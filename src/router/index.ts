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
      path: '/ebook',
      components: {
        sidebar: () => import('../modules/ebook/EbookSidebar.vue'),
        main: () => import('../modules/ebook/EbookMain.vue'),
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
    {
      path: '/tools',
      components: {
        sidebar: () => import('../modules/tools/ToolsSidebar.vue'),
        main: () => import('../modules/tools/ToolsMain.vue'),
      },
      children: [
        { path: 'text/case-converter', component: () => import('../modules/tools/Text/CaseConverter/View.vue') },
        { path: 'text/case-converter/history', component: () => import('../modules/tools/Text/CaseConverter/History.vue') },
        { path: 'text/diff', component: () => import('../modules/tools/Text/DiffViewer/View.vue') },
        { path: 'text/diff/history', component: () => import('../modules/tools/Text/DiffViewer/History.vue') },
        { path: 'text/stats', component: () => import('../modules/tools/Text/TextStats/View.vue') },
        { path: 'text/stats/history', component: () => import('../modules/tools/Text/TextStats/History.vue') },
        { path: 'paper/bibtex', component: () => import('../modules/tools/Paper/BibtexConverter/View.vue') },
        { path: 'paper/bibtex/history', component: () => import('../modules/tools/Paper/BibtexConverter/History.vue') },
        { path: 'paper/color', component: () => import('../modules/tools/Paper/ColorScheme/View.vue') },
        { path: 'paper/format-converter', component: () => import('../modules/tools/Paper/LatexConverter/View.vue') },
        { path: 'paper/format-converter/history', component: () => import('../modules/tools/Paper/LatexConverter/History.vue') },
        { path: 'latex/latex2png', component: () => import('../modules/tools/Latex/Latex2Png/View.vue') },
        { path: 'latex/latex2png/history', component: () => import('../modules/tools/Latex/Latex2Png/History.vue') },
        { path: 'latex/table', component: () => import('../modules/tools/Latex/TableGenerator/View.vue') },
        { path: 'latex/table/history', component: () => import('../modules/tools/Latex/TableGenerator/History.vue') },
        { path: 'media/remove-bg', component: () => import('../modules/tools/Media/RemoveBg/View.vue') },
        { path: 'media/remove-bg/history', component: () => import('../modules/tools/Media/RemoveBg/History.vue') },
        { path: 'misc/printer', component: () => import('../modules/tools/Misc/Printer/View.vue') },
        { path: 'misc/qrcode', component: () => import('../modules/tools/Misc/QrCode/View.vue') },
        { path: 'misc/qrcode/history', component: () => import('../modules/tools/Misc/QrCode/History.vue') },
        { path: '', redirect: '/tools/text/case-converter' },
      ],
    },
  ],
})

export default router
