<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessageSquare, MapPin, BarChart3, Settings } from 'lucide-vue-next'
import { getCurrentWindow } from '@tauri-apps/api/window'

const route = useRoute()
const { t } = useI18n()
const win = getCurrentWindow()

const isWindows = navigator.userAgent.includes('Windows')

const navItems = computed(() => [
  { path: '/chat',   icon: MessageSquare, labelKey: 'nav.chat' },
  { path: '/travel', icon: MapPin,        labelKey: 'nav.travel' },
])

const isActive = (path: string) => route.path.startsWith(path)
const isHome = computed(() => route.path.startsWith('/home'))

async function onHeaderMouseDown(e: MouseEvent) {
  if (e.button === 0 && !(e.target as HTMLElement).closest('button')) {
    await win.startDragging()
  }
}
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
      <router-link to="/home" class="logo-link" :title="t('nav.home')">
        <div class="logo-mark" :class="{ active: isHome }">
          <span>M</span>
        </div>
      </router-link>
    </div>

    <!-- Main navigation -->
    <nav class="sidebar-nav">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="nav-item"
        :class="{ active: isActive(item.path) }"
        :title="t(item.labelKey)"
      >
        <component :is="item.icon" :size="21" />
      </router-link>
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

.logo-mark span {
  color: white;
  font-size: 17px;
  font-weight: 700;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
  letter-spacing: -0.5px;
  line-height: 1;
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
  border-radius: 10px;
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
</style>
