<script lang="ts" setup>
// 官网 OAuth 回调：把 code/state 交给后端换取 JWT，并回跳登录前页面。
import {onMounted, ref} from 'vue'
import {authStore} from '../auth-store'

const errorMsg = ref('')

function loginRedirect(): string {
  const saved = sessionStorage.getItem('anvil_home_login_redirect')
  sessionStorage.removeItem('anvil_home_login_redirect')
  if (saved && saved.startsWith('/') && !saved.startsWith('//')) return saved
  return '/posts/base-info/profile'
}

onMounted(async () => {
  const q = new URLSearchParams(window.location.search)
  const code = q.get('code')
  const state = q.get('state')
  if (!code || !state) {
    errorMsg.value = 'OAuth 回调缺少 code/state'
    return
  }
  try {
    const params = new URLSearchParams({code, state})
    const r = await fetch(authStore.apiURL(`/auth/callback?${params}`))
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
    authStore.setAuth(j.token, j.user)
    window.location.replace(loginRedirect())
  } catch (e: any) {
    errorMsg.value = 'GitHub 登录失败：' + (e?.message ?? '请稍后重试')
  }
})
</script>

<template>
  <div class="oauth-callback">
    <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
    <p v-else>正在完成 GitHub 登录…</p>
    <a v-if="errorMsg" class="link" href="/login">返回登录页</a>
  </div>
</template>

<style scoped>
.oauth-callback {
  max-width: 420px;
  margin: 48px auto;
  padding: 24px;
  text-align: center;
  color: var(--vp-c-text-1);
}
.error {
  color: #c62828;
}
.link {
  color: var(--vp-c-brand-1);
}
:global(.oauth-callback-page .VPDoc.has-aside .aside) {
  display: none;
}
:global(.oauth-callback-page .VPDoc.has-aside .content-container) {
  max-width: 520px;
}
:global(.dark) .error {
  color: #ff7b72;
}
</style>
