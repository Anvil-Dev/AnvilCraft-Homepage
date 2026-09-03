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
}

function logout() {
  token.value = ''
  loggedUser.value = null
  localStorage.removeItem(TOKEN_KEY)
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
    // 先逐张上传图片（上传端点规划为 POST /uploads；后端未实现时回退为直接提交图片名占位）
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
    const r = await fetch(apiURL('/applications'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token.value}`},
      body: JSON.stringify({...form.value, images: uploaded}),
    })
    const j = await r.json()
    if (!r.ok) {
      errorMsg.value = j.error ?? '提交失败'
      return
    }
    alert('申请已提交，等待管理员审核')
    form.value = {category_id: 0, nickname: '', id: '', qq: '', bilibili_uid: '', mc_id: '', description: ''}
    imageFiles.value = []
    imagePreviews.value.forEach((p) => URL.revokeObjectURL(p))
    imagePreviews.value = []
  } catch (e: any) {
    errorMsg.value = e?.message ?? '提交失败'
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

        <form class="apply-form" @submit.prevent="submit">
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
          <button type="submit" class="btn primary" :disabled="submitting">
            {{ submitting ? '提交中…' : '提交申请' }}
          </button>
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
</style>
