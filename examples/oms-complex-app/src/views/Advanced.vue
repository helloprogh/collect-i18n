<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const activeTab = ref('basic')
const drawerVisible = ref(false)
const treeChecked = ref<string[]>([])
const volume = ref(60)
const rating = ref(4)
const dateValue = ref('')
const dateRange = ref<[string, string] | null>(null)
const monthValue = ref('')
const cascaderValue = ref<string[]>([])
const segmentedValue = ref('day')
const featureEnabled = ref(true)
const radioValue = ref('a')
const checkboxValue = ref<string[]>([])

const treeData = computed(() => [
  {
    label: t('advanced.tree.node.root'),
    children: [
      {
        label: t('advanced.tree.group.sales'),
        children: [
          { label: t('advanced.tree.node.sales.east') },
          { label: t('advanced.tree.node.sales.west') },
        ],
      },
      {
        label: t('advanced.tree.group.tech'),
        children: [
          { label: t('advanced.tree.node.tech.frontend') },
          { label: t('advanced.tree.node.tech.backend') },
        ],
      },
      { label: t('advanced.tree.node.ops') },
    ],
  },
])

const cascaderOptions = computed(() => [
  {
    value: 'electronics',
    label: t('advanced.cascader.group.electronics'),
    children: [
      { value: 'phone', label: t('advanced.cascader.electronics.phone') },
      { value: 'laptop', label: t('advanced.cascader.electronics.laptop') },
      { value: 'audio', label: t('advanced.cascader.electronics.audio') },
    ],
  },
  {
    value: 'apparel',
    label: t('advanced.cascader.group.apparel'),
    children: [
      { value: 'men', label: t('advanced.cascader.apparel.men') },
      { value: 'women', label: t('advanced.cascader.apparel.women') },
    ],
  },
  {
    value: 'food',
    label: t('advanced.cascader.group.food'),
    children: [
      { value: 'snack', label: t('advanced.cascader.food.snack') },
      { value: 'drink', label: t('advanced.cascader.food.drink') },
    ],
  },
])

const steps = computed(() => [
  { title: t('advanced.steps.submit') },
  { title: t('advanced.steps.pay') },
  { title: t('advanced.steps.ship') },
  { title: t('advanced.steps.done') },
])
const stepIndex = ref(1)

const progressValue = ref(64)

async function openPopconfirm(): Promise<void> {
  ElMessage.success(t('common.dialog.operationSuccess'))
}
async function openResultConfirm(): Promise<void> {
  await ElMessageBox.confirm(t('advanced.result.successDesc'), t('advanced.result.title'), {
    confirmButtonText: t('advanced.popconfirm.confirm'),
    cancelButtonText: t('advanced.popconfirm.cancel'),
  })
  ElMessage.success(t('common.dialog.operationSuccess'))
}
</script>

<template>
  <div class="advanced-page">
    <el-card shadow="never">
      <template #header>
        <span>{{ t('advanced.title') }}</span>
      </template>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-card shadow="never" class="block">
            <template #header>{{ t('advanced.tabs.title') }}</template>
            <el-tabs v-model="activeTab">
              <el-tab-pane :label="t('advanced.tabs.basic')" name="basic">
                {{ t('advanced.tabs.description.basic') }}
              </el-tab-pane>
              <el-tab-pane :label="t('advanced.tabs.advanced')" name="advanced">
                {{ t('advanced.tabs.description.advanced') }}
              </el-tab-pane>
              <el-tab-pane :label="t('advanced.tabs.audit')" name="audit">
                {{ t('advanced.tabs.description.audit') }}
              </el-tab-pane>
            </el-tabs>
          </el-card>

          <el-card shadow="never" class="block">
            <template #header>{{ t('advanced.tree.title') }}</template>
            <el-tree :data="treeData" show-checkbox node-key="label" :default-expanded-keys="[t('advanced.tree.node.root')]" />
          </el-card>

          <el-card shadow="never" class="block">
            <template #header>{{ t('advanced.cascader.title') }}</template>
            <el-cascader v-model="cascaderValue" :options="cascaderOptions" style="width: 100%" />
          </el-card>

          <el-card shadow="never" class="block">
            <template #header>{{ t('advanced.date.title') }}</template>
            <el-date-picker v-model="dateValue" type="date" :placeholder="t('advanced.date.today')" style="width: 180px" />
            <el-date-picker v-model="dateRange" type="daterange" :start-placeholder="t('advanced.date.range')"
              :end-placeholder="t('advanced.date.range')" style="width: 260px; margin-left: 12px" />
            <el-date-picker v-model="monthValue" type="month" :placeholder="t('advanced.date.month')" style="width: 140px; margin-left: 12px" />
          </el-card>
        </el-col>

        <el-col :span="12">
          <el-card shadow="never" class="block">
            <template #header>{{ t('advanced.slider.title') }}</template>
            <div class="slider-row">
              <span class="label">{{ t('advanced.slider.volume') }}</span>
              <el-slider v-model="volume" style="flex: 1" />
              <span>{{ volume }}</span>
            </div>
            <div class="slider-row">
              <span class="label">{{ t('advanced.slider.rating') }}</span>
              <el-rate v-model="rating" />
            </div>
          </el-card>

          <el-card shadow="never" class="block">
            <template #header>{{ t('advanced.steps.title') }}</template>
            <el-steps :active="stepIndex" align-center>
              <el-step v-for="step in steps" :key="step.title" :title="step.title" />
            </el-steps>
          </el-card>

          <el-card shadow="never" class="block">
            <template #header>{{ t('advanced.descriptions.title') }}</template>
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item :label="t('advanced.descriptions.name')">智能手表 Pro</el-descriptions-item>
              <el-descriptions-item :label="t('advanced.descriptions.sku')">SKU-202608</el-descriptions-item>
              <el-descriptions-item :label="t('advanced.descriptions.brand')">Acme</el-descriptions-item>
              <el-descriptions-item :label="t('advanced.descriptions.price')">¥ 1,299</el-descriptions-item>
              <el-descriptions-item :label="t('advanced.descriptions.stock')">328</el-descriptions-item>
              <el-descriptions-item :label="t('advanced.descriptions.status')">
                <el-tag type="success" size="small">{{ t('advanced.descriptions.tags') }}</el-tag>
              </el-descriptions-item>
            </el-descriptions>
          </el-card>

          <el-card shadow="never" class="block">
            <template #header>{{ t('advanced.result.title') }}</template>
            <el-result icon="success" :title="t('advanced.result.successTitle')" :sub-title="t('advanced.result.successDesc')">
              <template #extra>
                <el-button type="primary">{{ t('advanced.result.backHome') }}</el-button>
                <el-button @click="openResultConfirm">{{ t('advanced.result.viewDetail') }}</el-button>
              </template>
            </el-result>
          </el-card>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="8">
          <el-card shadow="never" class="block">
            <template #header>{{ t('advanced.empty.title') }}</template>
            <el-empty :description="t('advanced.empty.desc')">
              <el-button type="primary">{{ t('advanced.empty.button') }}</el-button>
            </el-empty>
          </el-card>
        </el-col>
        <el-col :span="8">
          <el-card shadow="never" class="block">
            <template #header>{{ t('advanced.drawer.title') }}</template>
            <el-button type="primary" plain @click="drawerVisible = true">{{ t('advanced.drawer.open') }}</el-button>
            <el-button type="primary" plain @click="openPopconfirm">{{ t('advanced.popconfirm.title') }}</el-button>
          </el-card>
        </el-col>
        <el-col :span="8">
          <el-card shadow="never" class="block">
            <template #header>{{ t('advanced.progress.title') }}</template>
            <el-progress :percentage="progressValue" :status="progressValue >= 100 ? 'success' : undefined" />
            <p class="muted small">{{ t('advanced.progress.uploading') }}</p>
            <p class="muted small">{{ t('advanced.progress.processed', { count: progressValue }) }}</p>
          </el-card>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="8">
          <el-card shadow="never" class="block">
            <template #header>{{ t('advanced.timeline.title') }}</template>
            <el-timeline>
              <el-timeline-item :timestamp="'2026-08-01'" type="primary">{{ t('advanced.timeline.created') }}</el-timeline-item>
              <el-timeline-item :timestamp="'2026-08-10'" type="success">{{ t('advanced.timeline.review') }}</el-timeline-item>
              <el-timeline-item :timestamp="'2026-08-15'" type="warning">{{ t('advanced.timeline.published') }}</el-timeline-item>
              <el-timeline-item :timestamp="'2026-08-19'" type="info">{{ t('advanced.timeline.archived') }}</el-timeline-item>
            </el-timeline>
          </el-card>
        </el-col>
        <el-col :span="8">
          <el-card shadow="never" class="block">
            <template #header>{{ t('advanced.tag.title') }}</template>
            <el-tag type="primary">{{ t('advanced.tag.primary') }}</el-tag>
            <el-tag type="success">{{ t('advanced.tag.success') }}</el-tag>
            <el-tag type="warning">{{ t('advanced.tag.warning') }}</el-tag>
            <el-tag type="danger">{{ t('advanced.tag.danger') }}</el-tag>
            <el-divider />
            <h4 class="block-title">{{ t('advanced.badge.title') }}</h4>
            <el-badge :value="8" :max="9" class="badge-item">{{ t('advanced.badge.unread') }}</el-badge>
            <el-badge :value="120" class="badge-item">{{ t('advanced.badge.new') }}</el-badge>
          </el-card>
        </el-col>
        <el-col :span="8">
          <el-card shadow="never" class="block">
            <template #header>{{ t('advanced.radio.title') }}</template>
            <el-radio-group v-model="radioValue">
              <el-radio value="a">{{ t('advanced.radio.optionA') }}</el-radio>
              <el-radio value="b">{{ t('advanced.radio.optionB') }}</el-radio>
            </el-radio-group>
            <el-divider />
            <h4 class="block-title">{{ t('advanced.checkbox.title') }}</h4>
            <el-checkbox-group v-model="checkboxValue">
              <el-checkbox value="1">{{ t('advanced.checkbox.option1') }}</el-checkbox>
              <el-checkbox value="2">{{ t('advanced.checkbox.option2') }}</el-checkbox>
              <el-checkbox value="3">{{ t('advanced.checkbox.option3') }}</el-checkbox>
            </el-checkbox-group>
            <el-divider />
            <h4 class="block-title">{{ t('advanced.switch.title') }}</h4>
            <el-switch v-model="featureEnabled" :active-text="t('advanced.switch.enableFeature')" />
            <el-divider />
            <h4 class="block-title">{{ t('advanced.segmented.title') }}</h4>
            <el-segmented v-model="segmentedValue" :options="[
              { label: t('advanced.segmented.day'), value: 'day' },
              { label: t('advanced.segmented.week'), value: 'week' },
              { label: t('advanced.segmented.month'), value: 'month' },
            ]" />
          </el-card>
        </el-col>
      </el-row>

      <el-drawer v-model="drawerVisible" :title="t('advanced.drawer.title')" size="380px">
        <p>{{ t('advanced.drawer.content') }}</p>
        <template #footer>
          <el-button @click="drawerVisible = false">{{ t('advanced.drawer.footer') }}</el-button>
        </template>
      </el-drawer>
    </el-card>
  </div>
</template>

<style scoped>
.advanced-page { display: flex; flex-direction: column; gap: 16px; }
.block { margin-bottom: 16px; }
.slider-row { display: flex; align-items: center; gap: 12px; }
.label { width: 60px; color: #374151; font-size: 13px; }
.muted { color: #6b7280; }
.small { font-size: 12px; }
.badge-item { margin-right: 16px; }
.block-title { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151; }
</style>
