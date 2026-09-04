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

// 依据昵称生成默认头像文字与糖果底色（与后端规则一致）
function avatarText(nickname: string): string {
  const chars = Array.from(nickname.trim())
  if (chars.length === 0) return '?'
  const code = chars[0].codePointAt(0)!
  if (code > 0x2e80) return chars[0] // CJK 取首字
  return chars.slice(0, 2).join('')
}

const candyColors = ['#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF', '#E8BAFF', '#FFB3DE']
function avatarColor(nickname: string): string {
  let h = 0
  for (const ch of nickname) h = (h * 31 + ch.codePointAt(0)!) % 100000
  return candyColors[h % candyColors.length]
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
      <!-- 贡献者合并组（非独立分类，一人一条去重） -->
      <section v-if="mergedEntries().length" class="cat-block">
        <h2>贡献者</h2>
        <div class="cards">
          <div
              v-for="e in mergedEntries()"
              :key="e.id"
              class="card"
              :title="descOf(e) || undefined"
          >
            <img
                v-if="e.avatar_url || avatarOf(e)"
                class="avatar"
                :src="avatarOf(e)"
                :alt="e.nickname"
                loading="lazy"
            />
            <span
                v-else
                class="avatar avatar-fallback"
                :style="{background: avatarColor(e.nickname)}"
            >{{ avatarText(e.nickname) }}</span>
            <div class="info">
              <div class="name">{{ e.nickname }}</div>
              <div class="sub">{{ e.display_id }}</div>
              <div v-if="extraSeparates(e).length" class="tags">
                <span v-for="c in extraSeparates(e)" :key="c.id" class="tag">{{ c.name }} {{ c.emoji }}</span>
              </div>
            </div>
            <ul v-if="checkItems.length" class="checks">
              <li
                  v-for="ci in checkItems"
                  :key="ci.id"
                  class="check"
                  :class="{done: e.check_states?.[String(ci.id)]}"
              >
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
            <span v-else class="avatar avatar-fallback" :style="{background: avatarColor(e.nickname)}">{{ avatarText(e.nickname) }}</span>
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
          <p v-if="!orphanSeparate(cat.id).length" class="hint">（暂无）</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.hint {
  color: #888;
  padding: 12px 0;
}
.empty {
  padding: 0;
}
.retry-btn {
  margin-top: 8px;
  padding: 5px 16px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.retry-btn:hover {
  border-color: #1f6feb;
  color: #1f6feb;
}
.cat-block {
  margin: 20px 0;
}
.cat-block h2 {
  font-size: 1.3em;
  margin-bottom: 12px;
}
.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.card {
  display: flex;
  flex-direction: column;
  width: 200px;
  padding: 12px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.05);
  cursor: default;
  position: relative;
  transition: box-shadow 0.2s;
}
.card:hover {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}
.avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  object-fit: cover;
  margin-bottom: 8px;
}
.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #333;
  font-weight: 700;
  font-size: 18px;
}
.name {
  font-weight: 600;
}
.sub {
  color: #888;
  font-size: 12px;
}
.tags {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tag {
  font-size: 11px;
  color: #1f6feb;
  background: #eef4ff;
  border-radius: 10px;
  padding: 0 7px;
  line-height: 18px;
}
.checks {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}
.check {
  font-size: 12px;
  color: #999;
}
.check .box {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 1px solid #aaa;
  border-radius: 3px;
  margin-right: 4px;
  line-height: 12px;
  font-size: 10px;
  text-align: center;
}
.check.done {
  color: #2e7d32;
}
.check.done .box {
  background: #2e7d32;
  color: #fff;
  border-color: #2e7d32;
}
.desc {
  font-size: 12px;
  color: #666;
  margin: 6px 0 0;
}
</style>
