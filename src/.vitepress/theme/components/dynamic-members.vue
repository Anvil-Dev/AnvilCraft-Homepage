<script lang="ts" setup>
// 特别鸣谢页动态区：从后端拉取贡献者条目并分组渲染。
// 规则：非 separate 分类的条目合并显示在「贡献者」组；
//       separate=true 的分类（如 实力富哥💵=赞助者）各自成独立分组。
// 卡片与历史贡献者墙一致：头像/昵称/ID/检查清单勾选/悬浮个人描述。

import {onMounted, onUnmounted, ref} from 'vue'
import {upUrl} from './img-url'

interface CheckItem {id: number; name: string; enabled: boolean}
interface Category {id: number; name: string; emoji: string; separate: boolean; separate_title: string}
interface Entry {
  id: number
  nickname: string
  avatar_url: string
  display_id: string
  description: string
  category_ids: number[]
  check_states: Record<string, boolean> | null
  user?: {bio?: string} | null
}

const apiBase = ref('')
const loading = ref(true)
const error = ref('')
const noConfig = ref(false)
const categories = ref<Category[]>([])
const entries = ref<Entry[]>([])
const checkItems = ref<CheckItem[]>([])

function descOf(e: Entry): string {
  return e.description || e.user?.bio || ''
}

function avatarOf(e: Entry): string {
  if (e.avatar_url) return upUrl(e.avatar_url)
  if (apiBase.value) return apiBase.value + '/api/v1/avatar.svg?name=' + encodeURIComponent(e.nickname)
  return ''
}

// 主「贡献者」组 = 所有非 separate 分类
const normalCats = () => categories.value.filter(c => !c.separate)
// 独立分组 = separate 分类（标题用 separate_title）
const separateCats = () => categories.value.filter(c => c.separate)
// 某分类下的条目（含多分类归属）
const entriesOf = (catId: number) => entries.value.filter(e => (e.category_ids ?? []).includes(catId))
// 「贡献者」合并组：出现在任一非 separate 分类下的条目（去重）
const mergedEntries = () => {
  const ids = new Set(normalCats().map(c => c.id))
  const seen = new Set<number>()
  return entries.value.filter(e => {
    if ((e.category_ids ?? []).some(id => ids.has(id))) {
      if (seen.has(e.id)) return false
      seen.add(e.id)
      return true
    }
    return false
  })
}
// 仅属于独立分类（separate）且不属于任何普通分类的条目（避免与合并组重复）
const orphanSeparate = (catId: number) => {
  const normalIds = new Set(normalCats().map(c => c.id))
  return entriesOf(catId).filter(e => !(e.category_ids ?? []).some(id => normalIds.has(id)))
}
// 普通条目额外归属的 separate 分类标记（如 代码民工 也赞助）
const extraSeparates = (e: Entry) => {
  return separateCats().filter(c => (e.category_ids ?? []).includes(c.id))
}

async function load() {
  loading.value = true
  error.value = ''
  const base = (window as any).__ANVIL_API_BASE__ as string | undefined
  apiBase.value = (base || '').replace(/\/$/, '')
  try {
    const [catRes, entryRes, checkRes] = await Promise.all([
      fetch(`${apiBase.value}/api/v1/categories`),
      fetch(`${apiBase.value}/api/v1/contributors`),
      fetch(`${apiBase.value}/api/v1/checklist`),
    ])
    if (!catRes.ok || !entryRes.ok || !checkRes.ok) throw new Error('接口请求失败')
    const catJson = await catRes.json()
    const entryJson = await entryRes.json()
    const checkJson = await checkRes.json()
    categories.value = catJson.categories ?? []
    entries.value = entryJson.entries ?? []
    checkItems.value = (checkJson.items ?? []).filter((i: CheckItem) => i.enabled)
    noConfig.value = false
    error.value = ''
  } catch (e: any) {
    error.value = `加载失败：${e?.message ?? e}`
  } finally {
    loading.value = false
  }
}

async function refreshSilently() {
  if (noConfig.value || !apiBase.value) return
  try {
    const [catRes, entryRes] = await Promise.all([
      fetch(`${apiBase.value}/api/v1/categories`),
      fetch(`${apiBase.value}/api/v1/contributors`),
    ])
    if (!catRes.ok || !entryRes.ok) return
    const catJson = await catRes.json()
    const entryJson = await entryRes.json()
    if (catJson.categories) categories.value = catJson.categories
    if (entryJson.entries) entries.value = entryJson.entries
  } catch { /* 静默 */ }
}

let pollTimer: number | null = null
onMounted(() => {
  load()
  pollTimer = window.setInterval(refreshSilently, 60 * 1000)
  document.addEventListener('visibilitychange', onVisibility)
})
function onVisibility() {
  if (!document.hidden) refreshSilently()
}
onUnmounted(() => {
  if (pollTimer) window.clearInterval(pollTimer)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div class="dynamic-members">
    <p v-if="loading" class="hint">加载中…</p>
    <div v-else-if="error" class="hint">
      <p>{{ error }}</p>
      <button v-if="!noConfig" class="retry-btn" @click="load">重试</button>
    </div>

    <template v-else>
      <!-- 贡献者合并组（非独立分类） -->
      <section v-if="mergedEntries().length" class="cat-block">
        <h2>贡献者</h2>
        <div class="cards">
          <div v-for="e in mergedEntries()" :key="e.id" class="card" :title="descOf(e) || undefined">
            <img v-if="e.avatar_url || avatarOf(e)" class="avatar" :src="avatarOf(e)" :alt="e.nickname" loading="lazy"/>
            <span v-else class="avatar avatar-fallback">{{ (e.nickname || '?').slice(0, 1) }}</span>
            <div class="info">
              <div class="name">{{ e.nickname }}</div>
              <div class="sub">{{ e.display_id }}</div>
              <div v-if="extraSeparates(e).length" class="tags">
                <span v-for="c in extraSeparates(e)" :key="c.id" class="tag">{{ c.name }} {{ c.emoji }}</span>
              </div>
            </div>
            <ul v-if="checkItems.length" class="checks">
              <li v-for="ci in checkItems" :key="ci.id" class="check" :class="{done: e.check_states?.[String(ci.id)]}">
                <span class="box">{{ e.check_states?.[String(ci.id)] ? '✔' : '' }}</span>
                {{ ci.name }}
              </li>
            </ul>
            <p v-if="descOf(e)" class="desc">{{ descOf(e) }}</p>
          </div>
        </div>
      </section>

      <!-- 独立分组（separate 分类，如 赞助者） -->
      <section v-for="cat in separateCats()" :key="'sep-' + cat.id" class="cat-block">
        <h2>{{ cat.separate_title || cat.name + ' ' + cat.emoji }}</h2>
        <div class="cards">
          <div v-for="e in orphanSeparate(cat.id)" :key="e.id" class="card" :title="descOf(e) || undefined">
            <img v-if="e.avatar_url || avatarOf(e)" class="avatar" :src="avatarOf(e)" :alt="e.nickname" loading="lazy"/>
            <span v-else class="avatar avatar-fallback">{{ (e.nickname || '?').slice(0, 1) }}</span>
            <div class="info">
              <div class="name">{{ e.nickname }}</div>
              <div class="sub">{{ e.display_id }}</div>
            </div>
            <ul v-if="checkItems.length" class="checks">
              <li v-for="ci in checkItems" :key="ci.id" class="check" :class="{done: e.check_states?.[String(ci.id)]}">
                <span class="box">{{ e.check_states?.[String(ci.id)] ? '✔' : '' }}</span>
                {{ ci.name }}
              </li>
            </ul>
            <p v-if="descOf(e)" class="desc">{{ descOf(e) }}</p>
          </div>
          <p v-if="!orphanSeparate(cat.id).length" class="hint empty">（暂无）</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.hint {color: #888; padding: 12px 0;}
.empty {padding: 0;}
.retry-btn {
  margin-top: 6px; padding: 6px 16px; cursor: pointer;
  border: 1px solid #d0d7de; border-radius: 6px; background: #fff;
}
.cat-block {margin-bottom: 28px;}
.cat-block h2 {
  font-size: 1.4em;
  border-bottom: 1px solid var(--vp-c-divider);
  padding-bottom: 8px;
  margin: 28px 0 16px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px;
}
.card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 16px 12px;
  text-align: center;
  background: var(--vp-c-bg-soft);
  transition: box-shadow 0.2s;
}
.card:hover {box-shadow: 0 4px 16px rgba(0,0,0,0.08);}
.avatar {
  width: 56px; height: 56px; border-radius: 50%;
  object-fit: cover; margin-bottom: 8px;
}
.avatar-fallback {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; border-radius: 50%;
  background: #e8ecf1; color: #57606a; font-size: 20px;
  margin-bottom: 8px;
}
.name {font-weight: 600; font-size: 14px; word-break: break-all;}
.sub {color: #8a9199; font-size: 12px; margin-top: 2px;}
.tags {margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; justify-content: center;}
.tag {
  font-size: 11px; color: #1f6feb; background: #eef4ff;
  border-radius: 10px; padding: 1px 8px;
}
.checks {list-style: none; margin: 10px 0 0; padding: 0; text-align: left;}
.checks .check {
  font-size: 11px; color: #8a9199; padding: 1px 0;
  display: flex; align-items: center; gap: 4px;
}
.checks .check.done {color: #2f855a;}
.checks .box {
  width: 12px; height: 12px; border: 1px solid #cbd5e1; border-radius: 3px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 9px; line-height: 1; flex-shrink: 0;
}
.checks .check.done .box {background: #2f855a; color: #fff; border-color: #2f855a;}
.desc {
  font-size: 12px; color: #6b7280; margin: 8px 0 0;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
</style>
