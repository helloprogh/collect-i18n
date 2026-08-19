<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

interface UserRow {
  id: number
  name: string
  email: string
  phone: string
  role: string
  status: 'enabled' | 'disabled'
  department: string
}

const allUsers = computed<UserRow[]>(() =>
  Array.from({ length: 46 }, (_, index) => {
    const i = index + 1
    return {
      id: 1000 + i,
      name: t(`users.rows.${i}.name`),
      email: t(`users.rows.${i}.email`),
      phone: t(`users.rows.${i}.phone`),
      role: ['admin', 'editor', 'viewer', 'auditor', 'operator'][i % 5],
      status: i % 4 === 0 ? 'disabled' : 'enabled',
      department: t(`users.rows.${i}.department`),
    }
  }),
)

const page = ref(1)
const pageSize = ref(15)
const keyword = ref('')
const roleFilter = ref('')
const statusFilter = ref('')
const selected = ref<UserRow[]>([])
const dialogVisible = ref(false)
const editingId = ref<number | null>(null)

const filtered = computed(() =>
  allUsers.value.filter((user) => {
    const keywordMatch =
      !keyword.value ||
      user.name.includes(keyword.value) ||
      user.email.includes(keyword.value) ||
      user.phone.includes(keyword.value)
    const roleMatch = !roleFilter.value || user.role === roleFilter.value
    const statusMatch = !statusFilter.value || user.status === statusFilter.value
    return keywordMatch && roleMatch && statusMatch
  }),
)
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

const roleOptions = [
  { value: 'admin', labelKey: 'users.role.admin' },
  { value: 'editor', labelKey: 'users.role.editor' },
  { value: 'viewer', labelKey: 'users.role.viewer' },
  { value: 'auditor', labelKey: 'users.role.auditor' },
  { value: 'operator', labelKey: 'users.role.operator' },
]

const form = reactive({
  name: '',
  email: '',
  phone: '',
  department: '',
  role: 'editor',
  status: 'enabled' as 'enabled' | 'disabled',
})

const rules = {
  name: [{ required: true, message: t('settings.validation.nickname.required'), trigger: 'blur' }],
  email: [
    { required: true, message: t('settings.validation.email.required'), trigger: 'blur' },
    { type: 'email', message: t('settings.validation.email.format'), trigger: 'blur' },
  ],
  phone: [
    { required: true, message: t('settings.validation.phone.required'), trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: t('settings.validation.phone.format'), trigger: 'blur' },
  ],
}

const formRef = ref()
function openCreate(): void {
  editingId.value = null
  Object.assign(form, { name: '', email: '', phone: '', department: '', role: 'editor', status: 'enabled' })
  dialogVisible.value = true
}
function openEdit(row: UserRow): void {
  editingId.value = row.id
  Object.assign(form, {
    name: row.name,
    email: row.email,
    phone: row.phone,
    department: row.department,
    role: row.role,
    status: row.status,
  })
  dialogVisible.value = true
}
async function submitForm(): Promise<void> {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) {
    ElMessage.error(t('messages.form.error'))
    return
  }
  ElMessage.success(t('common.dialog.saveSuccess'))
  dialogVisible.value = false
}
function resetSearch(): void {
  keyword.value = ''
  roleFilter.value = ''
  statusFilter.value = ''
  page.value = 1
}
async function batchDelete(): Promise<void> {
  if (selected.value.length === 0) return
  await ElMessageBox.confirm(
    t('common.dialog.deleteContent', { count: selected.value.length }),
    t('common.dialog.deleteTitle'),
    { type: 'warning', confirmButtonText: t('common.action.delete'), cancelButtonText: t('common.action.cancel') },
  )
  ElMessage.success(t('common.dialog.deleteSuccess'))
  selected.value = []
}
async function deleteRow(row: UserRow): Promise<void> {
  await ElMessageBox.confirm(
    t('messages.confirm.content'),
    t('messages.confirm.title'),
    { type: 'warning', confirmButtonText: t('messages.confirm.confirmText'), cancelButtonText: t('messages.confirm.cancelText') },
  )
  ElMessage.success(t('common.dialog.deleteSuccess'))
}
function statusTag(status: string): 'success' | 'info' {
  return status === 'enabled' ? 'success' : 'info'
}
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="header">
        <span>{{ t('users.title') }}</span>
        <el-button type="primary" @click="openCreate">{{ t('common.action.create') }}</el-button>
      </div>
    </template>

    <el-form inline class="filters">
      <el-form-item>
        <el-input v-model="keyword" :placeholder="t('users.searchPlaceholder')" clearable style="width: 260px" />
      </el-form-item>
      <el-form-item>
        <el-select v-model="roleFilter" :placeholder="t('users.filter.role')" clearable style="width: 140px">
          <el-option v-for="option in roleOptions" :key="option.value" :label="t(option.labelKey)" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-select v-model="statusFilter" :placeholder="t('users.filter.status')" clearable style="width: 140px">
          <el-option :label="t('common.status.enabled')" value="enabled" />
          <el-option :label="t('common.status.disabled')" value="disabled" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="page = 1">{{ t('common.action.search') }}</el-button>
        <el-button @click="resetSearch">{{ t('common.action.reset') }}</el-button>
      </el-form-item>
    </el-form>

    <div class="batch-bar">
      <el-button :disabled="selected.length === 0" @click="batchDelete">{{ t('users.batch.delete') }}</el-button>
      <el-button :disabled="selected.length === 0">{{ t('users.batch.export') }}</el-button>
      <span v-if="selected.length" class="muted small">{{ t('common.pagination.total', { count: selected.length }) }}</span>
    </div>

    <el-table :data="paged" @selection-change="selected = $event" border>
      <el-table-column type="selection" width="44" />
      <el-table-column :label="t('users.table.id')" prop="id" width="90" />
      <el-table-column :label="t('users.table.name')" prop="name" min-width="120" />
      <el-table-column :label="t('users.table.email')" prop="email" min-width="180" />
      <el-table-column :label="t('users.table.phone')" prop="phone" width="130" />
      <el-table-column :label="t('users.table.role')" width="110">
        <template #default="{ row }">
          <el-tag size="small" type="warning" effect="plain">{{ t(`users.role.${row.role}`) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('users.table.department')" prop="department" min-width="110" />
      <el-table-column :label="t('users.table.status')" width="90">
        <template #default="{ row }">
          <el-tag :type="statusTag(row.status)" size="small">
            {{ t(`common.status.${row.status}`) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('users.table.actions')" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">{{ t('common.action.edit') }}</el-button>
          <el-button link type="danger" @click="deleteRow(row)">{{ t('common.action.delete') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="filtered.length"
        layout="total, prev, pager, next, sizes"
        :page-sizes="[15, 30, 46]"
      />
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? t('users.edit.title') : t('users.create.title')" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item :label="t('users.table.name')" prop="name">
          <el-input v-model="form.name" :placeholder="t('settings.placeholder.nickname')" />
        </el-form-item>
        <el-form-item :label="t('users.table.email')" prop="email">
          <el-input v-model="form.email" :placeholder="t('settings.placeholder.email')" />
        </el-form-item>
        <el-form-item :label="t('users.table.phone')" prop="phone">
          <el-input v-model="form.phone" :placeholder="t('settings.placeholder.phone')" />
        </el-form-item>
        <el-form-item :label="t('users.table.department')" prop="department">
          <el-input v-model="form.department" />
        </el-form-item>
        <el-form-item :label="t('users.table.role')" prop="role">
          <el-select v-model="form.role" style="width: 100%">
            <el-option v-for="option in roleOptions" :key="option.value" :label="t(option.labelKey)" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('users.table.status')" prop="status">
          <el-switch v-model="form.status" active-value="enabled" inactive-value="disabled"
            :active-text="t('common.status.enabled')" :inactive-text="t('common.status.disabled')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ t('common.action.cancel') }}</el-button>
        <el-button type="primary" @click="submitForm">{{ t('common.action.save') }}</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: center; }
.filters { margin-bottom: 4px; }
.batch-bar { margin-bottom: 12px; }
.muted { color: #6b7280; }
.small { font-size: 12px; }
.pager { margin-top: 12px; display: flex; justify-content: flex-end; }
</style>
