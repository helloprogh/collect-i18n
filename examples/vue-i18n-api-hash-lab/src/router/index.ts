import { createRouter, createWebHashHistory } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import OrdersView from '../views/OrdersView.vue'
import ProductsView from '../views/ProductsView.vue'
import MessagesView from '../views/MessagesView.vue'
import SettingsView from '../views/SettingsView.vue'
import LoginView from '../views/LoginView.vue'

// hash 路由:URL 形如 http://127.0.0.1:5174/lab/#/orders
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', name: 'dashboard', component: DashboardView },
    { path: '/orders', name: 'orders', component: OrdersView },
    { path: '/products', name: 'products', component: ProductsView },
    { path: '/messages', name: 'messages', component: MessagesView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/login', name: 'login', component: LoginView },
  ],
})
