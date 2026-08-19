<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const orderStatuses = ['pending', 'paid', 'shipped', 'finished', 'cancelled', 'refunding']
const payMethods = ['wechat', 'alipay', 'card', 'balance']

const orders = computed(() =>
  Array.from({ length: 42 }, (_, index) => {
    const i = index + 1
    return {
      orderNo: t(`orders.rows.${i}.orderNo`),
      customer: t(`orders.rows.${i}.customer`),
      amount: t(`orders.rows.${i}.amount`),
      status: orderStatuses[i % 6],
      payMethod: payMethods[i % 4],
      quantity: (i % 9) + 1,
      createdAt: `2026-08-${String((i % 28) + 1).padStart(2, '0')} 14:${String(i % 60).padStart(2, '0')}`,
    }
  }),
)

const page = ref(1)
const pageSize = 15
const dateRange = ref<[string, string] | null>(null)
const keyword = ref('')
const statusFilter = ref('')
const payFilter = ref('')
const drawerVisible = ref(false)
const current = ref<Record<string, string> | null>(null)

const filtered = computed(() =>
  orders.value.filter((order) => {
    const keywordMatch = !keyword.value || order.orderNo.includes(keyword.value) || order.customer.includes(keyword.value)
    const statusMatch = !statusFilter.value || order.status === statusFilter.value
    const payMatch = !payFilter.value || order.payMethod === payFilter.value
    return keywordMatch && statusMatch && payMatch
  }),
)
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))

function statusType(status: string): 'warning' | 'success' | 'primary' | 'info' | 'danger' {
  if (status === 'pending') return 'warning'
  if (status === 'paid') return 'primary'
  if (status === 'shipped') return 'success'
  if (status === 'finished') return 'success'
  if (status === 'cancelled') return 'info'
  return 'danger'
}
function openDetail(order: Record<string, string>): void {
  current.value = order
  drawerVisible.value = true
}
function actionShip(): void {
  ElMessage.success(t('common.dialog.operationSuccess'))
}
async function actionCancel(): Promise<void> {
  await ElMessageBox.confirm(t('orders.detail.remark'), t('orders.action.cancel'), {
    type: 'warning',
    confirmButtonText: t('common.action.confirm'),
    cancelButtonText: t('common.action.cancel'),
  })
  ElMessage.success(t('common.dialog.operationSuccess'))
}
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="header">
        <span>{{ t('orders.title') }}</span>
        <el-button type="primary">{{ t('common.action.export') }}</el-button>
      </div>
    </template>

    <el-form inline class="filters">
      <el-form-item>
        <el-input v-model="keyword" :placeholder="t('orders.searchPlaceholder')" clearable style="width: 260px" />
      </el-form-item>
      <el-form-item>
        <el-select v-model="statusFilter" :placeholder="t('orders.filter.status')" clearable style="width: 150px">
          <el-option v-for="status in orderStatuses" :key="status" :label="t(`orders.status.${status}`)" :value="status" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-select v-model="payFilter" :placeholder="t('orders.filter.payMethod')" clearable style="width: 150px">
          <el-option v-for="pay in payMethods" :key="pay" :label="t(`orders.pay.${pay}`)" :value="pay" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-date-picker v-model="dateRange" type="daterange" :start-placeholder="t('common.placeholder.date')"
          :end-placeholder="t('common.placeholder.date')" value-format="YYYY-MM-DD" style="width: 260px" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="page = 1">{{ t('common.action.search') }}</el-button>
        <el-button @click="keyword = ''; statusFilter = ''; payFilter = ''; page = 1">{{ t('common.action.reset') }}</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="paged" border>
      <el-table-column :label="t('orders.table.orderNo')" prop="orderNo" min-width="150" />
      <el-table-column :label="t('orders.table.customer')" prop="customer" min-width="120" />
      <el-table-column :label="t('orders.table.quantity')" prop="quantity" width="80" />
      <el-table-column :label="t('orders.table.amount')" prop="amount" width="120" />
      <el-table-column :label="t('orders.table.payMethod')" width="110">
        <template #default="{ row }">
          {{ t(`orders.pay.${row.payMethod}`) }}
        </template>
      </el-table-column>
      <el-table-column :label="t('orders.table.status')" width="110">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ t(`orders.status.${row.status}`) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('orders.table.createdAt')" prop="createdAt" width="150" />
      <el-table-column :label="t('orders.table.actions')" width="160" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">{{ t('orders.action.view') }}</el-button>
          <el-button v-if="row.status === 'paid'" link type="success" @click="actionShip">{{ t('orders.action.ship') }}</el-button>
          <el-button v-if="row.status === 'pending'" link type="danger" @click="actionCancel">{{ t('orders.action.cancel') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination v-model:current-page="page" :page-size="pageSize" :total="filtered.length"
        layout="total, prev, pager, next" />
    </div>

    <el-drawer v-model="drawerVisible" :title="t('orders.detail.title')" size="420px">
      <template v-if="current">
        <el-descriptions :column="1" border>
          <el-descriptions-item :label="t('orders.detail.customer')">{{ current.customer }}</el-descriptions-item>
          <el-descriptions-item :label="t('orders.table.orderNo')">{{ current.orderNo }}</el-descriptions-item>
          <el-descriptions-item :label="t('orders.table.amount')">{{ current.amount }}</el-descriptions-item>
          <el-descriptions-item :label="t('orders.detail.address')">上海市浦东新区示例路 88 号</el-descriptions-item>
          <el-descriptions-item :label="t('orders.detail.logistics')">顺丰速运 SF1234567890</el-descriptions-item>
          <el-descriptions-item :label="t('orders.detail.remark')">—</el-descriptions-item>
        </el-descriptions>
      </template>
    </el-drawer>
  </el-card>
</template>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: center; }
.filters { margin-bottom: 4px; }
.pager { margin-top: 12px; display: flex; justify-content: flex-end; }
</style>
