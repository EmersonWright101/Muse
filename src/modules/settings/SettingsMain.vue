<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '../../stores/uiStore'
import GeneralSettings from './tabs/GeneralSettings.vue'
import AISettings      from './tabs/AISettings.vue'
import SyncSettings    from './tabs/SyncSettings.vue'
import AboutSettings   from './tabs/AboutSettings.vue'
import ChatSettings      from './tabs/ChatSettings.vue'
import AssistantSettings from './tabs/AssistantSettings.vue'
import TodoSettings      from './tabs/TodoSettings.vue'

const ui = useUiStore()

// Placeholder component for not-yet-implemented sections
const PlaceholderTab = { template: '<div style="padding:28px 32px;color:#8e8e93;font-size:14px;">即将推出</div>' }

const sectionComponents: Record<string, unknown> = {
  general: GeneralSettings,
  ai:      AISettings,
  chat:      ChatSettings,
  assistant: AssistantSettings,
  todo:      TodoSettings,
  sync:    SyncSettings,
  about:   AboutSettings,
}

const activeComponent = computed(() => sectionComponents[ui.settingsSection] ?? PlaceholderTab)
</script>

<template>
  <div class="settings-main">
    <div class="settings-scroll">
      <component :is="activeComponent" />
    </div>
  </div>
</template>

<style scoped>
.settings-main {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: #ffffff;
}

.settings-scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.settings-scroll::-webkit-scrollbar { width: 4px; }
.settings-scroll::-webkit-scrollbar-track { background: transparent; }
.settings-scroll::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.10); border-radius: 2px; }
</style>
