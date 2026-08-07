<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import {
  sendLabRequest,
  type BackoffStrategy,
  type LabResult,
  type LabScenario,
  type PayloadSize,
} from '../api/client'

const { t } = useI18n()

const scenarios: LabScenario[] = ['success', 'error', 'partial', 'retry', 'empty', 'slow']
const scenario = ref<LabScenario>('success')
const payloadSize = ref<PayloadSize>('small')
const delay = ref<number | ''>(0)
const statusCode = ref<number | ''>(200)
const injectError = ref(false)
const maxRetries = ref(2)
const retryDelay = ref(400)
const backoff = ref<BackoffStrategy>('fixed')
const onRetryNotify = ref(true)

const loading = ref(false)
const result = ref<LabResult | null>(null)
const retryingInfo = ref<{ attempt: number; remaining: number } | null>(null)

interface LogEntry { time: string; scenario: LabScenario; status: number; duration: number; attempt: number }
const log = ref<LogEntry[]>([])

const scenarioDesc = computed(() => t(`requestLab.scenarios.${scenario.value}.desc`))

const stateTitle = computed(() => {
  if (loading.value && retryingInfo.value) return t('requestLab.states.retrying')
  if (loading.value) return t('requestLab.states.loading')
  if (!result.value) return ''
  const map: Record<LabResult['state'], string> = {
    loading: t('requestLab.states.loading'),
    success: t('requestLab.states.success'),
    error: t('requestLab.states.error'),
    partial: t('requestLab.states.partial'),
    empty: t('requestLab.states.empty'),
    retrying: t('requestLab.states.retrying'),
    retryExhausted: t('requestLab.states.retryExhausted'),
  }
  return map[result.value.state]
})

const stateDetail = computed(() => {
  if (loading.value && retryingInfo.value) {
    return t('requestLab.states.retryingHint', { attempt: retryingInfo.value.attempt, remaining: retryingInfo.value.remaining })
  }
  if (loading.value) return t('requestLab.states.loadingHint')
  if (!result.value) return ''
  const body = result.value.responseBody as { count?: number; code?: string; summary?: { success: number; failed: number } }
  switch (result.value.state) {
    case 'success': return t('requestLab.states.successDetail', { count: body?.count ?? 0 })
    case 'error': return t('requestLab.states.errorDetail', { code: body?.code ?? result.value.status })
    case 'partial': return t('requestLab.states.partialDetail', { success: body?.summary?.success ?? 0, failed: body?.summary?.failed ?? 0 })
    case 'empty': return t('requestLab.states.emptyHint')
    case 'retryExhausted': return t('requestLab.states.retryExhaustedDetail', { max: maxRetries.value })
    default: return ''
  }
})

const stateAlertType = computed<'info' | 'success' | 'warning' | 'error'>(() => {
  if (loading.value) return 'info'
  if (!result.value) return 'info'
  switch (result.value.state) {
    case 'success': return 'success'
    case 'error': return 'error'
    case 'partial': return 'warning'
    case 'empty': return 'info'
    case 'retryExhausted': return 'error'
    default: return 'info'
  }
})

const requestParams = computed(() => ({
  scenario: scenario.value,
  payloadSize: payloadSize.value,
  delay: delay.value || 0,
  statusCode: injectError.value
    ? 500
    : (statusCode.value && statusCode.value !== 200 ? statusCode.value : undefined),
}))

async function send() {
  loading.value = true
  result.value = null
  retryingInfo.value = null
  try {
    const response = await sendLabRequest({
      scenario: scenario.value,
      payloadSize: payloadSize.value,
      delay: delay.value || 0,
      statusCode: injectError.value
        ? 500
        : (statusCode.value && statusCode.value !== 200 ? statusCode.value : undefined),
      maxRetries: maxRetries.value,
      retryDelay: retryDelay.value,
      backoff: backoff.value,
      onRetry: (attempt, remaining) => {
        if (onRetryNotify.value) {
          ElMessage.info(t('requestLab.states.retryingHint', { attempt, remaining }))
        }
        retryingInfo.value = { attempt, remaining }
      },
    })
    result.value = response
    log.value.unshift({
      time: new Date().toLocaleTimeString(),
      scenario: response.scenario,
      status: response.status,
      duration: response.duration,
      attempt: response.attempt,
    })
  } catch {
    ElMessage.error(t('requestLab.states.timeout'))
  } finally {
    loading.value = false
    retryingInfo.value = null
  }
}

function retry() {
  send()
}

function clearResult() {
  result.value = null
  ElMessage.info(t('requestLab.feedback.cleared'))
}

async function copyResponse() {
  if (!result.value) return
  try {
    await navigator.clipboard.writeText(JSON.stringify(result.value.responseBody, null, 2))
    ElMessage.success(t('requestLab.feedback.copied'))
  } catch {
    // clipboard unavailable; ignore silently
  }
}

function clearLog() {
  log.value = []
}
</script>

<template>
  <section class="page" data-testid="request-lab-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('requestLab.title') }}</h1>
        <p>{{ t('requestLab.subtitle') }}</p>
      </div>
    </header>

    <el-card class="section-card">
      <el-form label-position="top">
        <el-form-item :label="t('requestLab.scenarioLabel')">
          <el-select v-model="scenario" data-testid="request-lab-scenario" :placeholder="t('requestLab.scenarioPlaceholder')" style="width: 280px">
            <el-option v-for="item in scenarios" :key="item" :label="t(`requestLab.scenarios.${item}.label`)" :value="item" />
          </el-select>
          <span class="muted" style="margin-left: 12px">{{ scenarioDesc }}</span>
        </el-form-item>

        <el-row :gutter="16">
          <el-col :span="6">
            <el-form-item :label="t('requestLab.controls.payloadSizeLabel')">
              <el-select v-model="payloadSize" data-testid="request-lab-payload-size" style="width: 100%">
                <el-option :label="t('requestLab.controls.payloadOptions.small')" value="small" />
                <el-option :label="t('requestLab.controls.payloadOptions.medium')" value="medium" />
                <el-option :label="t('requestLab.controls.payloadOptions.large')" value="large" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item :label="t('requestLab.controls.delayLabel')">
              <el-input-number v-model="delay" data-testid="request-lab-delay" :min="0" :step="100" style="width: 100%"
                :placeholder="t('requestLab.controls.delayPlaceholder')" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item :label="t('requestLab.controls.statusCodeLabel')">
              <el-input-number v-model="statusCode" data-testid="request-lab-status-code" :min="100" :max="599" :step="1" style="width: 100%"
                :placeholder="t('requestLab.controls.statusCodePlaceholder')" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item :label="t('requestLab.controls.injectErrorLabel')">
              <el-switch v-model="injectError" data-testid="request-lab-inject-error" inline-prompt />
            </el-form-item>
          </el-col>
        </el-row>

        <el-card class="section-card" shadow="never">
          <h4>{{ t('requestLab.retry.title') }}</h4>
          <el-row :gutter="16">
            <el-col :span="6">
              <el-form-item :label="t('requestLab.retry.maxLabel')">
                <el-input-number v-model="maxRetries" data-testid="request-lab-max-retries" :min="0" :max="5" style="width: 100%"
                  :placeholder="t('requestLab.retry.maxPlaceholder')" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item :label="t('requestLab.retry.delayLabel')">
                <el-input-number v-model="retryDelay" data-testid="request-lab-retry-delay" :min="0" :step="100" style="width: 100%"
                  :placeholder="t('requestLab.retry.delayPlaceholder')" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item :label="t('requestLab.retry.backoffLabel')">
                <el-select v-model="backoff" data-testid="request-lab-backoff" style="width: 100%">
                  <el-option :label="t('requestLab.retry.backoff.fixed')" value="fixed" />
                  <el-option :label="t('requestLab.retry.backoff.linear')" value="linear" />
                  <el-option :label="t('requestLab.retry.backoff.exponential')" value="exponential" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item :label="t('requestLab.retry.onRetry')">
                <el-switch v-model="onRetryNotify" data-testid="request-lab-on-retry" inline-prompt />
              </el-form-item>
            </el-col>
          </el-row>
        </el-card>

        <div class="dialog-actions">
          <el-button data-testid="request-lab-clear" @click="clearResult">{{ t('requestLab.clearBtn') }}</el-button>
          <el-button data-testid="request-lab-retry" @click="retry">{{ t('requestLab.retryBtn') }}</el-button>
          <el-button type="primary" data-testid="request-lab-send" :loading="loading" @click="send">{{ t('requestLab.sendBtn') }}</el-button>
        </div>
      </el-form>
    </el-card>

    <el-card class="section-card">
      <h3>{{ t('requestLab.responseTitle') }}</h3>
      <el-alert v-if="stateTitle" data-testid="request-lab-state" :type="stateAlertType" show-icon :closable="false" :title="stateTitle" :description="stateDetail" class="result-panel" />
      <div v-if="result" class="response-grid" data-testid="request-lab-result">
        <dt>{{ t('requestLab.response.status') }}</dt><dd>{{ result.status }}</dd>
        <dt>{{ t('requestLab.response.duration') }}</dt><dd>{{ result.duration }} ms</dd>
        <dt>{{ t('requestLab.response.requestId') }}</dt><dd>{{ result.requestId ?? '-' }}</dd>
        <dt>{{ t('requestLab.response.attempt') }}</dt><dd>{{ result.attempt }}</dd>
        <dt>{{ t('requestLab.response.method') }}</dt><dd>{{ result.method }}</dd>
        <dt>{{ t('requestLab.response.url') }}</dt><dd>{{ result.url }}</dd>
        <dt>{{ t('requestLab.response.requestBody') }}</dt><dd><pre>{{ JSON.stringify(requestParams, null, 2) }}</pre></dd>
        <dt>{{ t('requestLab.response.responseHeaders') }}</dt><dd><pre>{{ JSON.stringify({ 'content-type': 'application/json', 'x-request-id': result.requestId }, null, 2) }}</pre></dd>
        <dt>{{ t('requestLab.response.responseBody') }}</dt><dd><pre>{{ JSON.stringify(result.responseBody, null, 2) }}</pre></dd>
      </div>
      <div v-else-if="!loading" class="muted">{{ t('requestLab.response.empty') }}</div>
      <div v-if="result" class="dialog-actions">
        <el-button data-testid="request-lab-copy" @click="copyResponse">{{ t('requestLab.response.copy') }}</el-button>
      </div>
    </el-card>

    <el-card class="section-card">
      <div class="toolbar">
        <h3>{{ t('requestLab.log.title') }}</h3>
        <el-button data-testid="request-lab-clear-log" @click="clearLog">{{ t('requestLab.log.clear') }}</el-button>
      </div>
      <el-table :data="log" data-testid="request-lab-log-table" size="small">
        <el-table-column prop="time" :label="t('requestLab.log.columns.time')" width="140" />
        <el-table-column :label="t('requestLab.log.columns.scenario')">
          <template #default="scope">{{ t(`requestLab.scenarios.${scope.row.scenario}.label`) }}</template>
        </el-table-column>
        <el-table-column prop="status" :label="t('requestLab.log.columns.status')" width="100" />
        <el-table-column :label="t('requestLab.log.columns.duration')" width="120">
          <template #default="scope">{{ scope.row.duration }} ms</template>
        </el-table-column>
        <el-table-column prop="attempt" :label="t('requestLab.log.columns.attempt')" width="100" />
        <template #empty>
          <span>{{ t('requestLab.log.empty') }}</span>
        </template>
      </el-table>
    </el-card>

    <el-card class="section-card">
      <div class="scenario-grid">
        <el-tag v-for="item in ['ok200','badRequest400','notFound404','validation422','serverError500']" :key="item" :type="item === 'ok200' ? 'success' : 'danger'">
          {{ t(`requestLab.statusCodes.${item}`) }}
        </el-tag>
      </div>
    </el-card>
  </section>
</template>
