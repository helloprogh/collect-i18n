<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

const route = useRoute()
const { t, locale } = useI18n()

function switchLocale() {
  const cookieLocale = locale.value === 'zh-CN' ? 'en_US' : 'zh_CN'
  document.cookie = `x-gde-locale=${cookieLocale}; path=/; SameSite=Lax`
  window.location.reload()
}

const navItems = [
  { index: '/onboarding', testid: 'nav-onboarding', key: 'common.nav.onboarding' },
  { index: '/orders', testid: 'nav-orders', key: 'common.nav.orders' },
  { index: '/permissions', testid: 'nav-permissions', key: 'common.nav.permissions' },
  { index: '/notifications', testid: 'nav-notifications', key: 'common.nav.notifications' },
  { index: '/settings', testid: 'nav-settings', key: 'common.nav.settings' },
  { index: '/request-lab', testid: 'nav-request-lab', key: 'common.nav.requestLab' },
  { index: '/diagnostics', testid: 'nav-diagnostics', key: 'common.nav.diagnostics' },
] as const

const themeOptions = ['light', 'dark'] as const
const userMenuOptions = ['profile', 'settings', 'logout'] as const
</script>

<template>
  <el-container class="app-shell">
    <el-header class="topbar">
      <div>
        <p class="eyebrow">{{ t('common.product') }}</p>
        <strong>{{ t('common.title') }}</strong>
      </div>
      <div class="topbar-actions">
        <span class="locale-label">{{ t('common.localeLabel') }}</span>
        <el-button data-testid="switch-locale" text @click="switchLocale">
          {{ t('common.switchLocale') }}
        </el-button>
        <el-dropdown data-testid="theme-menu" trigger="click">
          <el-button text>{{ t('common.theme.toggle') }}</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="option in themeOptions" :key="option">
                {{ t(`common.theme.${option}`) }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-tooltip data-testid="help-tooltip" :content="t('common.help.tooltip')" placement="bottom">
          <el-button text circle aria-label="help">?</el-button>
        </el-tooltip>
        <el-dropdown data-testid="user-menu" trigger="click">
          <el-button text>{{ t('common.userMenu.label') }}</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="option in userMenuOptions" :key="option">
                {{ t(`common.userMenu.${option}`) }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-header>
    <el-container>
      <el-aside width="220px" class="sidebar">
        <el-menu :default-active="route.path" router>
          <el-menu-item
            v-for="item in navItems"
            :key="item.index"
            :index="item.index"
            :data-testid="item.testid"
          >
            {{ t(item.key) }}
          </el-menu-item>
        </el-menu>
      </el-aside>
      <el-main><router-view /></el-main>
    </el-container>
    <el-footer class="app-footer">
      <span>{{ t('common.footer.copyright') }}</span>
      <span>{{ t('common.footer.version') }}</span>
    </el-footer>
  </el-container>
</template>
