<script lang="ts" setup>
// 个人中心：登录后查看/编辑个人描述与头像、邮箱 TOTP 绑定。
import {onMounted, onUnmounted, ref} from 'vue'

interface UserInfo {
  id: number
  username: string
  nickname: string
  avatar_url: string
  bio: string
  role: string
  email?: string
  email_verified?: boolean
}

const apiBase = ref('')
const enabled = ref(false)
const errorMsg = ref('')

const token = ref('')
const me = ref<UserInfo | null>(null)

const form = ref({nickname: '', avatar_url: '', bio: ''})
const saving = ref(false)
const msg = ref('')

// TOTP 绑定
const totpStep = ref<'idle' | 'secret' | 'done'>('idle')
const totpEmail = ref('')
const totpSecret = ref('')
const totpAuthURL = ref('')
const totpCode = ref('')
const totpMsg = ref('')

const device = ref<{device_code: string; user_code: string; verification_uri: string} | null>(null)
const deviceExpired = ref(false)
let pollTimer: number | null = null
let pollDeadline = 0
const POLL_TIMEOUT_MS = 15 * 60 * 1000

const TOKEN_KEY = 'anvil_website_token'

function apiURL(p: string) {
  return apiBase.value.replace(/\/$/, '') + '/api/v1' + p
}

async function beginLogin() {
  errorMsg.value = ''
  deviceExpired.value = false
  try {
    const r = await fetch(apiURL('/auth/device/start'))
    const j = await r.json()
    if (j.device_flow) {
      device.value = j
      pollDeadline = Date.now() + POLL_TIMEOUT_MS
      const tick = async () => {
        const ok = await pollOnce(j.device_code)
        if (!ok && !deviceExpired.value) pollTimer = window.setTimeout(tick, 5000)
      }
      tick()
      return
    }
  } catch {
    /* 忽略 */
  }
  window.location.href = apiURL('/auth/begin')
}

function cancelDevicePolling() {
  if (pollTimer) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
  device.value = null
  deviceExpired.value = false
  pollDeadline = 0
}

onUnmounted(() => {
  if (pollTimer) window.clearTimeout(pollTimer)
})

async function pollOnce(deviceCode: string): Promise<boolean> {
  if (Date.now() > pollDeadline) {
    deviceExpired.value = true
    return false
  }
  try {
    const r = await fetch(apiURL('/auth/device/poll'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({device_code: deviceCode}),
    })
    const j = await r.json()
    if (j.token) {
      token.value = j.token
      me.value = j.user
      localStorage.setItem(TOKEN_KEY, j.token)
      fillForm(j.user)
      device.value = null
      return true
    }
  } catch {
    /* 忽略 */
  }
  return false
}

function fillForm(u: UserInfo) {
  form.value = {nickname: u.nickname ?? '', avatar_url: u.avatar_url ?? '', bio: u.bio ?? ''}
  if (u.email) {
    totpEmail.value = u.email
    totpStep.value = 'done'
  }
}

async function refreshMe() {
  try {
    const r = await fetch(apiURL('/auth/me'), {headers: {Authorization: `Bearer ${token.value}`}})
    if (r.ok) {
      const j = await r.json()
      me.value = j.user
      fillForm(j.user)
    }
  } catch {
    /* 忽略 */
  }
}

async function saveProfile() {
  if (!token.value) return
  saving.value = true
  msg.value = ''
  try {
    const r = await fetch(apiURL('/users/me/profile'), {
      method: 'PUT',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token.value}`},
      body: JSON.stringify(form.value),
    })
    const j = await r.json()
    if (!r.ok) {
      msg.value = j.error ?? '保存失败'
      return
    }
    me.value = j.user
    msg.value = '已保存'
    await refreshMe()
  } catch {
    msg.value = '保存失败'
  } finally {
    saving.value = false
  }
}

function logout() {
  token.value = ''
  me.value = null
  localStorage.removeItem(TOKEN_KEY)
}

// 头像上传：压缩到 256px 方形 JPG 后上传，成功后回填 avatar_url
const uploadingAvatar = ref(false)
const avatarMsg = ref('')

async function uploadAvatar(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !token.value) return
  uploadingAvatar.value = true
  avatarMsg.value = ''
  try {
    // 压缩为方形小图
    const img = await loadImage(file)
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, size, size)
    const side = Math.min(img.width, img.height)
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size)
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) throw new Error('图片压缩失败')
    const fd = new FormData()
    fd.append('file', new File([blob], 'avatar.jpg', {type: 'image/jpeg'}))
    const r = await fetch(apiURL('/uploads'), {method: 'POST', headers: {Authorization: `Bearer ${token.value}`}, body: fd})
    const j = await r.json()
    if (!r.ok || !j.url) throw new Error(j.error ?? '上传失败')
    form.value.avatar_url = j.url
    avatarMsg.value = '头像已上传，点击「保存资料」生效'
  } catch (err: any) {
    avatarMsg.value = '上传失败：' + (err?.message ?? err)
  } finally {
    uploadingAvatar.value = false
    input.value = ''
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')) }
    img.src = url
  })
}

// ---------- 邀请码注册为管理员 ----------
const inviteCode = ref('')
const regBusy = ref(false)
const regMsg = ref('')
const regErrMsg = ref('')

async function registerAsAdmin() {
  if (!token.value || !me.value) return
  if (totpStep.value !== 'done') {
    regErrMsg.value = '请先完成邮箱 TOTP 绑定'
    return
  }
  if (!inviteCode.value.trim()) {
    regErrMsg.value = '请输入邀请码'
    return
  }
  regBusy.value = true
  regMsg.value = ''
  regErrMsg.value = ''
  try {
    const r = await fetch(apiURL('/auth/register-admin'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token.value}`},
      body: JSON.stringify({
        invite_code: inviteCode.value.trim(),
        email: totpEmail.value || me.value.email || '',
        totp_code: totpCode.value.trim(),
      }),
    })
    const j = await r.json()
    if (!r.ok) {
      regErrMsg.value = j.error ?? '注册失败'
      return
    }
    token.value = j.token
    me.value = j.user
    localStorage.setItem(TOKEN_KEY, j.token)
    regMsg.value = '注册成功，已成为管理员！'
    inviteCode.value = ''
  } catch {
    regErrMsg.value = '注册失败：网络错误，请重试'
  } finally {
    regBusy.value = false
  }
}

// ---------- TOTP ----------
async function requestTOTP() {
  totpMsg.value = ''
  if (!totpEmail.value.trim()) {
    totpMsg.value = '请先填写邮箱'
    return
  }
  try {
    const r = await fetch(apiURL('/auth/totp/request'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token.value}`},
      body: JSON.stringify({email: totpEmail.value.trim()}),
    })
    const j = await r.json()
    if (!r.ok) {
      totpMsg.value = j.error ?? '请求失败'
      return
    }
    totpSecret.value = j.secret
    totpAuthURL.value = j.otpauth_url
    totpStep.value = 'secret'
    totpMsg.value = '请将以下密钥加入你的 TOTP 验证器（如 Google Authenticator）'
  } catch {
    totpMsg.value = '请求失败'
  }
}

async function verifyTOTP() {
  totpMsg.value = ''
  try {
    const r = await fetch(apiURL('/auth/totp/verify'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token.value}`},
      body: JSON.stringify({code: totpCode.value.trim()}),
    })
    const j = await r.json()
    if (!r.ok) {
      totpMsg.value = j.error ?? '验证失败'
      return
    }
    totpMsg.value = '邮箱 TOTP 绑定成功'
    totpStep.value = 'done'
  } catch {
    totpMsg.value = '验证失败'
  }
}

onMounted(async () => {
  const base = (window as any).__ANVIL_API_BASE__ as string | undefined
  if (!base) {
    errorMsg.value = '尚未配置后端 API（window.__ANVIL_API_BASE__）'
    return
  }
  apiBase.value = base.replace(/\/$/, '')
  enabled.value = true
  const saved = localStorage.getItem(TOKEN_KEY)
  if (saved) {
    token.value = saved
    await refreshMe()
  }
})
</script>

<template>
  <div class="profile-page">
    <p v-if="!enabled && errorMsg" class="hint">{{ errorMsg }}</p>
    <template v-if="enabled">
      <section v-if="!me" class="panel">
        <h3>个人中心</h3>
        <p class="hint">登录后即可编辑个人描述与头像。</p>
        <button class="btn primary" @click="beginLogin">使用 GitHub 登录</button>
        <div v-if="device" class="device">
          <p>请在 GitHub 设备授权页输入设备码：</p>
          <div class="code">{{ device.user_code }}</div>
          <p class="hint">授权地址：{{ device.verification_uri }}（等待自动确认…）</p>
          <p v-if="deviceExpired" class="error">设备码已过期，请重新点击 GitHub 登录。</p>
          <button class="btn" @click="cancelDevicePolling">取消等待</button>
        </div>
      </section>

      <section v-else class="panel">
        <div class="user-bar">
          <img v-if="me.avatar_url" :src="me.avatar_url" class="avatar" alt="头像" />
          <span>{{ me.nickname || me.username }}（{{ me.role }}）· GitHub: {{ me.username }}</span>
          <button class="btn" @click="logout">退出</button>
        </div>

        <h4>个人资料</h4>
        <label class="field">昵称<input v-model="form.nickname" /></label>
        <div class="field">
          <span>头像</span>
          <div class="avatar-row">
            <img v-if="form.avatar_url" :src="form.avatar_url" class="avatar-preview" alt="头像预览" />
            <label class="btn" :class="{disabled: uploadingAvatar}" for="avatar-file-input">
              {{ uploadingAvatar ? '上传中…' : '上传头像' }}
            </label>
            <input id="avatar-file-input" type="file" accept="image/*" class="hide-input" @change="uploadAvatar" />
          </div>
          <div class="avatar-sub">
            <input v-model="form.avatar_url" placeholder="或直接填写头像 URL（留空使用 GitHub 头像）" />
          </div>
          <span v-if="avatarMsg" class="ok small-tip">{{ avatarMsg }}</span>
        </div>
        <label class="field">个人描述<textarea v-model="form.bio" rows="4" placeholder="写一段关于你的介绍（悬浮贡献者卡片时展示）" /></label>
        <button class="btn primary" :disabled="saving" @click="saveProfile">{{ saving ? '保存中…' : '保存资料' }}</button>
        <p v-if="msg" class="ok">{{ msg }}</p>

        <h4>邮箱 TOTP 绑定（管理员注册需要）</h4>
        <div v-if="totpStep === 'done'">
          <p class="hint">已绑定邮箱：{{ totpEmail || me.email || '—' }}</p>
        </div>
        <template v-else>
          <label class="field">邮箱<input v-model="totpEmail" placeholder="用于 TOTP 二次验证" /></label>
          <template v-if="totpStep === 'secret'">
            <div class="secret-box">
              <p class="hint">密钥：<code>{{ totpSecret }}</code></p>
              <p class="hint">验证器地址：<code class="small">{{ totpAuthURL }}</code></p>
              <label class="field">当前验证码<input v-model="totpCode" placeholder="6 位动态码" /></label>
              <button class="btn primary" @click="verifyTOTP">验证并绑定</button>
            </div>
          </template>
          <button v-else class="btn primary" @click="requestTOTP">获取绑定密钥</button>
          <p v-if="totpMsg" class="ok">{{ totpMsg }}</p>
        </template>

        <!-- 邀请码注册为管理员（2.2：仅普通用户、需先完成邮箱 TOTP 绑定） -->
        <template v-if="me?.role === 'user'">
          <h4>邀请码注册为管理员</h4>
          <div class="secret-box">
            <p class="hint">输入超级管理员分发的邀请码，将当前账号升级为管理员（权限由超管在后台分配）。</p>
            <label class="field">邀请码<input v-model="inviteCode" placeholder="一次性邀请码" /></label>
            <button class="btn primary" :disabled="regBusy || totpStep !== 'done'" @click="registerAsAdmin">
              {{ regBusy ? '提交中…' : '提交注册' }}
            </button>
            <p v-if="totpStep !== 'done'" class="hint">请先完成上方邮箱 TOTP 绑定后再注册</p>
            <p v-if="regMsg" class="ok">{{ regMsg }}</p>
            <p v-if="regErrMsg" class="error">{{ regErrMsg }}</p>
          </div>
        </template>
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
.ok {
  color: #2e7d32;
  font-size: 13px;
}
.error {
  color: #c62828;
  font-size: 13px;
}
.code {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 4px;
  color: #c62828;
}
.small {
  font-size: 11px;
  word-break: break-all;
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
  margin-bottom: 12px;
}
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}
.field {
  display: block;
  margin: 10px 0;
  font-size: 14px;
}
.field input,
.field textarea {
  width: 100%;
  margin-top: 4px;
  padding: 7px 10px;
  border: 1px solid #ccc;
  border-radius: 8px;
  box-sizing: border-box;
  font-size: 14px;
}
.secret-box {
  background: #f6f8fa;
  border-radius: 8px;
  padding: 10px;
  margin: 6px 0;
}
.avatar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}
.avatar-preview {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid #ddd;
}
.hide-input {
  display: none;
}
.btn.disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.avatar-sub {
  margin-top: 6px;
}
.avatar-sub input {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #ccc;
  border-radius: 8px;
  box-sizing: border-box;
  font-size: 14px;
}
.small-tip {
  display: block;
  font-size: 12px;
  margin-top: 4px;
}
</style>
