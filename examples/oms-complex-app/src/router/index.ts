import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory('/oms/web'),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', name: 'dashboard', component: () => import('@/views/Dashboard.vue'), meta: { title: 'common.menu.dashboard' } },
    { path: '/users', name: 'users', component: () => import('@/views/Users.vue'), meta: { title: 'common.menu.users' } },
    { path: '/products', name: 'products', component: () => import('@/views/Products.vue'), meta: { title: 'common.menu.products' } },
    { path: '/orders', name: 'orders', component: () => import('@/views/Orders.vue'), meta: { title: 'common.menu.orders' } },
    { path: '/settings', name: 'settings', component: () => import('@/views/Settings.vue'), meta: { title: 'common.menu.settings' } },
    { path: '/messages', name: 'messages', component: () => import('@/views/Messages.vue'), meta: { title: 'common.menu.messages' } },
    { path: '/advanced', name: 'advanced', component: () => import('@/views/Advanced.vue'), meta: { title: 'common.menu.advanced' } },
  ],
})

export default router
