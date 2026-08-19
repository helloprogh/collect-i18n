<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const router = useRouter()

// 变量定义 key 传递调用场景：key 存为变量后再传给 t()
const welcomeKey = 'dashboard.welcome'
const trendUpKey = 'dashboard.metric.trendUp'
const trendDownKey = 'dashboard.metric.trendDown'

const metrics = [
  { key: 'metric.totalUsers', value: '128,430', delta: '12.5%', up: true },
  { key: 'metric.activeUsers', value: '48,912', delta: '3.2%', up: true },
  { key: 'metric.orderToday', value: '1,208', delta: '8.4%', up: true },
  { key: 'metric.gmv', value: '¥ 2,846,100', delta: '6.1%', up: true },
  { key: 'metric.sales', value: '¥ 86,204,000', delta: '2.3%', up: false },
  { key: 'metric.refund', value: '¥ 1,204,500', delta: '1.8%', up: false },
  { key: 'metric.completion', value: '98.6%', delta: '0.4%', up: true },
  { key: 'metric.conversion', value: '5.42%', delta: '0.2%', up: false },
]

const salesBars = [42, 55, 38, 70, 62, 88, 74, 92, 66, 80, 95, 78]
const visitBars = [60, 72, 55, 82, 68, 90, 76, 86, 70, 88, 96, 84]
const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

const latestOrders = [1, 2, 3, 4, 5].map((index) => ({
  orderNo: t(`orders.rows.${index}.orderNo`),
  customer: t(`orders.rows.${index}.customer`),
  amount: t(`orders.rows.${index}.amount`),
  status: t(`orders.rows.${index}.status`),
}))

const shortcuts = [
  { path: '/users', labelKey: 'shortcut.manageUsers' },
  { path: '/orders', labelKey: 'shortcut.manageOrders' },
  { path: '/products', labelKey: 'shortcut.manageProducts' },
  { path: '/settings', labelKey: 'shortcut.viewSettings' },
]

function go(path: string): void {
  router.push(path)
}
</script>

<template>
  <div class="dashboard">
    <el-card shadow="never" class="welcome-card">
      <div class="welcome-row">
        <div>
          <h2>{{ t(welcomeKey, { name: 'Alex' }) }}</h2>
          <p class="muted">{{ t('dashboard.greeting') }}</p>
        </div>
        <div class="notice">
          <el-tag type="warning" effect="light">{{ t('dashboard.notice.announcement') }}</el-tag>
          <p class="muted small">{{ t('dashboard.notice.version') }}</p>
          <p class="muted small">{{ t('dashboard.notice.maintenance') }}</p>
        </div>
      </div>
    </el-card>

    <el-row :gutter="16" class="metric-row">
      <el-col v-for="metric in metrics" :key="metric.key" :span="6">
        <el-card shadow="hover">
          <div class="metric">
            <div class="metric-label">{{ t(`dashboard.${metric.key}`) }}</div>
            <div class="metric-value">{{ metric.value }}</div>
            <div class="metric-delta" :class="{ down: !metric.up }">
              {{ metric.up ? t(trendUpKey, { percent: metric.delta }) : t(trendDownKey, { percent: metric.delta }) }}
              <span class="muted small"> · {{ t('dashboard.metric.versusLastWeek') }}</span>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>
            <span>{{ t('dashboard.chart.salesOverview') }}</span>
          </template>
          <div class="bars">
            <div v-for="(height, index) in salesBars" :key="index" class="bar-col">
              <div class="bar" :style="{ height: height + '%' }"></div>
              <span class="bar-label">{{ months[index] }}</span>
            </div>
          </div>
          <div class="legend">
            <span class="dot sales"></span>{{ t('dashboard.chart.legend.sales') }}
          </div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>
            <span>{{ t('dashboard.chart.visitsOverview') }}</span>
          </template>
          <div class="bars">
            <div v-for="(height, index) in visitBars" :key="index" class="bar-col">
              <div class="bar alt" :style="{ height: height + '%' }"></div>
              <span class="bar-label">{{ months[index] }}</span>
            </div>
          </div>
          <div class="legend">
            <span class="dot visits"></span>{{ t('dashboard.chart.legend.visits') }}
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16">
      <el-col :span="14">
        <el-card shadow="never">
          <template #header>
            <span>{{ t('dashboard.table.latestOrders') }}</span>
          </template>
          <el-table :data="latestOrders" size="small">
            <el-table-column :label="t('dashboard.table.orderNo')" prop="orderNo" />
            <el-table-column :label="t('dashboard.table.customer')" prop="customer" />
            <el-table-column :label="t('dashboard.table.amount')" prop="amount" />
            <el-table-column :label="t('dashboard.table.status')" prop="status" />
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card shadow="never">
          <template #header>
            <span>{{ t('dashboard.shortcut.quickActions') }}</span>
          </template>
          <div class="shortcuts">
            <el-button v-for="item in shortcuts" :key="item.path" class="shortcut" @click="go(item.path)">
              {{ t(`dashboard.${item.labelKey}`) }}
            </el-button>
          </div>
          <el-divider />
          <el-button type="primary" plain>{{ t('dashboard.report.exportTitle') }}</el-button>
          <p class="muted small">{{ t('dashboard.report.exportHint') }}</p>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.dashboard { display: flex; flex-direction: column; gap: 16px; }
.welcome-row { display: flex; justify-content: space-between; align-items: flex-start; }
.muted { color: #6b7280; }
.small { font-size: 12px; }
.metric-row { margin-bottom: 0; }
.metric-label { color: #6b7280; font-size: 13px; }
.metric-value { font-size: 26px; font-weight: 700; margin: 6px 0; }
.metric-delta { font-size: 12px; color: #16a34a; }
.metric-delta.down { color: #dc2626; }
.bars { display: flex; align-items: flex-end; gap: 6px; height: 200px; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.bar { width: 100%; max-width: 26px; background: #3b82f6; border-radius: 4px 4px 0 0; }
.bar.alt { background: #22c55e; }
.bar-label { font-size: 10px; color: #9ca3af; }
.legend { margin-top: 12px; font-size: 13px; color: #374151; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
.dot.sales { background: #3b82f6; }
.dot.visits { background: #22c55e; }
.shortcuts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.shortcut { margin-left: 0 !important; }
.notice { text-align: right; }
</style>
