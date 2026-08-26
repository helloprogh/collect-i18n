<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const formRef = ref<FormInstance>()
const saving = ref(false)
const form = reactive({
  name: '',
  email: '',
  password: '',
})

// 校验词条:required / email / minLength
const rules: FormRules = {
  name: [{ required: true, message: t('settings.validation.nameRequired'), trigger: 'blur' }],
  email: [
    { required: true, message: t('settings.validation.emailRequired'), trigger: 'blur' },
    { type: 'email', message: t('settings.validation.emailInvalid'), trigger: 'blur' },
  ],
  password: [
    { required: true, message: t('settings.validation.passwordRequired'), trigger: 'blur' },
    { min: 6, message: t('settings.validation.passwordMinLength', { min: 6 }), trigger: 'blur' },
  ],
}

async function save() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().then(() => true).catch(() => false)
  if (!valid) {
    ElMessage.warning(t('settings.form.saveFail'))
    return
  }
  saving.value = true
  try {
    // 模拟保存请求
    await new Promise((resolve) => setTimeout(resolve, 500))
    ElMessage.success(t('settings.form.saveSuccess'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="page" data-testid="settings-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('settings.title') }}</h1>
        <p>{{ t('settings.subtitle') }}</p>
      </div>
    </header>

    <el-card class="section-card login-card">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px" data-testid="settings-form">
        <el-form-item :label="t('settings.form.name')" prop="name">
          <el-input
            v-model="form.name"
            data-testid="settings-name"
            :placeholder="t('settings.form.namePlaceholder')"
            :aria-label="t('settings.aria.name')"
          />
        </el-form-item>
        <el-form-item :label="t('settings.form.email')" prop="email">
          <el-input
            v-model="form.email"
            data-testid="settings-email"
            :placeholder="t('settings.form.emailPlaceholder')"
            :aria-label="t('settings.aria.email')"
          />
        </el-form-item>
        <el-form-item :label="t('settings.form.password')" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            data-testid="settings-password"
            :placeholder="t('settings.form.passwordPlaceholder')"
            :aria-label="t('settings.aria.password')"
          />
        </el-form-item>
        <el-form-item :label="t('settings.lang.label')">
          <span class="muted">{{ t('settings.lang.hint') }}</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" data-testid="settings-save" :aria-label="t('settings.aria.save')" @click="save">
            {{ t('settings.form.save') }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 原生 title 非可视词条 -->
    <div :title="t('settings.nonVisual.hint')" data-testid="settings-nonvisual-hint" class="muted" style="text-align:center">{{ t('settings.nonVisual.hint') }}</div>
    <div :title="t('settings.nonVisual.themeTitle')" style="display: none" data-testid="settings-nonvisual-theme"></div>
  </section>
</template>
