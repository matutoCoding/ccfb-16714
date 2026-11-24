import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/batches' },
    { path: '/batches', name: 'batches', component: () => import('@/pages/BatchesPage.vue'), meta: { title: '检测批次' } },
    { path: '/archive', name: 'archive', component: () => import('@/pages/ArchivePage.vue'), meta: { title: '线路档案' } },
    { path: '/replay', name: 'replay', component: () => import('@/pages/ReplayPage.vue'), meta: { title: '三维回放' } },
    { path: '/exceeds', name: 'exceeds', component: () => import('@/pages/ExceedsPage.vue'), meta: { title: '超限管理' } },
    { path: '/trend', name: 'trend', component: () => import('@/pages/TrendPage.vue'), meta: { title: '趋势对比' } },
    { path: '/orders', name: 'orders', component: () => import('@/pages/OrdersPage.vue'), meta: { title: '维修工单' } },
    { path: '/settings', name: 'settings', component: () => import('@/pages/SettingsPage.vue'), meta: { title: '设置' } },
  ],
})
