<script setup lang="ts">
import { defineAsyncComponent, defineComponent, h, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MultiRootWrapper from '../components/MultiRootWrapper.vue'

const { t } = useI18n()

const LazyLoading = defineComponent({
  setup() {
    const { t } = useI18n()
    return () => h('div', { class: 'muted', 'data-testid': 'diagnostics-lazy-loading' }, t('diagnostics.lazy.loading'))
  },
})

const LazyDialog = defineAsyncComponent({
  loader: async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
    return (await import('../components/LazyDialogContent.vue')).default
  },
  loadingComponent: LazyLoading,
  delay: 0,
})

const teleportOpen = ref(false)
const lazyOpen = ref(false)
const activeCollapse = ref<string[]>([])

type Status = 'idle' | 'running' | 'done' | 'failed'
const status = ref<Status>('idle')
const statuses: Status[] = ['idle', 'running', 'done', 'failed']

const nameInput = ref('Ada')
const countInput = ref(12)
const doneInput = ref(3)
const totalInput = ref(10)
const pluralCount = ref(5)

const operations = ['create', 'read', 'update', 'delete'] as const
const duplicates = ['confirm', 'cancel', 'save', 'delete', 'export', 'import', 'edit'] as const
const listItems = ['item1', 'item2', 'item3'] as const
const steps = ['open', 'render', 'capture'] as const
</script>

<template>
  <section class="page" data-testid="diagnostics-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('diagnostics.title') }}</h1>
        <p>{{ t('diagnostics.subtitle') }}</p>
      </div>
      <el-button type="primary" data-testid="diagnostics-open-dialog" @click="teleportOpen = true">{{ t('diagnostics.openDialog') }}</el-button>
    </header>

    <el-card class="section-card" :title="t('diagnostics.titles.teleportCard')">
      <template #header>{{ t('diagnostics.sections.teleport') }}</template>
      <el-button data-testid="diagnostics-teleport-open" :aria-label="t('diagnostics.aria.teleportOpen')" @click="teleportOpen = true">{{ t('diagnostics.teleport.open') }}</el-button>
    </el-card>

    <el-card class="section-card" :title="t('diagnostics.titles.lazyCard')">
      <template #header>{{ t('diagnostics.sections.lazy') }}</template>
      <el-button data-testid="diagnostics-lazy-open" :aria-label="t('diagnostics.aria.lazyOpen')" @click="lazyOpen = true">{{ t('diagnostics.lazy.open') }}</el-button>
    </el-card>

    <el-card class="section-card">
      <template #header>{{ t('diagnostics.sections.fragment') }}</template>
      <el-collapse v-model="activeCollapse" data-testid="diagnostics-fragment-collapse" :aria-label="t('diagnostics.aria.fragmentInfo')">
        <el-collapse-item name="fragment" :title="t('diagnostics.fragment.wrapper.title')">
          <p class="muted">{{ t('diagnostics.fragment.desc') }}</p>
          <MultiRootWrapper
            :title="t('diagnostics.fragment.wrapper.title')"
            :lead="t('diagnostics.fragment.wrapper.lead')"
            :body="t('diagnostics.fragment.wrapper.body')"
            :footer="t('diagnostics.fragment.wrapper.footer')"
          />
          <p class="muted">{{ t('diagnostics.fragment.props.label') }}: {{ t('diagnostics.fragment.props.hint') }}</p>
          <h4>{{ t('diagnostics.fragment.slots.title') }}</h4>
          <el-card class="section-card" shadow="never">
            <template #header>{{ t('diagnostics.fragment.slots.header') }}</template>
            {{ t('diagnostics.fragment.slots.default') }}
            <template #footer>{{ t('diagnostics.fragment.slots.footer') }}</template>
          </el-card>
        </el-collapse-item>
      </el-collapse>
    </el-card>

    <el-card class="section-card">
      <template #header>{{ t('diagnostics.sections.dynamic') }}</template>
      <el-collapse v-model="activeCollapse" data-testid="diagnostics-dynamic-collapse" :aria-label="t('diagnostics.aria.dynamicInfo')">
        <el-collapse-item name="dynamic" :title="t('diagnostics.dynamic.operations.title')">
          <p class="muted">{{ t('diagnostics.dynamic.desc') }}</p>

          <el-form label-position="top">
            <el-form-item :label="t('diagnostics.dynamic.statusLabel')">
              <el-select v-model="status" data-testid="diagnostics-status" style="width: 200px">
                <el-option v-for="item in statuses" :key="item" :label="t(`diagnostics.dynamic.statuses.${item}`)" :value="item" />
              </el-select>
              <el-tag :title="t('diagnostics.titles.statusBadge')" style="margin-left: 12px">{{ t(`diagnostics.dynamic.statuses.${status}`) }}</el-tag>
            </el-form-item>
            <el-form-item :label="t('diagnostics.dynamic.interpolation.greeting', { name: nameInput, product: 'GDE' })">
              <el-input v-model="nameInput" data-testid="diagnostics-name" style="width: 200px" />
            </el-form-item>
            <el-form-item :label="t('diagnostics.dynamic.interpolation.count', { count: countInput })">
              <el-input-number v-model="countInput" data-testid="diagnostics-count" :min="0" />
            </el-form-item>
            <el-form-item :label="t('diagnostics.dynamic.interpolation.progress', { done: doneInput, total: totalInput })">
              <el-input-number v-model="doneInput" data-testid="diagnostics-done" :min="0" />
              <el-input-number v-model="totalInput" data-testid="diagnostics-total" :min="0" style="margin-left: 12px" />
            </el-form-item>
            <el-form-item :label="t('diagnostics.dynamic.plurals.label')">
              <span class="muted">{{ t('diagnostics.dynamic.plurals.hint') }}</span>
              <div class="toolbar">
                <el-input-number v-model="pluralCount" data-testid="diagnostics-plural-count" :min="0" />
                <span :title="t('diagnostics.titles.helpLink')">{{ t('diagnostics.dynamic.plurals.examples') }}: {{ pluralCount }}</span>
                <strong data-testid="diagnostics-plural-result">{{ t('diagnostics.dynamic.plurals.messages', { count: pluralCount }, pluralCount) }}</strong>
              </div>
            </el-form-item>
          </el-form>

          <h4>{{ t('diagnostics.dynamic.operations.title') }}</h4>
          <div class="duplicate-row">
            <el-button v-for="op in operations" :key="op" data-testid="diagnostics-operation">{{ t(`diagnostics.dynamic.operations.${op}`) }}</el-button>
          </div>

          <h4>{{ t('diagnostics.dynamic.templates.title') }}</h4>
          <p>{{ t('diagnostics.dynamic.templates.default') }}</p>

          <h4>{{ t('diagnostics.duplicates.desc') }}</h4>
          <div class="duplicate-row" data-testid="diagnostics-duplicates">
            <el-button v-for="item in duplicates" :key="item" data-testid="diagnostics-duplicate">{{ t(`diagnostics.duplicates.${item}`) }}</el-button>
          </div>
        </el-collapse-item>
      </el-collapse>
    </el-card>

    <Teleport to="body">
      <div v-if="teleportOpen" class="teleport-overlay" data-testid="diagnostics-teleport-panel" @click.self="teleportOpen = false">
        <div class="teleport-panel">
          <h3>{{ t('diagnostics.teleport.dialog.title') }}</h3>
          <p>{{ t('diagnostics.teleport.dialog.body') }}</p>
          <p class="muted">{{ t('diagnostics.teleport.dialog.note') }}</p>
          <h4>{{ t('diagnostics.teleport.list.title') }}</h4>
          <ul>
            <li v-for="item in listItems" :key="item">{{ t(`diagnostics.teleport.list.${item}`) }}</li>
          </ul>
          <el-steps :active="1" simple>
            <el-step v-for="step in steps" :key="step" :title="t(`diagnostics.teleport.steps.${step}`)" />
          </el-steps>
          <p class="muted">{{ t('diagnostics.teleport.footer') }}</p>
          <div class="dialog-actions">
            <el-button data-testid="diagnostics-teleport-cancel" @click="teleportOpen = false">{{ t('diagnostics.teleport.dialog.cancel') }}</el-button>
            <el-button type="primary" data-testid="diagnostics-teleport-confirm" @click="teleportOpen = false">{{ t('diagnostics.teleport.dialog.confirm') }}</el-button>
          </div>
        </div>
      </div>
    </Teleport>

    <el-dialog v-model="lazyOpen" data-testid="diagnostics-lazy-dialog" width="540">
      <component
        :is="LazyDialog"
        :title="t('diagnostics.lazy.dialog.title')"
        :body="t('diagnostics.lazy.dialog.body')"
        :hint="t('diagnostics.lazy.dialog.hint')"
        :confirm="t('diagnostics.lazy.dialog.confirm')"
        :close="t('diagnostics.lazy.dialog.close')"
        @close="lazyOpen = false"
        @confirm="lazyOpen = false"
      />
      <template #footer>
        <span class="muted">{{ t('diagnostics.lazy.loaded') }}</span>
      </template>
    </el-dialog>
  </section>
</template>
