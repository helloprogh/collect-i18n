<!-- 应用外壳:hide-on-login;登录路由可直接访问,其余路由依赖顶栏导航 -->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()

const isLogin = computed(() => route.path === '/login')

function switchLocale() {
  const cookieLocale = locale.value === 'zh-CN' ? 'en_US' : 'zh_CN'
  document.cookie = `x-gde-locale=${cookieLocale}; path=/; SameSite=Lax`
  window.location.reload()
}

const navItems = [
  { index: '/dashboard', testid: 'nav-dashboard', key: 'common.nav.dashboard' },
  { index: '/orders', testid: 'nav-orders', key: 'common.nav.orders' },
  { index: '/products', testid: 'nav-products', key: 'common.nav.products' },
  { index: '/messages', testid: 'nav-messages', key: 'common.nav.messages' },
  { index: '/settings', testid: 'nav-settings', key: 'common.nav.settings' },
  { index: '/login', testid: 'nav-login', key: 'common.nav.login' },
] as const

function logout() {
  document.cookie = 'x-gde-token=; path=/; Max-Age=0'
  router.push('/login')
}
</script>

<template>
  <el-container class="app-shell">
    <el-header v-if="!isLogin" class="topbar">
      <div>
        <p class="eyebrow">{{ t('common.product') }}</p>
        <strong>{{ t('common.title') }}</strong>
      </div>
      <div class="topbar-actions">
        <span class="locale-label">{{ t('common.localeLabel') }}</span>
        <el-button data-testid="switch-locale" text @click="switchLocale">
          {{ t('common.switchLocale') }}
        </el-button>
        <el-dropdown data-testid="user-menu" trigger="click">
          <el-button text>{{ t('common.userMenu.label') }}</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="router.push('/settings')">{{ t('common.userMenu.settings') }}</el-dropdown-item>
              <el-dropdown-item data-testid="logout" @click="logout">{{ t('common.userMenu.logout') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-header>

    <el-container>
      <el-aside v-if="!isLogin" width="200px" class="sidebar">
        <el-menu :default-active="route.path" router data-testid="main-menu">
          <el-menu-item v-for="item in navItems" :key="item.index" :index="item.index" :data-testid="item.testid">
            {{ t(item.key) }}
          </el-menu-item>
        </el-menu>
      </el-aside>

      <el-main>
        <router-view />
      </el-main>
    </el-container>

    <el-footer v-if="!isLogin" class="app-footer">
      <span>{{ t('common.footer.copyright') }}</span>
      <span>{{ t('common.footer.version') }}</span>
    </el-footer>
  </el-container>
</template>
