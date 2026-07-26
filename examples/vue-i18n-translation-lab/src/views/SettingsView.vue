<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const activeTab = ref<'profile' | 'security' | 'appearance' | 'advanced'>('profile')
const activeCollapse = ref<string[]>(['sync', 'experimental', 'components'])

interface SettingsForm {
  name: string
  email: string
  phone: string
  country: string
  province: string
  city: string
  street: string
  currentPassword: string
  newPassword: string
  confirmPassword: string
  theme: 'light' | 'dark' | 'auto'
  language: 'zh' | 'en' | 'system'
  frequency: 'realtime' | 'hourly' | 'daily'
  retryMax: number
  retryDelay: number
  conflict: 'skip' | 'overwrite' | 'merge'
  betaFeatures: boolean
  analytics: boolean
  aiAssistant: boolean
  mfaEnabled: boolean
}

const form = reactive<SettingsForm>({
  name: '',
  email: '',
  phone: '',
  country: '',
  province: '',
  city: '',
  street: '',
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
  theme: 'light',
  language: 'system',
  frequency: 'daily',
  retryMax: 3,
  retryDelay: 500,
  conflict: 'skip',
  betaFeatures: false,
  analytics: true,
  aiAssistant: false,
  mfaEnabled: false,
})

const buttonType = ref<'primary' | 'success' | 'warning' | 'danger' | 'info' | ''>('')
const buttonLoading = ref(false)

const passwordStrength = computed<{ level: 'weak' | 'medium' | 'strong'; key: string }>(() => {
  const password = form.newPassword
  if (!password) return { level: 'weak', key: 'settings.security.password.strength.weak' }
  let score = 0
  if (password.length >= 8) score += 1
  if (/[A-Za-z]/u.test(password)) score += 1
  if (/\d/u.test(password)) score += 1
  if (/[^A-Za-z0-9]/u.test(password)) score += 1
  const level = score >= 4 ? 'strong' : score >= 3 ? 'medium' : 'weak'
  return { level, key: `settings.security.password.strength.${level}` }
})

const themeOptions = [
  { value: 'light', key: 'settings.appearance.theme.light' },
  { value: 'dark', key: 'settings.appearance.theme.dark' },
  { value: 'auto', key: 'settings.appearance.theme.auto' },
] as const
const languageOptions = [
  { value: 'zh', key: 'settings.appearance.language.zh' },
  { value: 'en', key: 'settings.appearance.language.en' },
  { value: 'system', key: 'settings.appearance.language.followSystem' },
] as const

function updatePassword() {
  if (form.newPassword !== form.confirmPassword) {
    ElMessage.error(t('settings.validation.passwordMismatch'))
    return
  }
  if (form.newPassword && !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/u.test(form.newPassword)) {
    ElMessage.error(t('settings.validation.passwordWeak'))
    return
  }
  ElMessage.success(t('settings.feedback.passwordUpdated'))
  form.currentPassword = ''
  form.newPassword = ''
  form.confirmPassword = ''
}

function toggleMfa(value: boolean) {
  form.mfaEnabled = value
  ElMessage.success(value ? t('settings.feedback.mfaEnabled') : t('settings.feedback.mfaDisabled'))
}

function save() {
  ElMessage.success(t('settings.feedback.saved'))
}

function reset() {
  Object.assign(form, {
    name: '', email: '', phone: '', country: '', province: '', city: '', street: '',
    currentPassword: '', newPassword: '', confirmPassword: '',
    theme: 'light', language: 'system', frequency: 'daily',
    retryMax: 3, retryDelay: 500, conflict: 'skip',
    betaFeatures: false, analytics: true, aiAssistant: false, mfaEnabled: false,
  } as SettingsForm)
}
</script>

<template>
  <section class="page" data-testid="settings-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('settings.title') }}</h1>
        <p>{{ t('settings.subtitle') }}</p>
      </div>
      <div class="toolbar">
        <el-button data-testid="settings-reset" @click="reset">{{ t('settings.reset') }}</el-button>
        <el-button type="primary" data-testid="settings-save" @click="save">{{ t('settings.save') }}</el-button>
      </div>
    </header>

    <el-tabs v-model="activeTab" data-testid="settings-tabs" lazy>
      <el-tab-pane :label="t('settings.tabs.profile')" name="profile">
        <el-card class="section-card">
          <h3>{{ t('settings.profile.basic.title') }}</h3>
          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item :label="t('settings.profile.basic.name.label')">
                <el-input v-model="form.name" data-testid="settings-name" :placeholder="t('settings.profile.basic.name.placeholder')" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item :label="t('settings.profile.basic.email.label')">
                <el-input v-model="form.email" data-testid="settings-email" :placeholder="t('settings.profile.basic.email.placeholder')" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item :label="t('settings.profile.basic.phone.label')">
                <el-input v-model="form.phone" data-testid="settings-phone" :placeholder="t('settings.profile.basic.phone.placeholder')" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-card>
        <el-card class="section-card">
          <h3>{{ t('settings.profile.address.title') }}</h3>
          <el-row :gutter="16">
            <el-col :span="6">
              <el-form-item :label="t('settings.profile.address.country.label')">
                <el-input v-model="form.country" data-testid="settings-country" :placeholder="t('settings.profile.address.country.placeholder')" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item :label="t('settings.profile.address.province.label')">
                <el-input v-model="form.province" data-testid="settings-province" :placeholder="t('settings.profile.address.province.placeholder')" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item :label="t('settings.profile.address.city.label')">
                <el-input v-model="form.city" data-testid="settings-city" :placeholder="t('settings.profile.address.city.placeholder')" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item :label="t('settings.profile.address.street.label')">
                <el-input v-model="form.street" data-testid="settings-street" :placeholder="t('settings.profile.address.street.placeholder')" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-card>
      </el-tab-pane>

      <el-tab-pane :label="t('settings.tabs.security')" name="security">
        <el-collapse v-model="activeCollapse" data-testid="settings-security-collapse">
          <el-collapse-item name="password" :title="t('settings.security.password.title')">
            <el-row :gutter="16">
              <el-col :span="8">
                <el-form-item :label="t('settings.security.password.current.label')">
                  <el-input v-model="form.currentPassword" data-testid="settings-current-password" type="password" show-password :placeholder="t('settings.security.password.current.placeholder')" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item :label="t('settings.security.password.new.label')">
                  <el-input v-model="form.newPassword" data-testid="settings-new-password" type="password" show-password :placeholder="t('settings.security.password.new.placeholder')" />
                  <el-tag size="small" :type="passwordStrength.level === 'strong' ? 'success' : passwordStrength.level === 'medium' ? 'warning' : 'danger'">{{ t(passwordStrength.key) }}</el-tag>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item :label="t('settings.security.password.confirm.label')">
                  <el-input v-model="form.confirmPassword" data-testid="settings-confirm-password" type="password" show-password :placeholder="t('settings.security.password.confirm.placeholder')" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-button type="primary" data-testid="settings-update-password" @click="updatePassword">{{ t('settings.security.password.update') }}</el-button>
          </el-collapse-item>

          <el-collapse-item name="mfa" :title="t('settings.security.mfa.title')">
            <div class="status-row">
              <el-switch :model-value="form.mfaEnabled" data-testid="settings-mfa-toggle"
                :active-text="t('settings.security.mfa.enable')" :inactive-text="t('settings.security.mfa.disable')"
                @change="toggleMfa" />
              <span class="muted">{{ t('settings.security.mfa.status', { status: form.mfaEnabled ? t('settings.security.mfa.enable') : t('settings.security.mfa.disable') }) }}</span>
            </div>
            <el-checkbox-group v-if="form.mfaEnabled" data-testid="settings-mfa-methods">
              <el-checkbox value="authenticator">{{ t('settings.security.mfa.methods.authenticator') }}</el-checkbox>
              <el-checkbox value="sms">{{ t('settings.security.mfa.methods.sms') }}</el-checkbox>
              <el-checkbox value="email">{{ t('settings.security.mfa.methods.email') }}</el-checkbox>
            </el-checkbox-group>
          </el-collapse-item>

          <el-collapse-item name="sessions" :title="t('settings.security.sessions.title')">
            <p class="muted">{{ t('settings.security.sessions.empty') }}</p>
            <el-button data-testid="settings-revoke-session">{{ t('settings.security.sessions.revoke') }}</el-button>
          </el-collapse-item>
        </el-collapse>
      </el-tab-pane>

      <el-tab-pane :label="t('settings.tabs.appearance')" name="appearance">
        <el-card class="section-card">
          <h3>{{ t('settings.appearance.theme.title') }}</h3>
          <el-radio-group v-model="form.theme" data-testid="settings-theme">
            <el-radio v-for="option in themeOptions" :key="option.value" :value="option.value">{{ t(option.key) }}</el-radio>
          </el-radio-group>
        </el-card>
        <el-card class="section-card">
          <h3>{{ t('settings.appearance.language.title') }}</h3>
          <el-radio-group v-model="form.language" data-testid="settings-language">
            <el-radio v-for="option in languageOptions" :key="option.value" :value="option.value">{{ t(option.key) }}</el-radio>
          </el-radio-group>
        </el-card>
        <el-card class="section-card">
          <h3>{{ t('settings.appearance.preview.title') }}</h3>
          <p>{{ t('settings.appearance.preview.text') }}</p>
          <el-button data-testid="settings-preview-button">{{ t('settings.appearance.preview.button') }}</el-button>
        </el-card>
      </el-tab-pane>

      <el-tab-pane :label="t('settings.tabs.advanced')" name="advanced">
        <el-collapse v-model="activeCollapse" data-testid="settings-advanced-collapse">
          <el-collapse-item name="sync" :title="t('settings.advanced.sync.title')">
            <el-form-item :label="t('settings.advanced.sync.frequency.label')">
              <el-radio-group v-model="form.frequency" data-testid="settings-frequency">
                <el-radio value="realtime">{{ t('settings.advanced.sync.frequency.realtime') }}</el-radio>
                <el-radio value="hourly">{{ t('settings.advanced.sync.frequency.hourly') }}</el-radio>
                <el-radio value="daily">{{ t('settings.advanced.sync.frequency.daily') }}</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item :label="t('settings.advanced.sync.retry.max')">
                  <el-input-number v-model="form.retryMax" data-testid="settings-retry-max" :min="0" :max="10" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item :label="t('settings.advanced.sync.retry.delay')">
                  <el-input-number v-model="form.retryDelay" data-testid="settings-retry-delay" :min="0" :step="100" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item :label="t('settings.advanced.sync.conflict.label')">
              <el-radio-group v-model="form.conflict" data-testid="settings-conflict">
                <el-radio value="skip">{{ t('settings.advanced.sync.conflict.skip') }}</el-radio>
                <el-radio value="overwrite">{{ t('settings.advanced.sync.conflict.overwrite') }}</el-radio>
                <el-radio value="merge">{{ t('settings.advanced.sync.conflict.merge') }}</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-collapse-item>

          <el-collapse-item name="experimental" :title="t('settings.advanced.experimental.title')">
            <el-alert type="warning" show-icon :closable="false" :title="t('settings.advanced.experimental.warning')" class="result-panel" />
            <div class="status-row">
              <el-switch v-model="form.betaFeatures" data-testid="settings-beta" :active-text="t('settings.advanced.experimental.betaFeatures')" inline-prompt />
              <el-switch v-model="form.analytics" data-testid="settings-analytics" :active-text="t('settings.advanced.experimental.analytics')" inline-prompt />
              <el-switch v-model="form.aiAssistant" data-testid="settings-ai" :active-text="t('settings.advanced.experimental.aiAssistant')" inline-prompt />
            </div>
          </el-collapse-item>

          <el-collapse-item name="components" :title="t('settings.advanced.components.title')">
            <p class="muted">{{ t('settings.advanced.components.desc') }}</p>
            <div class="toolbar">
              <el-select v-model="buttonType" data-testid="settings-button-type" :placeholder="t('settings.advanced.components.button.type')" style="width: 160px" clearable>
                <el-option label="primary" value="primary" />
                <el-option label="success" value="success" />
                <el-option label="warning" value="warning" />
                <el-option label="danger" value="danger" />
              </el-select>
              <el-switch v-model="buttonLoading" data-testid="settings-button-loading" :active-text="t('settings.advanced.components.button.loading')" inline-prompt />
              <el-button :type="buttonType || undefined" :loading="buttonLoading" data-testid="settings-button-demo">{{ t('settings.advanced.components.button.text') }}</el-button>
            </div>
            <h4>{{ t('settings.advanced.components.slots.title') }}</h4>
            <el-card data-testid="settings-slots-card" class="section-card">
              <template #header>{{ t('settings.advanced.components.slots.header') }}</template>
              {{ t('settings.advanced.components.slots.default') }}
              <template #footer>{{ t('settings.advanced.components.slots.footer') }}</template>
            </el-card>
          </el-collapse-item>
        </el-collapse>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>
