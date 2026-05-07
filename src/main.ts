import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import { getCurrentWindow } from '@tauri-apps/api/window'
import 'leaflet/dist/leaflet.css'

const app = createApp(App)
  .use(createPinia())
  .use(router)
  .use(i18n)

app.mount('#app')

// Disable browser context menu in production builds (it shows useless "Back/Reload" in Tauri).
// In dev we keep it so the WebView "Inspect" item is available for debugging.
// Specific context menus (variant comparisons etc.) use Vue @contextmenu.prevent
// handlers that fire before this listener and remain functional.
if (!import.meta.env.DEV) {
  document.addEventListener('contextmenu', (e) => e.preventDefault())
}

// Show window after first paint to avoid white flash; CSS fade handles visual smoothness
requestAnimationFrame(() => {
  getCurrentWindow().show()
})
