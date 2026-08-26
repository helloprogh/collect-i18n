<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { getApiError, login as apiLogin } from '../api/client'

const { t } = useI18n()
const router = useRouter()
const formRef = ref<FormInstance>()
const submitting = ref(false)
const failCode = ref('')

const form = reactive({ username: '', password: '' })

const rules: FormRules = {
  username: [{ required: true, message: t('login.validation.usernameRequired'), trigger: 'blur' }],
  password: [{ required: true, message: t('login.validation.passwordRequired'), trigger: 'blur' }],
}

async function submit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().then(() => true).catch(() => false)
  if (!valid) return
  submitting.value = true
  failCode.value = ''
  try {
    const result = await apiLogin({ username: form.username, password: form.password })
    document.cookie = `x-gde-token=${result.token}; path=/; SameSite=Lax`
    ElMessage.success(t('login.success', { username: result.username }))
    router.push('/dashboard')
  } catch (error) {
    const info = getApiError(error)
    failCode.value = info.code
    ElMessage.error(t('login.failed', { code: info.code }))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="page" data-testid="login-page">
    <el-card class="section-card login-card">
      <header class="page-heading">
        <div>
          <h1>{{ t('login.title') }}</h1>
          <p>{{ t('login.subtitle') }}</p>
        </div>
      </header>

      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px" data-testid="login-form">
        <el-form-item :label="t('login.username')" prop="username">
          <el-input
            v-model="form.username"
            data-testid="login-username"
            :placeholder="t('login.usernamePlaceholder')"
            :aria-label="t('login.aria.username')"
          />
        </el-form-item>
        <el-form-item :label="t('login.password')" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            data-testid="login-password"
            :placeholder="t('login.passwordPlaceholder')"
            :aria-label="t('login.aria.password')"
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="submitting" data-testid="login-submit" :aria-label="t('login.aria.submit')" style="width: 100%" @click="submit">
            {{ submitting ? t('login.submitting') : t('login.submit') }}
          </el-button>
        </el-form-item>
        <el-form-item>
          <el-link type="primary" data-testid="login-forgot">{{ t('login.forgot') }}</el-link>
        </el-form-item>
      </el-form>

      <el-alert v-if="failCode" data-testid="login-failed" type="error" show-icon :closable="false" :title="t('login.failed', { code: failCode })" />
      <p class="muted" data-testid="login-tip">{{ t('login.tip') }}</p>
    </el-card>
  </section>
</template>
