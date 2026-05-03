<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  SlidersHorizontal,
  Bot,
  CloudUpload,
  Info,
  MessageSquare,
  CheckSquare,
} from 'lucide-vue-next'
import assistantIcon from '../../assets/icons/AIAssistant@2x.svg'
import { useUiStore } from '../../stores/uiStore'

const { t } = useI18n()
const ui    = useUiStore()

const sections = [
  { id: 'general',   icon: SlidersHorizontal, labelKey: 'settings.sections.general' },
  { id: 'ai',        icon: Bot,               labelKey: 'settings.sections.ai' },
  { id: 'chat',      icon: MessageSquare,     labelKey: 'settings.sections.chat' },
  { id: 'assistant', icon: null, customIcon: assistantIcon, labelKey: 'settings.sections.assistant' },
  { id: 'todo',      icon: CheckSquare,       labelKey: 'settings.sections.todo' },
  { id: 'sync',      icon: CloudUpload,       labelKey: 'settings.sections.sync' },
  { id: 'about',     icon: Info,              labelKey: 'settings.sections.about' },
]

function select(id: string) {
  ui.setSettingsSection(id)
}
</script>

<template>
  <div class="settings-sidebar">
    <!-- Header -->
    <div class="panel-header">
      <h2 class="panel-title">{{ t('settings.title') }}</h2>
    </div>

    <!-- Sections list -->
    <div class="list-scroll">
      <div
        v-for="section in sections"
        :key="section.id"
        class="list-item"
        :class="{ active: ui.settingsSection === section.id }"
        @click="select(section.id)"
      >
        <img v-if="section.customIcon" :src="section.customIcon" class="item-icon custom-icon" />
        <component v-else :is="section.icon" :size="15" class="item-icon" />
        <span class="item-label">{{ t(section.labelKey) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-sidebar {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: rgba(235, 235, 235, 0.85);
  backdrop-filter: blur(40px) saturate(1.8);
  -webkit-backdrop-filter: blur(40px) saturate(1.8);
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.10), 0 0 0 0.5px rgba(255, 255, 255, 0.6) inset;
}

.panel-header {
  height: 48px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0;
}

.list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 6px;
}

.list-item {
  padding: 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: background 0.12s;
}

.list-item:hover { background: rgba(0, 0, 0, 0.05); }
.list-item.active { background: rgba(34, 63, 121, 0.10); }

.item-icon { color: #8e8e93; flex-shrink: 0; }
.list-item.active .item-icon { color: #223F79; }

.custom-icon {
  width: 15px;
  height: 15px;
  object-fit: contain;
  opacity: 0.55;
  transition: opacity 0.12s;
}
.list-item:hover .custom-icon { opacity: 0.75; }
.list-item.active .custom-icon { opacity: 1; }

.item-label { font-size: 13px; color: #3c3c43; }
.list-item.active .item-label { color: #223F79; font-weight: 500; }
</style>
