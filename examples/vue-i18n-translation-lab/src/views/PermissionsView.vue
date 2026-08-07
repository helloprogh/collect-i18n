<script setup lang="ts">
import type { FormInstance, FormRules } from 'element-plus'
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import {
  createRole,
  deleteRole,
  getApiError,
  getPermissionTree,
  listMembers,
  listOperationLogs,
  listRoles,
  savePermissions,
  updateRole,
  type OperationLog,
  type PermissionNode,
  type Role,
  type RoleInput,
  type RoleMember,
  type RoleStatus,
} from '../api/client'

const { t } = useI18n()
const activeTab = ref<'roles' | 'tree' | 'log'>('roles')

// roles
const roles = ref<Role[]>([])
const rolesLoading = ref(false)
const roleDialogVisible = ref(false)
const editingRole = ref<Role | null>(null)
const roleFormRef = ref<FormInstance>()
const roleSaving = ref(false)
const roleForm = reactive<RoleInput & { status: RoleStatus }>({
  name: '',
  code: '',
  description: '',
  status: 'enabled',
})

// tree
const tree = ref<PermissionNode[]>([])
const treeRef = ref()
const treeSearch = ref('')
const checkedCount = ref(0)
const confirmVisible = ref(false)
const treeSaving = ref(false)

// members
const membersDrawerVisible = ref(false)
const membersRole = ref<Role | null>(null)
const members = ref<RoleMember[]>([])
const membersLoading = ref(false)

// delete
const deleteTarget = ref<Role | null>(null)
const deleteVisible = ref(false)
const deleteLoading = ref(false)

// log
const logs = ref<OperationLog[]>([])
const logFilter = ref('')

const filteredLogs = computed(() => {
  const keyword = logFilter.value.trim().toLowerCase()
  if (!keyword) return logs.value
  return logs.value.filter((log) => log.operator.toLowerCase().includes(keyword))
})

const roleRules = computed<FormRules<typeof roleForm>>(() => ({
  name: [
    { required: true, message: t('permissions.validation.nameRequired'), trigger: 'blur' },
    { min: 2, max: 20, message: t('permissions.validation.nameLength'), trigger: 'blur' },
  ],
  code: [
    { required: true, message: t('permissions.validation.codeRequired'), trigger: 'blur' },
    { pattern: /^[a-z][a-z0-9_]*$/u, message: t('permissions.validation.codePattern'), trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        const duplicate = roles.value.find((role) => role.code === value && role.id !== editingRole.value?.id)
        if (duplicate) callback(new Error(t('permissions.validation.codeExists')))
        else callback()
      },
      trigger: 'blur',
    },
  ],
}))

async function loadRoles() {
  rolesLoading.value = true
  try {
    roles.value = await listRoles()
  } finally {
    rolesLoading.value = false
  }
}

function openCreate() {
  editingRole.value = null
  roleForm.name = ''
  roleForm.code = ''
  roleForm.description = ''
  roleForm.status = 'enabled'
  roleDialogVisible.value = true
  nextTick(() => roleFormRef.value?.clearValidate())
}

function openEdit(role: Role) {
  editingRole.value = role
  roleForm.name = role.name
  roleForm.code = role.code
  roleForm.description = role.description
  roleForm.status = role.status
  roleDialogVisible.value = true
  nextTick(() => roleFormRef.value?.clearValidate())
}

async function saveRole() {
  if (!roleFormRef.value || !(await roleFormRef.value.validate().catch(() => false))) return
  roleSaving.value = true
  try {
    if (editingRole.value) {
      await updateRole(editingRole.value.id, { ...roleForm })
    } else {
      await createRole({ ...roleForm })
    }
    roleDialogVisible.value = false
    await loadRoles()
  } finally {
    roleSaving.value = false
  }
}

async function toggleStatus(role: Role) {
  await updateRole(role.id, { status: role.status === 'enabled' ? 'disabled' : 'enabled' })
  await loadRoles()
}

function openDelete(role: Role) {
  deleteTarget.value = role
  deleteVisible.value = true
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  deleteLoading.value = true
  try {
    await deleteRole(deleteTarget.value.id)
    ElMessage.success(t('permissions.deleteDialog.success'))
    deleteVisible.value = false
    await loadRoles()
  } catch (error) {
    const apiError = getApiError(error)
    ElMessage.error(apiError.code === 'ROLE_HAS_MEMBERS' ? t('permissions.deleteDialog.failed') : t('permissions.deleteDialog.failed'))
  } finally {
    deleteLoading.value = false
  }
}

function switchToTree(role: Role) {
  activeTab.value = 'tree'
  void role
}

async function loadTree() {
  tree.value = await getPermissionTree()
  await nextTick()
  updateCheckedCount()
}

function updateCheckedCount() {
  checkedCount.value = treeRef.value?.getCheckedNodes?.()?.length ?? 0
}

function filterNode(value: string, data: PermissionNode) {
  if (!value) return true
  const label = data.children ? t(`permissions.tree.categories.${data.label}`) : t(`permissions.tree.nodes.${data.label}`)
  return label.toLowerCase().includes(value.toLowerCase())
}

watch(treeSearch, (value) => treeRef.value?.filter(value))

interface TreeNodeLike {
  expanded?: boolean
  childNodes?: TreeNodeLike[]
}

function applyExpand(expanded: boolean) {
  const store = (treeRef.value as unknown as { store?: { root?: TreeNodeLike } } | null)?.store
  const root = store?.root
  if (!root) return
  const visit = (node: TreeNodeLike) => {
    if (node.childNodes && node.childNodes.length) {
      node.expanded = expanded
      node.childNodes.forEach(visit)
    }
  }
  visit(root)
}
function expandAll() {
  applyExpand(true)
}
function collapseAll() {
  applyExpand(false)
}

function requestSaveTree() {
  confirmVisible.value = true
}

async function confirmSaveTree() {
  treeSaving.value = true
  try {
    const ids = (treeRef.value?.getCheckedKeys?.() ?? []) as string[]
    await savePermissions(ids)
    ElMessage.success(t('permissions.confirmDialog.success'))
    confirmVisible.value = false
  } catch {
    ElMessage.error(t('permissions.confirmDialog.failed'))
  } finally {
    treeSaving.value = false
  }
}

function resetTree() {
  treeRef.value?.setCheckedKeys?.([])
  updateCheckedCount()
}

async function openMembers(role: Role) {
  membersRole.value = role
  membersDrawerVisible.value = true
  membersLoading.value = true
  try {
    members.value = await listMembers(role.id)
  } finally {
    membersLoading.value = false
  }
}

async function loadLogs() {
  logs.value = await listOperationLogs()
}

onMounted(async () => {
  await loadRoles()
})

watch(activeTab, async (tab) => {
  if (tab === 'tree' && tree.value.length === 0) await loadTree()
  if (tab === 'log' && logs.value.length === 0) await loadLogs()
})
</script>

<template>
  <section class="page" data-testid="permissions-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('permissions.title') }}</h1>
        <p>{{ t('permissions.subtitle') }}</p>
      </div>
      <div class="toolbar">
        <el-button data-testid="permissions-new-role" type="primary" @click="openCreate">{{ t('permissions.newRole') }}</el-button>
        <el-button data-testid="permissions-refresh" @click="loadRoles">{{ t('permissions.refresh') }}</el-button>
      </div>
    </header>

    <el-tabs v-model="activeTab" data-testid="permissions-tabs" lazy>
      <el-tab-pane :label="t('permissions.tabs.roles')" name="roles">
        <el-table v-loading="rolesLoading" :data="roles" data-testid="permissions-roles-table">
          <el-table-column prop="name" :label="t('permissions.roles.columns.name')" />
          <el-table-column prop="code" :label="t('permissions.roles.columns.code')" width="160" />
          <el-table-column :label="t('permissions.roles.columns.members')" width="100">
            <template #default="scope">
              <el-button link data-testid="permissions-open-members" @click="openMembers(scope.row)">{{ scope.row.memberCount }}</el-button>
            </template>
          </el-table-column>
          <el-table-column :label="t('permissions.roles.columns.status')" width="100">
            <template #default="scope">
              <el-tag :type="scope.row.status === 'enabled' ? 'success' : 'info'">
                {{ t(`permissions.roles.status.${scope.row.status}`) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('permissions.roles.columns.actions')" width="320">
            <template #default="scope">
              <el-button link data-testid="permissions-edit" @click="openEdit(scope.row)">{{ t('permissions.roles.actions.edit') }}</el-button>
              <el-button link data-testid="permissions-permissions" @click="switchToTree(scope.row)">{{ t('permissions.roles.actions.permissions') }}</el-button>
              <el-button link data-testid="permissions-toggle-status" @click="toggleStatus(scope.row)">
                {{ scope.row.status === 'enabled' ? t('permissions.roles.actions.disable') : t('permissions.roles.actions.enable') }}
              </el-button>
              <el-button link data-testid="permissions-delete" @click="openDelete(scope.row)">{{ t('permissions.roles.actions.delete') }}</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <span data-testid="permissions-roles-empty">{{ t('permissions.roles.empty') }}</span>
          </template>
        </el-table>
      </el-tab-pane>

      <el-tab-pane :label="t('permissions.tabs.tree')" name="tree">
        <h3>{{ t('permissions.tree.title') }}</h3>
        <div class="toolbar">
          <el-input v-model="treeSearch" data-testid="permissions-tree-search" :placeholder="t('permissions.tree.searchPlaceholder')" :aria-label="t('permissions.aria.treeSearch')" style="max-width: 280px" clearable />
          <el-button data-testid="permissions-expand-all" @click="expandAll">{{ t('permissions.tree.expandAll') }}</el-button>
          <el-button data-testid="permissions-collapse-all" @click="collapseAll">{{ t('permissions.tree.collapseAll') }}</el-button>
          <span class="muted">{{ t('permissions.tree.checked', { count: checkedCount }) }}</span>
        </div>
        <el-tree
          ref="treeRef"
          :data="tree"
          show-checkbox
          node-key="id"
          :filter-node-method="filterNode"
          data-testid="permissions-tree"
          @check="updateCheckedCount"
        >
          <template #default="{ data }">
            <span :aria-label="t('permissions.aria.toggleNode')">
              {{ data.children ? t(`permissions.tree.categories.${data.label}`) : t(`permissions.tree.nodes.${data.label}`) }}
            </span>
          </template>
        </el-tree>
        <div class="dialog-actions">
          <el-button data-testid="permissions-tree-reset" @click="resetTree">{{ t('permissions.tree.reset') }}</el-button>
          <el-button type="primary" data-testid="permissions-tree-save" @click="requestSaveTree">{{ t('permissions.tree.save') }}</el-button>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="t('permissions.tabs.log')" name="log">
        <div class="toolbar">
          <el-input v-model="logFilter" data-testid="permissions-log-filter" :placeholder="t('permissions.log.filterPlaceholder')" style="max-width: 280px" clearable />
        </div>
        <el-table :data="filteredLogs" data-testid="permissions-log-table">
          <el-table-column prop="operator" :label="t('permissions.log.columns.operator')" />
          <el-table-column prop="action" :label="t('permissions.log.columns.action')" />
          <el-table-column prop="target" :label="t('permissions.log.columns.target')" />
          <el-table-column prop="time" :label="t('permissions.log.columns.time')" width="180" />
          <el-table-column :label="t('permissions.log.columns.result')" width="100">
            <template #default="scope">
              <el-tag :type="scope.row.result === 'success' ? 'success' : 'danger'">
                {{ t(`permissions.log.result.${scope.row.result}`) }}
              </el-tag>
            </template>
          </el-table-column>
          <template #empty>
            <span data-testid="permissions-log-empty">{{ t('permissions.log.empty') }}</span>
          </template>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="roleDialogVisible" data-testid="permissions-role-dialog"
      :title="editingRole ? t('permissions.roleDialog.editTitle') : t('permissions.roleDialog.createTitle')" width="520"
      :aria-label="t('permissions.aria.closeDialog')">
      <el-form ref="roleFormRef" :model="roleForm" :rules="roleRules" label-position="top">
        <el-form-item :label="t('permissions.roleDialog.name.label')" prop="name">
          <el-input v-model="roleForm.name" data-testid="permissions-role-name" :placeholder="t('permissions.roleDialog.name.placeholder')" />
        </el-form-item>
        <el-form-item :label="t('permissions.roleDialog.code.label')" prop="code">
          <el-input v-model="roleForm.code" data-testid="permissions-role-code" :placeholder="t('permissions.roleDialog.code.placeholder')" />
        </el-form-item>
        <el-form-item :label="t('permissions.roleDialog.description.label')" prop="description">
          <el-input v-model="roleForm.description" data-testid="permissions-role-desc" type="textarea" :rows="2" :placeholder="t('permissions.roleDialog.description.placeholder')" />
        </el-form-item>
        <el-form-item :label="t('permissions.roleDialog.status.label')">
          <el-radio-group v-model="roleForm.status" data-testid="permissions-role-status">
            <el-radio value="enabled">{{ t('permissions.roleDialog.status.enabled') }}</el-radio>
            <el-radio value="disabled">{{ t('permissions.roleDialog.status.disabled') }}</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button data-testid="permissions-role-cancel" @click="roleDialogVisible = false">{{ t('permissions.roleDialog.cancel') }}</el-button>
        <el-button type="primary" :loading="roleSaving" data-testid="permissions-role-submit" @click="saveRole">{{ t('permissions.roleDialog.submit') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="confirmVisible" data-testid="permissions-confirm-dialog" :title="t('permissions.confirmDialog.title')" width="480">
      <p>{{ t('permissions.confirmDialog.message') }}</p>
      <template #footer>
        <el-button data-testid="permissions-confirm-cancel" @click="confirmVisible = false">{{ t('permissions.confirmDialog.cancel') }}</el-button>
        <el-button type="primary" :loading="treeSaving" data-testid="permissions-confirm-save" @click="confirmSaveTree">{{ t('permissions.confirmDialog.confirm') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="deleteVisible" data-testid="permissions-delete-dialog" :title="t('permissions.deleteDialog.title')" width="480">
      <p>{{ t('permissions.deleteDialog.message') }}</p>
      <template #footer>
        <el-button data-testid="permissions-delete-cancel" @click="deleteVisible = false">{{ t('permissions.deleteDialog.cancel') }}</el-button>
        <el-button type="danger" :loading="deleteLoading" data-testid="permissions-delete-confirm" @click="confirmDelete">{{ t('permissions.deleteDialog.confirm') }}</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="membersDrawerVisible" data-testid="permissions-members-drawer" :title="t('permissions.members.title')" size="40%" :aria-label="t('permissions.aria.closeDrawer')">
      <p v-if="membersRole" class="muted">{{ t('permissions.members.total', { count: membersRole.memberCount }) }}</p>
      <el-table v-loading="membersLoading" :data="members" size="small">
        <el-table-column prop="name" :label="t('permissions.members.columns.name')" />
        <el-table-column prop="dept" :label="t('permissions.members.columns.dept')" />
        <el-table-column prop="joinedAt" :label="t('permissions.members.columns.joinedAt')" width="140" />
        <el-table-column :label="t('permissions.members.columns.actions')" width="100">
          <template #default>
            <el-button link data-testid="permissions-remove-member">{{ t('permissions.members.remove') }}</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <span>{{ t('permissions.members.empty') }}</span>
        </template>
      </el-table>
      <div class="dialog-actions">
        <el-button data-testid="permissions-add-member">{{ t('permissions.members.add') }}</el-button>
      </div>
    </el-drawer>
  </section>
</template>
