<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { operationMessage } from '../services/supportMessages.js'

type Ticket = {
  no: string
  subject: string
  customer: string
  priority: 'urgent' | 'high' | 'normal' | 'low'
  status: 'new' | 'assigned' | 'working' | 'waiting' | 'resolved' | 'closed'
  channel: 'portal' | 'email' | 'phone' | 'monitor'
  owner: string
  updatedAt: string
  sla: string
}

const { t } = useI18n()
const loading = ref(false)
const detailTicket = ref<Ticket>()
const replyOpen = ref(false)
const createOpen = ref(false)
const createFormRef = ref<FormInstance>()
const replyFormRef = ref<FormInstance>()
const filters = reactive({ keyword: '', status: '', priority: '', channel: '', owner: '' })
const createForm = reactive({ subject: '', customer: '', description: '' })
const replyForm = reactive({ recipient: '', template: '', content: '', internal: false, sendCopy: true })

const tickets = ref<Ticket[]>([
  { no: 'CS-10482', subject: '生产数据同步延迟', customer: '华东零售集团', priority: 'urgent', status: 'working', channel: 'monitor', owner: '林晓', updatedAt: '10:42', sla: '18 分钟' },
  { no: 'CS-10479', subject: '账单导出字段缺失', customer: '远海物流', priority: 'high', status: 'assigned', channel: 'email', owner: '周航', updatedAt: '09:56', sla: '1 小时' },
  { no: 'CS-10471', subject: '新成员无法登录门户', customer: '北辰科技', priority: 'normal', status: 'waiting', channel: 'portal', owner: '陈洁', updatedAt: '昨天', sla: '6 小时' },
  { no: 'CS-10465', subject: '接口调用额度咨询', customer: '云岭制造', priority: 'low', status: 'resolved', channel: 'phone', owner: '林晓', updatedAt: '昨天', sla: '已暂停' },
])

const createRules = computed<FormRules>(() => ({
  subject: [
    { required: true, message: t('support.validation.subjectRequired'), trigger: 'blur' },
    { min: 6, max: 80, message: t('support.validation.subjectLength'), trigger: 'blur' },
  ],
  customer: [{ required: true, message: t('support.validation.customerRequired'), trigger: 'change' }],
  description: [{ required: true, message: t('support.validation.descriptionRequired'), trigger: 'blur' }],
}))

const replyRules = computed<FormRules>(() => ({
  recipient: [{ required: true, type: 'email', message: t('support.validation.recipientRequired'), trigger: 'blur' }],
  content: [{ min: 10, message: t('support.validation.replyLength'), trigger: 'blur' }],
}))

function priorityLabel(value: Ticket['priority']) {
  return t(`support.priority.${value}`)
}

function statusLabel(value: Ticket['status']) {
  return t(`support.status.${value}`)
}

function channelLabel(value: Ticket['channel']) {
  return t(`support.channels.${value}`)
}

async function refresh() {
  loading.value = true
  await new Promise((resolve) => setTimeout(resolve, 180))
  loading.value = false
  ElMessage.success(operationMessage(t, 'refreshed'))
}

function notify(action: string) {
  ElMessage.success(operationMessage(t, action))
}

async function submitCreate() {
  if (!await createFormRef.value?.validate().catch(() => false)) return
  createOpen.value = false
  notify('created')
}

async function submitReply() {
  if (!await replyFormRef.value?.validate().catch(() => false)) return
  replyOpen.value = false
  notify('replied')
}
</script>

<template>
  <section class="page">
    <div class="page-heading">
      <div>
        <h1>{{ t('support.page.title') }}</h1>
        <p>{{ t('support.page.subtitle') }}</p>
        <small class="muted">{{ t('support.page.queueHint') }}</small>
      </div>
      <div class="toolbar">
        <el-button data-testid="support-refresh" :loading="loading" @click="refresh">{{ t('support.page.refresh') }}</el-button>
        <el-button type="primary" data-testid="support-create-open" @click="createOpen = true">{{ t('support.page.createTicket') }}</el-button>
      </div>
    </div>

    <div class="metric-grid">
      <el-card><el-statistic :title="t('support.metrics.open')" :value="42" /></el-card>
      <el-card><el-statistic :title="t('support.metrics.waitingCustomer')" :value="11" /></el-card>
      <el-card><el-statistic :title="t('support.metrics.breached')" :value="3" /></el-card>
      <el-card><el-statistic :title="t('support.metrics.dueToday')" :value="16" /></el-card>
      <el-card><el-statistic :title="t('support.metrics.firstResponse')" value="8 分钟" /></el-card>
      <el-card><el-statistic :title="t('support.metrics.avgResolve')" value="4.2 小时" /></el-card>
      <el-card><el-statistic :title="t('support.metrics.satisfaction')" value="96.8%" /></el-card>
      <el-card><el-statistic :title="t('support.metrics.backlog')" :value="27" /></el-card>
    </div>

    <el-card class="section-card">
      <el-form class="filter-bar" label-position="top">
        <el-form-item :label="t('support.filters.keywordLabel')"><el-input v-model="filters.keyword" data-testid="support-filter-keyword" :placeholder="t('support.filters.keywordPlaceholder')" /></el-form-item>
        <el-form-item :label="t('support.filters.statusLabel')"><el-select v-model="filters.status" data-testid="support-filter-status" :placeholder="t('support.filters.statusPlaceholder')"><el-option :label="t('support.status.new')" value="new" /><el-option :label="t('support.status.working')" value="working" /></el-select></el-form-item>
        <el-form-item :label="t('support.filters.priorityLabel')"><el-select v-model="filters.priority" data-testid="support-filter-priority" :placeholder="t('support.filters.priorityPlaceholder')"><el-option :label="t('support.priority.urgent')" value="urgent" /><el-option :label="t('support.priority.normal')" value="normal" /></el-select></el-form-item>
        <el-form-item :label="t('support.filters.channelLabel')"><el-select v-model="filters.channel" data-testid="support-filter-channel" :placeholder="t('support.filters.channelPlaceholder')"><el-option :label="t('support.channels.portal')" value="portal" /><el-option :label="t('support.channels.email')" value="email" /></el-select></el-form-item>
        <el-form-item :label="t('support.filters.ownerLabel')"><el-input v-model="filters.owner" data-testid="support-filter-owner" :placeholder="t('support.filters.ownerPlaceholder')" /></el-form-item>
      </el-form>
      <div class="toolbar">
        <el-button type="primary" data-testid="support-filter-apply">{{ t('support.filters.apply') }}</el-button>
        <el-button data-testid="support-filter-reset">{{ t('support.filters.reset') }}</el-button>
      </div>

      <div class="status-row legend-row">
        <el-tag>{{ t('support.priority.high') }}</el-tag><el-tag>{{ t('support.priority.low') }}</el-tag>
        <el-tag>{{ t('support.status.assigned') }}</el-tag><el-tag>{{ t('support.status.waiting') }}</el-tag><el-tag>{{ t('support.status.resolved') }}</el-tag><el-tag>{{ t('support.status.closed') }}</el-tag>
        <el-tag>{{ t('support.channels.phone') }}</el-tag><el-tag>{{ t('support.channels.monitor') }}</el-tag>
      </div>

      <el-table :data="tickets" stripe data-testid="support-table">
        <el-table-column prop="no" :label="t('support.columns.ticketNo')" width="120" />
        <el-table-column prop="subject" :label="t('support.columns.subject')" min-width="190" />
        <el-table-column prop="customer" :label="t('support.columns.customer')" min-width="140" />
        <el-table-column :label="t('support.columns.priority')" width="110"><template #default="scope">{{ priorityLabel(scope.row.priority) }}</template></el-table-column>
        <el-table-column :label="t('support.columns.status')" width="130"><template #default="scope">{{ statusLabel(scope.row.status) }}</template></el-table-column>
        <el-table-column :label="t('support.columns.channel')" width="130"><template #default="scope">{{ channelLabel(scope.row.channel) }}</template></el-table-column>
        <el-table-column prop="owner" :label="t('support.columns.owner')" width="90" />
        <el-table-column prop="updatedAt" :label="t('support.columns.updatedAt')" width="125" />
        <el-table-column prop="sla" :label="t('support.columns.sla')" width="140" />
        <el-table-column :label="t('support.columns.actions')" width="300" fixed="right">
          <template #default="scope">
            <el-button link data-testid="support-view" @click="detailTicket = scope.row">{{ t('support.actions.view') }}</el-button>
            <el-button link data-testid="support-assign" @click="notify('assigned')">{{ t('support.actions.assign') }}</el-button>
            <el-button link data-testid="support-reply" @click="replyOpen = true">{{ t('support.actions.reply') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="toolbar action-strip">
        <el-button data-testid="support-escalate" @click="notify('escalated')">{{ t('support.actions.escalate') }}</el-button>
        <el-button data-testid="support-resolve" @click="notify('resolved')">{{ t('support.actions.resolve') }}</el-button>
        <el-button data-testid="support-close" @click="notify('closed')">{{ t('support.actions.close') }}</el-button>
        <el-button data-testid="support-merge" @click="notify('merged')">{{ t('support.actions.merge') }}</el-button>
        <el-button data-testid="support-export" @click="notify('exported')">{{ t('support.actions.export') }}</el-button>
      </div>
    </el-card>

    <el-drawer v-model="detailTicket" data-testid="support-detail" :title="t('support.detail.title')" size="46%">
      <el-descriptions v-if="detailTicket" :column="1" border>
        <el-descriptions-item :label="t('support.detail.summary')">{{ detailTicket.subject }}</el-descriptions-item>
        <el-descriptions-item :label="t('support.detail.description')">客户反馈生产任务在高峰期出现明显延迟。</el-descriptions-item>
        <el-descriptions-item :label="t('support.detail.environment')">生产环境 / 华东区域</el-descriptions-item>
        <el-descriptions-item :label="t('support.detail.contact')">王经理</el-descriptions-item>
        <el-descriptions-item :label="t('support.detail.contract')">企业旗舰服务</el-descriptions-item>
        <el-descriptions-item :label="t('support.detail.timeline')">10:12 创建，10:18 分配专家</el-descriptions-item>
        <el-descriptions-item :label="t('support.detail.internalNote')"><el-input data-testid="support-note" /><el-button @click="notify('noteSaved')">保存</el-button></el-descriptions-item>
        <el-descriptions-item :label="t('support.detail.attachments')">trace.zip</el-descriptions-item>
      </el-descriptions>
      <el-button data-testid="support-detail-close" @click="detailTicket = undefined">{{ t('support.detail.close') }}</el-button>
    </el-drawer>

    <el-dialog v-model="createOpen" data-testid="support-create-dialog" :title="t('support.page.createTicket')" width="560px">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-position="top">
        <el-form-item prop="subject" :label="t('support.columns.subject')"><el-input v-model="createForm.subject" data-testid="support-create-subject" /></el-form-item>
        <el-form-item prop="customer" :label="t('support.columns.customer')"><el-select v-model="createForm.customer" data-testid="support-create-customer"><el-option label="华东零售集团" value="east" /></el-select></el-form-item>
        <el-form-item prop="description" :label="t('support.detail.description')"><el-input v-model="createForm.description" data-testid="support-create-description" type="textarea" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="createOpen = false">{{ t('support.reply.cancel') }}</el-button><el-button type="primary" data-testid="support-create-submit" @click="submitCreate">{{ t('support.page.createTicket') }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="replyOpen" data-testid="support-reply-dialog" :title="t('support.reply.title')" width="600px">
      <el-form ref="replyFormRef" :model="replyForm" :rules="replyRules" label-position="top">
        <el-form-item prop="recipient" :label="t('support.reply.recipient')"><el-input v-model="replyForm.recipient" data-testid="support-reply-recipient" /></el-form-item>
        <el-form-item :label="t('support.reply.template')"><el-select v-model="replyForm.template" data-testid="support-reply-template" :placeholder="t('support.reply.templatePlaceholder')"><el-option label="问题处理中" value="working" /></el-select></el-form-item>
        <el-form-item prop="content" :label="t('support.reply.content')"><el-input v-model="replyForm.content" data-testid="support-reply-content" type="textarea" :placeholder="t('support.reply.contentPlaceholder')" /></el-form-item>
        <el-form-item><el-checkbox v-model="replyForm.internal">{{ t('support.reply.internal') }}</el-checkbox><el-checkbox v-model="replyForm.sendCopy">{{ t('support.reply.sendCopy') }}</el-checkbox></el-form-item>
      </el-form>
      <template #footer><el-button @click="replyOpen = false">{{ t('support.reply.cancel') }}</el-button><el-button type="primary" data-testid="support-reply-submit" @click="submitReply">{{ t('support.reply.send') }}</el-button></template>
    </el-dialog>

  </section>
</template>
