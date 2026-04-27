import { createI18n } from 'vue-i18n'
import enUS from './locales/en-US'
import zhCN from './locales/zh-CN'

export type Locale = 'en-US' | 'zh-CN'

export const LOCALES: { value: Locale; label: string; flag: string }[] = [
  { value: 'en-US', label: 'English', flag: '🇺🇸' },
  { value: 'zh-CN', label: '简体中文', flag: '🇨🇳' },
]

const savedLocale = (localStorage.getItem('muse-locale') as Locale) || 'zh-CN'

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'en-US',
  messages: {
    'en-US': enUS,
    'zh-CN': zhCN,
  },
})

export function setLocale(locale: Locale) {
  ;(i18n.global.locale as any).value = locale
  localStorage.setItem('muse-locale', locale)
  localStorage.setItem('muse-locale-modified-at', new Date().toISOString())
  document.documentElement.lang = locale
}

export default i18n

// ─── Sync module ─────────────────────────────────────────────────────────────

import { syncService } from '../services/sync'
import type { SyncModule } from '../services/sync/types'

const MOD_LOCALE = 'locale'
const LS_LOCALE_KEY = 'muse-locale'
const LS_LOCALE_MODIFIED_AT = 'muse-locale-modified-at'

const localeSyncModule: SyncModule = {
  id: MOD_LOCALE,
  remoteDirs: ['settings'],
  getLocalTimestamp() {
    return localStorage.getItem(LS_LOCALE_MODIFIED_AT) ?? new Date(0).toISOString()
  },
  async sync(ctx, localChanged) {
    ctx.setProgress('同步语言设置…')
    const path = ctx.rp('settings/locale.enc')
    const raw = localStorage.getItem(LS_LOCALE_KEY)
    const localData = raw ? { locale: raw } : {}

    const remoteData = await ctx.getEncrypted<Record<string, unknown> | null>(path, null)

    if (!remoteData) {
      if (localChanged && Object.keys(localData).length > 0) {
        await ctx.putEncrypted(path, localData)
      }
      return
    }

    const localTs = await this.getLocalTimestamp()
    const remoteTs = (remoteData as Record<string, unknown> & { __syncTs?: string }).__syncTs ?? new Date(0).toISOString()

    if (remoteTs > localTs && remoteData.locale) {
      localStorage.setItem(LS_LOCALE_KEY, String(remoteData.locale))
    }

    if (!localChanged) return
    await ctx.putEncrypted(path, { ...localData, __syncTs: new Date().toISOString() })
  },
}

syncService.register(localeSyncModule)
