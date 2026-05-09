<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useTravelStore } from './stores/travel'
import { useTodoNotifications } from './modules/todo/composables/useTodoNotifications'
import TitleBar from './components/TitleBar.vue'
import AppSidebar from './components/AppSidebar.vue'
import { cleanupTmpDir } from './utils/path'
import { syncAllFromServer } from './services/syncManager'
import { useTodoStore } from './stores/todo'
import { useEbookStore } from './stores/ebook'

const showPanel = ref(true)
const route = useRoute()
const travel = useTravelStore()
const todo = useTodoStore()
const ebookStore = useEbookStore()

// Auto-hide sidebar when opening a book; restore when closing
watch(() => ebookStore.activeBookId, (id, prevId) => {
  if (!prevId && id && route.path.startsWith('/ebook')) showPanel.value = false
  else if (prevId && !id && route.path.startsWith('/ebook')) showPanel.value = true
})

useTodoNotifications()

// Prevent global Cmd+A / Ctrl+A from selecting the entire UI, but keep it inside editors.
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
    const target = e.target as HTMLElement | null
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('[contenteditable="true"]'))
    ) {
      return
    }
    e.preventDefault()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  cleanupTmpDir().catch(() => {})
  syncAllFromServer().catch(() => {})
  todo.load().catch(() => {})
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

const panelFloats = computed(() =>
  (route.path === '/travel' && travel.viewMode !== 'editor') ||
  (route.path.startsWith('/ebook') && !!ebookStore.activeBookId)
)

// Routes without a sidebar component — hide the panel column entirely for these
const routeHasSidebar = computed(() => route.path !== '/home')

// When floating ebook sidebar is visible, push the epub content right so text isn't hidden
const ebookPanelActive = computed(() =>
  route.path.startsWith('/ebook') && !!ebookStore.activeBookId && showPanel.value && routeHasSidebar.value
)

// Give the panel-column the same background as the ebook paper when reading
const panelBgClass = computed(() => {
  if (!route.path.startsWith('/ebook') || !ebookStore.activeBookId) return ''
  return ebookStore.settings.theme === 'sepia' ? 'panel-sepia'
       : ebookStore.settings.theme === 'dark'  ? 'panel-dark'
       : ''
})

// Independent chat window: no sidebar, no title bar, full-screen content
const isChatWindow = computed(() => route.path === '/chat-window')
</script>

<template>
  <div class="app-layout" :class="{ 'chat-window-mode': isChatWindow }">
    <template v-if="!isChatWindow">
      <!-- Icon sidebar runs full height (contains traffic lights at top) -->
      <AppSidebar />

      <!-- Right column: title bar + content -->
      <div class="app-right">
        <TitleBar :panel-visible="showPanel" @toggle="showPanel = !showPanel" />

        <div class="content-area" :class="{ 'panel-floats': panelFloats, 'ebook-panel-active': ebookPanelActive }">
          <Transition name="panel-slide">
            <div v-show="showPanel && routeHasSidebar" class="panel-column" :class="panelBgClass">
              <router-view name="sidebar" />
            </div>
          </Transition>
          <div class="main-column">
            <router-view name="main" />
          </div>
        </div>
      </div>
    </template>

    <!-- Chat window mode: full screen, no chrome -->
    <router-view v-else name="main" />
  </div>
</template>

<style>
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body, #app {
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: transparent;
  animation: app-fade-in 0.12s ease both;
}

@keyframes app-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
</style>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: row;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  border-radius: 12px;
}

.app-layout.chat-window-mode {
  border-radius: 0;
}

/* Right column: title bar stacked above content */
.app-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

/* Content area: panel + main */
.content-area {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-width: 0;
  min-height: 0;
  background: #ffffff;
  overflow: hidden;
  position: relative;
}

/* Floating panel for travel map view */
.content-area.panel-floats .panel-column {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  z-index: 1000;
  pointer-events: none;
}

.content-area.panel-floats .panel-column > * {
  pointer-events: auto;
}

/* Floating panel wrapper */
.panel-column {
  width: 252px;
  flex-shrink: 0;
  padding: 8px 4px 8px 8px;
  display: flex;
  flex-direction: column;
}

/* Main content */
.main-column {
  flex: 1;
  min-width: 0;
  display: flex;
  overflow: hidden;
  background: #ffffff;
  transition: padding-left 0.2s ease;
}

/* When ebook floating sidebar is open: push content right so text isn't hidden,
   but the background still extends behind the sidebar */
.content-area.ebook-panel-active .main-column {
  padding-left: 252px;
}

/* Ebook reading theme — panel background matches paper */
.panel-sepia { background: #f4ecd8; }
.panel-dark  { background: #1c1c1e; }

/* Panel slide transition */
.panel-slide-enter-active,
.panel-slide-leave-active {
  transition: width 0.2s ease, opacity 0.15s ease;
  overflow: hidden;
}

.panel-slide-enter-from,
.panel-slide-leave-to {
  width: 0 !important;
  opacity: 0;
  padding: 0 !important;
}
</style>
