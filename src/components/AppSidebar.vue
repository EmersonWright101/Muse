<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessageSquare, MapPin, CheckSquare, BarChart3, Settings, BookOpen } from 'lucide-vue-next'
import toolIcon from '../assets/icons/tool.svg'
import { apiPut } from '../services/api'
import assistantIcon from '../assets/icons/AIAssistant@2x.svg'
import appIcon from '../assets/app-icon.png'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTodoStore } from '../stores/todo'

const route = useRoute()
const { t } = useI18n()
const win = getCurrentWindow()

const isWindows = navigator.userAgent.includes('Windows')

const navItems = computed(() => [
  { path: '/chat',      icon: MessageSquare, labelKey: 'nav.chat',      avatar: false },
  { path: '/assistant', icon: null,          labelKey: 'nav.assistant', customIcon: assistantIcon },
  { path: '/todo',      icon: CheckSquare,   labelKey: 'nav.todo',      avatar: false, iconSize: 18 },
  { path: '/ebook',     icon: BookOpen,      labelKey: 'nav.ebook',     avatar: false, iconSize: 20 },
  { path: '/travel',    icon: MapPin,        labelKey: 'nav.travel',    avatar: false },
  { path: '/tools',     icon: null,          labelKey: 'nav.tools',     avatar: false, customIcon: toolIcon },
])

const todoStore = useTodoStore()
const todoBadgeCount = computed(() => todoStore.countByFilter('today'))



const isActive = (path: string) => route.path.startsWith(path)
const isHome = computed(() => route.path.startsWith('/home'))

async function onHeaderMouseDown(e: MouseEvent) {
  if (e.button === 0 && !(e.target as HTMLElement).closest('button')) {
    await win.startDragging()
  }
}

// ─── User avatar ─────────────────────────────────────────────────────────────

const LS_AVATAR_KEY = 'muse-user-avatar'
const userAvatar = ref<string | null>(null)

function loadAvatar() {
  userAvatar.value = localStorage.getItem(LS_AVATAR_KEY)
}

function saveAvatar(base64: string) {
  localStorage.setItem(LS_AVATAR_KEY, base64)
  userAvatar.value = base64
  apiPut('/api/settings/profile', { value: { avatar: base64 } }).catch(() => {})
}

function clearAvatar() {
  localStorage.removeItem(LS_AVATAR_KEY)
  userAvatar.value = null
  apiPut('/api/settings/profile', { value: { avatar: null } }).catch(() => {})
}

const logoMenuOpen = ref(false)
const logoMenuPos = ref({ x: 0, y: 0 })

function openLogoMenu(e: MouseEvent) {
  e.preventDefault()
  logoMenuPos.value = { x: e.clientX, y: e.clientY }
  logoMenuOpen.value = true
}

function closeLogoMenu() {
  logoMenuOpen.value = false
}

const fileInput = ref<HTMLInputElement>()

function pickAvatar() {
  closeLogoMenu()
  fileInput.value?.click()
}

function handleAvatarChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    alert('请选择图片文件')
    return
  }
  const reader = new FileReader()
  reader.onload = (ev) => {
    const result = ev.target?.result as string
    if (result) saveAvatar(result)
  }
  reader.readAsDataURL(file)
  ;(e.target as HTMLInputElement).value = ''
}

onMounted(() => {
  loadAvatar()
  document.addEventListener('click', closeLogoMenu)
})
onUnmounted(() => {
  document.removeEventListener('click', closeLogoMenu)
})
</script>

<template>
  <aside class="app-sidebar">
    <!-- Traffic lights — draggable header area -->
    <div class="sidebar-header" @mousedown="onHeaderMouseDown">
      <div v-if="!isWindows" class="traffic-lights">
        <button class="tl-btn tl-close" @click.stop="win.close()" @mousedown.stop>
          <svg class="tl-icon" viewBox="0 0 10 10" fill="none">
            <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="tl-btn tl-minimize" @click.stop="win.minimize()" @mousedown.stop>
          <svg class="tl-icon" viewBox="0 0 10 10" fill="none">
            <path d="M2 5h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="tl-btn tl-zoom" @click.stop="win.toggleMaximize()" @mousedown.stop>
          <svg class="tl-icon" viewBox="0 0 10 10" fill="none">
            <path d="M5 2v6M2 5h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Logo mark — click to go home -->
    <div class="sidebar-logo">
      <router-link to="/home" class="logo-link" :title="t('nav.home')" @contextmenu.prevent="openLogoMenu">
        <img v-if="userAvatar" :src="userAvatar" class="logo-avatar" :class="{ active: isHome }" alt="" />
        <img v-else :src="appIcon" class="logo-avatar" :class="{ active: isHome }" alt="" />
      </router-link>
    </div>

    <!-- Logo context menu -->
    <Teleport to="body">
      <div
        v-if="logoMenuOpen"
        class="logo-context-menu"
        :style="{ left: logoMenuPos.x + 'px', top: logoMenuPos.y + 'px' }"
        @click.stop
      >
        <button class="logo-menu-item" @click="pickAvatar">
          <span>更换头像</span>
        </button>
        <button v-if="userAvatar" class="logo-menu-item delete" @click="clearAvatar(); closeLogoMenu()">
          <span>恢复默认</span>
        </button>
      </div>
    </Teleport>

    <input ref="fileInput" type="file" accept="image/*" class="hidden-file-input" @change="handleAvatarChange" />

    <!-- Main navigation -->
    <nav class="sidebar-nav">
      <div
        v-for="item in navItems"
        :key="item.path"
        class="nav-item-wrap"
      >
        <router-link
          :to="item.path"
          class="nav-item"
          :class="{ active: isActive(item.path) }"
          :title="t(item.labelKey)"
        >
          <img v-if="item.customIcon" :src="item.customIcon" class="nav-custom-icon" />
          <component v-else-if="item.icon" :is="item.icon" :size="item.iconSize || 21" />
        </router-link>
        <span
          v-if="item.path === '/todo' && todoBadgeCount > 0"
          class="nav-badge"
        >{{ todoBadgeCount > 99 ? '99+' : todoBadgeCount }}</span>
      </div>
    </nav>

    <!-- Bottom: statistics + settings -->
    <div class="sidebar-bottom">
      <router-link
        to="/statistics"
        class="nav-item"
        :class="{ active: isActive('/statistics') }"
        :title="t('nav.statistics')"
      >
        <BarChart3 :size="21" />
      </router-link>
      <router-link
        to="/settings"
        class="nav-item"
        :class="{ active: isActive('/settings') }"
        :title="t('nav.settings')"
      >
        <Settings :size="21" />
      </router-link>
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  width: 76px;
  min-width: 76px;
  height: 100%;
  background: rgba(235, 235, 240, 0.88);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  user-select: none;
  border-right: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow: inset -1px 0 0 rgba(0, 0, 0, 0.04);
  z-index: 20;
  flex-shrink: 0;
}

/* Traffic lights header — same height as TitleBar for visual alignment */
.sidebar-header {
  width: 100%;
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 13px;
  flex-shrink: 0;
  cursor: default;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.traffic-lights {
  display: flex;
  align-items: center;
  gap: 7px;
}

.tl-btn {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: none;
  cursor: default;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  flex-shrink: 0;
  transition: filter 0.1s;
}

.tl-btn:active { filter: brightness(0.8); }
.tl-close    { background: #FF5F57; }
.tl-minimize { background: #FEBC2E; }
.tl-zoom     { background: #28C840; }

.tl-icon {
  width: 7px;
  height: 7px;
  color: transparent;
  flex-shrink: 0;
  pointer-events: none;
}

.traffic-lights:hover .tl-icon {
  color: rgba(0, 0, 0, 0.5);
}

/* Logo section */
.sidebar-logo {
  width: 100%;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.logo-link {
  display: flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  border-radius: 11px;
  padding: 3px;
  transition: background 0.12s;
}

.logo-link:hover {
  background: rgba(0, 0, 0, 0.06);
}

.logo-mark {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: linear-gradient(145deg, #E4983D 0%, #223F79 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(34, 63, 121, 0.30);
  transition: box-shadow 0.15s, transform 0.12s;
}

.logo-mark.active {
  box-shadow: 0 0 0 3px rgba(34, 63, 121, 0.20), 0 2px 8px rgba(34, 63, 121, 0.30);
}

.logo-link:hover .logo-mark {
  transform: scale(1.06);
}

.logo-link:hover .logo-avatar {
  transform: scale(1.06);
}

.logo-mark span {
  color: white;
  font-size: 17px;
  font-weight: 700;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
  letter-spacing: -0.5px;
  line-height: 1;
}

.logo-avatar {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  object-fit: cover;
  box-shadow: 0 2px 8px rgba(34, 63, 121, 0.20);
  transition: box-shadow 0.15s, transform 0.12s;
}

.logo-avatar.active {
  box-shadow: 0 0 0 3px rgba(34, 63, 121, 0.20), 0 2px 8px rgba(34, 63, 121, 0.30);
}

.logo-context-menu {
  position: fixed;
  z-index: 500;
  background: rgba(250, 250, 252, 0.97);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  padding: 5px;
  min-width: 140px;
}

.logo-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  color: #1c1c1e;
  cursor: pointer;
  transition: background 0.10s;
  text-align: left;
}

.logo-menu-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.logo-menu-item.delete {
  color: #ff3b30;
}

.hidden-file-input {
  display: none;
}

.sidebar-nav {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 10px;
  gap: 2px;
}

.nav-item-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #ff3b30;
  color: white;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  pointer-events: none;
  box-sizing: border-box;
}

.sidebar-bottom {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: 10px;
  gap: 2px;
}

.nav-item {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8e8e93;
  text-decoration: none;
  transition: background 0.12s, color 0.12s;
  cursor: pointer;
}

.nav-item:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #3c3c43;
}

.nav-item.active {
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
}

.nav-custom-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
  opacity: 0.55;
  transition: opacity 0.12s;
}
.nav-item:hover .nav-custom-icon { opacity: 0.75; }
.nav-item.active .nav-custom-icon { opacity: 1; }

.sync-indicator {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8e8e93;
  transition: color 0.3s, background 0.12s;
  cursor: pointer;
}

.sync-indicator:hover {
  background: rgba(0, 0, 0, 0.06);
}

.sync-indicator.syncing        { color: #223F79; }
.sync-indicator.done           { color: #34c759; }
.sync-indicator.error          { color: #ff3b30; }
.sync-indicator.not_configured { color: #ff3b30; }

.sync-stack {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.inner-spin {
  position: absolute;
  animation: inner-rotate 0.8s linear infinite;
}

.inner-check {
  position: absolute;
}

.inner-exclaim {
  position: absolute;
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
}

@keyframes inner-rotate {
  to { transform: rotate(360deg); }
}

/* ── Sync status text ── */
.sync-status-text {
  font-size: 10px;
  color: #8e8e93;
  text-align: center;
  line-height: 1.3;
  max-width: 64px;
  padding: 2px 4px;
  word-break: break-all;
}

/* fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
