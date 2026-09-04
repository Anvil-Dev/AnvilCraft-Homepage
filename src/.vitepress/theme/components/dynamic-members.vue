<script lang="ts" setup>
// 特别鸣谢页动态区：从后端拉取贡献者条目并分组渲染。
// 规则：非 separate 分类的条目合并显示在「贡献者」组；
//       separate=true 的分类（如 实力富哥💵=赞助者）各自成独立分组。
// 卡片按参考图居中展示：发光头像/昵称/贡献项目/检查清单/展示 ID。

import {computed, onMounted, onUnmounted, ref} from 'vue'
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
// 卡片副标题：按后端分类顺序拼接该成员全部贡献项目
const categoryMap = computed(() => new Map(categories.value.map(c => [c.id, c])))
function categoryLine(e: Entry): string {
  return (e.category_ids ?? [])
      .map(id => categoryMap.value.get(id))
      .filter((c): c is Category => Boolean(c))
      .map(c => `${c.name} ${c.emoji}`)
      .join(' ')
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
          >
            <div class="avatar-ring">
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
            </div>
            <div class="info">
              <div class="name">{{ e.nickname }}</div>
              <div v-if="categoryLine(e)" class="roles">{{ categoryLine(e) }}</div>
              <p v-if="descOf(e)" class="desc">{{ descOf(e) }}</p>
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
            <div v-if="e.display_id" class="card-footer">@{{ e.display_id }}</div>
          </div>
        </div>
      </section>

      <!-- 独立分组（separate 分类，如 赞助者） -->
      <section v-for="cat in separateCats()" :key="'sep-' + cat.id" class="cat-block">
        <h2>{{ cat.separate_title || cat.name + ' ' + cat.emoji }}</h2>
        <div class="cards">
          <div v-for="e in orphanSeparate(cat.id)" :key="e.id" class="card">
            <div class="avatar-ring">
              <img v-if="e.avatar_url || avatarOf(e)" class="avatar" :src="avatarOf(e)" :alt="e.nickname" loading="lazy"/>
              <span v-else class="avatar avatar-fallback" :style="{background: avatarColor(e.nickname)}">{{ avatarText(e.nickname) }}</span>
            </div>
            <div class="info">
              <div class="name">{{ e.nickname }}</div>
              <div v-if="categoryLine(e)" class="roles">{{ categoryLine(e) }}</div>
              <p v-if="descOf(e)" class="desc">{{ descOf(e) }}</p>
            </div>
            <ul v-if="checkItems.length" class="checks">
              <li v-for="ci in checkItems" :key="ci.id" class="check" :class="{done: e.check_states?.[String(ci.id)]}">
                <span class="box">{{ e.check_states?.[String(ci.id)] ? '✔' : '' }}</span>
                {{ ci.name }}
              </li>
            </ul>
            <div v-if="e.display_id" class="card-footer">@{{ e.display_id }}</div>
          </div>
          <p v-if="!orphanSeparate(cat.id).length" class="hint">（暂无）</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.hint {
  color: var(--vp-c-text-3);
  padding: 12px 0;
}
.retry-btn {
  margin-top: 8px;
  padding: 5px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 13px;
}
.retry-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.cat-block {
  margin: 20px 0;
}
.cat-block h2 {
  color: var(--vp-c-text-1);
  font-size: 1.3em;
  margin-bottom: 12px;
}
.cards {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
  max-width: 784px;
  margin: 0 auto;
}
.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(calc(50% - 8px), 376px);
  min-height: 280px;
  padding: 28px 24px 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 18px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  text-align: center;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
}
.card:hover {
  transform: translateY(-2px);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.14);
}
.avatar-ring {
  width: 88px;
  height: 88px;
  padding: 3px;
  margin: 0 auto 18px;
  border-radius: 50%;
  background: linear-gradient(135deg, #41d1ff, #00a7c7);
  box-shadow: 0 0 0 3px var(--vp-c-brand-soft), 0 0 22px rgba(65, 209, 255, 0.28);
}
.avatar {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  background: var(--vp-c-bg);
}
.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.72);
  font-weight: 700;
  font-size: 22px;
}
.info {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.name {
  color: var(--vp-c-text-1);
  font-size: 20px;
  font-weight: 700;
  line-height: 28px;
}
.roles {
  margin-top: 8px;
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.7;
}
.desc {
  display: -webkit-box;
  margin: 8px 0 0;
  overflow: hidden;
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.checks {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-3);
  font-size: 12px;
  line-height: 16px;
}
.check .box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  border: 1px solid currentColor;
  border-radius: 3px;
  font-size: 10px;
  line-height: 12px;
}
.check.done {
  border-color: transparent;
  background: var(--vp-c-tip-soft);
  color: var(--vp-c-tip-1);
}
.check.done .box {
  border-color: transparent;
  background: var(--vp-c-tip-1);
  color: var(--vp-c-bg);
}
.card-footer {
  width: 100%;
  margin-top: auto;
  padding-top: 16px;
  color: var(--vp-c-text-3);
  font-size: 13px;
  line-height: 20px;
}
:global(.dark) .card {
  border-color: rgba(255, 255, 255, 0.08);
  background: var(--vp-c-bg-elv, var(--vp-c-bg-soft));
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.32);
}
:global(.dark) .card:hover {
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.48);
}
:global(.dark) .avatar-ring {
  box-shadow: 0 0 0 3px rgba(65, 209, 255, 0.12), 0 0 26px rgba(65, 209, 255, 0.35);
}
@media (max-width: 640px) {
  .cards {
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }
  .card {
    width: 100%;
    max-width: 380px;
    min-height: 0;
  }
}
</style>
