<script lang="ts" setup>
// 独立登录页核心：GitHub OAuth 优先，未配置 Secret 时使用 Device Flow。
// 登录成功后写入全局 authStore，并回跳 ?redirect= 指定路径（默认个人中心）。
// 若已登录则直接展示「已登录」状态与跳转按钮。

import {onMounted, onUnmounted, ref} from 'vue'
import {authStore} from '../auth-store'

const apiURL = authStore.apiURL
const errorMsg = ref('')
const device = ref<{device_code: string; user_code: string; verification_uri: string} | null>(null)
const deviceExpired = ref(false)
const starting = ref(false)
const copying = ref(false)
let pollTimer: number | null = null
let pollDeadline = 0
const POLL_TIMEOUT_MS = 15 * 60 * 1000

const redirectTo = ref('')

function currentRedirect(): string {
  try {
    const q = new URLSearchParams(window.location.search)
    const r = q.get('redirect')
    if (r && r.startsWith('/') && !r.startsWith('//')) return r
  } catch { /* ignore */ }
  return '/posts/base-info/profile'
}

async function beginLogin() {
  if (starting.value || device.value) return
  errorMsg.value = ''
  deviceExpired.value = false
  starting.value = true
  try {
    const modeResp = await fetch(apiURL('/auth/mode')).catch(() => null)
    if (modeResp?.ok) {
      const mode = await modeResp.json()
      if (mode.mode === 'oauth') {
        sessionStorage.setItem('anvil_home_login_redirect', redirectTo.value || currentRedirect())
        window.location.href = apiURL('/auth/begin?site=website')
        return
      }
    }
    const r = await fetch(apiURL('/auth/device/start'), {method: 'POST'})
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = await r.json()
    if (j.device_flow) {
      device.value = j
      pollDeadline = Date.now() + POLL_TIMEOUT_MS
      startPolling(j.device_code)
    } else {
      errorMsg.value = '无法发起登录：后端未返回设备码'
    }
  } catch (e: any) {
    errorMsg.value = '无法发起登录：' + (e?.message ?? '请稍后重试')
  } finally {
    starting.value = false
  }
}

async function pollOnce(deviceCode: string) {
  if (Date.now() > pollDeadline) {
    deviceExpired.value = true
    return true
  }
  try {
    const r = await fetch(apiURL('/auth/device/poll'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({device_code: deviceCode}),
    })
    const j = await r.json()
    if (j.token) {
      authStore.setAuth(j.token, j.user)
      device.value = null
      stopPolling()
      // 回跳
      const dest = redirectTo.value || currentRedirect()
      window.location.href = dest
      return true
    }
  } catch { /* 忽略 */ }
  return false
}

async function startPolling(deviceCode: string) {
  stopPolling()
  const tick = async () => {
    const done = await pollOnce(deviceCode)
    if (!done && !deviceExpired.value) pollTimer = window.setTimeout(tick, 5000)
  }
  tick()
}

function stopPolling() {
  if (pollTimer) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
}

function cancelPolling() {
  stopPolling()
  device.value = null
  deviceExpired.value = false
  pollDeadline = 0
}

async function copyCode() {
  if (!device.value) return
  try {
    await navigator.clipboard.writeText(device.value.user_code)
    copying.value = true
    setTimeout(() => (copying.value = false), 1500)
  } catch { /* 忽略 */ }
}

function gotoGitHub() {
  copyCode()
  window.open(device.value?.verification_uri ?? 'https://github.com/login/device', '_blank', 'noopener')
}

onMounted(() => {
  redirectTo.value = currentRedirect()
  authStore.restore().then(() => {
    // 已登录则直接跳转
    if (authStore.isLoggedIn) window.location.href = redirectTo.value
  })
})

onUnmounted(stopPolling)
</script>

<template>
  <div class="device-login">
    <!-- 已登录 -->
    <div v-if="authStore.isLoggedIn" class="logged-in">
      <p class="ok">已登录：{{ authStore.user?.nickname || authStore.user?.username }}</p>
      <a class="btn" :href="redirectTo">进入个人中心 →</a>
    </div>

    <!-- 未登录 -->
    <div v-else class="login-box">
      <template v-if="!device">
        <button class="btn primary" :disabled="starting" @click="beginLogin">
          {{ starting ? '连接中…' : '使用 GitHub 登录' }}
        </button>
        <p class="hint">登录后可提交贡献者申请、管理个人信息；首次登录将创建本地账号。</p>
        <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
      </template>

      <template v-else>
        <div class="device-panel">
          <h3>GitHub 设备授权</h3>
          <p class="tip">请在 GitHub 授权页输入下方设备码：</p>
          <div class="code" @click="copyCode" :title="copying ? '已复制' : '点击复制'">
            {{ device.user_code }}
          </div>
          <button class="btn primary" @click="gotoGitHub">
            {{ copying ? '设备码已复制 ✓' : '前往 GitHub 授权（自动复制设备码）' }}
          </button>
          <p class="or">
            或手动打开
            <a :href="device.verification_uri" target="_blank" rel="noopener">{{ device.verification_uri }}</a>
          </p>
          <p v-if="deviceExpired" class="error">设备码已过期，请重新发起登录。</p>
          <button class="btn ghost" @click="cancelPolling">取消</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.device-login {
  max-width: 460px;
  margin: 24px auto 0;
}
.logged-in,
.login-box {
  padding: 30px 28px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  text-align: center;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
}
:global(.dark) .logged-in,
:global(.dark) .login-box {
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
}
:global(.login-page .VPDoc.has-aside .aside) {
  display: none;
}
:global(.login-page .VPDoc.has-aside .content-container) {
  max-width: 520px;
}
:global(.login-page .vp-doc h1) {
  text-align: center;
}
.ok {
  font-size: 16px;
  color: #2f855a;
}
:global(.dark) .ok {
  color: #4ade80;
}
.btn {
  display: inline-block;
  padding: 10px 22px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  cursor: pointer;
  text-decoration: none;
  font-size: 15px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  transition: all 0.2s;
}
.btn.primary {
  background: #1f6feb;
  border-color: #1f6feb;
  color: #fff;
}
.btn.primary:hover {
  background: #1a5fd0;
}
.btn.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn.ghost {
  margin-top: 12px;
  background: transparent;
}
.hint {
  color: var(--vp-c-text-2);
  font-size: 13px;
  margin-top: 14px;
}
.error {
  color: #c62828;
  font-size: 13px;
  margin-top: 10px;
}
:global(.dark) .error {
  color: #ff7b72;
}
.device-panel h3 {
  margin: 0 0 6px;
  color: var(--vp-c-text-1);
}
.tip {
  color: var(--vp-c-text-2);
  font-size: 14px;
}
.code {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--vp-c-brand-1);
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--vp-c-brand-soft);
  display: inline-block;
  margin: 12px 0;
  cursor: pointer;
  user-select: all;
}
.or {
  color: var(--vp-c-text-3);
  font-size: 12px;
  margin: 10px 0 4px;
}
.or a {
  color: var(--vp-c-brand-1);
}
</style>
