<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { operationMessage } from '../services/inventoryMessages.js'

type Stock = { sku: string; product: string; warehouse: string; zone: string; available: number; reserved: number; status: string; batch: string; updatedAt: string }
const { t } = useI18n()
const detail = ref<Stock>()
const adjustOpen = ref(false)
const adjustRef = ref<FormInstance>()
const filters = reactive({ sku: '', warehouse: '', status: '', type: '', zone: '' })
const adjust = reactive({ warehouse: '', sku: '', reason: '', quantity: undefined as number | undefined, reference: '', remark: '' })
const stocks: Stock[] = [
  { sku: 'SKU-10081', product: '边缘计算网关', warehouse: '上海一号仓', zone: 'A-12', available: 428, reserved: 72, status: 'healthy', batch: 'B240801', updatedAt: '11:05' },
  { sku: 'SKU-20417', product: '工业采集模块', warehouse: '苏州备件仓', zone: 'C-08', available: 18, reserved: 12, status: 'low', batch: 'B240726', updatedAt: '10:48' },
  { sku: 'SKU-30196', product: '温湿度传感器', warehouse: '深圳中心仓', zone: 'P-03', available: 0, reserved: 0, status: 'out', batch: 'B240611', updatedAt: '09:31' },
  { sku: 'SKU-40822', product: '设备授权许可', warehouse: '虚拟商品仓', zone: 'V-01', available: 900, reserved: 900, status: 'reserved', batch: 'LICENSE', updatedAt: '昨天' },
]

const rules = computed<FormRules>(() => ({
  warehouse: [{ required: true, message: t('inventory.validation.warehouseRequired'), trigger: 'change' }],
  sku: [{ required: true, message: t('inventory.validation.skuRequired'), trigger: 'change' }],
  reason: [{ required: true, message: t('inventory.validation.reasonRequired'), trigger: 'change' }],
  quantity: [
    { required: true, message: t('inventory.validation.quantityRequired'), trigger: 'blur' },
    { type: 'number', min: -10000, max: 10000, message: t('inventory.validation.quantityRange'), trigger: 'blur' },
  ],
  remark: [{ max: 200, message: t('inventory.validation.remarkLength'), trigger: 'blur' }],
}))

function message(action: string) { ElMessage.success(operationMessage(t, action)) }
async function submitAdjust() {
  if (!await adjustRef.value?.validate().catch(() => false)) return
  adjustOpen.value = false
  message('adjusted')
}
</script>

<template>
  <section class="page">
    <div class="page-heading">
      <div><h1>{{ t('inventory.page.title') }}</h1><p>{{ t('inventory.page.subtitle') }}</p><small class="muted">{{ t('inventory.page.stockHint') }}</small></div>
      <div class="toolbar"><el-button data-testid="inventory-refresh" @click="message('refreshed')">{{ t('inventory.page.refresh') }}</el-button><el-button type="primary" data-testid="inventory-adjust-open" @click="adjustOpen = true">{{ t('inventory.page.createAdjustment') }}</el-button></div>
    </div>

    <div class="metric-grid">
      <el-card><el-statistic :title="t('inventory.metrics.totalSku')" :value="12842" /></el-card>
      <el-card><el-statistic :title="t('inventory.metrics.lowStock')" :value="86" /></el-card>
      <el-card><el-statistic :title="t('inventory.metrics.outOfStock')" :value="12" /></el-card>
      <el-card><el-statistic :title="t('inventory.metrics.reserved')" :value="3260" /></el-card>
      <el-card><el-statistic :title="t('inventory.metrics.inTransit')" :value="741" /></el-card>
      <el-card><el-statistic :title="t('inventory.metrics.expiring')" :value="19" /></el-card>
      <el-card><el-statistic :title="t('inventory.metrics.blocked')" :value="34" /></el-card>
      <el-card><el-statistic :title="t('inventory.metrics.turnover')" value="26.4" /></el-card>
    </div>

    <el-card class="section-card">
      <el-form class="filter-bar" label-position="top">
        <el-form-item :label="t('inventory.filters.skuLabel')"><el-input v-model="filters.sku" data-testid="inventory-filter-sku" :placeholder="t('inventory.filters.skuPlaceholder')" /></el-form-item>
        <el-form-item :label="t('inventory.filters.warehouseLabel')"><el-select v-model="filters.warehouse" data-testid="inventory-filter-warehouse" :placeholder="t('inventory.filters.warehousePlaceholder')"><el-option label="上海一号仓" value="sh" /></el-select></el-form-item>
        <el-form-item :label="t('inventory.filters.statusLabel')"><el-select v-model="filters.status" data-testid="inventory-filter-status" :placeholder="t('inventory.filters.statusPlaceholder')"><el-option :label="t('inventory.status.healthy')" value="healthy" /><el-option :label="t('inventory.status.low')" value="low" /></el-select></el-form-item>
        <el-form-item :label="t('inventory.filters.typeLabel')"><el-select v-model="filters.type" data-testid="inventory-filter-type" :placeholder="t('inventory.filters.typePlaceholder')"><el-option :label="t('inventory.types.finished')" value="finished" /><el-option :label="t('inventory.types.material')" value="material" /></el-select></el-form-item>
        <el-form-item :label="t('inventory.filters.zoneLabel')"><el-select v-model="filters.zone" data-testid="inventory-filter-zone" :placeholder="t('inventory.filters.zonePlaceholder')"><el-option :label="t('inventory.zones.storage')" value="storage" /></el-select></el-form-item>
      </el-form>
      <div class="toolbar"><el-button type="primary" data-testid="inventory-filter-apply">{{ t('inventory.filters.apply') }}</el-button><el-button data-testid="inventory-filter-reset">{{ t('inventory.filters.reset') }}</el-button></div>

      <div class="status-row legend-row">
        <el-tag>{{ t('inventory.types.spare') }}</el-tag><el-tag>{{ t('inventory.types.consumable') }}</el-tag><el-tag>{{ t('inventory.types.virtual') }}</el-tag>
        <el-tag>{{ t('inventory.status.out') }}</el-tag><el-tag>{{ t('inventory.status.reserved') }}</el-tag><el-tag>{{ t('inventory.status.blocked') }}</el-tag><el-tag>{{ t('inventory.status.counting') }}</el-tag>
        <el-tag>{{ t('inventory.zones.receiving') }}</el-tag><el-tag>{{ t('inventory.zones.picking') }}</el-tag><el-tag>{{ t('inventory.zones.quarantine') }}</el-tag>
      </div>

      <el-table :data="stocks" stripe data-testid="inventory-table">
        <el-table-column prop="sku" :label="t('inventory.columns.sku')" width="120" />
        <el-table-column prop="product" :label="t('inventory.columns.product')" min-width="150" />
        <el-table-column prop="warehouse" :label="t('inventory.columns.warehouse')" min-width="130" />
        <el-table-column prop="zone" :label="t('inventory.columns.zone')" width="100" />
        <el-table-column prop="available" :label="t('inventory.columns.available')" width="100" />
        <el-table-column prop="reserved" :label="t('inventory.columns.reserved')" width="100" />
        <el-table-column :label="t('inventory.columns.status')" width="120"><template #default="scope">{{ t(`inventory.status.${scope.row.status}`) }}</template></el-table-column>
        <el-table-column prop="batch" :label="t('inventory.columns.batch')" width="110" />
        <el-table-column prop="updatedAt" :label="t('inventory.columns.updatedAt')" width="125" />
        <el-table-column :label="t('inventory.columns.actions')" width="250" fixed="right"><template #default="scope"><el-button link data-testid="inventory-view" @click="detail = scope.row">{{ t('inventory.actions.view') }}</el-button><el-button link data-testid="inventory-adjust-row" @click="adjustOpen = true">{{ t('inventory.actions.adjust') }}</el-button><el-button link data-testid="inventory-reserve" @click="message('reserved')">{{ t('inventory.actions.reserve') }}</el-button></template></el-table-column>
      </el-table>
      <div class="toolbar action-strip">
        <el-button data-testid="inventory-transfer" @click="message('transferred')">{{ t('inventory.actions.transfer') }}</el-button>
        <el-button data-testid="inventory-release" @click="message('released')">{{ t('inventory.actions.release') }}</el-button>
        <el-button data-testid="inventory-count" @click="message('countStarted')">{{ t('inventory.actions.count') }}</el-button>
        <el-button data-testid="inventory-freeze" @click="message('frozen')">{{ t('inventory.actions.freeze') }}</el-button>
        <el-button data-testid="inventory-export" @click="message('exported')">{{ t('inventory.actions.export') }}</el-button>
      </div>
    </el-card>

    <el-drawer v-model="detail" data-testid="inventory-detail" :title="t('inventory.detail.title')" size="46%">
      <el-collapse v-if="detail" model-value="basic">
        <el-collapse-item name="basic" :title="t('inventory.detail.basic')"><p>{{ detail.sku }} · {{ detail.product }}</p><p>{{ t('inventory.detail.supplier') }}：华联工业</p><p>{{ t('inventory.detail.safetyStock') }}：120</p><p>{{ t('inventory.detail.reorderPoint') }}：180</p></el-collapse-item>
        <el-collapse-item name="quantities" :title="t('inventory.detail.quantities')"><p>{{ detail.available }} / {{ detail.reserved }}</p></el-collapse-item>
        <el-collapse-item name="batches" :title="t('inventory.detail.batches')"><p>{{ detail.batch }}</p></el-collapse-item>
        <el-collapse-item name="movement" :title="t('inventory.detail.movement')"><p>最近一次入库 240 件</p></el-collapse-item>
      </el-collapse>
      <p>{{ t('inventory.detail.lastCount') }}：账实一致</p>
      <el-button data-testid="inventory-detail-close" @click="detail = undefined">{{ t('inventory.detail.close') }}</el-button>
    </el-drawer>

    <el-dialog v-model="adjustOpen" data-testid="inventory-adjust-dialog" :title="t('inventory.adjust.title')" width="580px">
      <el-form ref="adjustRef" :model="adjust" :rules="rules" label-position="top">
        <el-form-item prop="warehouse" :label="t('inventory.filters.warehouseLabel')"><el-select v-model="adjust.warehouse" data-testid="inventory-adjust-warehouse"><el-option label="上海一号仓" value="sh" /></el-select></el-form-item>
        <el-form-item prop="sku" :label="t('inventory.columns.sku')"><el-select v-model="adjust.sku" data-testid="inventory-adjust-sku"><el-option label="SKU-10081" value="SKU-10081" /></el-select></el-form-item>
        <el-form-item prop="reason" :label="t('inventory.adjust.reason')"><el-select v-model="adjust.reason" data-testid="inventory-adjust-reason" :placeholder="t('inventory.adjust.reasonPlaceholder')"><el-option label="盘点差异" value="count" /></el-select></el-form-item>
        <el-form-item prop="quantity" :label="t('inventory.adjust.quantity')"><el-input-number v-model="adjust.quantity" data-testid="inventory-adjust-quantity" :placeholder="t('inventory.adjust.quantityPlaceholder')" /></el-form-item>
        <el-form-item :label="t('inventory.adjust.reference')"><el-input v-model="adjust.reference" data-testid="inventory-adjust-reference" :placeholder="t('inventory.adjust.referencePlaceholder')" /></el-form-item>
        <el-form-item prop="remark" :label="t('inventory.adjust.remark')"><el-input v-model="adjust.remark" data-testid="inventory-adjust-remark" type="textarea" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="adjustOpen = false">{{ t('inventory.adjust.cancel') }}</el-button><el-button type="primary" data-testid="inventory-adjust-submit" @click="submitAdjust">{{ t('inventory.adjust.submit') }}</el-button></template>
    </el-dialog>
  </section>
</template>
