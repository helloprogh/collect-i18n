<script setup lang="ts">
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

type MessageType = 'success' | 'warning' | 'error' | 'info' | 'plain'
type ConfirmType = 'confirm' | 'alert' | 'prompt'

const { t } = useI18n()

const messageTypes: MessageType[] = ['success', 'warning', 'error', 'info', 'plain']
const messageType = ref<MessageType>('success')
const duration = ref<number | ''>(3000)
const closable = ref(true)

const notifTypes: MessageType[] = ['success', 'warning', 'error', 'info', 'plain']
const notifType = ref<MessageType>('success')
const positionOptions = [
  { value: 'top-right', key: 'notifications.notifications.position.topRight' },
  { value: 'top-left', key: 'notifications.notifications.position.topLeft' },
  { value: 'bottom-right', key: 'notifications.notifications.position.bottomRight' },
  { value: 'bottom-left', key: 'notifications.notifications.position.bottomLeft' },
] as const
const notifPosition = ref('top-right')

const confirmTypes: ConfirmType[] = ['confirm', 'alert', 'prompt']
const confirmType = ref<ConfirmType>('confirm')
const confirmResult = ref('')

function epType(type: MessageType): 'success' | 'warning' | 'info' | 'error' {
  return type === 'plain' ? 'info' : type
}

function sendMessage() {
  ElMessage({
    type: epType(messageType.value),
    message: t(`notifications.messages.${messageType.value}.text`),
    duration: typeof duration.value === 'number' ? duration.value : 3000,
    showClose: closable.value,
  })
}

function clearMessages() {
  ElMessage.closeAll()
}

function sendNotification() {
  ElNotification({
    type: epType(notifType.value),
    title: t(`notifications.notifications.${notifType.value}.title`),
    message: t(`notifications.notifications.${notifType.value}.text`),
    position: notifPosition.value as 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left',
  })
}

async function triggerConfirm() {
  confirmResult.value = ''
  try {
    if (confirmType.value === 'confirm') {
      await ElMessageBox.confirm(
        t('notifications.confirmations.confirm.message'),
        t('notifications.confirmations.confirm.title'),
        {
          confirmButtonText: t('notifications.confirmations.confirm.confirm'),
          cancelButtonText: t('notifications.confirmations.confirm.cancel'),
        },
      )
      confirmResult.value = t('notifications.confirmations.result.confirmed')
    } else if (confirmType.value === 'alert') {
      await ElMessageBox.alert(
        t('notifications.confirmations.alert.message'),
        t('notifications.confirmations.alert.title'),
        { confirmButtonText: t('notifications.confirmations.alert.confirm') },
      )
      confirmResult.value = t('notifications.confirmations.result.confirmed')
    } else {
      const result = await ElMessageBox.prompt(
        t('notifications.confirmations.prompt.title'),
        t('notifications.confirmations.prompt.title'),
        {
          confirmButtonText: t('notifications.confirmations.prompt.confirm'),
          cancelButtonText: t('notifications.confirmations.prompt.cancel'),
          inputPlaceholder: t('notifications.confirmations.prompt.placeholder'),
          inputValidator: (value: string) => Boolean(value && value.trim()) || t('notifications.confirmations.prompt.validation'),
        },
      )
      confirmResult.value = t('notifications.confirmations.result.entered', { value: result.value ?? '' })
    }
  } catch {
    confirmResult.value = t('notifications.confirmations.result.cancelled')
  }
}
</script>

<template>
  <section class="page" data-testid="notifications-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('notifications.title') }}</h1>
        <p>{{ t('notifications.subtitle') }}</p>
      </div>
    </header>

    <el-card class="section-card">
      <h3>{{ t('notifications.sections.messages') }}</h3>
      <div class="toolbar">
        <el-select v-model="messageType" data-testid="notifications-message-type" style="width: 180px">
          <el-option v-for="type in messageTypes" :key="type" :label="t(`notifications.messages.${type}.label`)" :value="type" />
        </el-select>
        <el-input-number v-model="duration" data-testid="notifications-duration" :min="0" :step="500"
          :placeholder="t('notifications.messages.duration.placeholder')" />
        <el-switch v-model="closable" data-testid="notifications-closable" :active-text="t('notifications.messages.closable')" inline-prompt />
      </div>
      <div class="dialog-actions">
        <el-button data-testid="notifications-clear" @click="clearMessages">{{ t('notifications.messages.clear') }}</el-button>
        <el-button type="primary" data-testid="notifications-send-message" @click="sendMessage">{{ t('notifications.messages.send') }}</el-button>
      </div>
    </el-card>

    <el-card class="section-card">
      <h3>{{ t('notifications.sections.notifications') }}</h3>
      <div class="toolbar">
        <el-select v-model="notifType" data-testid="notifications-notif-type" style="width: 180px">
          <el-option v-for="type in notifTypes" :key="type" :label="t(`notifications.notifications.${type}.label`)" :value="type" />
        </el-select>
        <el-select v-model="notifPosition" data-testid="notifications-position" style="width: 160px">
          <el-option v-for="option in positionOptions" :key="option.value" :label="t(option.key)" :value="option.value" />
        </el-select>
      </div>
      <div class="dialog-actions">
        <el-button type="primary" data-testid="notifications-send-notif" @click="sendNotification">{{ t('notifications.notifications.send') }}</el-button>
      </div>
    </el-card>

    <el-card class="section-card">
      <h3>{{ t('notifications.sections.confirmations') }}</h3>
      <div class="toolbar">
        <el-select v-model="confirmType" data-testid="notifications-confirm-type" style="width: 200px">
          <el-option v-for="type in confirmTypes" :key="type" :label="t(`notifications.confirmations.${type}.label`)" :value="type" />
        </el-select>
        <el-button type="primary" data-testid="notifications-trigger" @click="triggerConfirm">{{ t('notifications.confirmations.trigger') }}</el-button>
      </div>
      <el-alert v-if="confirmResult" data-testid="notifications-result" type="info" show-icon :closable="false" :title="confirmResult" class="result-panel" />
    </el-card>
  </section>
</template>
