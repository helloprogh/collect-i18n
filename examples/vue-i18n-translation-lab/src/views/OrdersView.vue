<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import {
  cancelOrder,
  exportOrders,
  getApiError,
  listOrders,
  reprintOrder,
  type OrderItem,
  type OrderStatus,
  type CustomerLevel,
} from '../api/client'

const { t } = useI18n()

const searchInput = ref('')
const filters = reactive<{ status: OrderStatus | ''; level: CustomerLevel | ''; dateRange: string[]; minAmount: string }>({
  status: '',
  level: '',
  dateRange: [],
  minAmount: '',
})
const applied = reactive({ search: '', status: '' as OrderStatus | '', level: '' as CustomerLevel | '', minAmount: '' })
const filtersVisible = ref(false)
const simulateError = ref(false)

const loading = ref(false)
const errorMsg = ref('')
const items = ref<OrderItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const hasSearched = ref(false)
const selected = ref<OrderItem[]>([])

const drawerOrder = ref<OrderItem>()
const cancelTarget = ref<OrderItem>()
const cancelLoading = ref(false)

const statusOptions: OrderStatus[] = ['pending', 'paid', 'shipped', 'cancelled', 'refunded', 'completed']
const levelOptions: CustomerLevel[] = ['vip', 'normal', 'new']
const pageSizeOptions = [10, 20, 50]

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

function statusTagType(status: OrderStatus) {
  const map: Record<OrderStatus, 'success' | 'warning' | 'info' | 'danger' | 'primary'> = {
    pending: 'warning',
    paid: 'success',
    shipped: 'primary',
    cancelled: 'info',
    refunded: 'danger',
    completed: 'success',
  }
  return map[status]
}
function statusLabel(status: OrderStatus) {
  return t(`orders.filters.status.${status}`)
}
function levelLabel(level: CustomerLevel) {
  return t(`orders.filters.customerLevel.${level}`)
}

async function loadOrders() {
  loading.value = true
  errorMsg.value = ''
  try {
    const result = await listOrders({
      search: applied.search,
      status: applied.status,
      level: applied.level,
      page: page.value,
      pageSize: pageSize.value,
      scenario: simulateError.value ? 'error' : 'success',
    })
    items.value = result.items
    total.value = result.total
    hasSearched.value = true
  } catch (error) {
    errorMsg.value = simulateError.value ? t('orders.states.loadFailed') : t('orders.states.quotaExceeded')
    const apiError = getApiError(error)
    if (apiError.requestId) errorMsg.value += ` · ${apiError.requestId}`
  } finally {
    loading.value = false
  }
}

function search() {
  applied.search = searchInput.value.trim()
  applied.status = filters.status
  applied.level = filters.level
  applied.minAmount = filters.minAmount
  page.value = 1
  loadOrders()
}

function resetQuery() {
  searchInput.value = ''
  filters.status = ''
  filters.level = ''
  filters.dateRange = []
  filters.minAmount = ''
  applied.search = ''
  applied.status = ''
  applied.level = ''
  applied.minAmount = ''
  items.value = []
  total.value = 0
  hasSearched.value = false
  errorMsg.value = ''
}

function applyFilters() {
  applied.status = filters.status
  applied.level = filters.level
  applied.minAmount = filters.minAmount
  page.value = 1
  loadOrders()
}

function clearFilters() {
  filters.status = ''
  filters.level = ''
  filters.dateRange = []
  filters.minAmount = ''
}

function goto(target: number) {
  page.value = Math.min(Math.max(1, target), totalPages.value)
  loadOrders()
}
function changePageSize(value: number) {
  pageSize.value = value
  page.value = 1
  loadOrders()
}

function openDetail(row: OrderItem) {
  drawerOrder.value = row
}
async function confirmCancel() {
  if (!cancelTarget.value) return
  cancelLoading.value = true
  try {
    await cancelOrder(cancelTarget.value.id)
    ElMessage.success(t('orders.cancelDialog.success'))
    cancelTarget.value = undefined
    await loadOrders()
  } catch {
    ElMessage.error(t('orders.cancelDialog.failed'))
  } finally {
    cancelLoading.value = false
  }
}
async function reprint(row: OrderItem) {
  try {
    await reprintOrder(row.id)
    ElMessage.success(t('orders.reprint.success'))
  } catch {
    ElMessage.error(t('orders.reprint.failed'))
  }
}
async function exportAll() {
  try {
    await exportOrders()
    ElMessage.success(t('orders.export.success'))
  } catch {
    ElMessage.error(t('orders.export.failed'))
  }
}
</script>

<template>
  <section class="page" data-testid="orders-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('orders.title') }}</h1>
        <p>{{ t('orders.subtitle') }}</p>
      </div>
      <div class="toolbar">
        <el-button data-testid="orders-refresh" :loading="loading" :aria-label="t('orders.aria.refresh')" @click="loadOrders">{{ t('orders.toolbar.refresh') }}</el-button>
        <el-button data-testid="orders-export" @click="exportAll">{{ t('orders.toolbar.export') }}</el-button>
        <el-switch v-model="simulateError" data-testid="orders-simulate-error" :active-text="t('orders.toolbar.simulateError')" inline-prompt />
      </div>
    </header>

    <el-card class="section-card">
      <div class="toolbar">
        <el-input v-model="searchInput" data-testid="orders-search" :placeholder="t('orders.searchPlaceholder')" style="max-width: 320px" clearable @keyup.enter="search" />
        <el-button type="primary" data-testid="orders-search-btn" @click="search">{{ t('orders.searchBtn') }}</el-button>
        <el-button data-testid="orders-reset" @click="resetQuery">{{ t('orders.resetBtn') }}</el-button>
        <el-button text data-testid="orders-filter-toggle" :aria-label="t('orders.aria.filterToggle')" @click="filtersVisible = !filtersVisible">{{ t('orders.filters.title') }}</el-button>
      </div>

      <div v-if="filtersVisible" class="filter-bar" data-testid="orders-filters">
        <el-form-item :label="t('orders.filters.status.label')">
          <el-select v-model="filters.status" data-testid="orders-filter-status" :placeholder="t('orders.filters.status.placeholder')" clearable style="width: 100%">
            <el-option v-for="status in statusOptions" :key="status" :label="statusLabel(status)" :value="status" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('orders.filters.customerLevel.label')">
          <el-select v-model="filters.level" data-testid="orders-filter-level" :placeholder="t('orders.filters.customerLevel.placeholder')" clearable style="width: 100%">
            <el-option v-for="level in levelOptions" :key="level" :label="levelLabel(level)" :value="level" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('orders.filters.dateRange.label')">
          <el-date-picker v-model="filters.dateRange" data-testid="orders-filter-date" type="daterange" :start-placeholder="t('orders.filters.dateRange.start')" :end-placeholder="t('orders.filters.dateRange.end')" style="width: 100%" />
        </el-form-item>
        <el-form-item :label="t('orders.filters.minAmount.label')">
          <el-input v-model="filters.minAmount" data-testid="orders-filter-min-amount" :placeholder="t('orders.filters.minAmount.placeholder')" />
        </el-form-item>
        <div class="toolbar">
          <el-button data-testid="orders-apply-filters" @click="applyFilters">{{ t('orders.filters.apply') }}</el-button>
          <el-button data-testid="orders-clear-filters" @click="clearFilters">{{ t('orders.filters.clear') }}</el-button>
        </div>
      </div>

      <el-alert v-if="errorMsg" data-testid="orders-error" type="error" show-icon :closable="false" :title="errorMsg" class="result-panel" />
      <el-button v-if="errorMsg" data-testid="orders-retry" type="primary" @click="loadOrders">{{ t('orders.states.retry') }}</el-button>
      <div v-if="loading" class="muted" data-testid="orders-loading-text">{{ t('orders.states.loading') }}</div>
      <el-alert v-else-if="hasSearched && !errorMsg && total > 0" data-testid="orders-success" type="success" show-icon
        :closable="false" :title="t('orders.states.success')" class="result-panel" />
      <el-alert v-else-if="hasSearched && total === 0" data-testid="orders-empty" type="info" show-icon :closable="false" :title="t('orders.states.noResults')" class="result-panel" />

      <div v-if="!hasSearched" class="muted" data-testid="orders-initial-empty">{{ t('orders.emptyHint') }}</div>

      <el-table
        v-if="hasSearched"
        v-loading="loading"
        :data="items"
        data-testid="orders-table"
        @selection-change="(rows: OrderItem[]) => (selected = rows)"
      >
        <el-table-column type="selection" width="42" />
        <el-table-column prop="orderNo" :label="t('orders.columns.orderNo')" width="140" />
        <el-table-column prop="customer" :label="t('orders.columns.customer')" />
        <el-table-column :label="t('orders.columns.status')" width="120">
          <template #default="scope">
            <el-tag :type="statusTagType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="amount" :label="t('orders.columns.amount')" width="120" />
        <el-table-column :label="t('orders.columns.actions')" width="280" :aria-label="t('orders.aria.rowActions')">
          <template #default="scope">
            <el-button link data-testid="orders-view-detail" @click="openDetail(scope.row)">{{ t('orders.actions.viewDetail') }}</el-button>
            <el-button link data-testid="orders-reprint" @click="reprint(scope.row)">{{ t('orders.actions.reprint') }}</el-button>
            <el-button link data-testid="orders-cancel" @click="cancelTarget = scope.row">{{ t('orders.actions.cancel') }}</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="hasSearched && total > 0" class="pager" data-testid="orders-pagination">
        <span>{{ t('orders.pagination.total', { count: total }) }}</span>
        <span v-if="selected.length" class="muted">{{ t('orders.batch.selected', { count: selected.length }) }}</span>
        <el-button v-if="selected.length" data-testid="orders-export-selected" @click="exportAll">{{ t('orders.actions.export') }}</el-button>
        <div class="toolbar">
          <el-dropdown data-testid="orders-column-settings">
            <el-button>{{ t('orders.toolbar.columnSettings') }}</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="key in ['orderNo', 'customer', 'status', 'amount']" :key="key">
                  {{ t(`orders.columns.${key}`) }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-select :model-value="pageSize" data-testid="orders-page-size" style="width: 130px" @change="changePageSize">
            <el-option v-for="size in pageSizeOptions" :key="size" :label="t('orders.pagination.pageSize', { size })" :value="size" />
          </el-select>
          <el-button data-testid="orders-first-page" :disabled="page <= 1" @click="goto(1)">{{ t('orders.pagination.first') }}</el-button>
          <el-button data-testid="orders-prev-page" :disabled="page <= 1" @click="goto(page - 1)">{{ t('orders.pagination.prev') }}</el-button>
          <span class="muted">{{ page }} / {{ totalPages }}</span>
          <el-button data-testid="orders-next-page" :disabled="page >= totalPages" @click="goto(page + 1)">{{ t('orders.pagination.next') }}</el-button>
          <el-button data-testid="orders-last-page" :disabled="page >= totalPages" @click="goto(totalPages)">{{ t('orders.pagination.last') }}</el-button>
        </div>
      </div>
    </el-card>

    <el-drawer v-model="drawerOrder" data-testid="orders-detail-drawer" :title="t('orders.detail.title')" size="42%" :aria-label="t('orders.aria.closeDrawer')">
      <template v-if="drawerOrder">
        <dl class="kv-grid">
          <dt>{{ t('orders.detail.orderNo') }}</dt><dd>{{ drawerOrder.orderNo }}</dd>
          <dt>{{ t('orders.detail.customer') }}</dt><dd>{{ drawerOrder.customer }}</dd>
          <dt>{{ t('orders.detail.contact') }}</dt><dd>{{ drawerOrder.contact }}</dd>
          <dt>{{ t('orders.detail.status') }}</dt><dd><el-tag :type="statusTagType(drawerOrder.status)">{{ statusLabel(drawerOrder.status) }}</el-tag></dd>
          <dt>{{ t('orders.detail.amount') }}</dt><dd>{{ drawerOrder.amount }}</dd>
          <dt>{{ t('orders.detail.paymentMethod') }}</dt><dd>{{ drawerOrder.paymentMethod }}</dd>
          <dt>{{ t('orders.detail.createdAt') }}</dt><dd>{{ drawerOrder.createdAt }}</dd>
          <dt>{{ t('orders.detail.paidAt') }}</dt><dd>{{ ['paid', 'shipped', 'completed'].includes(drawerOrder.status) ? drawerOrder.createdAt : '-' }}</dd>
          <dt>{{ t('orders.detail.shippedAt') }}</dt><dd>{{ ['shipped', 'completed'].includes(drawerOrder.status) ? drawerOrder.createdAt : '-' }}</dd>
          <dt>{{ t('orders.detail.address') }}</dt><dd>{{ drawerOrder.address }}</dd>
          <dt>{{ t('orders.detail.remark') }}</dt><dd>{{ drawerOrder.remark || '-' }}</dd>
        </dl>
        <h4>{{ t('orders.detail.items.title') }}</h4>
        <el-table :data="drawerOrder.items" size="small">
          <el-table-column prop="product" :label="t('orders.detail.items.product')" />
          <el-table-column prop="quantity" :label="t('orders.detail.items.quantity')" width="80" />
          <el-table-column prop="price" :label="t('orders.detail.items.price')" width="100" />
          <el-table-column :label="t('orders.detail.items.subtotal')" width="120">
            <template #default="scope">{{ (scope.row.quantity * scope.row.price).toFixed(2) }}</template>
          </el-table-column>
        </el-table>
        <h4>{{ t('orders.detail.timeline.title') }}</h4>
        <el-steps direction="vertical" :active="drawerOrder.status === 'completed' ? 4 : 2">
          <el-step :title="t('orders.detail.timeline.created')" />
          <el-step :title="t('orders.detail.timeline.paid')" />
          <el-step :title="t('orders.detail.timeline.shipped')" />
          <el-step :title="t('orders.detail.timeline.delivered')" />
        </el-steps>
        <div class="dialog-actions">
          <el-button data-testid="orders-detail-close" @click="drawerOrder = undefined">{{ t('orders.detail.close') }}</el-button>
        </div>
      </template>
    </el-drawer>

    <el-dialog v-model="cancelTarget" data-testid="orders-cancel-dialog" :title="t('orders.cancelDialog.title')" width="480">
      <p>{{ t('orders.cancelDialog.message') }}</p>
      <template #footer>
        <el-button data-testid="orders-cancel-cancel" @click="cancelTarget = undefined">{{ t('orders.cancelDialog.cancel') }}</el-button>
        <el-button type="danger" :loading="cancelLoading" data-testid="orders-cancel-confirm" @click="confirmCancel">{{ t('orders.cancelDialog.confirm') }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>
