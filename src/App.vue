<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useTravelStore } from './stores/travel'
import { useSyncStore } from './stores/sync'
import './stores/travelCopilot'  // ensure copilot sync module is registered at startup
import './stores/chat'           // ensure conversations sync module is registered at startup
import './stores/assistants'     // ensure assistants sync module is registered at startup
import TitleBar from './components/TitleBar.vue'
import AppSidebar from './components/AppSidebar.vue'

const showPanel = ref(true)
const route = useRoute()
const travel = useTravelStore()

// Initialize sync store on app launch so the auto-sync timer starts
// even if the user never opens the Settings page.
useSyncStore()

const panelFloats = computed(() => route.path === '/travel' && travel.viewMode !== 'editor')
</script>

<template>
  <div class="app-layout">
    <!-- Icon sidebar runs full height (contains traffic lights at top) -->
    <AppSidebar />

    <!-- Right column: title bar + content -->
    <div class="app-right">
      <TitleBar :panel-visible="showPanel" @toggle="showPanel = !showPanel" />

      <div class="content-area" :class="{ 'panel-floats': panelFloats }">
        <Transition name="panel-slide">
          <div v-show="showPanel" class="panel-column">
            <router-view name="sidebar" />
          </div>
        </Transition>
        <div class="main-column">
          <router-view name="main" />
        </div>
      </div>
    </div>
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
}

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
