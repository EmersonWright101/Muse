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
        sidebar: () => import('../modules/home/HomeSidebar.vue'),
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
      path: '/travel',
      components: {
        sidebar: () => import('../modules/travel/TravelSidebar.vue'),
        main: () => import('../modules/travel/TravelMain.vue'),
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
