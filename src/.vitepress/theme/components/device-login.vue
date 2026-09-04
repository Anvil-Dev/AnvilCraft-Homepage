<script lang="ts" setup>
// 独立登录页核心：GitHub Device Flow 登录。
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
  max-width: 420px;
  margin: 0 auto;
}
.logged-in {
  text-align: center;
  padding: 24px 0;
}
.ok {
  font-size: 16px;
  color: #2f855a;
}
.login-box {
  text-align: center;
}
.btn {
  display: inline-block;
  padding: 10px 22px;
  border-radius: 8px;
  border: 1px solid #d0d7de;
  cursor: pointer;
  text-decoration: none;
  font-size: 15px;
  background: #fff;
  color: #1f2328;
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
  color: #6b7280;
  font-size: 13px;
  margin-top: 14px;
}
.error {
  color: #c62828;
  font-size: 13px;
  margin-top: 10px;
}
.device-panel {
  background: #fafbfc;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 24px 20px;
}
.device-panel h3 {
  margin: 0 0 6px;
}
.tip {
  color: #6b7280;
  font-size: 14px;
}
.code {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 4px;
  color: #1f6feb;
  padding: 8px 14px;
  border-radius: 8px;
  background: #eef4ff;
  display: inline-block;
  margin: 12px 0;
  cursor: pointer;
  user-select: all;
}
.or {
  color: #9ca3af;
  font-size: 12px;
  margin: 10px 0 4px;
}
.or a {
  color: #1f6feb;
}
</style>
