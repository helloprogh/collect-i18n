<script setup lang="ts">
import type { FormInstance, FormRules } from 'element-plus'
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { createJob, getApiError, type CreateJobInput } from '../api/client'

const { t } = useI18n()
const formRef = ref<FormInstance>()
const loading = ref(false)
const confirmVisible = ref(false)
const result = ref<{ type: 'success' | 'error'; title: string; detail?: string }>()

const form = reactive<CreateJobInput>({
  name: '',
  email: '',
  endpoint: '',
  retries: 2,
  environment: '',
  description: '',
})

const rules = computed<FormRules<CreateJobInput>>(() => ({
  name: [
    { required: true, message: t('requestLab.validation.nameRequired'), trigger: 'blur' },
    { min: 4, max: 24, message: t('requestLab.validation.nameLength'), trigger: 'blur' },
    { pattern: /^[A-Za-z][A-Za-z0-9-]*$/u, message: t('requestLab.validation.namePattern'), trigger: 'blur' },
  ],
  email: [
    { required: true, message: t('requestLab.validation.emailRequired'), trigger: 'blur' },
    { type: 'email', message: t('requestLab.validation.emailInvalid'), trigger: 'blur' },
  ],
  endpoint: [
    { required: true, message: t('requestLab.validation.endpointRequired'), trigger: 'blur' },
    { pattern: /^https:\/\/[\w.-]+(?:\/[^\s]*)?$/u, message: t('requestLab.validation.endpointInvalid'), trigger: 'blur' },
  ],
  environment: [{ required: true, message: t('requestLab.validation.environmentRequired'), trigger: 'change' }],
  description: [{ max: 120, message: t('requestLab.validation.descriptionLength'), trigger: 'blur' }],
}))

async function openConfirmation() {
  result.value = undefined
  if (!await formRef.value?.validate().catch(() => false)) return
  confirmVisible.value = true
}

async function confirmSubmit() {
  confirmVisible.value = false
  loading.value = true
  try {
    const response = await createJob({ ...form })
    result.value = {
      type: 'success',
      title: t('requestLab.feedback.success', { name: form.name, id: response.id }),
    }
  } catch (error) {
    const apiError = getApiError(error)
    const quotaDetail = apiError.code === 'QUOTA_EXCEEDED' ? t('requestLab.feedback.quotaExceeded') : ''
    const requestDetail = apiError.requestId
      ? t('requestLab.feedback.requestId', { requestId: apiError.requestId })
      : ''
    result.value = {
      type: 'error',
      title: t('requestLab.feedback.requestFailed'),
      detail: [quotaDetail, requestDetail].filter(Boolean).join(' · '),
    }
  } finally {
    loading.value = false
  }
}

function reset() {
  formRef.value?.resetFields()
  result.value = undefined
}
</script>

<template>
  <section class="page" data-testid="request-lab-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('requestLab.title') }}</h1>
        <p>{{ t('requestLab.subtitle') }}</p>
      </div>
      <el-tag type="success">{{ t('requestLab.status.ready') }}</el-tag>
    </header>

    <el-card class="form-card">
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" status-icon>
        <el-row :gutter="18">
          <el-col :span="12">
            <el-form-item :label="t('requestLab.form.name')" prop="name">
              <el-input v-model="form.name" name="name" data-testid="job-name" :placeholder="t('requestLab.form.namePlaceholder')" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="t('requestLab.form.email')" prop="email">
              <el-input v-model="form.email" name="email" type="email" data-testid="job-email" :placeholder="t('requestLab.form.emailPlaceholder')" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item :label="t('requestLab.form.endpoint')" prop="endpoint">
          <el-input v-model="form.endpoint" name="endpoint" type="url" data-testid="job-endpoint" :placeholder="t('requestLab.form.endpointPlaceholder')" />
        </el-form-item>
        <el-row :gutter="18">
          <el-col :span="8">
            <el-form-item :label="t('requestLab.form.retries')" prop="retries">
              <el-input-number v-model="form.retries" data-testid="job-retries" :min="0" :max="5" />
            </el-form-item>
          </el-col>
          <el-col :span="16">
            <el-form-item :label="t('requestLab.form.environment')" prop="environment">
              <el-select v-model="form.environment" data-testid="job-environment" :placeholder="t('requestLab.form.environmentPlaceholder')" style="width: 100%">
                <el-option :label="t('requestLab.environment.development')" value="development" />
                <el-option :label="t('requestLab.environment.staging')" value="staging" />
                <el-option :label="t('requestLab.environment.production')" value="production" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item :label="t('requestLab.form.description')" prop="description">
          <el-input v-model="form.description" name="description" data-testid="job-description" type="textarea" :rows="3" :maxlength="200" show-word-limit :placeholder="t('requestLab.form.descriptionPlaceholder')" />
        </el-form-item>
        <div class="form-actions">
          <el-button data-testid="reset-form" @click="reset">{{ t('requestLab.form.reset') }}</el-button>
          <el-button type="primary" data-testid="submit-form" :loading="loading" @click="openConfirmation">
            {{ t('requestLab.form.submit') }}
          </el-button>
        </div>
      </el-form>
    </el-card>

    <el-alert
      v-if="result"
      class="result-panel"
      data-testid="request-result"
      :type="result.type"
      :title="result.title"
      :description="result.detail"
      show-icon
      :closable="false"
    />

    <el-dialog v-model="confirmVisible" data-testid="confirm-dialog" :title="t('requestLab.confirmation.title')" width="520px">
      <p>{{ t('requestLab.confirmation.message') }}</p>
      <template #footer>
        <el-button data-testid="cancel-confirm" @click="confirmVisible = false">
          {{ t('requestLab.confirmation.cancel') }}
        </el-button>
        <el-button type="primary" data-testid="confirm-create" :loading="loading" @click="confirmSubmit">
          {{ t('requestLab.confirmation.confirm') }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>
