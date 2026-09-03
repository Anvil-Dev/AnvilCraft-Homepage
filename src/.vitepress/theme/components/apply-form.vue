<script lang="ts" setup>
// 贡献者申请表单：登录（GitHub OAuth / Device Flow）后提交；多图上传并前端压缩为 JPG。
import {onMounted, ref} from 'vue'

interface Category {id: number; name: string; emoji: string}
interface UserInfo {
  id: number; username: string; nickname: string; avatar_url: string; bio: string; role: string
}

// 官网静态站不引入 Arco，这里使用原生 HTML 表单元素（样式沿用页面样式）。
const apiBase = ref('')
const enabled = ref(false)

const loggedUser = ref<UserInfo | null>(null)
const token = ref('')
const categories = ref<Category[]>([])

const form = ref({
  category_id: 0,
  nickname: '',
  id: '',
  qq: '',
  bilibili_uid: '',
  mc_id: '',
  description: '',
})
const imageFiles = ref<File[]>([])
const imagePreviews = ref<string[]>([])
const submitting = ref(false)
const errorMsg = ref('')
const device = ref<{device_code: string; user_code: string; verification_uri: string} | null>(null)
const pollTimer = ref<number | null>(null)

// 我的申请（5.2：待审核可修改/撤回）
interface MyApp {
  id: number
  category_id: number
  nickname: string
  display_id: string
  qq: string
  bilibili_uid: string
  mc_id: string
  description: string
  status: string
  reject_reason?: string
  created_at: string
}
const myApps = ref<MyApp[]>([])
const editingAppId = ref<number | null>(null) // 正在编辑的申请 id（null=新申请）
const noticeMsg = ref('')

const TOKEN_KEY = 'anvil_website_token'
const MAX_IMAGES = 10
const MAX_SIZE = 5 * 1024 * 1024

function apiURL(p: string) {
  return apiBase.value.replace(/\/$/, '') + '/api/v1' + p
}

function setAuth(t: string, u: UserInfo) {
  token.value = t
  loggedUser.value = u
  localStorage.setItem(TOKEN_KEY, t)
  loadMyApps().catch(() => {})
}

function logout() {
  token.value = ''
  loggedUser.value = null
  localStorage.removeItem(TOKEN_KEY)
  myApps.value = []
  editingAppId.value = null
}

async function beginLogin() {
  errorMsg.value = ''
  try {
    // 尝试 Device Flow 起始（后端未配置 Secret 时返回设备码）
    const r = await fetch(apiURL('/auth/device/start'))
    const j = await r.json()
    if (j.device_flow) {
      device.value = j
      startPolling(j.device_code)
      return
    }
  } catch {
    /* 忽略 */
  }
  // 标准 OAuth 授权跳转
  window.location.href = apiURL('/auth/begin')
}

async function pollOnce(deviceCode: string) {
  try {
    const r = await fetch(apiURL('/auth/device/poll'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({device_code: deviceCode}),
    })
    const j = await r.json()
    if (j.token) {
      setAuth(j.token, j.user)
      device.value = null
      if (pollTimer.value) window.clearInterval(pollTimer.value)
      await loadMyApps()
      await prefillFromEntry(j.user.id)
      return true
    }
  } catch {
    /* 忽略 */
  }
  return false
}

async function startPolling(deviceCode: string) {
  if (pollTimer.value) window.clearInterval(pollTimer.value)
  const tick = async () => {
    const done = await pollOnce(deviceCode)
    if (!done) pollTimer.value = window.setTimeout(tick, 5000)
  }
  tick()
}

// ---------- 图片压缩为 JPG ----------
async function fileToJpeg(file: File): Promise<File> {
  if (file.type === 'image/jpeg' && file.size <= MAX_SIZE) return file
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const MAX_EDGE = 1600
      let {width, height} = img
      if (width > MAX_EDGE || height > MAX_EDGE) {
        const ratio = Math.min(MAX_EDGE / width, MAX_EDGE / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('图片压缩失败'))
        const f = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {type: 'image/jpeg'})
        resolve(f)
      }, 'image/jpeg', 0.85)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

async function onPickFiles(list: FileList | null) {
  if (!list) return
  errorMsg.value = ''
  for (const f of Array.from(list)) {
    if (imageFiles.value.length >= MAX_IMAGES) {
      errorMsg.value = `最多上传 ${MAX_IMAGES} 张图片`
      break
    }
    try {
      const jpg = await fileToJpeg(f)
      imageFiles.value.push(jpg)
      imagePreviews.value.push(URL.createObjectURL(jpg))
    } catch (e: any) {
      errorMsg.value = e?.message ?? '图片处理失败'
    }
  }
}

function removeImage(i: number) {
  imageFiles.value.splice(i, 1)
  imagePreviews.value.splice(i, 1)
}

// 拉取我的申请列表
async function loadMyApps() {
  if (!token.value) return
  try {
    const r = await fetch(apiURL('/applications/mine'), {headers: {Authorization: `Bearer ${token.value}`}})
    if (r.ok) {
      const j = await r.json()
      myApps.value = j.applications ?? []
    }
  } catch {
    /* 忽略 */
  }
}

// 编辑待审核申请（回填表单并切到编辑模式）
function editApp(a: MyApp) {
  editingAppId.value = a.id
  form.value = {
    category_id: a.category_id,
    nickname: a.nickname,
    id: a.display_id,
    qq: a.qq,
    bilibili_uid: a.bilibili_uid,
    mc_id: a.mc_id,
    description: a.description,
  }
  imageFiles.value = []
  imagePreviews.value.forEach((p) => URL.revokeObjectURL(p))
  imagePreviews.value = []
  noticeMsg.value = ''
  window.scrollTo({top: 0, behavior: 'smooth'})
}

// 撤回待审核申请
async function withdrawApp(a: MyApp) {
  if (!confirm(`确定撤回申请「${a.nickname}」吗？`)) return
  try {
    const r = await fetch(apiURL(`/applications/${a.id}/withdraw`), {
      method: 'POST', headers: {Authorization: `Bearer ${token.value}`},
    })
    if (r.ok) {
      noticeMsg.value = '已撤回申请'
      await loadMyApps()
    } else {
      const j = await r.json()
      errorMsg.value = j.error ?? '撤回失败'
    }
  } catch {
    errorMsg.value = '撤回失败'
  }
}

function statusLabel(s: string): string {
  return {pending: '待审核', approved: '已通过', rejected: '已拒绝', withdrawn: '已撤回'}[s] ?? s
}

function catName(id: number): string {
  const c = categories.value.find((x) => x.id === id)
  return c ? `${c.name} ${c.emoji}` : `#${id}`
}

function cancelEdit() {
  editingAppId.value = null
  form.value = {category_id: 0, nickname: '', id: '', qq: '', bilibili_uid: '', mc_id: '', description: ''}
  errorMsg.value = ''
}

// ---------- 提交 ----------
async function submit() {
  errorMsg.value = ''
  if (!token.value || !loggedUser.value) {
    errorMsg.value = '请先登录'
    return
  }
  if (!form.value.category_id) {
    errorMsg.value = '请选择贡献项目'
    return
  }
  if (!form.value.nickname.trim()) {
    errorMsg.value = '昵称必填'
    return
  }
  submitting.value = true
  try {
    // 先逐张上传图片
    const uploaded: string[] = []
    for (const f of imageFiles.value) {
      const fd = new FormData()
      fd.append('file', f)
      try {
        const r = await fetch(apiURL('/uploads'), {method: 'POST', headers: {Authorization: `Bearer ${token.value}`}, body: fd})
        const j = await r.json()
        if (r.ok && j.url) uploaded.push(j.url)
      } catch {
        // 上传端点不可用时跳过（开发期）
      }
    }
    const payload = {...form.value, images: uploaded}
    const isEdit = editingAppId.value !== null
    const r = await fetch(isEdit ? apiURL(`/applications/${editingAppId.value}`) : apiURL('/applications'), {
      method: isEdit ? 'PUT' : 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token.value}`},
      body: JSON.stringify(payload),
    })
    const j = await r.json()
    if (!r.ok) {
      errorMsg.value = j.error ?? (isEdit ? '修改失败' : '提交失败')
      return
    }
    alert(isEdit ? '申请已更新，等待管理员审核' : '申请已提交，等待管理员审核')
    editingAppId.value = null
    form.value = {category_id: 0, nickname: '', id: '', qq: '', bilibili_uid: '', mc_id: '', description: ''}
    imageFiles.value = []
    imagePreviews.value.forEach((p) => URL.revokeObjectURL(p))
    imagePreviews.value = []
    await loadMyApps()
  } catch (e: any) {
    errorMsg.value = e?.message ?? (editingAppId.value ? '修改失败' : '提交失败')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  const base = (window as any).__ANVIL_API_BASE__ as string | undefined
  if (!base) {
    errorMsg.value = '尚未配置后端 API（window.__ANVIL_API_BASE__）'
    return
  }
  apiBase.value = base.replace(/\/$/, '')
  const saved = localStorage.getItem(TOKEN_KEY)
  if (saved) {
    token.value = saved
    // 尝试拉取 me 校验
    try {
      const r = await fetch(apiURL('/auth/me'), {headers: {Authorization: `Bearer ${saved}`}})
      if (r.ok) {
        const j = await r.json()
        loggedUser.value = j.user
        await loadMyApps()
        await prefillFromEntry(j.user.id)
      } else {
        logout()
      }
    } catch {
      /* 离线忽略 */
    }
  }
  try {
    const r = await fetch(apiURL('/categories'))
    if (r.ok) {
      const j = await r.json()
      categories.value = j.categories ?? []
      enabled.value = true
    }
  } catch {
    errorMsg.value = '无法连接后端'
  }
})

// 5.2：若用户已绑定贡献者条目且无待审核申请，再次申请时基于最新条目预填表单
async function prefillFromEntry(userId: number) {
  // 有待审核申请时不预填（应通过「我的申请」编辑）
  if (myApps.value.some((a) => a.status === 'pending')) return
  try {
    const r = await fetch(apiURL(`/contributors?user_id=${userId}`), {
      headers: {Authorization: `Bearer ${token.value}`},
    })
    if (!r.ok) return
    const j = await r.json()
    const list: any[] = j.entries ?? []
    if (!list.length) return
    // 取最近更新的条目（按 id desc 由后端排序保证近似）
    const e = list[list.length - 1]
    form.value.category_id = e.category_id ?? 0
    form.value.nickname = e.nickname ?? ''
    form.value.id = e.display_id ?? ''
    form.value.qq = e.qq ?? ''
    form.value.bilibili_uid = e.bilibili_uid ?? ''
    form.value.mc_id = e.mc_id ?? ''
    form.value.description = e.description ?? ''
  } catch {
    /* 预填失败不阻塞 */
  }
}
</script>

<template>
  <div class="apply-page">
    <p v-if="!enabled && errorMsg" class="hint">{{ errorMsg }}</p>

    <template v-if="enabled">
      <!-- 登录区 -->
      <section v-if="!loggedUser" class="panel">
        <h3>申请成为贡献者</h3>
        <p class="hint">登录后即可提交申请（GitHub 授权）。</p>
        <button class="btn primary" @click="beginLogin">使用 GitHub 登录</button>
        <div v-if="device" class="device">
          <p>请在 GitHub 设备授权页输入设备码：</p>
          <div class="code">{{ device.user_code }}</div>
          <p class="hint">授权地址：{{ device.verification_uri }}（等待自动确认…）</p>
        </div>
      </section>

      <section v-else class="panel">
        <div class="user-bar">
          <img v-if="loggedUser.avatar_url" :src="loggedUser.avatar_url" class="avatar" alt="头像" />
          <span>{{ loggedUser.nickname || loggedUser.username }}（{{ loggedUser.role }}）</span>
          <button class="btn" @click="logout">退出</button>
        </div>

        <!-- 我的申请（待审核可修改/撤回） -->
        <div v-if="myApps.length" class="my-apps">
          <h4>我的申请</h4>
          <table class="app-table">
            <thead><tr><th>项目</th><th>昵称</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="a in myApps" :key="a.id">
                <td>{{ catName(a.category_id) }}</td>
                <td>{{ a.nickname }}</td>
                <td>
                  <span class="status" :class="a.status">{{ statusLabel(a.status) }}</span>
                  <div v-if="a.status === 'rejected' && a.reject_reason" class="reject">原因：{{ a.reject_reason }}</div>
                </td>
                <td class="time">{{ new Date(a.created_at).toLocaleDateString() }}</td>
                <td>
                  <button v-if="a.status === 'pending'" class="btn mini" @click="editApp(a)">修改</button>
                  <button v-if="a.status === 'pending'" class="btn mini danger" @click="withdrawApp(a)">撤回</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <form class="apply-form" @submit.prevent="submit">
          <h4 v-if="editingAppId !== null">修改申请（#{{ editingAppId }}）</h4>
          <p v-else-if="noticeMsg" class="ok">{{ noticeMsg }}</p>
          <label class="field">
            贡献项目（必选）
            <select v-model.number="form.category_id">
              <option :value="0" disabled>请选择</option>
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }} {{ c.emoji }}</option>
            </select>
          </label>
          <label class="field">昵称（必填）<input v-model="form.nickname" placeholder="你的昵称" required /></label>
          <label class="field">ID<input v-model="form.id" placeholder="GitHub 用户名等（可选）" /></label>
          <label class="field">QQ<input v-model="form.qq" placeholder="选填" /></label>
          <label class="field">B站UID<input v-model="form.bilibili_uid" placeholder="选填" /></label>
          <label class="field">Minecraft 正版 ID<input v-model="form.mc_id" placeholder="选填" /></label>
          <label class="field">文字说明<textarea v-model="form.description" rows="3" placeholder="选填" /></label>

          <div class="field">
            <span>截图/图片（最多 {{ MAX_IMAGES }} 张，自动压缩为 JPG）</span>
            <input type="file" accept="image/*" multiple @change="(e: Event) => onPickFiles((e.target as HTMLInputElement).files)" />
            <div class="imgs">
              <div v-for="(p, i) in imagePreviews" :key="i" class="img-item">
                <img :src="p" alt="预览" />
                <button type="button" class="remove" @click="removeImage(i)">×</button>
              </div>
            </div>
          </div>

          <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
          <div class="form-actions">
            <button type="submit" class="btn primary" :disabled="submitting">
              {{ submitting ? '提交中…' : editingAppId !== null ? '更新申请' : '提交申请' }}
            </button>
            <button v-if="editingAppId !== null" type="button" class="btn" @click="cancelEdit">取消编辑</button>
          </div>
        </form>
      </section>
    </template>
  </div>
</template>

<style scoped>
.panel {
  max-width: 520px;
  margin: 0 auto;
  padding: 20px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 12px;
  background: rgba(128, 128, 128, 0.04);
}
.hint {
  color: #888;
  font-size: 13px;
}
.code {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 4px;
  color: #c62828;
}
.btn {
  padding: 8px 18px;
  border-radius: 8px;
  border: 1px solid #ccc;
  cursor: pointer;
  background: #fff;
}
.btn.primary {
  background: #1f6feb;
  border-color: #1f6feb;
  color: #fff;
  font-weight: 600;
}
.user-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
}
.apply-form .field {
  display: block;
  margin: 10px 0;
  font-size: 14px;
}
.apply-form input,
.apply-form select,
.apply-form textarea {
  width: 100%;
  margin-top: 4px;
  padding: 7px 10px;
  border: 1px solid #ccc;
  border-radius: 8px;
  box-sizing: border-box;
  font-size: 14px;
}
.imgs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.img-item {
  position: relative;
}
.img-item img {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid #ddd;
}
.remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  line-height: 16px;
  border-radius: 50%;
  border: none;
  background: #e33;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
}
.error {
  color: #c62828;
  font-size: 13px;
}
.ok {
  color: #2e7d32;
  font-size: 13px;
}
.my-apps {
  margin-bottom: 16px;
  border-top: 1px solid rgba(128, 128, 128, 0.2);
  padding-top: 10px;
}
.app-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.app-table th,
.app-table td {
  padding: 6px 6px;
  text-align: left;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}
.status {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  background: #eee;
}
.status.pending { background: #fff3e0; color: #b26a00; }
.status.approved { background: #e8f5e9; color: #2e7d32; }
.status.rejected { background: #fdecea; color: #c62828; }
.status.withdrawn { background: #eee; color: #777; }
.reject {
  font-size: 12px;
  color: #c62828;
}
.time {
  color: #888;
  font-size: 12px;
  white-space: nowrap;
}
.btn.mini {
  padding: 3px 10px;
  font-size: 12px;
  margin-right: 4px;
}
.btn.mini.danger {
  border-color: #e33;
  color: #e33;
}
.form-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
</style>
