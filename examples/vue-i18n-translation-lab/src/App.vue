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
</script>

<template>
  <el-container class="app-shell">
    <el-header class="topbar">
      <div>
        <p class="eyebrow">{{ t('common.product') }}</p>
        <strong>{{ t('common.title') }}</strong>
      </div>
      <el-button data-testid="switch-locale" text @click="switchLocale">
        {{ t('common.switchLocale') }}
      </el-button>
    </el-header>
    <el-container>
      <el-aside width="220px" class="sidebar">
        <el-menu :default-active="route.path" router>
          <el-menu-item index="/request-lab" data-testid="nav-request-lab">{{ t('common.nav.createJob') }}</el-menu-item>
          <el-menu-item index="/jobs" data-testid="nav-jobs">{{ t('common.nav.jobs') }}</el-menu-item>
          <el-menu-item index="/dashboard" data-testid="nav-dashboard">{{ t('dashboard.title') }}</el-menu-item>
          <el-menu-item index="/audit" data-testid="nav-audit">{{ t('audit.title') }}</el-menu-item>
          <el-menu-item index="/dictionary" data-testid="nav-dictionary">{{ t('dictionary.title') }}</el-menu-item>
          <el-menu-item index="/help" data-testid="nav-help">{{ t('help.title') }}</el-menu-item>
          <el-menu-item index="/settings" data-testid="nav-settings">{{ t('settings.title') }}</el-menu-item>
          <el-menu-item index="/monitor" data-testid="nav-monitor">{{ t('monitor.title') }}</el-menu-item>
        </el-menu>
      </el-aside>
      <el-main><router-view /></el-main>
    </el-container>
  </el-container>
</template>
