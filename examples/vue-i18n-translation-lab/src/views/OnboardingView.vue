<script setup lang="ts">
import type { FormInstance, FormRules } from 'element-plus'
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { submitOnboarding } from '../api/client'

const { t } = useI18n()
const formRef = ref<FormInstance>()
const step = ref(0)
const submitting = ref(false)
const termsOpen = ref(false)
const acceptedTerms = ref(false)
const resultId = ref<string>()

interface OnboardingForm {
  username: string
  password: string
  accountType: 'personal' | 'team' | 'enterprise' | ''
  teamName: string
  company: string
  fullName: string
  bio: string
  country: string
  timezone: string
  language: 'zh' | 'en'
  theme: 'light' | 'dark' | 'auto'
  notifications: string[]
  frequency: 'realtime' | 'hourly' | 'daily' | 'weekly'
  marketing: boolean
}

const form = reactive<OnboardingForm>({
  username: '',
  password: '',
  accountType: '',
  teamName: '',
  company: '',
  fullName: '',
  bio: '',
  country: '',
  timezone: '',
  language: 'zh',
  theme: 'light',
  notifications: ['email'],
  frequency: 'daily',
  marketing: false,
})

const rules = computed<FormRules<OnboardingForm>>(() => ({
  username: [
    { required: true, message: t('onboarding.validation.usernameRequired'), trigger: 'blur' },
    { min: 4, max: 20, message: t('onboarding.validation.usernameLength'), trigger: 'blur' },
    { pattern: /^[A-Za-z0-9]+$/u, message: t('onboarding.validation.usernamePattern'), trigger: 'blur' },
  ],
  password: [
    { required: true, message: t('onboarding.validation.passwordRequired'), trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value && !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/u.test(value)) {
          callback(new Error(t('onboarding.validation.passwordWeak')))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
  accountType: [{ required: true, message: t('onboarding.validation.accountTypeRequired'), trigger: 'change' }],
  teamName: [
    {
      validator: (_rule, _value, callback) => {
        if ((form.accountType === 'team' || form.accountType === 'enterprise') && !form.teamName.trim()) {
          callback(new Error(t('onboarding.validation.teamNameRequired')))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
  company: [
    {
      validator: (_rule, _value, callback) => {
        if (form.accountType === 'enterprise' && !form.company.trim()) {
          callback(new Error(t('onboarding.validation.companyRequired')))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
  fullName: [{ required: true, message: t('onboarding.validation.fullNameRequired'), trigger: 'blur' }],
  bio: [{ max: 80, message: t('onboarding.validation.bioLength'), trigger: 'blur' }],
}))

const accountTypeOptions = [
  { value: 'personal', key: 'onboarding.account.accountType.personal' },
  { value: 'team', key: 'onboarding.account.accountType.team' },
  { value: 'enterprise', key: 'onboarding.account.accountType.enterprise' },
] as const

const themeOptions = [
  { value: 'light', key: 'onboarding.preferences.theme.light' },
  { value: 'dark', key: 'onboarding.preferences.theme.dark' },
  { value: 'auto', key: 'onboarding.preferences.theme.auto' },
] as const

const frequencyOptions = [
  { value: 'realtime', key: 'onboarding.preferences.frequency.realtime' },
  { value: 'hourly', key: 'onboarding.preferences.frequency.hourly' },
  { value: 'daily', key: 'onboarding.preferences.frequency.daily' },
  { value: 'weekly', key: 'onboarding.preferences.frequency.weekly' },
] as const

const notificationOptions = [
  { value: 'email', key: 'onboarding.preferences.notifications.email' },
  { value: 'sms', key: 'onboarding.preferences.notifications.sms' },
  { value: 'inApp', key: 'onboarding.preferences.notifications.inApp' },
] as const

const countryOptions = ['CN', 'US', 'JP', 'DE', 'SG', 'AU']
const timezoneOptions = ['Asia/Shanghai', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'UTC']

const showTeamName = computed(() => form.accountType === 'team' || form.accountType === 'enterprise')
const showCompany = computed(() => form.accountType === 'enterprise')

const accountTypeLabel = computed(() => {
  const match = accountTypeOptions.find((option) => option.value === form.accountType)
  return match ? t(match.key) : '-'
})
const themeLabel = computed(() => t(`onboarding.preferences.theme.${form.theme}`))
const frequencyLabel = computed(() => t(`onboarding.preferences.frequency.${form.frequency}`))
const languageLabel = computed(() => t(`onboarding.preferences.language.${form.language}`))

async function validateStep(): Promise<boolean> {
  if (!formRef.value) return false
  const fieldsByStep = [
    ['username', 'password', 'accountType', 'teamName', 'company'],
    ['fullName', 'bio'],
    [],
    [],
  ] as Array<Array<keyof OnboardingForm>>
  const fields = fieldsByStep[step.value]
  if (!fields || fields.length === 0) return true
  try {
    await formRef.value.validateField(fields as never)
    return true
  } catch {
    return false
  }
}

async function next() {
  if (!(await validateStep())) return
  if (step.value < 3) step.value += 1
}

function prev() {
  if (step.value > 0) step.value -= 1
}

async function submit() {
  if (!acceptedTerms.value) {
    return
  }
  if (!(await validateStep())) return
  submitting.value = true
  try {
    const result = await submitOnboarding({
      username: form.username,
      accountType: form.accountType,
      teamName: form.teamName,
      company: form.company,
      fullName: form.fullName,
      country: form.country,
      timezone: form.timezone,
      language: form.language,
      theme: form.theme,
      frequency: form.frequency,
    })
    resultId.value = result.id
    step.value = 4
  } finally {
    submitting.value = false
  }
}

function resend() {
  resultId.value = undefined
  step.value = 3
}
</script>

<template>
  <section class="page" data-testid="onboarding-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('onboarding.title') }}</h1>
        <p>{{ t('onboarding.subtitle') }}</p>
      </div>
    </header>

    <el-card class="section-card">
      <el-steps v-if="step < 4" :active="step" align-center data-testid="onboarding-steps">
        <el-step :title="t('onboarding.steps.account')" />
        <el-step :title="t('onboarding.steps.profile')" />
        <el-step :title="t('onboarding.steps.preferences')" />
        <el-step :title="t('onboarding.steps.confirm')" />
      </el-steps>

      <el-form
        v-if="step < 4"
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        class="onboarding-form"
      >
        <div v-if="step === 0">
          <h3>{{ t('onboarding.account.heading') }}</h3>
          <el-form-item :label="t('onboarding.account.username.label')" prop="username">
            <el-input v-model="form.username" data-testid="onboarding-username" :placeholder="t('onboarding.account.username.placeholder')" />
          </el-form-item>
          <el-form-item :label="t('onboarding.account.password.label')" prop="password">
            <el-input v-model="form.password" data-testid="onboarding-password" type="password" show-password :placeholder="t('onboarding.account.password.placeholder')" />
          </el-form-item>
          <el-form-item :label="t('onboarding.account.accountType.label')" prop="accountType">
            <el-radio-group v-model="form.accountType" data-testid="onboarding-account-type">
              <el-radio v-for="option in accountTypeOptions" :key="option.value" :value="option.value">{{ t(option.key) }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="showTeamName" :label="t('onboarding.account.teamName.label')" prop="teamName">
            <el-input v-model="form.teamName" data-testid="onboarding-team-name" :placeholder="t('onboarding.account.teamName.placeholder')" />
          </el-form-item>
          <el-form-item v-if="showCompany" :label="t('onboarding.account.company.label')" prop="company">
            <el-input v-model="form.company" data-testid="onboarding-company" :placeholder="t('onboarding.account.company.placeholder')" />
          </el-form-item>
        </div>

        <div v-else-if="step === 1">
          <h3>{{ t('onboarding.profile.heading') }}</h3>
          <el-form-item :label="t('onboarding.profile.fullName.label')" prop="fullName">
            <el-input v-model="form.fullName" data-testid="onboarding-full-name" :placeholder="t('onboarding.profile.fullName.placeholder')" />
          </el-form-item>
          <el-form-item :label="t('onboarding.profile.avatar.label')">
            <div class="muted">{{ t('onboarding.profile.avatar.hint') }}</div>
          </el-form-item>
          <el-form-item :label="t('onboarding.profile.bio.label')" prop="bio">
            <el-input v-model="form.bio" data-testid="onboarding-bio" type="textarea" :rows="2" :placeholder="t('onboarding.profile.bio.placeholder')" />
          </el-form-item>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item :label="t('onboarding.profile.country.label')">
                <el-select v-model="form.country" data-testid="onboarding-country" :placeholder="t('onboarding.profile.country.placeholder')" style="width: 100%">
                  <el-option v-for="country in countryOptions" :key="country" :label="country" :value="country" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="t('onboarding.profile.timezone.label')">
                <el-select v-model="form.timezone" data-testid="onboarding-timezone" :placeholder="t('onboarding.profile.timezone.placeholder')" style="width: 100%">
                  <el-option v-for="zone in timezoneOptions" :key="zone" :label="zone" :value="zone" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
        </div>

        <div v-else-if="step === 2">
          <h3>{{ t('onboarding.preferences.heading') }}</h3>
          <el-form-item :label="t('onboarding.preferences.language.label')">
            <el-radio-group v-model="form.language" data-testid="onboarding-language">
              <el-radio value="zh">{{ t('onboarding.preferences.language.zh') }}</el-radio>
              <el-radio value="en">{{ t('onboarding.preferences.language.en') }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item :label="t('onboarding.preferences.theme.label')">
            <el-radio-group v-model="form.theme" data-testid="onboarding-theme">
              <el-radio v-for="option in themeOptions" :key="option.value" :value="option.value">{{ t(option.key) }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item :label="t('onboarding.preferences.notifications.label')">
            <el-checkbox-group v-model="form.notifications" data-testid="onboarding-notifications">
              <el-checkbox v-for="option in notificationOptions" :key="option.value" :value="option.value">{{ t(option.key) }}</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item :label="t('onboarding.preferences.frequency.label')">
            <el-radio-group v-model="form.frequency" data-testid="onboarding-frequency">
              <el-radio v-for="option in frequencyOptions" :key="option.value" :value="option.value">{{ t(option.key) }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item :label="t('onboarding.preferences.marketing.label')">
            <el-switch v-model="form.marketing" data-testid="onboarding-marketing"
              :active-text="t('onboarding.preferences.marketing.agree')" :inactive-text="t('onboarding.preferences.marketing.disagree')" />
          </el-form-item>
        </div>

        <div v-else-if="step === 3">
          <h3>{{ t('onboarding.confirm.heading') }}</h3>
          <p>{{ t('onboarding.confirm.summaryTitle') }}</p>
          <dl class="summary-grid">
            <dt>{{ t('onboarding.confirm.summary.username') }}</dt><dd>{{ form.username || '-' }}</dd>
            <dt>{{ t('onboarding.confirm.summary.accountType') }}</dt><dd>{{ accountTypeLabel }}</dd>
            <dt v-if="showTeamName">{{ t('onboarding.confirm.summary.teamName') }}</dt>
            <dd v-if="showTeamName">{{ form.teamName || '-' }}</dd>
            <dt v-if="showCompany">{{ t('onboarding.confirm.summary.company') }}</dt>
            <dd v-if="showCompany">{{ form.company || '-' }}</dd>
            <dt>{{ t('onboarding.confirm.summary.fullName') }}</dt><dd>{{ form.fullName || '-' }}</dd>
            <dt>{{ t('onboarding.confirm.summary.country') }}</dt><dd>{{ form.country || '-' }}</dd>
            <dt>{{ t('onboarding.confirm.summary.timezone') }}</dt><dd>{{ form.timezone || '-' }}</dd>
            <dt>{{ t('onboarding.confirm.summary.language') }}</dt><dd>{{ languageLabel }}</dd>
            <dt>{{ t('onboarding.confirm.summary.theme') }}</dt><dd>{{ themeLabel }}</dd>
            <dt>{{ t('onboarding.confirm.summary.frequency') }}</dt><dd>{{ frequencyLabel }}</dd>
          </dl>
          <el-checkbox v-model="acceptedTerms" data-testid="onboarding-terms">
            {{ t('onboarding.confirm.terms.label') }}
          </el-checkbox>
          <div class="duplicate-row">
            <el-button link data-testid="onboarding-open-terms" @click="termsOpen = true">{{ t('onboarding.confirm.terms.openTerms') }}</el-button>
            <el-button link data-testid="onboarding-open-privacy" @click="termsOpen = true">{{ t('onboarding.confirm.terms.openPrivacy') }}</el-button>
          </div>
        </div>
      </el-form>

      <div v-if="step < 4" class="step-actions">
        <el-button v-if="step > 0" data-testid="onboarding-prev" @click="prev">{{ t('onboarding.confirm.prev') }}</el-button>
        <div class="form-actions">
          <el-button v-if="step < 3" type="primary" data-testid="onboarding-next" @click="next">{{ t('onboarding.account.next') }}</el-button>
          <el-button v-else type="primary" :loading="submitting" :disabled="!acceptedTerms" data-testid="onboarding-submit" @click="submit">
            {{ t('onboarding.confirm.submit') }}
          </el-button>
        </div>
      </div>

      <div v-if="step === 4" class="result-panel" data-testid="onboarding-success">
        <el-alert type="success" show-icon :closable="false" :title="t('onboarding.success.title')"
          :description="t('onboarding.success.message', { id: resultId })" />
        <div class="dialog-actions">
          <el-button data-testid="onboarding-resend" @click="resend">{{ t('onboarding.success.resend') }}</el-button>
          <el-button type="primary" data-testid="onboarding-done" @click="resend">{{ t('onboarding.success.done') }}</el-button>
        </div>
      </div>
    </el-card>

    <el-dialog v-model="termsOpen" data-testid="onboarding-terms-dialog" :title="t('onboarding.termsDialog.title')" width="520">
      <p>{{ t('onboarding.termsDialog.body') }}</p>
      <template #footer>
        <el-button type="primary" data-testid="onboarding-terms-close" @click="termsOpen = false">{{ t('onboarding.termsDialog.close') }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>
