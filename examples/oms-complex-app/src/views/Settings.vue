<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { switchLocale } from '@/i18n'

const { t, locale } = useI18n()

const activeTab = ref('basic')

const profile = reactive({
  nickname: '',
  realName: '',
  email: '',
  phone: '',
  gender: 'male',
  bio: '',
})

const profileRules = {
  nickname: [{ required: true, message: t('settings.validation.nickname.required'), trigger: 'blur' }],
  realName: [{ required: true, message: t('settings.validation.realName.required'), trigger: 'blur' }],
  email: [
    { required: true, message: t('settings.validation.email.required'), trigger: 'blur' },
    { type: 'email', message: t('settings.validation.email.format'), trigger: 'blur' },
  ],
  phone: [
    { required: true, message: t('settings.validation.phone.required'), trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: t('settings.validation.phone.format'), trigger: 'blur' },
  ],
  bio: [{ max: 200, message: t('settings.validation.bio.max'), trigger: 'blur' }],
}

const password = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })

const passwordRules = {
  oldPassword: [{ required: true, message: t('settings.validation.password.required'), trigger: 'blur' }],
  newPassword: [
    { required: true, message: t('settings.validation.password.required'), trigger: 'blur' },
    { min: 8, message: t('settings.validation.password.min'), trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: t('settings.validation.confirmPassword.required'), trigger: 'blur' },
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
        if (value !== password.newPassword) callback(new Error(t('settings.validation.confirmPassword.match')))
        else callback()
      },
      trigger: 'blur',
    },
  ],
}

const preference = reactive({
  language: 'zh-CN',
  theme: 'light',
  timezone: 'Asia/Shanghai',
  weekStart: 'monday',
  density: 'default',
  emailNotify: true,
  smsNotify: false,
  appNotify: true,
})

const profileRef = ref()
const passwordRef = ref()

async function saveProfile(): Promise<void> {
  const valid = await profileRef.value.validate().catch(() => false)
  if (!valid) {
    ElMessage.error(t('settings.save.failed'))
    return
  }
  ElMessage.success(t('settings.save.success'))
}
async function savePassword(): Promise<void> {
  const valid = await passwordRef.value.validate().catch(() => false)
  if (!valid) {
    ElMessage.error(t('settings.save.failed'))
    return
  }
  ElMessage.success(t('settings.save.success'))
}
function savePreference(): void {
  if (preference.language !== locale.value) switchLocale(preference.language as 'zh-CN' | 'en-US')
  ElMessage.success(t('settings.save.success'))
}
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <span>{{ t('settings.title') }}</span>
    </template>

    <el-tabs v-model="activeTab">
      <el-tab-pane :label="t('settings.tab.basic')" name="basic">
        <el-form ref="profileRef" :model="profile" :rules="profileRules" label-width="110px" style="max-width: 560px">
          <el-form-item :label="t('settings.profile.nickname')" prop="nickname">
            <el-input v-model="profile.nickname" :placeholder="t('settings.placeholder.nickname')" />
          </el-form-item>
          <el-form-item :label="t('settings.profile.realName')" prop="realName">
            <el-input v-model="profile.realName" :placeholder="t('settings.placeholder.realName')" />
          </el-form-item>
          <el-form-item :label="t('settings.profile.email')" prop="email">
            <el-input v-model="profile.email" :placeholder="t('settings.placeholder.email')" />
          </el-form-item>
          <el-form-item :label="t('settings.profile.phone')" prop="phone">
            <el-input v-model="profile.phone" :placeholder="t('settings.placeholder.phone')" />
          </el-form-item>
          <el-form-item :label="t('settings.profile.gender')" prop="gender">
            <el-radio-group v-model="profile.gender">
              <el-radio value="male">{{ t('settings.gender.male') }}</el-radio>
              <el-radio value="female">{{ t('settings.gender.female') }}</el-radio>
              <el-radio value="other">{{ t('settings.gender.other') }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item :label="t('settings.profile.bio')" prop="bio">
            <el-input v-model="profile.bio" type="textarea" :rows="3" :placeholder="t('settings.placeholder.bio')" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveProfile">{{ t('common.action.save') }}</el-button>
            <el-button>{{ t('common.action.cancel') }}</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane :label="t('settings.tab.security')" name="security">
        <el-form ref="passwordRef" :model="password" :rules="passwordRules" label-width="110px" style="max-width: 560px">
          <el-form-item :label="t('settings.security.oldPassword')" prop="oldPassword">
            <el-input v-model="password.oldPassword" type="password" show-password />
          </el-form-item>
          <el-form-item :label="t('settings.security.newPassword')" prop="newPassword">
            <el-input v-model="password.newPassword" type="password" show-password />
          </el-form-item>
          <el-form-item :label="t('settings.security.confirmPassword')" prop="confirmPassword">
            <el-input v-model="password.confirmPassword" type="password" show-password />
          </el-form-item>
          <el-form-item :label="t('settings.security.twoFactor')">
            <el-switch />
            <span class="hint">{{ t('settings.security.twoFactorDesc') }}</span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="savePassword">{{ t('settings.security.changePassword') }}</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane :label="t('settings.tab.preference')" name="preference">
        <el-form label-width="150px" style="max-width: 640px">
          <el-form-item :label="t('settings.preference.language')">
            <el-select v-model="preference.language" style="width: 200px">
              <el-option label="简体中文" value="zh-CN" />
              <el-option label="English" value="en-US" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('settings.preference.theme')">
            <el-radio-group v-model="preference.theme">
              <el-radio value="light">{{ t('settings.preference.theme.light') }}</el-radio>
              <el-radio value="dark">{{ t('settings.preference.theme.dark') }}</el-radio>
              <el-radio value="system">{{ t('settings.preference.theme.system') }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item :label="t('settings.preference.timezone')">
            <el-select v-model="preference.timezone" style="width: 220px">
              <el-option label="Asia/Shanghai (UTC+8)" value="Asia/Shanghai" />
              <el-option label="UTC" value="UTC" />
              <el-option label="America/New_York" value="America/New_York" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('settings.preference.weekStart')">
            <el-select v-model="preference.weekStart" style="width: 200px">
              <el-option label="Monday" value="monday" />
              <el-option label="Sunday" value="sunday" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('settings.preference.density')">
            <el-segmented v-model="preference.density" :options="[
              { label: t('settings.preference.density.compact'), value: 'compact' },
              { label: t('settings.preference.density.default'), value: 'default' },
              { label: t('settings.preference.density.loose'), value: 'loose' },
            ]" />
          </el-form-item>
          <el-form-item :label="t('settings.preference.notification')">
            <div class="notify-column">
              <el-checkbox v-model="preference.emailNotify">{{ t('settings.preference.notification.email') }}</el-checkbox>
              <el-checkbox v-model="preference.smsNotify">{{ t('settings.preference.notification.sms') }}</el-checkbox>
              <el-checkbox v-model="preference.appNotify">{{ t('settings.preference.notification.app') }}</el-checkbox>
            </div>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="savePreference">{{ t('common.action.save') }}</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>

<style scoped>
.hint { margin-left: 12px; color: #9ca3af; font-size: 12px; }
.notify-column { display: flex; flex-direction: column; gap: 8px; }
</style>
