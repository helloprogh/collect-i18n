<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { operationMessage } from '../services/billingMessages.js'

type Invoice = { no: string; customer: string; amount: string; received: string; dueDate: string; status: string; method: string; reconcile: string; owner: string }
const { t } = useI18n()
const detail = ref<Invoice>()
const paymentOpen = ref(false)
const paymentRef = ref<FormInstance>()
const filters = reactive({ invoice: '', status: '', method: '', reconcile: '', period: [] as Date[] })
const payment = reactive({ invoice: '', amount: undefined as number | undefined, method: '', reference: '', receivedAt: new Date() })
const invoices: Invoice[] = [
  { no: 'INV-202608-0182', customer: '华东零售集团', amount: '¥ 128,000', received: '¥ 64,000', dueDate: '2026-08-15', status: 'partial', method: 'bank', reconcile: 'matched', owner: '宋蕾' },
  { no: 'INV-202607-0961', customer: '远海物流', amount: '¥ 86,400', received: '¥ 0', dueDate: '2026-07-31', status: 'overdue', method: 'card', reconcile: 'pending', owner: '孙哲' },
  { no: 'INV-202608-0204', customer: '北辰科技', amount: '¥ 42,800', received: '¥ 42,800', dueDate: '2026-08-20', status: 'paid', method: 'wallet', reconcile: 'difference', owner: '宋蕾' },
]

const rules = computed<FormRules>(() => ({
  invoice: [{ required: true, message: t('billing.validation.invoiceRequired'), trigger: 'change' }],
  amount: [
    { required: true, message: t('billing.validation.amountRequired'), trigger: 'blur' },
    { type: 'number', min: 0.01, message: t('billing.validation.amountPositive'), trigger: 'blur' },
    { validator: (_rule, value, callback) => value > 128000 ? callback(new Error(t('billing.validation.amountExceeded'))) : callback(), trigger: 'blur' },
  ],
  method: [{ required: true, message: t('billing.validation.methodRequired'), trigger: 'change' }],
  reference: [{ required: true, message: t('billing.validation.referenceRequired'), trigger: 'blur' }],
}))
function message(action: string) { ElMessage.success(operationMessage(t, action)) }
async function submitPayment() {
  if (!await paymentRef.value?.validate().catch(() => false)) return
  paymentOpen.value = false
  message('paymentRecorded')
}
</script>

<template>
  <section class="page">
    <div class="page-heading">
      <div><h1>{{ t('billing.page.title') }}</h1><p>{{ t('billing.page.subtitle') }}</p><small class="muted">{{ t('billing.page.periodHint') }}</small></div>
      <div class="toolbar"><el-button data-testid="billing-refresh" @click="message('refreshed')">{{ t('billing.page.refresh') }}</el-button><el-button type="primary" data-testid="billing-payment-open" @click="paymentOpen = true">{{ t('billing.page.recordPayment') }}</el-button></div>
    </div>

    <div class="metric-grid">
      <el-card><el-statistic :title="t('billing.metrics.receivable')" value="¥ 4,680,000" /></el-card>
      <el-card><el-statistic :title="t('billing.metrics.overdue')" value="¥ 328,400" /></el-card>
      <el-card><el-statistic :title="t('billing.metrics.receivedToday')" value="¥ 706,200" /></el-card>
      <el-card><el-statistic :title="t('billing.metrics.unapplied')" value="¥ 58,000" /></el-card>
      <el-card><el-statistic :title="t('billing.metrics.refundPending')" :value="7" /></el-card>
      <el-card><el-statistic :title="t('billing.metrics.invoiceCount')" :value="186" /></el-card>
      <el-card><el-statistic :title="t('billing.metrics.difference')" value="¥ 12,600" /></el-card>
      <el-card><el-statistic :title="t('billing.metrics.collectionRate')" value="94.2%" /></el-card>
    </div>

    <el-card class="section-card">
      <el-form class="filter-bar" label-position="top">
        <el-form-item :label="t('billing.filters.invoiceLabel')"><el-input v-model="filters.invoice" data-testid="billing-filter-invoice" :placeholder="t('billing.filters.invoicePlaceholder')" /></el-form-item>
        <el-form-item :label="t('billing.filters.statusLabel')"><el-select v-model="filters.status" data-testid="billing-filter-status" :placeholder="t('billing.filters.statusPlaceholder')"><el-option :label="t('billing.invoiceStatus.issued')" value="issued" /><el-option :label="t('billing.invoiceStatus.overdue')" value="overdue" /></el-select></el-form-item>
        <el-form-item :label="t('billing.filters.methodLabel')"><el-select v-model="filters.method" data-testid="billing-filter-method" :placeholder="t('billing.filters.methodPlaceholder')"><el-option :label="t('billing.paymentMethods.bank')" value="bank" /><el-option :label="t('billing.paymentMethods.card')" value="card" /></el-select></el-form-item>
        <el-form-item :label="t('billing.filters.reconcileLabel')"><el-select v-model="filters.reconcile" data-testid="billing-filter-reconcile" :placeholder="t('billing.filters.reconcilePlaceholder')"><el-option :label="t('billing.reconcileStatus.pending')" value="pending" /><el-option :label="t('billing.reconcileStatus.matched')" value="matched" /></el-select></el-form-item>
        <el-form-item :label="t('billing.filters.periodLabel')"><el-date-picker v-model="filters.period" data-testid="billing-filter-period" type="daterange" :start-placeholder="t('billing.filters.periodStart')" :end-placeholder="t('billing.filters.periodEnd')" /></el-form-item>
      </el-form>
      <el-button type="primary" data-testid="billing-filter-apply">{{ t('billing.filters.apply') }}</el-button>

      <div class="status-row legend-row">
        <el-tag>{{ t('billing.invoiceStatus.draft') }}</el-tag><el-tag>{{ t('billing.invoiceStatus.partial') }}</el-tag><el-tag>{{ t('billing.invoiceStatus.paid') }}</el-tag><el-tag>{{ t('billing.invoiceStatus.voided') }}</el-tag>
        <el-tag>{{ t('billing.paymentMethods.wallet') }}</el-tag><el-tag>{{ t('billing.paymentMethods.cash') }}</el-tag><el-tag>{{ t('billing.paymentMethods.credit') }}</el-tag>
        <el-tag>{{ t('billing.reconcileStatus.difference') }}</el-tag><el-tag>{{ t('billing.reconcileStatus.manual') }}</el-tag>
      </div>

      <el-table :data="invoices" stripe data-testid="billing-table">
        <el-table-column prop="no" :label="t('billing.columns.invoiceNo')" width="150" />
        <el-table-column prop="customer" :label="t('billing.columns.customer')" min-width="130" />
        <el-table-column prop="amount" :label="t('billing.columns.amount')" width="120" />
        <el-table-column prop="received" :label="t('billing.columns.received')" width="120" />
        <el-table-column prop="dueDate" :label="t('billing.columns.dueDate')" width="120" />
        <el-table-column :label="t('billing.columns.status')" width="120"><template #default="scope">{{ t(`billing.invoiceStatus.${scope.row.status}`) }}</template></el-table-column>
        <el-table-column :label="t('billing.columns.method')" width="120"><template #default="scope">{{ t(`billing.paymentMethods.${scope.row.method}`) }}</template></el-table-column>
        <el-table-column :label="t('billing.columns.reconcile')" width="130"><template #default="scope">{{ t(`billing.reconcileStatus.${scope.row.reconcile}`) }}</template></el-table-column>
        <el-table-column prop="owner" :label="t('billing.columns.owner')" width="100" />
        <el-table-column :label="t('billing.columns.actions')" width="280" fixed="right"><template #default="scope"><el-button link data-testid="billing-view" @click="detail = scope.row">{{ t('billing.actions.view') }}</el-button><el-button link data-testid="billing-send" @click="message('reminderSent')">{{ t('billing.actions.send') }}</el-button><el-button link data-testid="billing-pay-row" @click="paymentOpen = true">{{ t('billing.actions.payment') }}</el-button></template></el-table-column>
      </el-table>
      <div class="toolbar action-strip">
        <el-button data-testid="billing-refund" @click="message('refundCreated')">{{ t('billing.actions.refund') }}</el-button>
        <el-button data-testid="billing-void" @click="message('invoiceVoided')">{{ t('billing.actions.void') }}</el-button>
        <el-button data-testid="billing-reconcile" @click="message('reconciled')">{{ t('billing.actions.reconcile') }}</el-button>
        <el-button data-testid="billing-download" @click="message('downloaded')">{{ t('billing.actions.download') }}</el-button>
        <el-button data-testid="billing-export" @click="message('exported')">{{ t('billing.actions.export') }}</el-button>
      </div>
    </el-card>

    <el-drawer v-model="detail" data-testid="billing-detail" :title="t('billing.detail.title')" size="46%">
      <el-collapse v-if="detail" model-value="invoice">
        <el-collapse-item name="invoice" :title="t('billing.detail.invoiceInfo')"><p>{{ detail.no }} · {{ detail.amount }}</p><p>{{ t('billing.detail.taxSummary') }}：¥ 7,332</p></el-collapse-item>
        <el-collapse-item name="customer" :title="t('billing.detail.customerInfo')"><p>{{ detail.customer }}</p><p>{{ t('billing.detail.contract') }}：CON-2026-0081</p></el-collapse-item>
        <el-collapse-item name="items" :title="t('billing.detail.lineItems')"><p>企业平台订阅 × 1</p></el-collapse-item>
        <el-collapse-item name="payments" :title="t('billing.detail.paymentHistory')"><p>{{ detail.received }}</p></el-collapse-item>
        <el-collapse-item name="notes" :title="t('billing.detail.collectionNotes')"><el-input /><el-button @click="message('noteSaved')">保存</el-button></el-collapse-item>
        <el-collapse-item name="audit" :title="t('billing.detail.auditTrail')"><p>2026-08-01 自动开票</p></el-collapse-item>
      </el-collapse>
      <el-button data-testid="billing-detail-close" @click="detail = undefined">{{ t('billing.detail.close') }}</el-button>
    </el-drawer>

    <el-dialog v-model="paymentOpen" data-testid="billing-payment-dialog" :title="t('billing.payment.title')" width="580px">
      <el-form ref="paymentRef" :model="payment" :rules="rules" label-position="top">
        <el-form-item prop="invoice" :label="t('billing.payment.invoice')"><el-select v-model="payment.invoice" data-testid="billing-payment-invoice"><el-option label="INV-202608-0182" value="INV-202608-0182" /></el-select></el-form-item>
        <el-form-item prop="amount" :label="t('billing.payment.amount')"><el-input-number v-model="payment.amount" data-testid="billing-payment-amount" :placeholder="t('billing.payment.amountPlaceholder')" /></el-form-item>
        <el-form-item prop="method" :label="t('billing.payment.method')"><el-select v-model="payment.method" data-testid="billing-payment-method" :placeholder="t('billing.payment.methodPlaceholder')"><el-option :label="t('billing.paymentMethods.bank')" value="bank" /></el-select></el-form-item>
        <el-form-item prop="reference" :label="t('billing.payment.reference')"><el-input v-model="payment.reference" data-testid="billing-payment-reference" /></el-form-item>
        <el-form-item :label="t('billing.payment.receivedAt')"><el-date-picker v-model="payment.receivedAt" data-testid="billing-payment-date" type="datetime" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="paymentOpen = false">{{ t('billing.payment.cancel') }}</el-button><el-button type="primary" data-testid="billing-payment-submit" @click="submitPayment">{{ t('billing.payment.submit') }}</el-button></template>
    </el-dialog>
  </section>
</template>
