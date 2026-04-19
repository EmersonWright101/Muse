import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import i18n from './i18n'

const app = createApp(App)
  .use(createPinia())
  .use(router)
  .use(i18n)

app.mount('#app')

// Wait for first paint before showing window to avoid any flash
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().show()
    })
  })
})
