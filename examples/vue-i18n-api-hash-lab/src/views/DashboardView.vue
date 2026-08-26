<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchDashboard, getApiError, type DashboardMetric } from '../api/client'

const { t } = useI18n()
const metrics = ref<DashboardMetric[]>([])
const updatedAt = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const payload = await fetchDashboard()
    metrics.value = payload.metrics
    updatedAt.value = new Date(payload.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })
  } catch (error) {
    errorMsg.value = getApiError(error).code
  } finally {
    // 延迟关闭 loading,让遮罩/自定义 spinner 有可采集窗口(F1/F2 演练)
    setTimeout(() => { loading.value = false }, 600)
  }
}

onMounted(load)
</script>

<template>
  <!-- 整页 overlay:data-collect-i18n-loading 属性 + 自定义 spinner —— F1 可配置选择器 + F2 整帧闸门演练 -->
  <div v-if="loading" class="fullpage-overlay" data-collect-i18n-loading="dashboard">
    <div class="custom-spinner" role="status" aria-label="loading"></div>
    <span>{{ t('dashboard.loading') }}</span>
  </div>

  <section class="page" data-testid="dashboard-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('dashboard.title') }}</h1>
        <p>{{ t('dashboard.subtitle') }}</p>
      </div>
      <div class="toolbar">
        <el-button data-testid="dashboard-refresh" :aria-label="t('dashboard.aria.refresh')" :loading="loading" @click="load">
          {{ t('dashboard.refresh') }}
        </el-button>
      </div>
    </header>

    <el-alert v-if="errorMsg" data-testid="dashboard-error" type="error" show-icon :closable="false" :title="errorMsg" class="result-panel" />
    <p v-else-if="updatedAt" class="muted" data-testid="dashboard-updated">{{ t('dashboard.lastUpdated', { time: updatedAt }) }}</p>

    <!-- 指标卡:动态词条 key = dashboard.metric.<key> -->
    <div class="metric-grid" data-testid="dashboard-metrics">
      <div v-for="metric in metrics" :key="metric.key" class="metric-card" :data-testid="`metric-${metric.key}`">
        <h3>{{ t(`dashboard.metric.${metric.key}`) }}</h3>
        <div class="metric-value">
          {{ metric.value }}<small>{{ metric.unit }}</small>
        </div>
        <span class="metric-trend">{{ metric.trend }}</span>
      </div>
    </div>
  </section>
</template>
