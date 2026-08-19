<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const categories = [
  { value: 'electronics', labelKey: 'products.category.electronics' },
  { value: 'apparel', labelKey: 'products.category.apparel' },
  { value: 'food', labelKey: 'products.category.food' },
  { value: 'home', labelKey: 'products.category.home' },
  { value: 'sports', labelKey: 'products.category.sports' },
  { value: 'books', labelKey: 'products.category.books' },
]

const products = computed(() =>
  Array.from({ length: 45 }, (_, index) => {
    const i = index + 1
    return {
      id: 5000 + i,
      name: t(`products.rows.${i}.name`),
      sku: t(`products.rows.${i}.sku`),
      price: t(`products.rows.${i}.price`),
      category: categories[i % categories.length].value,
      stock: (i * 37) % 500 + 10,
      status: i % 5 === 0 ? 'offline' : i % 7 === 0 ? 'draft' : 'online',
    }
  }),
)

const page = ref(1)
const pageSize = ref(15)
const keyword = ref('')
const categoryFilter = ref('')
const statusFilter = ref('')

const filtered = computed(() =>
  products.value.filter((product) => {
    const keywordMatch = !keyword.value || product.name.includes(keyword.value) || product.sku.includes(keyword.value)
    const categoryMatch = !categoryFilter.value || product.category === categoryFilter.value
    const statusMatch = !statusFilter.value || product.status === statusFilter.value
    return keywordMatch && categoryMatch && statusMatch
  }),
)
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

function statusType(status: string): 'success' | 'info' | 'warning' {
  return status === 'online' ? 'success' : status === 'offline' ? 'info' : 'warning'
}
async function toggleStatus(row: { status: string; name: string }): Promise<void> {
  if (row.status === 'offline') {
    ElMessage.success(t('products.success.onShelf'))
    return
  }
  await ElMessageBox.confirm(t('products.confirm.offShelf'), t('common.dialog.title'), {
    type: 'warning',
    confirmButtonText: t('common.action.confirm'),
    cancelButtonText: t('common.action.cancel'),
  })
  ElMessage.success(t('products.success.offShelf'))
}
async function copySku(row: { sku: string }): Promise<void> {
  try {
    await navigator.clipboard.writeText(row.sku)
    ElMessage.success(t('common.dialog.copySuccess'))
  } catch {
    ElMessage.error(t('common.dialog.copyFailed'))
  }
}
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="header">
        <span>{{ t('products.title') }}</span>
        <el-button type="primary">{{ t('common.action.create') }}</el-button>
      </div>
    </template>

    <el-form inline class="filters">
      <el-form-item>
        <el-input v-model="keyword" :placeholder="t('products.searchPlaceholder')" clearable style="width: 260px" />
      </el-form-item>
      <el-form-item>
        <el-select v-model="categoryFilter" :placeholder="t('products.filter.category')" clearable style="width: 150px">
          <el-option v-for="category in categories" :key="category.value" :label="t(category.labelKey)" :value="category.value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-select v-model="statusFilter" :placeholder="t('products.filter.status')" clearable style="width: 150px">
          <el-option :label="t('products.status.online')" value="online" />
          <el-option :label="t('products.status.offline')" value="offline" />
          <el-option :label="t('products.status.draft')" value="draft" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="page = 1">{{ t('common.action.search') }}</el-button>
        <el-button @click="keyword = ''; categoryFilter = ''; statusFilter = ''; page = 1">{{ t('common.action.reset') }}</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="paged" border>
      <el-table-column :label="t('products.table.id')" prop="id" width="90" />
      <el-table-column :label="t('products.table.name')" prop="name" min-width="140" />
      <el-table-column :label="t('products.table.sku')" prop="sku" width="130" />
      <el-table-column :label="t('products.table.category')" width="120">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">{{ t(`products.category.${row.category}`) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('products.table.price')" prop="price" width="110" />
      <el-table-column :label="t('products.table.stock')" prop="stock" width="90" />
      <el-table-column :label="t('products.table.status')" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ t(`products.status.${row.status}`) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('products.table.actions')" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="toggleStatus(row)">
            {{ row.status === 'online' ? t('products.action.offShelf') : t('products.action.onShelf') }}
          </el-button>
          <el-button link type="primary">{{ t('products.action.edit') }}</el-button>
          <el-button link type="info" @click="copySku(row)">{{ t('products.action.copySku') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="filtered.length"
        layout="total, prev, pager, next"
        :page-sizes="[15, 30]"
      />
    </div>
  </el-card>
</template>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: center; }
.filters { margin-bottom: 4px; }
.pager { margin-top: 12px; display: flex; justify-content: flex-end; }
</style>
