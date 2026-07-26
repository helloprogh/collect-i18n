<script setup lang="ts">
// Loaded on demand because release notes are not needed during initial startup.
import { useI18n } from 'vue-i18n'

defineProps<{
  title: string
  body: string
  hint: string
  confirm: string
  close: string
}>()
defineEmits<{ close: []; confirm: [] }>()

const { t } = useI18n()
const features = ['item1', 'item2', 'item3', 'item4'] as const
</script>

<template>
  <div class="lazy-content">
    <h3>{{ title }}</h3>
    <p>{{ body }}</p>
    <p class="muted">{{ hint }}</p>
    <ul>
      <li v-for="feature in features" :key="feature">{{ t(`diagnostics.lazy.features.${feature}`) }}</li>
    </ul>
    <div class="dialog-actions">
      <el-button data-testid="lazy-confirm" type="primary" @click="$emit('confirm')">{{ confirm }}</el-button>
      <el-button data-testid="lazy-close" @click="$emit('close')">{{ close }}</el-button>
    </div>
  </div>
</template>
