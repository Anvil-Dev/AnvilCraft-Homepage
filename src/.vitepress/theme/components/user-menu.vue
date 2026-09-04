<script lang="ts" setup>
// 导航栏右侧全局登录态：
// 未登录 → 「登录」按钮（跳独立登录页，带回跳）
// 已登录 → 头像 + 悬浮菜单（个人中心 / 退出）

import {onMounted, ref} from 'vue'
import {authStore} from '../auth-store'
import {upUrl} from './img-url'

const menuOpen = ref(false)

function goLogin() {
  const here = window.location.pathname
  window.location.href = '/login?redirect=' + encodeURIComponent(here)
}

function goProfile() {
  window.location.href = '/posts/base-info/profile'
}

function logout() {
  authStore.clearAuth()
  menuOpen.value = false
  window.location.reload()
}

function avatarSrc(): string {
  const u = authStore.user
  if (u?.avatar_url) return upUrl(u.avatar_url)
  return ''
}

onMounted(() => {
  authStore.restore()
  // 点击外部关闭菜单
  document.addEventListener('click', (e) => {
    const el = e.target as HTMLElement
    if (!el.closest('.user-menu')) menuOpen.value = false
  })
})
</script>

<template>
  <div class="user-menu">
    <!-- 未登录 -->
    <button v-if="!authStore.isLoggedIn" class="login-btn" @click="goLogin">登录</button>

    <!-- 已登录：头像 + 悬浮菜单 -->
    <div v-else class="user-wrap">
      <button class="avatar-btn" @click.stop="menuOpen = !menuOpen" :title="authStore.user?.nickname || authStore.user?.username">
        <img v-if="avatarSrc()" class="avatar" :src="avatarSrc()" alt="avatar"/>
        <span v-else class="avatar ph">{{ (authStore.user?.nickname || authStore.user?.username || '?').slice(0, 1) }}</span>
      </button>
      <transition name="menu">
        <div v-if="menuOpen" class="dropdown">
          <div class="me">
            <div class="nick">{{ authStore.user?.nickname || authStore.user?.username }}</div>
            <div class="uname">@{{ authStore.user?.username }}</div>
          </div>
          <button class="item" @click="goProfile">个人中心</button>
          <button class="item danger" @click="logout">退出登录</button>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.user-menu {
  display: flex;
  align-items: center;
  margin-left: 12px;
}
.login-btn {
  padding: 5px 16px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}
.login-btn:hover {
  background: var(--vp-c-brand-1);
  color: #fff;
}
.user-wrap {
  position: relative;
}
.avatar-btn {
  border: none;
  background: none;
  cursor: pointer;
  padding: 0;
  display: flex;
}
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--vp-c-divider);
}
.avatar.ph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--vp-c-brand-soft, #eef4ff);
  color: var(--vp-c-brand-1, #1f6feb);
  font-weight: 600;
  font-size: 14px;
}
.dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  min-width: 180px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 6px;
  z-index: 100;
}
.me {
  padding: 8px 10px;
  border-bottom: 1px solid var(--vp-c-divider);
  margin-bottom: 4px;
  text-align: left;
}
.nick {
  font-weight: 600;
  font-size: 14px;
}
.uname {
  color: var(--vp-c-text-2);
  font-size: 12px;
}
.item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: 6px;
  font-size: 14px;
  color: var(--vp-c-text-1);
}
.item:hover {
  background: var(--vp-c-bg-soft);
}
.item.danger {
  color: #c62828;
}
.menu-enter-active,
.menu-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}
.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
