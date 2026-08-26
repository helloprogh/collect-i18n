<script setup lang="ts">
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

function showSuccess() { ElMessage.success(t('messages.msg.success')) }
function showWarning() { ElMessage.warning(t('messages.msg.warning')) }
function showError() { ElMessage.error(t('messages.msg.error')) }
function showInfo() { ElMessage.info(t('messages.msg.info')) }

function showNotification() {
  ElNotification({
    title: t('messages.notification.title'),
    message: t('messages.notification.message'),
    type: 'info',
    showClose: true,
  })
}

async function showAlert() {
  await ElMessageBox.alert(t('messages.alert.message'), t('messages.alert.title'), {
    confirmButtonText: t('messages.alert.ok'),
  })
}

async function showConfirm() {
  try {
    await ElMessageBox.confirm(t('messages.confirm.message'), t('messages.confirm.title'), {
      confirmButtonText: t('messages.confirm.ok'),
      cancelButtonText: t('messages.confirm.cancel'),
      type: 'warning',
    })
    ElMessage.success(t('messages.confirm.success'))
  } catch {
    ElMessage.info(t('messages.confirm.cancelled'))
  }
}

async function showPrompt() {
  try {
    const { value } = await ElMessageBox.prompt(t('messages.prompt.message'), t('messages.prompt.title'), {
      confirmButtonText: t('messages.prompt.ok'),
      cancelButtonText: t('messages.prompt.cancel'),
      inputPlaceholder: t('messages.prompt.placeholder'),
    })
    ElMessage.success(t('messages.prompt.success', { value }))
  } catch {
    // 用户取消,无操作
  }
}

function showLoadingMessage() {
  const close = ElMessage({
    message: t('messages.loading.message'),
    type: 'info',
    duration: 0,
    showClose: false,
  })
  // 1.2s 后关闭 —— 消息型 loading 演练
  setTimeout(() => close.close(), 1200)
}
</script>

<template>
  <section class="page" data-testid="messages-page" :aria-label="t('messages.aria.sectionTitle')">
    <header class="page-heading">
      <div>
        <h1>{{ t('messages.title') }}</h1>
        <p>{{ t('messages.subtitle') }}</p>
      </div>
    </header>

    <el-card class="section-card">
      <div class="message-actions">
        <el-button data-testid="msg-success" type="success" @click="showSuccess">{{ t('messages.buttons.success') }}</el-button>
        <el-button data-testid="msg-warning" type="warning" @click="showWarning">{{ t('messages.buttons.warning') }}</el-button>
        <el-button data-testid="msg-error" type="danger" @click="showError">{{ t('messages.buttons.error') }}</el-button>
        <el-button data-testid="msg-info" @click="showInfo">{{ t('messages.buttons.info') }}</el-button>
        <el-button data-testid="msg-notification" @click="showNotification">{{ t('messages.buttons.notification') }}</el-button>
        <el-button data-testid="msg-alert" @click="showAlert">{{ t('messages.buttons.alert') }}</el-button>
        <el-button data-testid="msg-confirm" type="warning" @click="showConfirm">{{ t('messages.buttons.confirm') }}</el-button>
        <el-button data-testid="msg-prompt" @click="showPrompt">{{ t('messages.buttons.prompt') }}</el-button>
        <el-button data-testid="msg-loading" type="primary" plain @click="showLoadingMessage">{{ t('messages.buttons.loading') }}</el-button>
      </div>
    </el-card>

    <!-- drawer 形态:ElMessageBox 类即 Teleport 到 body —— 采集时出现在视口 -->
    <div style="display: none" :title="t('messages.notification.close')" data-testid="messages-nonvisual"></div>
  </section>
</template>
