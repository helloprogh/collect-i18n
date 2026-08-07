<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { operationMessage } from '../services/releaseMessages.js'

type Release = { no: string; application: string; version: string; environment: string; window: string; risk: string; status: string; owner: string; approvers: string }
const { t } = useI18n()
const detail = ref<Release>()
const approvalOpen = ref(false)
const createOpen = ref(false)
const approvalRef = ref<FormInstance>()
const filters = reactive({ application: '', environment: '', status: '', risk: '', owner: '' })
const approval = reactive({ decision: '', comment: '', conditions: '', notifyOwner: true, confirmRisk: false })
const releases: Release[] = [
  { no: 'REL-2026-0817', application: '数据同步服务', version: 'v4.18.0', environment: 'production', window: '08-08 22:00', risk: 'high', status: 'reviewing', owner: '梁川', approvers: '2 / 3' },
  { no: 'REL-2026-0815', application: '统一权限中心', version: 'v2.9.3', environment: 'staging', window: '08-08 16:00', risk: 'medium', status: 'approved', owner: '沈瑜', approvers: '3 / 3' },
  { no: 'REL-2026-0811', application: '告警编排平台', version: 'v6.2.1', environment: 'testing', window: '08-07 14:30', risk: 'low', status: 'running', owner: '顾言', approvers: '2 / 2' },
]

const rules = computed<FormRules>(() => ({
  decision: [{ required: true, message: t('releases.validation.decisionRequired'), trigger: 'change' }],
  comment: [{ min: 8, message: t('releases.validation.commentLength'), trigger: 'blur' }],
}))

const createRules = computed<FormRules>(() => ({
  application: [{ required: true, message: t('releases.validation.applicationRequired'), trigger: 'change' }],
  version: [{ required: true, message: t('releases.validation.versionRequired'), trigger: 'blur' }],
  environment: [{ required: true, message: t('releases.validation.environmentRequired'), trigger: 'change' }],
  window: [{ required: true, message: t('releases.validation.windowRequired'), trigger: 'change' }],
}))

function message(action: string) { ElMessage.success(operationMessage(t, action)) }
async function submitApproval() {
  if (!await approvalRef.value?.validate().catch(() => false)) return
  const action = approval.decision === 'reject' ? 'rejected' : 'approved'
  approvalOpen.value = false
  message(action)
}
</script>

<template>
  <section class="page">
    <div class="page-heading">
      <div><h1>{{ t('releases.page.title') }}</h1><p>{{ t('releases.page.subtitle') }}</p><small class="muted">{{ t('releases.page.windowHint') }}</small></div>
      <div class="toolbar"><el-button data-testid="releases-refresh" @click="message('refreshed')">{{ t('releases.page.refresh') }}</el-button><el-button type="primary" data-testid="releases-create-open" @click="createOpen = true">{{ t('releases.page.createRelease') }}</el-button></div>
    </div>

    <div class="metric-grid">
      <el-card><el-statistic :title="t('releases.metrics.planned')" :value="24" /></el-card>
      <el-card><el-statistic :title="t('releases.metrics.awaiting')" :value="7" /></el-card>
      <el-card><el-statistic :title="t('releases.metrics.approved')" :value="9" /></el-card>
      <el-card><el-statistic :title="t('releases.metrics.running')" :value="3" /></el-card>
      <el-card><el-statistic :title="t('releases.metrics.failed')" :value="2" /></el-card>
      <el-card><el-statistic :title="t('releases.metrics.rollback')" :value="1" /></el-card>
      <el-card><el-statistic :title="t('releases.metrics.successRate')" value="98.6%" /></el-card>
      <el-card><el-statistic :title="t('releases.metrics.leadTime')" value="1.8 天" /></el-card>
    </div>

    <el-card class="section-card">
      <el-form class="filter-bar" label-position="top">
        <el-form-item :label="t('releases.filters.applicationLabel')"><el-input v-model="filters.application" data-testid="releases-filter-application" :placeholder="t('releases.filters.applicationPlaceholder')" /></el-form-item>
        <el-form-item :label="t('releases.filters.environmentLabel')"><el-select v-model="filters.environment" data-testid="releases-filter-environment" :placeholder="t('releases.filters.environmentPlaceholder')"><el-option :label="t('releases.environments.production')" value="production" /></el-select></el-form-item>
        <el-form-item :label="t('releases.filters.statusLabel')"><el-select v-model="filters.status" data-testid="releases-filter-status" :placeholder="t('releases.filters.statusPlaceholder')"><el-option :label="t('releases.statuses.reviewing')" value="reviewing" /></el-select></el-form-item>
        <el-form-item :label="t('releases.filters.riskLabel')"><el-select v-model="filters.risk" data-testid="releases-filter-risk" :placeholder="t('releases.filters.riskPlaceholder')"><el-option :label="t('releases.risk.high')" value="high" /></el-select></el-form-item>
        <el-form-item :label="t('releases.filters.ownerLabel')"><el-input v-model="filters.owner" data-testid="releases-filter-owner" :placeholder="t('releases.filters.ownerPlaceholder')" /></el-form-item>
      </el-form>
      <div class="toolbar"><el-button type="primary" data-testid="releases-filter-apply">{{ t('releases.filters.apply') }}</el-button><el-button data-testid="releases-filter-reset">{{ t('releases.filters.reset') }}</el-button></div>

      <div class="status-row legend-row">
        <el-tag>{{ t('releases.environments.development') }}</el-tag><el-tag>{{ t('releases.environments.testing') }}</el-tag><el-tag>{{ t('releases.environments.staging') }}</el-tag>
        <el-tag>{{ t('releases.statuses.draft') }}</el-tag><el-tag>{{ t('releases.statuses.scheduled') }}</el-tag><el-tag>{{ t('releases.statuses.succeeded') }}</el-tag><el-tag>{{ t('releases.statuses.failed') }}</el-tag>
        <el-tag>{{ t('releases.risk.low') }}</el-tag><el-tag>{{ t('releases.risk.medium') }}</el-tag><el-tag>{{ t('releases.risk.critical') }}</el-tag>
      </div>

      <el-table :data="releases" stripe data-testid="releases-table">
        <el-table-column prop="no" :label="t('releases.columns.releaseNo')" width="135" />
        <el-table-column prop="application" :label="t('releases.columns.application')" min-width="140" />
        <el-table-column prop="version" :label="t('releases.columns.version')" width="100" />
        <el-table-column :label="t('releases.columns.environment')" width="120"><template #default="scope">{{ t(`releases.environments.${scope.row.environment}`) }}</template></el-table-column>
        <el-table-column prop="window" :label="t('releases.columns.window')" width="130" />
        <el-table-column :label="t('releases.columns.risk')" width="120"><template #default="scope">{{ t(`releases.risk.${scope.row.risk}`) }}</template></el-table-column>
        <el-table-column :label="t('releases.columns.status')" width="120"><template #default="scope">{{ t(`releases.statuses.${scope.row.status}`) }}</template></el-table-column>
        <el-table-column prop="owner" :label="t('releases.columns.owner')" width="100" />
        <el-table-column prop="approvers" :label="t('releases.columns.approvers')" width="105" />
        <el-table-column :label="t('releases.columns.actions')" width="280" fixed="right"><template #default="scope"><el-button link data-testid="releases-view" @click="detail = scope.row">{{ t('releases.actions.view') }}</el-button><el-button link data-testid="releases-submit" @click="message('submitted')">{{ t('releases.actions.submit') }}</el-button><el-button link data-testid="releases-approve" @click="approvalOpen = true">{{ t('releases.actions.approve') }}</el-button></template></el-table-column>
      </el-table>
      <div class="toolbar action-strip">
        <el-button data-testid="releases-reject" @click="approvalOpen = true">{{ t('releases.actions.reject') }}</el-button>
        <el-button data-testid="releases-schedule" @click="message('scheduled')">{{ t('releases.actions.schedule') }}</el-button>
        <el-button data-testid="releases-start" @click="message('started')">{{ t('releases.actions.start') }}</el-button>
        <el-button data-testid="releases-rollback" @click="message('rollbackStarted')">{{ t('releases.actions.rollback') }}</el-button>
        <el-button data-testid="releases-export">{{ t('releases.actions.export') }}</el-button>
      </div>
    </el-card>

    <el-drawer v-model="detail" data-testid="releases-detail" :title="t('releases.detail.title')" size="48%">
      <el-collapse v-if="detail" model-value="summary">
        <el-collapse-item name="summary" :title="t('releases.detail.summary')"><p>升级同步引擎并调整任务调度策略。</p></el-collapse-item>
        <el-collapse-item name="commits" :title="t('releases.detail.commits')"><p>18 commits / 24 files</p></el-collapse-item>
        <el-collapse-item name="dependencies" :title="t('releases.detail.dependencies')"><p>权限中心、配置中心</p></el-collapse-item>
        <el-collapse-item name="database" :title="t('releases.detail.database')"><p>新增任务索引</p></el-collapse-item>
        <el-collapse-item name="verification" :title="t('releases.detail.verification')"><p>核心链路回归与指标观察</p></el-collapse-item>
        <el-collapse-item name="rollback" :title="t('releases.detail.rollbackPlan')"><p>自动切回 v4.17.3</p></el-collapse-item>
        <el-collapse-item name="approvals" :title="t('releases.detail.approvals')"><p>架构负责人已批准</p></el-collapse-item>
        <el-collapse-item name="logs" :title="t('releases.detail.executionLog')"><p>尚未开始执行</p></el-collapse-item>
      </el-collapse>
      <el-button data-testid="releases-detail-close" @click="detail = undefined">{{ t('releases.detail.close') }}</el-button>
    </el-drawer>

    <el-dialog v-model="approvalOpen" data-testid="releases-approval-dialog" :title="t('releases.approval.title')" width="600px">
      <el-form ref="approvalRef" :model="approval" :rules="rules" label-position="top">
        <el-form-item prop="decision" :label="t('releases.approval.decision')"><el-select v-model="approval.decision" data-testid="releases-approval-decision" :placeholder="t('releases.approval.decisionPlaceholder')"><el-option :label="t('releases.actions.approve')" value="approve" /><el-option :label="t('releases.actions.reject')" value="reject" /></el-select></el-form-item>
        <el-form-item prop="comment" :label="t('releases.approval.comment')"><el-input v-model="approval.comment" data-testid="releases-approval-comment" type="textarea" :placeholder="t('releases.approval.commentPlaceholder')" /></el-form-item>
        <el-form-item :label="t('releases.approval.conditions')"><el-input v-model="approval.conditions" data-testid="releases-approval-conditions" /></el-form-item>
        <el-form-item><el-checkbox v-model="approval.notifyOwner">{{ t('releases.approval.notifyOwner') }}</el-checkbox><el-checkbox v-model="approval.confirmRisk">{{ t('releases.approval.confirmRisk') }}</el-checkbox></el-form-item>
      </el-form>
      <template #footer><el-button @click="approvalOpen = false">{{ t('releases.approval.cancel') }}</el-button><el-button type="primary" data-testid="releases-approval-submit" @click="submitApproval">{{ t('releases.approval.submit') }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="createOpen" data-testid="releases-create-dialog" :title="t('releases.page.createRelease')" width="600px">
      <el-form :model="{}" :rules="createRules" label-position="top">
        <el-form-item prop="application" :label="t('releases.filters.applicationLabel')"><el-select data-testid="releases-create-application" /></el-form-item>
        <el-form-item prop="version" :label="t('releases.columns.version')"><el-input data-testid="releases-create-version" /></el-form-item>
        <el-form-item prop="environment" :label="t('releases.filters.environmentLabel')"><el-select data-testid="releases-create-environment" /></el-form-item>
        <el-form-item prop="window" :label="t('releases.columns.window')"><el-date-picker data-testid="releases-create-window" type="datetime" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="createOpen = false">{{ t('releases.approval.cancel') }}</el-button><el-button type="primary" data-testid="releases-create-submit" @click="message('created')">{{ t('releases.page.createRelease') }}</el-button></template>
    </el-dialog>
  </section>
</template>
