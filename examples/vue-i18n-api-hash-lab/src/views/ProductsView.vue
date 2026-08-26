<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { getApiError, listProducts, triggerBoom, type Product } from '../api/client'

const { t } = useI18n()
const loading = ref(false)
const errorMsg = ref('')
const items = ref<Product[]>([])
const category = ref('')
const hasLoaded = ref(false)

const categories = ['外设', '显示器', '配件', '音频', '家具']

async function load() {
  loading.value = true // 自定义 spinner 出现(800ms 遮罩演练)
  errorMsg.value = ''
  try {
    const payload = await listProducts(category.value)
    items.value = payload.items
    hasLoaded.value = true
  } catch (error) {
    const info = getApiError(error)
    errorMsg.value = t('products.state.error', { code: info.code })
  } finally {
    loading.value = false
  }
}

function stockLabel(stock: number): string {
  if (stock === 0) return t('products.stock.empty')
  if (stock < 50) return t('products.stock.low')
  return t('products.stock.ok')
}

async function fireError() {
  try {
    await triggerBoom()
  } catch (error) {
    const info = getApiError(error)
    // 错误态词条:接口异常 + 详情 + 请求号
    ElMessage.error(t('products.boom.error', { code: info.code }))
    if (info.message) ElMessage(t('products.boom.detail', { message: info.message }))
    if (info.requestId) ElMessage.info(t('products.boom.requestId', { requestId: info.requestId }))
  }
}

onMounted(load)
</script>

<template>
  <!-- 自定义 spinner(非 EP):F1 可配置选择器演练 -->
  <div v-if="loading" class="toolbar" data-testid="products-loading">
    <div class="custom-spinner" role="status" aria-label="products-loading"></div>
    <span class="muted">{{ t('products.state.loading') }}</span>
  </div>

  <section class="page" data-testid="products-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('products.title') }}</h1>
        <p>{{ t('products.subtitle') }}</p>
      </div>
      <div class="toolbar">
        <el-button data-testid="products-refresh" :aria-label="t('products.aria.refresh')" :loading="loading" @click="load">{{ t('products.toolbar.refresh') }}</el-button>
        <el-button type="danger" data-testid="products-boom" :aria-label="t('products.aria.triggerError')" @click="fireError">{{ t('products.toolbar.triggerError') }}</el-button>
      </div>
    </header>

    <el-alert v-if="errorMsg" data-testid="products-error" type="error" show-icon :closable="false" :title="errorMsg" class="result-panel" />

    <el-card class="section-card">
      <div class="toolbar">
        <el-form-item :label="t('products.filter.label')">
          <el-select v-model="category" data-testid="products-category" :placeholder="t('products.filter.placeholder')" clearable style="width: 220px" @change="load">
            <el-option v-for="item in categories" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
      </div>

      <p v-if="hasLoaded" class="muted" data-testid="products-count">{{ t('products.state.loaded', { total: items.length }) }}</p>

      <el-table :data="items" data-testid="products-table" :title="t('products.nonVisual.tableTitle')">
        <el-table-column prop="name" :label="t('products.columns.name')" />
        <el-table-column prop="category" :label="t('products.columns.category')" width="120" />
        <el-table-column prop="price" :label="t('products.columns.price')" width="120" />
        <el-table-column :label="t('products.columns.stock')" width="120">
          <template #default="scope">
            <span data-testid="products-stock-label">{{ stockLabel(scope.row.stock) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('products.columns.online')" width="110">
          <template #default="scope">
            <el-tag :type="scope.row.online ? 'success' : 'info'">{{ scope.row.online ? t('products.status.online') : t('products.status.offline') }}</el-tag>
          </template>
        </el-table-column>
        <template #empty>
          <span data-testid="products-empty">{{ hasLoaded ? t('products.state.empty') : '' }}</span>
        </template>
      </el-table>
    </el-card>

    <!-- 原生 title 非可视词条 -->
    <div :title="t('products.nonVisual.tableTitle')" style="display: none" data-testid="products-nonvisual"></div>
  </section>
</template>
