<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { getApiError, listOrders, submitOrder, type Order, type OrderStatus } from '../api/client'

const { t } = useI18n()
const loading = ref(false)
const errorMsg = ref('')
const items = ref<Order[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const hasLoaded = ref(false)

const detailOrder = ref<Order>()
const deleteTarget = ref<Order>()

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const statuses: OrderStatus[] = ['pending', 'paid', 'shipped', 'delivered', 'cancelled']

const TAG_TYPES: Record<OrderStatus, 'warning' | 'success' | 'primary' | 'info' | 'danger'> = {
  pending: 'warning',
  paid: 'success',
  shipped: 'primary',
  delivered: 'success',
  cancelled: 'info',
}
function statusTagType(status: OrderStatus): 'warning' | 'success' | 'primary' | 'info' | 'danger' {
  return TAG_TYPES[status]
}
function statusLabel(status: OrderStatus) {
  return t(`orders.status.${status}`)
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const payload = await listOrders(page.value, pageSize.value)
    items.value = payload.items
    total.value = payload.total
    hasLoaded.value = true
  } catch (error) {
    const info = getApiError(error)
    errorMsg.value = t('orders.state.error', { code: info.code, message: info.message ?? '' })
  } finally {
    loading.value = false
  }
}

function goto(target: number) {
  page.value = Math.min(Math.max(1, target), totalPages.value)
  load() // 翻页触发 v-loading 遮罩
}
function changePageSize(value: number) {
  pageSize.value = value
  page.value = 1
  load()
}

// 新建订单:ElMessageBox.confirm + POST /api/orders + ElMessage.success
const createForm = reactive({ orderNo: '', customer: '', amount: 0 })
const createVisible = ref(false)
const createLoading = ref(false)
const createRules: FormRules = {
  orderNo: [{ required: true, message: t('orders.create.orderNo') + ' 必填', trigger: 'blur' }],
  customer: [{ required: true, message: t('orders.create.customer') + ' 必填', trigger: 'blur' }],
  amount: [{ required: true, message: t('orders.create.amount') + ' 必填', trigger: 'blur' }],
}
const createFormRef = ref<FormInstance>()

async function submitCreate() {
  if (!createFormRef.value) return
  const valid = await createFormRef.value.validate().then(() => true).catch(() => false)
  if (!valid) return
  createLoading.value = true
  try {
    await submitOrder({ ...createForm })
    ElMessage.success(t('orders.create.success'))
    createVisible.value = false
    createForm.orderNo = ''
    createForm.customer = ''
    createForm.amount = 0
    await load()
  } catch (error) {
    ElMessage.error(t('orders.create.fail') + ':' + getApiError(error).code)
  } finally {
    createLoading.value = false
  }
}

async function confirmDelete(row: Order) {
  try {
    await ElMessageBox.confirm(
      t('orders.actions.deleteConfirmMessage', { orderNo: row.orderNo }),
      t('orders.actions.deleteConfirmTitle'),
      { confirmButtonText: t('orders.actions.deleteOk'), cancelButtonText: t('orders.actions.deleteCancel'), type: 'warning' },
    )
    ElMessage.success(t('orders.actions.deleteSuccess'))
  } catch {
    ElMessage.info(t('orders.actions.deleteFail'))
  }
}

onMounted(load)
</script>

<template>
  <section class="page" data-testid="orders-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('orders.title') }}</h1>
        <p>{{ t('orders.subtitle') }}</p>
      </div>
      <div class="toolbar">
        <el-button data-testid="orders-refresh" :aria-label="t('orders.aria.refresh')" :loading="loading" @click="load">
          {{ t('orders.toolbar.refresh') }}
        </el-button>
        <el-button type="primary" data-testid="orders-create-open" :aria-label="t('orders.aria.openCreate')" @click="createVisible = true">
          {{ t('orders.toolbar.new') }}
        </el-button>
      </div>
    </header>

    <el-alert v-if="errorMsg" data-testid="orders-error" type="error" show-icon :closable="false" :title="errorMsg" class="result-panel" />

    <!-- v-loading:Element Plus 遮罩 —— F1 默认选择器演练 -->
    <el-table
      v-loading="loading"
      :data="items"
      data-testid="orders-table"
      element-loading-text="加载中"
    >
      <el-table-column prop="orderNo" :label="t('orders.columns.orderNo')" width="150" />
      <el-table-column prop="customer" :label="t('orders.columns.customer')" />
      <el-table-column :label="t('orders.columns.status')" width="120">
        <template #default="scope">
          <!-- 动态词条 key:orders.status.<row.status> -->
          <el-tag :type="statusTagType(scope.row.status as OrderStatus)">{{ statusLabel(scope.row.status as OrderStatus) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="amount" :label="t('orders.columns.amount')" width="120" />
      <el-table-column prop="createdAt" :label="t('orders.columns.createdAt')" width="140" />
      <el-table-column :label="t('orders.columns.actions')" width="210">
        <template #default="scope">
          <el-button link type="primary" data-testid="orders-view" :aria-label="t('orders.aria.viewDetail')" @click="detailOrder = scope.row">{{ t('orders.actions.view') }}</el-button>
          <el-button link type="danger" data-testid="orders-delete" :aria-label="t('orders.aria.deleteOrder')" @click="confirmDelete(scope.row)">{{ t('orders.actions.delete') }}</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <span data-testid="orders-empty">{{ hasLoaded ? t('orders.state.empty') : '' }}</span>
      </template>
    </el-table>

    <div v-if="hasLoaded && total > 0" class="pager" data-testid="orders-pagination">
      <span class="muted">{{ t('orders.pagination.total', { count: total }) }}</span>
      <!-- el-pagination 翻页重新拉取:每页切换都触发 v-loading 遮罩(F1 演练) -->
      <el-pagination
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        :layout="'total, sizes, prev, pager, next, jumper'"
        data-testid="orders-el-pagination"
        @current-change="goto"
        @size-change="changePageSize"
      />
    </div>

    <!-- 详情 dialog(drawer 形态) -->
    <el-dialog v-model="detailOrder" data-testid="orders-detail" :title="t('orders.detail.title')" width="560" :aria-label="t('orders.detail.drawerAria')">
      <template v-if="detailOrder">
        <dl class="kv-grid">
          <dt>{{ t('orders.columns.orderNo') }}</dt><dd>{{ detailOrder.orderNo }}</dd>
          <dt>{{ t('orders.columns.customer') }}</dt><dd>{{ detailOrder.customer }}</dd>
          <dt>{{ t('orders.columns.status') }}</dt><dd><el-tag :type="statusTagType(detailOrder.status)">{{ statusLabel(detailOrder.status) }}</el-tag></dd>
          <dt>{{ t('orders.columns.amount') }}</dt><dd>{{ detailOrder.amount }}</dd>
          <dt>{{ t('orders.columns.createdAt') }}</dt><dd>{{ detailOrder.createdAt }}</dd>
        </dl>
        <h4>{{ t('orders.detail.items') }}</h4>
        <el-table :data="detailOrder.items" size="small">
          <el-table-column prop="product" />
          <el-table-column prop="quantity" width="80" />
          <el-table-column prop="price" width="100" />
        </el-table>
        <div class="dialog-actions">
          <el-button data-testid="orders-detail-close" :aria-label="t('orders.aria.closeDrawer')" @click="detailOrder = undefined">{{ t('orders.detail.close') }}</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 新建订单 dialog -->
    <el-dialog v-model="createVisible" data-testid="orders-create" :title="t('orders.create.title')" width="480" :aria-label="t('orders.aria.closeDialog')">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="90px">
        <el-form-item :label="t('orders.create.orderNo')" prop="orderNo">
          <el-input v-model="createForm.orderNo" data-testid="orders-create-no" :placeholder="t('orders.filter.placeholder')" />
        </el-form-item>
        <el-form-item :label="t('orders.create.customer')" prop="customer">
          <el-input v-model="createForm.customer" data-testid="orders-create-customer" />
        </el-form-item>
        <el-form-item :label="t('orders.create.amount')" prop="amount">
          <el-input-number v-model="createForm.amount" data-testid="orders-create-amount" :min="1" :step="10" />
        </el-form-item>
      </el-form>
      <div class="dialog-actions">
        <el-button data-testid="orders-create-cancel" @click="createVisible = false">{{ t('orders.create.cancel') }}</el-button>
        <el-button type="primary" :loading="createLoading" data-testid="orders-create-submit" @click="submitCreate">{{ t('orders.create.ok') }}</el-button>
      </div>
    </el-dialog>

    <!-- 原生 title 非可视词条 -->
    <div :title="t('orders.nonVisual.title')" style="display: none" data-testid="orders-nonvisual"></div>
  </section>
</template>
