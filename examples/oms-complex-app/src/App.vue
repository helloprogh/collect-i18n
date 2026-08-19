<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Bell, Goods, Grid, Odometer, Platform, Setting, ShoppingCart, User } from '@element-plus/icons-vue'
import { switchLocale } from '@/i18n'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()

const menuItems = computed(() => [
  { path: '/dashboard', label: t('common.menu.dashboard'), icon: Odometer },
  { path: '/users', label: t('common.menu.users'), icon: User },
  { path: '/orders', label: t('common.menu.orders'), icon: ShoppingCart },
  { path: '/products', label: t('common.menu.products'), icon: Goods },
  { path: '/settings', label: t('common.menu.settings'), icon: Setting },
  { path: '/messages', label: t('common.menu.messages'), icon: Bell },
  { path: '/advanced', label: t('common.menu.advanced'), icon: Grid },
])

const currentTitle = computed(() => route.meta.title ? t(route.meta.title as string) : '')
function toggleLocale(): void {
  switchLocale(locale.value === 'zh-CN' ? 'en-US' : 'zh-CN')
}
</script>

<template>
  <el-container class="app-shell">
    <el-aside width="220px" class="app-aside">
      <div class="app-logo">
        <el-icon :size="22"><Platform /></el-icon>
        <span>{{ t('common.app.title') }}</span>
      </div>
      <el-menu :default-active="route.path" router class="app-menu">
        <el-menu-item v-for="item in menuItems" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="app-header">
        <div class="app-breadcrumb">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/dashboard' }">{{ t('common.app.title') }}</el-breadcrumb-item>
            <el-breadcrumb-item v-if="currentTitle">{{ currentTitle }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="app-header-right">
          <el-tag size="small" effect="plain">{{ t('common.status.active') }}</el-tag>
          <el-button size="small" @click="toggleLocale">
            {{ locale === 'zh-CN' ? 'EN' : '中文' }}
          </el-button>
        </div>
      </el-header>
      <el-main class="app-main">
        <router-view />
      </el-main>
      <el-footer class="app-footer" height="40px">
        {{ t('common.app.footer') }}
      </el-footer>
    </el-container>
  </el-container>
</template>

<style scoped>
.app-shell { height: 100vh; }
.app-aside { background: #1f2937; color: #fff; }
.app-logo { display: flex; align-items: center; gap: 8px; padding: 16px 20px; font-weight: 600; color: #fff; }
.app-menu { border-right: none; background: transparent; }
.app-menu :deep(.el-menu-item) { color: #cbd5e1; }
.app-menu :deep(.el-menu-item.is-active) { color: #fff; background: #374151; }
.app-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e5e7eb; }
.app-header-right { display: flex; align-items: center; gap: 12px; }
.app-main { background: #f3f4f6; overflow: auto; }
.app-footer { display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 12px; border-top: 1px solid #e5e7eb; background: #fff; }
</style>
