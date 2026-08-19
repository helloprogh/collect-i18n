<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

function showSuccess(): void {
  ElMessage({ type: 'success', message: t('messages.msg.success.text'), duration: 1500 })
}
function showWarning(): void {
  ElMessage({ type: 'warning', message: t('messages.msg.warning.text'), duration: 1500 })
}
function showError(): void {
  ElMessage({ type: 'error', message: t('messages.msg.error.text'), duration: 1500 })
}
function showInfo(): void {
  ElMessage({ type: 'info', message: t('messages.msg.info.text'), duration: 1500 })
}
function showSuccessClosable(): void {
  ElMessage({ type: 'success', message: t('messages.msg.success.send'), showClose: true })
}
function showLoading(): void {
  const loading = ElMessage({ type: 'info', message: t('common.misc.loading'), duration: 0 })
  setTimeout(() => loading.close(), 1200)
}

async function openConfirm(): Promise<void> {
  try {
    await ElMessageBox.confirm(t('messages.confirm.content'), t('messages.confirm.title'), {
      type: 'warning',
      confirmButtonText: t('messages.confirm.confirmText'),
      cancelButtonText: t('messages.confirm.cancelText'),
    })
    ElMessage.success(t('common.dialog.operationSuccess'))
  } catch {
    /* cancelled */
  }
}
async function openAlert(): Promise<void> {
  await ElMessageBox.alert(t('messages.alert.content'), t('messages.alert.title'), {
    confirmButtonText: t('messages.dialog.confirm'),
  })
}
async function openPrompt(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(t('messages.prompt.inputPlaceholder'), t('messages.prompt.title'), {
      inputPlaceholder: t('messages.prompt.inputPlaceholder'),
      confirmButtonText: t('messages.dialog.confirm'),
      cancelButtonText: t('messages.dialog.cancel'),
    })
    if (value) ElMessage.success(t('messages.prompt.success'))
  } catch {
    /* cancelled */
  }
}
function sendNotification(): void {
  ElNotification({
    title: t('messages.notification.title'),
    message: t('messages.notification.body'),
    type: 'info',
    duration: 2500,
  })
  ElNotification({
    title: t('messages.notification.successTitle'),
    message: t('messages.notification.successBody'),
    type: 'success',
    duration: 2500,
  })
}

// 表单校验提示场景
const demoForm = reactive({ code: '', remark: '' })
const demoRules = {
  code: [
    { required: true, message: t('settings.validation.nickname.required'), trigger: 'blur' },
    { pattern: /^[A-Za-z0-9]{4,16}$/, message: t('settings.validation.phone.format'), trigger: 'blur' },
  ],
}
const demoFormRef = ref()
async function submitDemo(): Promise<void> {
  const valid = await demoFormRef.value.validate().catch(() => false)
  if (!valid) {
    ElMessage.error(t('messages.form.error'))
    return
  }
  ElMessage.success(t('messages.demo.submit'))
}

const demoButtons = [
  { key: 'button.success', handler: showSuccess, type: 'success' },
  { key: 'button.warning', handler: showWarning, type: 'warning' },
  { key: 'button.error', handler: showError, type: 'danger' },
  { key: 'button.info', handler: showInfo, type: 'info' },
  { key: 'button.successClose', handler: showSuccessClosable, type: 'success' },
  { key: 'button.loading', handler: showLoading, type: 'info' },
] as const

const dialogButtons = [
  { key: 'button.confirm', handler: openConfirm },
  { key: 'button.alert', handler: openAlert },
  { key: 'button.prompt', handler: openPrompt },
  { key: 'button.notification', handler: sendNotification },
] as const
</script>

<template>
  <div class="messages-page">
    <el-card shadow="never">
      <template #header>
        <span>{{ t('messages.title') }}</span>
      </template>
      <p class="muted">{{ t('messages.intro') }}</p>

      <el-divider content-position="left">{{ t('messages.msg.info.title') }}</el-divider>
      <div class="button-row">
        <el-button v-for="item in demoButtons" :key="item.key" :type="item.type" plain @click="item.handler()">
          {{ t(`messages.${item.key}`) }}
        </el-button>
      </div>

      <el-divider content-position="left">{{ t('messages.confirm.title') }}</el-divider>
      <div class="button-row">
        <el-button v-for="item in dialogButtons" :key="item.key" @click="item.handler()">
          {{ t(`messages.${item.key}`) }}
        </el-button>
      </div>

      <el-divider content-position="left">{{ t('messages.form.error') }}</el-divider>
      <el-form ref="demoFormRef" :model="demoForm" :rules="demoRules" label-width="120px" style="max-width: 480px">
        <el-form-item :label="t('messages.prompt.inputPlaceholder')" prop="code">
          <el-input v-model="demoForm.code" :placeholder="t('messages.prompt.inputPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('messages.msg.warning.title')" prop="remark">
          <el-input v-model="demoForm.remark" :placeholder="t('settings.placeholder.bio')" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="submitDemo">{{ t('messages.demo.submit') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.muted { color: #6b7280; }
.button-row { display: flex; flex-wrap: wrap; gap: 12px; }
.messages-page { display: flex; flex-direction: column; gap: 16px; }
</style>
