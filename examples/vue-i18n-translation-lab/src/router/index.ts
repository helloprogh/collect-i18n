import { createRouter, createWebHistory } from 'vue-router'
import JobsView from '../views/JobsView.vue'
import RequestLabView from '../views/RequestLabView.vue'
import DashboardView from '../views/DashboardView.vue'
import AuditView from '../views/AuditView.vue'
import DictionaryView from '../views/DictionaryView.vue'
import HelpView from '../views/HelpView.vue'
import SettingsView from '../views/SettingsView.vue'
import MonitorView from '../views/MonitorView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/request-lab' },
    { path: '/request-lab', name: 'request-lab', component: RequestLabView },
    { path: '/jobs', name: 'jobs', component: JobsView },
    { path: '/dashboard', name: 'dashboard', component: DashboardView },
    { path: '/audit', name: 'audit', component: AuditView },
    { path: '/dictionary', name: 'dictionary', component: DictionaryView },
    { path: '/help', name: 'help', component: HelpView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/monitor', name: 'monitor', component: MonitorView },
  ],
})
