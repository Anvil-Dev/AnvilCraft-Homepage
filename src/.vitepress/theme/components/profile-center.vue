<script lang="ts" setup>
// 个人中心：登录后查看/编辑个人描述与头像、邮箱 TOTP 绑定。
import {onMounted, ref} from 'vue'

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
let pollTimer: number | null = null

const TOKEN_KEY = 'anvil_website_token'

function apiURL(p: string) {
  return apiBase.value.replace(/\/$/, '') + '/api/v1' + p
}

async function beginLogin() {
  errorMsg.value = ''
  try {
    const r = await fetch(apiURL('/auth/device/start'))
    const j = await r.json()
    if (j.device_flow) {
      device.value = j
      const tick = async () => {
        const ok = await pollOnce(j.device_code)
        if (!ok) pollTimer = window.setTimeout(tick, 5000)
      }
      tick()
      return
    }
  } catch {
    /* 忽略 */
  }
  window.location.href = apiURL('/auth/begin')
}

async function pollOnce(deviceCode: string): Promise<boolean> {
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
        <label class="field">头像 URL<input v-model="form.avatar_url" placeholder="留空使用 GitHub 头像" /></label>
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
</style>
