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
  document.documentElement.lang = locale
}

export default i18n
