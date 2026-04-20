import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import { getCurrentWindow } from '@tauri-apps/api/window'

const app = createApp(App)
  .use(createPinia())
  .use(router)
  .use(i18n)

app.mount('#app')

// Show window after first paint to avoid white flash; CSS fade handles visual smoothness
requestAnimationFrame(() => {
  getCurrentWindow().show()
})
