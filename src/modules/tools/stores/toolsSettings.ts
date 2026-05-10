import { reactive, watch } from 'vue'

export interface ToolsSettingsState {
  modelPath: string
  historyMaxRecords: number
  language: 'zh' | 'en'
}

const LS_KEY = 'muse-tools-settings'

const saved = localStorage.getItem(LS_KEY)
const parsed: Partial<ToolsSettingsState> = saved ? JSON.parse(saved) : {}

export const settings = reactive<ToolsSettingsState>({
  modelPath: parsed.modelPath ?? '',
  historyMaxRecords: parsed.historyMaxRecords ?? 100,
  language: parsed.language ?? (localStorage.getItem('muse-locale')?.startsWith('zh') ? 'zh' : 'en'),
})

watch(
  settings,
  () => {
    localStorage.setItem(LS_KEY, JSON.stringify(settings))
  },
  { deep: true }
)
