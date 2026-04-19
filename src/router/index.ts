import { createRouter, createWebHashHistory } from 'vue-router'

// Chat module
import ChatSidebar from '../modules/chat/ChatSidebar.vue'
import ChatMain from '../modules/chat/ChatMain.vue'

// Travel module
import TravelSidebar from '../modules/travel/TravelSidebar.vue'
import TravelMain from '../modules/travel/TravelMain.vue'

// Settings module
import SettingsSidebar from '../modules/settings/SettingsSidebar.vue'
import SettingsMain from '../modules/settings/SettingsMain.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/chat',
    },
    {
      path: '/chat',
      components: {
        sidebar: ChatSidebar,
        main: ChatMain,
      },
    },
    {
      path: '/travel',
      components: {
        sidebar: TravelSidebar,
        main: TravelMain,
      },
    },
    {
      path: '/settings',
      components: {
        sidebar: SettingsSidebar,
        main: SettingsMain,
      },
    },
  ],
})

export default router
