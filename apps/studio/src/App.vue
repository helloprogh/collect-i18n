<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage, ElNotification } from "element-plus";
import { Camera, Checked, Connection, DataAnalysis, Download, Files, Monitor, Refresh, UploadFilled, User } from "@element-plus/icons-vue";
import { api, type Evidence, type ImportReport, type SessionEvent, type SessionStatus, type Task } from "./api";

type Page = "overview" | "agent" | "manual" | "evidence" | "excel";
const page = ref<Page>("overview");
const sessionId = ref("");
const status = ref<SessionStatus>();
const tasks = ref<Task[]>([]);
const evidence = ref<Evidence[]>([]);
const events = ref<SessionEvent[]>([]);
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
const manualQueue = computed(() => tasks.value.filter((task) => ["needs_manual", "failed"].includes(task.status)));
const agentTasks = computed(() => tasks.value.filter((task) => task.status === "needs_agent" || task.stage === "agent" || task.plan));
const currentAgentTask = computed(() => agentTasks.value.find((task) => task.status === "running"));
const nextAgentTask = computed(() => tasks.value.find((task) => task.status === "needs_agent"));
const plannedAgentTask = computed(() => {
  const preferred = [currentAgentTask.value, nextAgentTask.value];
  return preferred.find((task) => task?.plan) ?? [...agentTasks.value].reverse().find((task) => task.plan);
});
const triggerPlanJson = computed(() => plannedAgentTask.value?.plan ? JSON.stringify(plannedAgentTask.value.plan, null, 2) : "");
const evidenceSources = computed(() => {
  const result = new Map<string, string>();
  // Evidence is returned newest first. Preserve the latest source for each task.
  for (const item of evidence.value) if (!result.has(item.task_id)) result.set(item.task_id, item.source);
  return result;
});
const agentEvents = computed(() => events.value
  .filter((event) => {
    if (event.origin) return event.origin === "agent";
    if (event.type.startsWith("agent.")) return true;
    if (event.type !== "task.captured" || typeof event.data.taskId !== "string") return false;
    return evidenceSources.value.get(event.data.taskId) === "agent";
  })
  .sort((left, right) => right.id - left.id)
  .slice(0, 20));
const hasAgentConsumption = computed(() => events.value.some((event) => event.origin === "agent" || event.type.startsWith("agent.")));
const agentAttemptCount = computed(() => agentTasks.value.reduce((total, task) => total + task.attempts, 0));

function suggestedRoute(task?: Task) {
  return task?.routeHints.find((hint) => hint.path)?.path ?? "暂无可靠路由建议";
}

function eventTitle(type: string) {
  const labels: Record<string, string> = {
    "agent.plan_saved": "Agent Skill 已保存 TriggerPlan",
    "agent.plan_submitted": "TriggerPlan 已提交执行",
    "task.running": "任务开始执行",
    "task.captured": "截图证据已保存",
    "task.needs_agent": "任务退回 Agent 队列",
    "task.needs_manual": "任务转入人工兜底",
    "task.failed": "任务执行失败",
  };
  return labels[type] ?? type;
}

async function refresh(silent = false) {
  if (!sessionId.value) return;
  if (!silent) loading.value = true;
  try {
    const eventCursor = events.value.at(-1)?.id ?? 0;
    const [nextStatus, nextTasks, nextEvidence, nextEvents] = await Promise.all([
      api.status(sessionId.value),
      api.tasks(sessionId.value),
      api.evidence(sessionId.value),
      api.events(sessionId.value, eventCursor),
    ]);
    if (nextTasks.length !== nextStatus.counts.total) {
      throw new Error(`任务列表不完整：服务端报告 ${nextStatus.counts.total} 个，工作台只收到 ${nextTasks.length} 个`);
    }
    status.value = nextStatus;
    tasks.value = nextTasks;
    evidence.value = nextEvidence;
    if (nextEvents.length) {
      const merged = new Map(events.value.map((event) => [event.id, event]));
      for (const event of nextEvents) merged.set(event.id, event);
      events.value = [...merged.values()].sort((left, right) => left.id - right.id);
    }
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
        <button :class="{ active: page === 'agent' }" @click="page = 'agent'"><Connection />Agent 处理<span v-if="status?.counts.needs_agent" class="badge agent-badge">{{ status.counts.needs_agent }}</span></button>
        <button :class="{ active: page === 'manual' }" @click="page = 'manual'"><User />人工兜底<span v-if="manualQueue.length" class="badge">{{ manualQueue.length }}</span></button>
        <button :class="{ active: page === 'evidence' }" @click="page = 'evidence'"><Camera />截图证据</button>
        <button :class="{ active: page === 'excel' }" @click="page = 'excel'"><Files />Excel 交付</button>
      </nav>
      <div class="sidebar-foot"><span class="live-dot" />本地服务运行中<small>{{ sessionId.slice(0, 22) }}</small></div>
    </aside>

    <main class="content" v-loading="loading">
      <header class="topbar"><div><p class="eyebrow">{{ status?.project_root || '正在连接项目' }}</p><h1>{{ page === 'overview' ? '任务总览' : page === 'agent' ? 'Agent 处理' : page === 'manual' ? '人工兜底' : page === 'evidence' ? '截图证据' : 'Excel 交付' }}</h1></div><el-button :icon="Refresh" @click="refresh()">刷新</el-button></header>

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

      <template v-else-if="page === 'agent'">
        <section class="agent-hero">
          <div>
            <span class="section-kicker">真实采集进度</span>
            <h2>{{ status?.counts.captured ?? 0 }} / {{ status?.counts.total ?? 0 }} 个词条已有截图证据</h2>
            <p>Studio 只展示任务、TriggerPlan 和服务事件；Agent Skill 在外部通过命令行领取并执行任务。</p>
          </div>
          <div class="agent-progress">
            <div class="agent-progress-track"><i :style="{ width: `${completion}%` }" /></div>
            <strong>{{ completion }}%</strong>
          </div>
          <div class="agent-stats">
            <span><small>等待 Agent</small><strong>{{ status?.counts.needs_agent ?? 0 }}</strong></span>
            <span><small>累计尝试</small><strong>{{ agentAttemptCount }}</strong></span>
            <span><small>转人工兜底</small><strong>{{ status?.counts.needs_manual ?? 0 }}</strong></span>
          </div>
        </section>

        <el-alert
          v-if="!hasAgentConsumption"
          class="agent-notice"
          title="尚未发现 Agent Skill 消费记录"
          description="当前外部 Skill 还没有保存或提交 TriggerPlan。工作台不会假装 Agent 正在自动运行；请由 Agent 使用软件命令行领取下一任务。"
          type="info"
          :closable="false"
          show-icon
        />

        <section class="agent-task-grid">
          <article class="panel agent-task-card">
            <div class="panel-title">
              <div><span class="section-kicker">当前 Agent 任务</span><h3>正在执行</h3></div>
              <el-tag v-if="currentAgentTask" type="primary" effect="light">运行中</el-tag>
            </div>
            <template v-if="currentAgentTask">
              <div class="agent-target"><strong>{{ currentAgentTask.chinese }}</strong><code>{{ currentAgentTask.keyPath }}</code></div>
              <dl class="agent-task-meta">
                <div><dt>源码</dt><dd>{{ currentAgentTask.relativeFile }}</dd></div>
                <div><dt>建议路由</dt><dd>{{ suggestedRoute(currentAgentTask) }}</dd></div>
                <div><dt>尝试次数</dt><dd>{{ currentAgentTask.attempts }}</dd></div>
              </dl>
              <el-alert v-if="currentAgentTask.lastError" :title="currentAgentTask.lastError" type="warning" :closable="false" show-icon />
            </template>
            <div v-else class="agent-empty-state"><Connection /><strong>当前没有 Agent 任务在执行</strong><p>这表示服务中不存在状态为 running 的 Agent 任务，不代表外部 Skill 正在后台工作。</p></div>
          </article>

          <article class="panel agent-task-card">
            <div class="panel-title">
              <div><span class="section-kicker">下一 Agent 任务</span><h3>等待 Skill 消费</h3></div>
              <el-tag v-if="nextAgentTask" type="warning" effect="light">待领取</el-tag>
            </div>
            <template v-if="nextAgentTask">
              <div class="agent-target"><strong>{{ nextAgentTask.chinese }}</strong><code>{{ nextAgentTask.keyPath }}</code></div>
              <dl class="agent-task-meta">
                <div><dt>源码</dt><dd>{{ nextAgentTask.relativeFile }}</dd></div>
                <div><dt>建议路由</dt><dd>{{ suggestedRoute(nextAgentTask) }}</dd></div>
                <div><dt>尝试次数</dt><dd>{{ nextAgentTask.attempts }}</dd></div>
              </dl>
              <el-alert v-if="nextAgentTask.lastError" :title="nextAgentTask.lastError" type="warning" :closable="false" show-icon />
            </template>
            <div v-else class="agent-empty-state"><Checked /><strong>没有等待 Agent 的任务</strong><p>任务可能已经生成证据，或已进入人工兜底队列。</p></div>
          </article>
        </section>

        <section class="agent-lower-grid">
          <article class="panel plan-panel">
            <div class="panel-title">
              <div><span class="section-kicker">受限执行协议</span><h3>已保存 TriggerPlan JSON</h3></div>
              <code v-if="plannedAgentTask">{{ plannedAgentTask.keyPath }}</code>
            </div>
            <pre v-if="triggerPlanJson"><code>{{ triggerPlanJson }}</code></pre>
            <div v-else class="agent-empty-state compact"><Files /><strong>尚未保存 TriggerPlan</strong><p>外部 Agent Skill 生成并通过 CLI 提交后，原始 JSON 会显示在这里。</p></div>
          </article>

          <article class="panel timeline-panel">
            <div class="panel-title">
              <div><span class="section-kicker">服务端真实记录</span><h3>最近 Agent 事件</h3></div>
              <span class="event-count">{{ agentEvents.length }} 条</span>
            </div>
            <ol v-if="agentEvents.length" class="event-timeline">
              <li v-for="event in agentEvents" :key="event.id">
                <i :class="{ success: event.type === 'task.captured', warning: event.type === 'task.needs_manual' || event.type === 'task.failed' }" />
                <div><strong>{{ eventTitle(event.type) }}</strong><code v-if="event.data.keyPath">{{ event.data.keyPath }}</code><p v-if="event.data.error">{{ event.data.error }}</p></div>
                <time>{{ new Date(event.created_at).toLocaleString() }}</time>
              </li>
            </ol>
            <div v-else class="agent-empty-state compact"><Connection /><strong>还没有 Agent 相关事件</strong><p>等待外部 Skill 首次保存 TriggerPlan 后，此处会按服务端时间显示处理轨迹。</p></div>
          </article>
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
          <article class="panel delivery-card"><span class="big-icon"><Download /></span><h2>导出翻译任务</h2><p>生成干净的 Excel，只有“中文、英文、截图、Key Path”四列。英文默认复制中文；尚未采集的词条保留空截图单元格。</p><ul><li>共 {{ status?.counts.total ?? 0 }} 个词条</li><li>已嵌入 {{ status?.uniqueScreenshotCount ?? status?.counts.captured ?? 0 }} 个词条的截图</li><li v-if="status?.duplicateEvidenceCount">已保留 {{ status.duplicateEvidenceCount }} 份历史替换证据，不重复写入 Excel</li><li>不包含状态列或隐藏工作表</li></ul><el-button type="primary" size="large" :icon="Download" @click="downloadWorkbook">下载四列 Excel</el-button></article>
          <article class="panel delivery-card"><span class="big-icon green"><UploadFilled /></span><h2>导入翻译回稿</h2><p>先校验 Key Path、重复项与中文修改。只有英文与中文不同时才写入 en-us。</p><label class="file-drop"><UploadFilled /><strong>{{ importFile?.name || '选择 .xlsx 回稿' }}</strong><span>文件只在本机服务中处理</span><input type="file" accept=".xlsx" @change="pickFile" /></label><div class="button-row"><el-button :loading="applying" @click="runImport(false)">仅校验</el-button><el-button type="primary" :disabled="!importReport?.canApply" :loading="applying" @click="runImport(true)">写入英文语言包</el-button></div></article>
        </section>
        <section v-if="importReport" class="panel import-report"><div class="panel-title"><div><span class="section-kicker">回稿检查结果</span><h3>{{ importReport.canApply ? '可以安全导入' : '需要先修正问题' }}</h3></div><el-tag :type="importReport.canApply ? 'success' : 'danger'">{{ importReport.translatedRows }} 条新翻译</el-tag></div><div class="report-metrics"><span>总行数<strong>{{ importReport.totalRows }}</strong></span><span>未翻译<strong>{{ importReport.unchangedRows }}</strong></span><span>问题<strong>{{ importReport.issues.length }}</strong></span></div><el-table v-if="importReport.issues.length" :data="importReport.issues"><el-table-column prop="row" label="行" width="80" /><el-table-column prop="keyPath" label="Key Path" min-width="240" /><el-table-column prop="message" label="问题" min-width="360" /><el-table-column label="影响" width="110"><template #default="scope"><el-tag :type="scope.row.fatal ? 'danger' : 'warning'">{{ scope.row.fatal ? '阻止导入' : '提醒' }}</el-tag></template></el-table-column></el-table></section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.badge.agent-badge{background:#2563eb}.agent-hero{display:grid;grid-template-columns:minmax(0,1fr) 200px auto;align-items:center;gap:28px;background:linear-gradient(118deg,#14213d,#1d3557 58%,#274c77);border-radius:18px;padding:28px 32px;color:#fff;box-shadow:0 16px 40px #1d35572b}.agent-hero .section-kicker{color:#a9c9ef}.agent-hero h2{margin:7px 0;font-size:25px}.agent-hero p{margin:0;color:#cbdcf1;line-height:1.65;font-size:13px}.agent-progress{display:grid;grid-template-columns:1fr 46px;align-items:center;gap:10px}.agent-progress-track{height:9px;background:#ffffff25;border-radius:20px;overflow:hidden}.agent-progress-track i{display:block;height:100%;background:linear-gradient(90deg,#60a5fa,#5eead4);border-radius:inherit;transition:width .3s}.agent-progress strong{font-size:14px}.agent-stats{display:flex;gap:9px}.agent-stats span{min-width:84px;padding:10px 12px;background:#ffffff12;border:1px solid #ffffff18;border-radius:10px;display:flex;flex-direction:column}.agent-stats small{color:#bcd0e8;font-size:11px}.agent-stats strong{font-size:20px;margin-top:3px}.agent-notice{margin:18px 0}.agent-task-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:18px 0}.agent-task-card{min-height:306px}.agent-target{display:flex;flex-direction:column;gap:7px;padding:15px 16px;background:#f4f7fb;border-radius:11px;border-left:4px solid #3b82f6}.agent-target strong{font-size:20px;color:#172033}.agent-target code{color:#475467;font-size:12px;overflow-wrap:anywhere}.agent-task-meta{margin:17px 0;display:grid;grid-template-columns:1.5fr 1fr 90px;gap:9px}.agent-task-meta div{background:#f8fafc;border-radius:9px;padding:11px 12px;min-width:0}.agent-task-meta dt{color:#667085;font-size:11px;margin-bottom:5px}.agent-task-meta dd{margin:0;color:#344054;font-weight:600;font-size:12px;overflow-wrap:anywhere}.agent-empty-state{height:205px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#667085}.agent-empty-state svg{width:32px;color:#98a2b3;margin-bottom:9px}.agent-empty-state strong{color:#475467}.agent-empty-state p{font-size:12px;line-height:1.6;max-width:390px;margin:7px 0 0}.agent-empty-state.compact{height:230px}.agent-lower-grid{display:grid;grid-template-columns:minmax(0,1.06fr) minmax(0,.94fr);gap:18px}.plan-panel .panel-title code{max-width:290px;overflow:hidden;text-overflow:ellipsis;color:#667085;font-size:11px}.plan-panel pre{height:340px;overflow:auto;margin:0;background:#101828;color:#d1e9ff;border-radius:11px;padding:18px;font-size:12px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}.event-count{font-size:12px;color:#667085;background:#f2f4f7;border-radius:15px;padding:5px 10px}.event-timeline{list-style:none;padding:0;margin:0;max-height:340px;overflow:auto}.event-timeline li{position:relative;display:grid;grid-template-columns:14px minmax(0,1fr) auto;gap:11px;padding:2px 0 18px}.event-timeline li:not(:last-child):before{content:"";position:absolute;left:5px;top:13px;bottom:0;width:1px;background:#dbe3ed}.event-timeline li>i{width:11px;height:11px;margin-top:4px;border-radius:50%;background:#3b82f6;box-shadow:0 0 0 4px #3b82f61a;z-index:1}.event-timeline li>i.success{background:#12b76a;box-shadow:0 0 0 4px #12b76a1c}.event-timeline li>i.warning{background:#f79009;box-shadow:0 0 0 4px #f790091c}.event-timeline li div{display:flex;flex-direction:column;gap:4px;min-width:0}.event-timeline strong{font-size:13px;color:#344054}.event-timeline code{font-size:11px;color:#667085;overflow:hidden;text-overflow:ellipsis}.event-timeline p{margin:0;color:#b42318;font-size:11px;line-height:1.5}.event-timeline time{font-size:10px;color:#98a2b3;white-space:nowrap;margin-top:3px}@media(max-width:1280px){.agent-hero{grid-template-columns:minmax(0,1fr) 180px}.agent-stats{grid-column:1/-1}.agent-task-meta{grid-template-columns:1fr 1fr}.agent-task-meta div:last-child{grid-column:1/-1}}
</style>
