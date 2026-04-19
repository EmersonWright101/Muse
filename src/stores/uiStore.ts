import { defineStore } from 'pinia'
import { ref } from 'vue'

/** Shared UI state for cross-component communication. */
export const useUiStore = defineStore('ui', () => {
  // Active section in Settings sidebar
  const settingsSection = ref<string>('general')

  function setSettingsSection(id: string) {
    settingsSection.value = id
  }

  return { settingsSection, setSettingsSection }
})
