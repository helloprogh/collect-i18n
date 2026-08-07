import { createRouter, createWebHistory } from 'vue-router'
import OnboardingView from '../views/OnboardingView.vue'
import OrdersView from '../views/OrdersView.vue'
import PermissionsView from '../views/PermissionsView.vue'
import NotificationsView from '../views/NotificationsView.vue'
import SettingsView from '../views/SettingsView.vue'
import RequestLabView from '../views/RequestLabView.vue'
import DiagnosticsView from '../views/DiagnosticsView.vue'
import SupportView from '../views/SupportView.vue'
import InventoryView from '../views/InventoryView.vue'
import BillingView from '../views/BillingView.vue'
import ReleasesView from '../views/ReleasesView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/onboarding' },
    { path: '/onboarding', name: 'onboarding', component: OnboardingView },
    { path: '/orders', name: 'orders', component: OrdersView },
    { path: '/permissions', name: 'permissions', component: PermissionsView },
    { path: '/notifications', name: 'notifications', component: NotificationsView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/request-lab', name: 'request-lab', component: RequestLabView },
    { path: '/diagnostics', name: 'diagnostics', component: DiagnosticsView },
    { path: '/support', name: 'support', component: SupportView },
    { path: '/inventory', name: 'inventory', component: InventoryView },
    { path: '/billing', name: 'billing', component: BillingView },
    { path: '/releases', name: 'releases', component: ReleasesView },
  ],
})
