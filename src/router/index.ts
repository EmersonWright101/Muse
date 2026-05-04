import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/home',
    },
    {
      path: '/home',
      components: {
        main: () => import('../modules/home/HomeMain.vue'),
      },
    },
    {
      path: '/chat',
      components: {
        sidebar: () => import('../modules/chat/ChatSidebar.vue'),
        main: () => import('../modules/chat/ChatMain.vue'),
      },
    },
    {
      path: '/chat-window',
      components: {
        main: () => import('../modules/chat/ChatWindow.vue'),
      },
    },
    {
      path: '/assistant',
      components: {
        sidebar: () => import('../modules/assistant/AssistantSidebar.vue'),
        main: () => import('../modules/assistant/AssistantMain.vue'),
      },
    },
    {
      path: '/travel',
      components: {
        sidebar: () => import('../modules/travel/TravelSidebar.vue'),
        main: () => import('../modules/travel/TravelMain.vue'),
      },
    },
    {
      path: '/todo',
      components: {
        sidebar: () => import('../modules/todo/TodoSidebar.vue'),
        main: () => import('../modules/todo/TodoMain.vue'),
      },
    },
    {
      path: '/statistics',
      components: {
        sidebar: () => import('../modules/statistics/StatisticsSidebar.vue'),
        main: () => import('../modules/statistics/StatisticsMain.vue'),
      },
    },
    {
      path: '/settings',
      components: {
        sidebar: () => import('../modules/settings/SettingsSidebar.vue'),
        main: () => import('../modules/settings/SettingsMain.vue'),
      },
    },
  ],
})

export default router
