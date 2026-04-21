import { defineStore } from 'pinia'
import { ref } from 'vue'

/** Shared UI state for cross-component communication. */
export const useUiStore = defineStore('ui', () => {
  // Active section in Settings sidebar
  const settingsSection = ref<string>('general')

  function setSettingsSection(id: string) {
    settingsSection.value = id
  }

  // Active section in Statistics sidebar
  const statsSection = ref<string>('ai_usage')

  function setStatsSection(id: string) {
    statsSection.value = id
  }

  // Active sub-tab inside AI Usage section
  const aiUsageSubSection = ref<string>('tokens')

  function setAiUsageSubSection(id: string) {
    aiUsageSubSection.value = id
  }

  return {
    settingsSection, setSettingsSection,
    statsSection, setStatsSection,
    aiUsageSubSection, setAiUsageSubSection,
  }
})
