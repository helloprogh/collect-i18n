<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage, ElNotification } from "element-plus";
import { Camera, Checked, Connection, DataAnalysis, Download, Files, Monitor, Refresh, UploadFilled, User } from "@element-plus/icons-vue";
import { api, type Evidence, type ImportReport, type SessionStatus, type Task } from "./api";

type Page = "overview" | "manual" | "evidence" | "excel";
const page = ref<Page>("overview");
const sessionId = ref("");
const status = ref<SessionStatus>();
const tasks = ref<Task[]>([]);
const evidence = ref<Evidence[]>([]);
const selectedTask = ref<Task>();
const selectedRoute = ref("");
const listeningKey = ref("");
const loading = ref(false);
const lastCaptured = ref(0);
const importFile = ref<File>();
const importReport = ref<ImportReport>();
const applying = ref(false);
const mockEnabled = ref(false);
const mocks = ref([{ id: "request-error", url: "**/api/**", method: "POST", status: 500, body: "" }]);
let timer: number | undefined;

const completion = computed(() => {
  const counts = status.value?.counts;
  return counts?.total ? Math.round((counts.captured / counts.total) * 100) : 0;
});
const remaining = computed(() => Math.max(0, (status.value?.counts.total ?? 0) - (status.value?.counts.captured ?? 0)));
const manualQueue = computed(() => tasks.value.filter((task) => ["needs_manual", "needs_agent", "failed"].includes(task.status)));

async function refresh(silent = false) {
  if (!sessionId.value) return;
  if (!silent) loading.value = true;
  try {
    const [nextStatus, nextTasks, nextEvidence] = await Promise.all([
      api.status(sessionId.value),
      api.tasks(sessionId.value, ["pending", "running", "needs_agent", "needs_manual", "failed", "captured"]),
      api.evidence(sessionId.value),
    ]);
    status.value = nextStatus;
    tasks.value = nextTasks;
    evidence.value = nextEvidence;
    if (lastCaptured.value && nextStatus.counts.captured > lastCaptured.value) {
      ElNotification({ title: "已捕获目标词条", message: "系统已自动标记并保存截图。", type: "success" });
      if (selectedTask.value?.status !== "captured") selectedTask.value = nextTasks.find((task) => task.id === selectedTask.value?.id);
    }
    lastCaptured.value = nextStatus.counts.captured;
    if (!selectedTask.value && manualQueue.value.length) chooseTask(manualQueue.value[0]!);
  } catch (error) {
    if (!silent) ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally { loading.value = false; }
}

function chooseTask(task: Task) {
  selectedTask.value = task;
  selectedRoute.value = task.routeHints.find((hint) => hint.path)?.path ?? "";
}

async function startListening() {
  if (!selectedTask.value) return;
  loading.value = true;
  try {
    const parsedMocks = mockEnabled.value ? mocks.value.map((rule) => ({ ...rule, body: rule.body.trim() ? JSON.parse(rule.body) : {} })) : [];
    await api.manualOpen({ sessionId: sessionId.value, keyPath: selectedTask.value.keyPath, route: selectedRoute.value || undefined, mocks: parsedMocks });
    listeningKey.value = selectedTask.value.keyPath;
    ElMessage.success("监听已开始，请在打开的项目页面中完成操作");
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : String(error)); }
  finally { loading.value = false; }
}

function pickFile(event: Event) {
  importFile.value = (event.target as HTMLInputElement).files?.[0];
  importReport.value = undefined;
}

async function runImport(apply: boolean) {
  if (!importFile.value) return ElMessage.warning("请先选择回稿 Excel");
  applying.value = true;
  try {
    importReport.value = await api.importWorkbook(sessionId.value, importFile.value, apply);
    if (apply && importReport.value.applied) ElMessage.success(`已写入 ${importReport.value.writtenFiles.length} 个语言包文件`);
    else if (importReport.value.canApply) ElMessage.success("校验通过，可以安全写入英文语言包");
    else ElMessage.error("校验未通过，请先处理下方问题");
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : String(error)); }
  finally { applying.value = false; }
}

function downloadWorkbook() {
  window.location.href = `/api/export-file?session=${encodeURIComponent(sessionId.value)}`;
}

watch(page, () => void refresh(true));
onMounted(async () => {
  try { sessionId.value = (await api.health()).sessionId; await refresh(); timer = window.setInterval(() => void refresh(true), 3000); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : String(error)); }
});
onBeforeUnmount(() => timer && clearInterval(timer));
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark"><Connection /></span><div><strong>Collect I18n</strong><small>翻译截图工作台</small></div></div>
      <nav>
        <button :class="{ active: page === 'overview' }" @click="page = 'overview'"><DataAnalysis />任务总览</button>
        <button :class="{ active: page === 'manual' }" @click="page = 'manual'"><User />人工兜底<span v-if="manualQueue.length" class="badge">{{ manualQueue.length }}</span></button>
        <button :class="{ active: page === 'evidence' }" @click="page = 'evidence'"><Camera />截图证据</button>
        <button :class="{ active: page === 'excel' }" @click="page = 'excel'"><Files />Excel 交付</button>
      </nav>
      <div class="sidebar-foot"><span class="live-dot" />本地服务运行中<small>{{ sessionId.slice(0, 22) }}</small></div>
    </aside>

    <main class="content" v-loading="loading">
      <header class="topbar"><div><p class="eyebrow">{{ status?.project_root || '正在连接项目' }}</p><h1>{{ page === 'overview' ? '任务总览' : page === 'manual' ? '人工兜底' : page === 'evidence' ? '截图证据' : 'Excel 交付' }}</h1></div><el-button :icon="Refresh" @click="refresh()">刷新</el-button></header>

      <template v-if="page === 'overview'">
        <section class="hero-card">
          <div><span class="section-kicker">采集进度</span><h2>已完成 {{ status?.counts.captured ?? 0 }} / {{ status?.counts.total ?? 0 }} 个词条</h2><p>静态分析先覆盖直接可达词条，Agent 处理复杂动作，最后只把无法自动完成的任务交给你。</p></div>
          <div class="progress-ring" :style="{ '--progress': `${completion * 3.6}deg` }"><strong>{{ completion }}%</strong><span>已留证</span></div>
        </section>
        <section class="metric-grid">
          <article><span class="metric-icon blue"><Files /></span><div><small>词条总数</small><strong>{{ status?.counts.total ?? 0 }}</strong></div></article>
          <article><span class="metric-icon green"><Checked /></span><div><small>已生成截图</small><strong>{{ status?.counts.captured ?? 0 }}</strong></div></article>
          <article><span class="metric-icon amber"><Connection /></span><div><small>等待 Agent</small><strong>{{ status?.counts.needs_agent ?? 0 }}</strong></div></article>
          <article><span class="metric-icon violet"><User /></span><div><small>需要人工</small><strong>{{ status?.counts.needs_manual ?? 0 }}</strong></div></article>
        </section>
        <section class="panel pipeline"><div class="panel-title"><div><span class="section-kicker">三级处理流水线</span><h3>剩余 {{ remaining }} 个词条</h3></div></div>
          <div class="pipeline-row"><span class="stage done"><Monitor /></span><div><strong>确定性采集</strong><small>源码、路由与运行时身份直接验证</small></div><em>{{ status?.counts.pending ?? 0 }} 处理中</em></div>
          <div class="pipeline-row"><span class="stage agent"><Connection /></span><div><strong>Agent 触发计划</strong><small>只生成受限动作，不以模型判断代替证据</small></div><em>{{ status?.counts.needs_agent ?? 0 }} 待处理</em></div>
          <div class="pipeline-row"><span class="stage human"><User /></span><div><strong>人工兜底</strong><small>工具提示路径并监听 key，出现后自动截图</small></div><em>{{ status?.counts.needs_manual ?? 0 }} 待处理</em></div>
        </section>
      </template>

      <template v-else-if="page === 'manual'">
        <div class="split-layout">
          <section class="panel queue"><div class="panel-title"><div><span class="section-kicker">待处理队列</span><h3>{{ manualQueue.length }} 个词条</h3></div></div>
            <button v-for="task in manualQueue" :key="task.id" class="queue-item" :class="{ selected: selectedTask?.id === task.id }" @click="chooseTask(task)"><strong>{{ task.chinese }}</strong><code>{{ task.keyPath }}</code><span>{{ task.status === 'needs_manual' ? '人工' : task.status === 'failed' ? '失败' : 'Agent' }}</span></button>
            <el-empty v-if="!manualQueue.length" description="所有词条都已处理" />
          </section>
          <section v-if="selectedTask" class="panel task-detail">
            <div class="target-head"><div><span class="section-kicker">目标词条</span><h2>{{ selectedTask.chinese }}</h2><code>{{ selectedTask.keyPath }}</code></div><span class="listen-chip" :class="{ on: listeningKey === selectedTask.keyPath }"><i />{{ listeningKey === selectedTask.keyPath ? '正在监听' : '尚未监听' }}</span></div>
            <div class="info-grid"><label>源码文件<strong>{{ selectedTask.relativeFile }}</strong></label><label>已尝试次数<strong>{{ selectedTask.attempts }}</strong></label></div>
            <div class="field"><label>建议路由</label><el-input v-model="selectedRoute" placeholder="例如 /users/create" /></div>
            <div class="hints"><h4>操作提示</h4><p v-if="!selectedTask.actionHints.length">源码中没有可靠动作提示，请在项目页面中按正常业务流程操作。</p><ol v-else><li v-for="(hint, index) in selectedTask.actionHints" :key="index"><strong>{{ hint.kind }}</strong> {{ hint.label || hint.selector || '按界面提示操作' }}</li></ol></div>
            <div class="mock-box"><div class="mock-title"><div><h4>请求 Mock</h4><p>只在需要制造接口成功或失败状态时开启。</p></div><el-switch v-model="mockEnabled" /></div>
              <template v-if="mockEnabled"><div v-for="(rule, index) in mocks" :key="rule.id" class="mock-rule"><el-input v-model="rule.url" placeholder="**/api/users" /><el-select v-model="rule.method"><el-option v-for="method in ['GET','POST','PUT','DELETE']" :key="method" :label="method" :value="method" /></el-select><el-input-number v-model="rule.status" :min="100" :max="599" /><el-input v-model="rule.body" type="textarea" :rows="3" /></div></template>
            </div>
            <el-alert v-if="selectedTask.lastError" :title="selectedTask.lastError" type="warning" :closable="false" show-icon />
            <div class="action-bar"><el-button type="primary" size="large" :icon="Monitor" @click="startListening">打开项目并监听该 Key</el-button><p>目标出现后会自动标框、截图并提示你，无需手动截屏。</p></div>
          </section>
          <section v-else class="panel empty-detail"><el-empty description="请选择一个待处理词条" /></section>
        </div>
      </template>

      <template v-else-if="page === 'evidence'">
        <section class="evidence-grid"><article v-for="item in evidence" :key="item.id" class="evidence-card"><img :src="`/api/artifact?id=${encodeURIComponent(item.id)}`" :alt="item.key_path" /><div><strong>{{ item.key_path }}</strong><p>{{ item.route }}</p><span>{{ item.source }} · {{ new Date(item.captured_at).toLocaleString() }}</span></div></article></section>
        <el-empty v-if="!evidence.length" description="尚未生成截图证据" />
      </template>

      <template v-else>
        <section class="excel-grid">
          <article class="panel delivery-card"><span class="big-icon"><Download /></span><h2>导出翻译任务</h2><p>生成干净的 Excel，只有“中文、英文、截图、Key Path”四列。英文默认复制中文。</p><ul><li>共 {{ status?.counts.total ?? 0 }} 个词条</li><li>已嵌入 {{ status?.screenshotCount ?? 0 }} 份截图证据</li><li>不包含状态列或隐藏工作表</li></ul><el-button type="primary" size="large" :icon="Download" @click="downloadWorkbook">下载四列 Excel</el-button></article>
          <article class="panel delivery-card"><span class="big-icon green"><UploadFilled /></span><h2>导入翻译回稿</h2><p>先校验 Key Path、重复项与中文修改。只有英文与中文不同时才写入 en-us。</p><label class="file-drop"><UploadFilled /><strong>{{ importFile?.name || '选择 .xlsx 回稿' }}</strong><span>文件只在本机服务中处理</span><input type="file" accept=".xlsx" @change="pickFile" /></label><div class="button-row"><el-button :loading="applying" @click="runImport(false)">仅校验</el-button><el-button type="primary" :disabled="!importReport?.canApply" :loading="applying" @click="runImport(true)">写入英文语言包</el-button></div></article>
        </section>
        <section v-if="importReport" class="panel import-report"><div class="panel-title"><div><span class="section-kicker">回稿检查结果</span><h3>{{ importReport.canApply ? '可以安全导入' : '需要先修正问题' }}</h3></div><el-tag :type="importReport.canApply ? 'success' : 'danger'">{{ importReport.translatedRows }} 条新翻译</el-tag></div><div class="report-metrics"><span>总行数<strong>{{ importReport.totalRows }}</strong></span><span>未翻译<strong>{{ importReport.unchangedRows }}</strong></span><span>问题<strong>{{ importReport.issues.length }}</strong></span></div><el-table v-if="importReport.issues.length" :data="importReport.issues"><el-table-column prop="row" label="行" width="80" /><el-table-column prop="keyPath" label="Key Path" min-width="240" /><el-table-column prop="message" label="问题" min-width="360" /><el-table-column label="影响" width="110"><template #default="scope"><el-tag :type="scope.row.fatal ? 'danger' : 'warning'">{{ scope.row.fatal ? '阻止导入' : '提醒' }}</el-tag></template></el-table-column></el-table></section>
      </template>
    </main>
  </div>
</template>
