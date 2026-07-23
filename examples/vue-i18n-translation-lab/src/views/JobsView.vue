<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { listJobs, type SyncJob } from '../api/client'

const { t } = useI18n()
const jobs = ref<SyncJob[]>([])
const loading = ref(false)
const loadError = ref(false)

function environmentLabel(environment: SyncJob['environment']) {
  if (environment === 'production') return t('jobs.environment.production')
  if (environment === 'staging') return t('jobs.environment.staging')
  return t('jobs.environment.development')
}

function statusLabel(status: SyncJob['status']) {
  return status === 'completed' ? t('jobs.status.completed') : t('jobs.status.running')
}

async function loadJobs() {
  loading.value = true
  loadError.value = false
  try {
    jobs.value = await listJobs()
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(loadJobs)
</script>

<template>
  <section class="page" data-testid="jobs-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('jobs.title') }}</h1>
        <p>{{ t('jobs.subtitle') }}</p>
      </div>
      <el-button data-testid="refresh-jobs" :loading="loading" @click="loadJobs">
        {{ t('jobs.refresh') }}
      </el-button>
    </header>

    <el-alert
      v-if="loadError"
      data-testid="jobs-load-error"
      type="error"
      :title="t('jobs.loadFailed')"
      :closable="false"
      show-icon
    />

    <el-card v-else>
      <el-table v-loading="loading" :data="jobs" :empty-text="t('jobs.empty')">
        <el-table-column prop="id" :label="t('jobs.columns.id')" width="150" />
        <el-table-column prop="name" :label="t('jobs.columns.name')" />
        <el-table-column :label="t('jobs.columns.environment')" width="180">
          <template #default="scope">
            {{ environmentLabel(scope.row.environment) }}
          </template>
        </el-table-column>
        <el-table-column :label="t('jobs.columns.status')" width="160">
          <template #default="scope">
            <el-tag :type="scope.row.status === 'completed' ? 'success' : 'warning'">
              {{ statusLabel(scope.row.status) }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </section>
</template>
