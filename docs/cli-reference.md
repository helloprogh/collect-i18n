# CLI 参考

## 调用约定

正常使用构建后的入口：

```text
node <collect-i18n-repo>/packages/cli/dist/bin.js \
  --project <absolute-project-root> \
  --json \
  --non-interactive \
  <command>
```

所有自动化与 Skill 调用都应使用绝对项目路径、`--json` 和 `--non-interactive`。成功结果写到 stdout，退出码为 0：

```json
{
  "ok": true,
  "command": "status",
  "timestamp": "2026-07-19T00:00:00.000Z",
  "data": {},
  "warnings": []
}
```

失败结果写到 stderr，退出码非 0：

```json
{
  "ok": false,
  "command": "status",
  "timestamp": "2026-07-19T00:00:00.000Z",
  "error": {
    "code": "command_failed",
    "message": "具体错误",
    "retryable": false
  },
  "warnings": []
}
```

调用方必须同时检查退出码与 `ok`，不能从控制台文案猜测成功。

## 项目与会话命令

### `doctor`

只读检查 `package.json`、Vite 配置、`src`、Node 版本和已声明依赖。`vue-i18n` 与 `element-plus` 缺失会提示，但 Vue、Vite、Node 或项目结构不满足时 `ready` 为 false。

```text
collect-i18n doctor
```

### `init`

创建或覆盖 `.collect-i18n/config.json`，扫描语言包与源码，并同步本地索引。返回项目 ID、词条数、occurrence、路由/动作提示、未使用/未知 key 与诊断。

```text
collect-i18n init
```

已有自定义配置时使用 `scan`，不要再次 `init`。

### `scan`

读取现有配置，重新扫描并刷新索引：

```text
collect-i18n scan
```

扫描刷新项目目录，但不会替正在运行的会话创建新任务；需要完整反映新增词条时，停止旧服务并启动新会话。

### `run`

Skill 的默认入口：

```text
collect-i18n run --output <absolute-xlsx-path> --deadline-minutes 120
```

命令自动检查环境，在缺少配置时初始化，否则刷新索引；随后启动或复用采集服务、等待确定性队列结束并导出首版四列 Excel。非 JSON 模式会在等待期间持续向标准错误输出自动处理进度，包括当前 Key、已处理数、可信截图数、转交数和失败数；JSON 标准输出仍保持单一稳定结果。最终返回 `sessionId`、`studioUrl`、`appUrl`、`deadlineAt`、`nextAction`、状态和工作簿结果。人工项不会阻止导出，未取证词条的截图单元格保持为空。

`nextAction=deterministic_continue` 表示确定性窗口提前结束但会话仍在运行，应继续轮询同一会话 `status` 直至 `pending`/`running` 归零，随后 `export` 刷新工作簿；`--deterministic-timeout-minutes` 默认按词条数自适应 `max(15, ceil(total/60))`。

确定性队列会直接接受 A 级 Host DOM 证据。可靠路由上的 B 级 Vue 组件证据会先在隔离页面执行一次无副作用 Canary；只有目标 occurrence 随 Canary 精确变化后才提升为 A 级并截图。Canary 失败只会把任务转交 Agent，不会使用相似文本生成证据。

确定性阶段还包含两条有界的内容展开通路：R3 滚屏（窗口与页面内滚动容器步进，至多 12 步并带稳定性早退）与 R7 控件扫描（只点击 Element Plus 树展开图标与分页「下一页」按钮等纯客户端控件，每轮至多 6 次点击、每路由至多 8 轮，不触碰任何表单或动作按钮）。两者都只让更多译文挂载到 DOM，再交由同一批采通路截图。

### `start`

```text
collect-i18n start --background
collect-i18n start --foreground
collect-i18n start --session <session-id> --background
```

后台是默认模式，要求 CLI 已构建。命令启动或复用：

- 仅监听回环地址的本地工作台/API；
- 加载目标项目配置并追加采集插件的 Vite 服务；
- 使用独立 profile 的 Chrome；
- 当前会话的确定性采集队列。

返回 `sessionId`、`serviceUrl`、`studioUrl`、`appUrl`，复用时还返回 `reused: true`。`--session` 只恢复指定的 `stopped`/`interrupted` 会话，保留原任务 ID、计划和证据；被中断的确定性任务会重新进入 `pending`，被中断的 Agent 任务会按重试次数安全回到 Agent 或人工队列。不带 `--session` 的 `start` 会创建新会话，不能用于恢复。若另一个会话的服务仍在运行，命令拒绝切换。同一项目不要并行启动多个实例。

### `status`

```text
collect-i18n status --session <session-id>
```

省略 `--session` 时读取最新会话。`counts` 的字段是：

| 字段 | 含义 |
| --- | --- |
| `total` | 本会话总任务数 |
| `pending` | 等待确定性采集 |
| `running` | 正在执行 |
| `captured` | 已有运行时截图证据 |
| `needs_agent` | 等待 Skill/Agent 计划 |
| `needs_manual` | 等待人工兜底 |
| `failed` | 记录了终止错误 |
| `skipped` | 明确跳过 |
| `evidenceCount` | 已持久化的不同内容证据数 |
| `capturedKeyCount` | 已有截图的唯一 Key 数，工作台默认使用此值 |
| `historicalEvidenceCount` | 同一 Key 的不同界面状态历史数 |
| `duplicateHashCount` | 重复内容哈希数；正常情况下为 0 |
| `screenshotCount` / `uniqueScreenshotCount` / `duplicateEvidenceCount` | v0.3.x 兼容别名，分别对应上述证据数、唯一 Key 数和重复哈希数 |
| `coveragePercent` | 已截图词条占比 |
| `manualPercent` | 当前人工队列占比 |
| `exportReady` | 确定性队列是否已经结束，可以交付进度 Excel |

`automatic` 提供工作台和调用方使用的实时阶段数据：`phase`、`processed`、
`total`、`percent`、`captured`、`deferred`、`failed` 和 `currentKey`。

在 `pending` 与 `running` 都归零后再消费 Agent 队列。

### `stop`

```text
collect-i18n stop --session <session-id>
```

停止与指定 ID 匹配的目标项目当前服务并删除服务描述；若另一个会话已经接管服务则拒绝停止。省略 `--session` 只为兼容人工诊断场景，不建议 Agent 使用。命令不删除 SQLite、截图或浏览器 profile。

## Agent 命令

### `agent next`

```text
collect-i18n agent next --session <session-id>
```

返回下一个 `needs_agent` 任务以及当前状态。`done: true` 表示队列为空。任务只包含受限事实：Key Path、中文、语言文件、源码 occurrence、路由/动作提示、尝试次数、保存的计划和最后错误。

### `agent submit`

```text
collect-i18n agent submit \
  --session <session-id> \
  --task <task-id> \
  --plan-file <absolute-plan-json>
```

校验 TriggerPlan v1、任务归属和 `targetKey` 一致性，保存计划但不执行。计划应保存到目标项目 `.collect-i18n/plans/`，完整格式见 [TriggerPlan 规范](../skill/collect-i18n/references/trigger-plan.md)。

### `agent execute`

```text
collect-i18n agent execute --session <session-id> --task <task-id>
collect-i18n agent execute --session <session-id> --task <task-id> --plan-file <absolute-plan-json>
```

默认执行已提交的计划，也可临时提供计划文件。执行期间 CLI 独占项目浏览器。若目标会话的服务已停止且没有其他活动服务，命令会自动恢复同一会话；若另一个会话仍在运行则拒绝劫持。首次失败保留在 Agent 队列供一次基于证据的修正；再次失败进入人工队列。

### `finalize`

```text
collect-i18n finalize --session <session-id>
```

只能在 `pending` 与 `running` 都归零后执行。会话创建时会预分类可证明的死键和非可视词条；命令收拢仍为 `needs_agent` 的任务并复核同样的判定：

- 没有任何源码 occurrence 且项目不存在未解析动态调用的词条记为 `skipped`，原因是 `no_source_occurrence`；
- 项目存在未解析动态调用时，无 occurrence 词条进入 `needs_manual`，原因是 `unresolved_dynamic_source`；
- occurrence 全部是 `aria-*` 或原生元素 `title` 的非可视词条记为 `skipped`，原因是 `non_visual_source_only`；
- 其余词条进入 `needs_manual`，原因是 `assisted_manual_fallback`。

返回 `settled` 数量、三类 Key Path 清单和最新 `status`。该命令不创建截图，不把任务状态写入 Excel，也不会改变已经进入人工队列的任务。

## 人工兜底

```text
collect-i18n manual open --session <session-id>
collect-i18n manual open --session <session-id> --key <key-path> --route <path>
```

不指定 key 时，从人工、Agent 或失败队列取下一个任务。命令激活目标 key 的运行时监听并返回工作台、中文、源码、路由和动作提示；它不录制人工步骤，也不生成可复用“教习路径”。

人工可以在工作台为当前任务设置最小请求 Mock。Mock 只作用于采集器浏览器；目标 key 出现后自动高亮、截图和更新任务。

## Excel 命令

### `export`

```text
collect-i18n export --session <session-id> --output <absolute-xlsx-path>
```

导出一个可见工作表和严格四列：`中文`、`英文`、`截图`、`Key Path`。英文列逐行复制中文原文，不读取当前 `en-us` 作为初值。命令返回输出路径、行数和嵌入图片数。

finalize 判定为废弃的词条（无源码引用且无未决动态渲染，`no_source_occurrence`）在导出中集中排在列表末尾，其截图列填写「词条废弃」；非可视词条（全部 occurrence 为 `aria-*` 或原生元素 `title`，`non_visual_source_only`）保持原有排序，截图列填写「非可视」；死键（`needs_manual` 且无任何源码 occurrence，被未解析动态调用保护挡在 skipped 之外的键）排在正常词条之后、废弃词条之前，截图列填写「死键」；其余无截图词条保持原有排序与空截图列。

### `import`

```text
collect-i18n import --session <session-id> --file <absolute-xlsx-path> --dry-run
collect-i18n import --session <session-id> --file <absolute-xlsx-path> --apply
```

`--session` 可省略，此时使用最新会话。省略 `--apply` 与显式 `--dry-run` 都不会写文件。报告包括：

- `totalRows`、`translatedRows`、`unchangedRows`；
- 待应用 `changes`；
- 重复、未知、缺失、中文改动、非法目录等 `issues`；
- `canApply`、`applied` 与 `writtenFiles`。

只有英文非空且不等于中文的行会形成 change。存在 fatal issue 时不得应用。

## 配置

`init` 生成的 `.collect-i18n/config.json` 使用版本 1：

```json
{
  "version": 1,
  "projectRoot": "<absolute-project-root>",
  "stateDirectory": ".collect-i18n",
  "source": {
    "include": ["src/**/*.{vue,ts,tsx,js,jsx}"],
    "exclude": ["**/node_modules/**", "**/dist/**", "**/.git/**"],
    "translationCallees": ["translate", "i18nBridge.lookup"]
  },
  "locales": {
    "source": "zh-cn",
    "target": "en-us",
    "roots": ["src"]
  },
  "app": {
    "baseUrl": "http://127.0.0.1:5173",
    "devCommand": "pnpm dev",
    "workingDirectory": "<absolute-project-root>",
    "healthPath": "/"
  },
  "browser": {
    "headless": false,
    "viewport": { "width": 1440, "height": 900 },
    "locale": "zh-CN",
    "cookies": [
      { "name": "x-gde-locale", "value": "zh_CN" }
    ],
    "localeCookie": { "name": "x-gde-locale", "value": "zh_CN" },
    "timeoutMs": 15000,
    "loadingSelectors": [".custom-spinner"],
    "loadingCropMarginPx": 48,
    "loadingClearWaitMs": 5000
  },
  "instrumentation": {
    "enabled": true,
    "devOnly": true
  }
}
```

`source.translationCallees` 用于登记项目封装的翻译函数，按完整调用名精确匹配；内置的 `t`、`$t` 和常见 i18n 对象调用无需重复配置。未配置的普通业务函数不会被当作翻译调用。

当前服务以编程方式启动 Vite；`app.devCommand`、`app.workingDirectory` 和 `app.healthPath` 会保存用于项目描述，但不是当前启动器的执行入口。0.1.0 启动器实际消费 `app.baseUrl`、`browser.headless`、`browser.viewport`、`browser.locale`、`browser.cookies`、`browser.localeCookie` 与 `browser.timeoutMs`；`instrumentation.enabled` 必须为 `true`，否则运行时采集会拒绝启动。`instrumentation.devOnly` 当前仅作为版本化配置保留。修改 `baseUrl` 时必须使用回环地址和一个空闲端口。

`browser.cookies` 会在采集上下文创建后写入目标应用源，可用于设置语言选择等非敏感 Cookie。`browser.localeCookie` 是其中用于语言选择的单个 Cookie；采集器会在每次打开页面/导航前重新注入它，防止应用被持久化配置切走源语言。`localeCookie` 与 `cookies` 都要求值以明文保存在目标项目的 `.collect-i18n/config.json` 中；不要在这里保存生产会话或长期访问令牌，并确保整个 `.collect-i18n/` 已被目标项目忽略。

加载遮罩检测支持按项目定制：内置选择器覆盖 `.el-loading-mask`、`.el-loading-spinner`、`.el-skeleton`、`.el-skeleton__item`、`.el-icon.is-loading`、`.ant-spin-spinning`（Element Plus / Ant Design）、`.n-spin-body`（naive-ui）、`.arco-spin-mask`、`.arco-spin-loading`（Arco Design）、`#nprogress`（NProgress）与页面标记 `[data-collect-i18n-loading]`；`browser.loadingSelectors` 可在此基础上追加项目自定义 spinner 选择器。目标矩形按中心+四角共 5 点采样，任一点命中遮罩即视为阻塞（any-hit 规则）；`browser.loadingCropMarginPx` 控制整帧闸门未通过（页面其他区域仍有加载遮罩）时裁剪兜底截图向外扩展的像素（默认 48）；`browser.loadingClearWaitMs` 控制截图前等待覆盖遮罩清除的有界窗口（默认 5000ms，与改造前固定等待一致）。全部为可选字段，省略时使用上述默认值。
