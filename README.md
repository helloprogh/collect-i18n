# Collect I18n

Collect I18n 是一个本地优先的 Vue 国际化截图采集工具。它从真实的 `zh-cn` JSON 语言包和 Vue 源码建立任务清单，先自动采集可直接抵达的词条，再让 Agent 通过受限动作计划处理交互场景，最后把无法可靠自动化的少量任务交给人工兜底。

最终产物是一个干净的翻译工作簿：只有 `中文`、`英文`、`截图`、`Key Path` 四列。回稿以 `Key Path` 为唯一定位依据，校验通过后可写回 `en-us` JSON。

> 当前版本为 `0.1.0`，适用于本地可信的 Vue 3 + Vite 项目。工具不会为了提高覆盖率向目标项目添加测试页面、预期词条或强制显示代码。

## 它如何工作

```text
语言包/源码静态扫描
        ↓
按可靠路由批量执行并采集运行时证据
        ↓
Skill 驱动 Agent 为剩余词条生成 TriggerPlan
        ↓
人工在真实页面完成无法自动化的业务操作
        ↓
目标 key 出现后自动高亮、截图并记录证据
        ↓
导出四列 Excel → 翻译回稿 → 校验并写回 en-us
```

运行时不仅依赖 `data-i18n-key`。采集器统一登记原生 DOM、文本 Range、组件属性以及 Element Plus 命令式服务/Teleport 节点，因此表单校验、组件文案、`ElMessage` 一类短暂提示也能进入同一套证据流程。

## 环境要求

- Node.js `22.12` 或更高版本（SQLite 使用 Node 内置的 `node:sqlite`）。
- pnpm `11.9`。
- 本机安装 Google Chrome；采集器使用独立的持久化浏览器资料目录。
- 目标项目至少使用 Vue 3 和 Vite；Vue I18n、Element Plus 是推荐且已覆盖的集成。
- 目标项目的 Vite 端口应与 `.collect-i18n/config.json` 中的 `app.baseUrl` 一致，默认是 `http://127.0.0.1:5173`。

## 从源码安装

```bash
git clone https://github.com/helloprogh/collect-i18n.git
cd collect-i18n
pnpm install --frozen-lockfile
pnpm build
```

构建后的 CLI 位于 `packages/cli/dist/bin.js`。后台服务不能从 TypeScript 开发入口启动，因此正常使用请调用这个构建产物。例如在 PowerShell 中：

```powershell
$CLI = "D:/ProjectSpace/collect-i18n/packages/cli/dist/bin.js"
$PROJECT = "D:/ProjectSpace/your-vue-project"
node $CLI --project $PROJECT --json --non-interactive doctor
```

开发时可以使用 `pnpm cli --project <path> doctor`；如需启动服务，只能加 `start --foreground`。

## 目标项目约定

语言包按语言目录发现，目录名大小写不敏感，并兼容 `zh-cn` / `zh_CN` 与 `en-us` / `en_US`。推荐一个界面一个 JSON 文件：

```text
src/locales/
├─ zh-cn/
│  ├─ common.json
│  └─ users/form.json
└─ en-us/
   ├─ common.json
   └─ users/form.json
```

文件相对路径参与命名空间。例如 `zh-cn/users/form.json` 中的 `title` 对应运行时 `Key Path`：`users.form.title`。新增界面时直接新增同名 JSON 文件即可，`scan` 会重新发现它。

扫描器只接受 JSON 叶子字符串；无效 JSON、非字符串叶子、重复 Key Path、源码中未知 key 会作为诊断返回。动态拼接 key 不能保证被静态扫描识别。

## 最短使用流程

以下示例沿用上面的 `$CLI` 与 `$PROJECT`：

```powershell
# 1. 只读检查
node $CLI --project $PROJECT --json --non-interactive doctor

# 2. 首次初始化；创建配置并扫描真实语言包/源码
node $CLI --project $PROJECT --json --non-interactive init

# 3. 启动本地服务、带采集插件的 Vite，并按需启动 Chrome
node $CLI --project $PROJECT --json --non-interactive start --background

# 4. 使用 start 返回的 sessionId 查询进度
node $CLI --project $PROJECT --json --non-interactive status --session <session-id>

# 5. 导出翻译任务
node $CLI --project $PROJECT --json --non-interactive export `
  --session <session-id> --output "D:/output/translations.xlsx"

# 6. 回稿先校验，再由用户明确授权写入
node $CLI --project $PROJECT --json --non-interactive import `
  --session <session-id> --file "D:/output/translations-return.xlsx" --dry-run
node $CLI --project $PROJECT --json --non-interactive import `
  --session <session-id> --file "D:/output/translations-return.xlsx" --apply

# 7. 停止后台服务
node $CLI --project $PROJECT --json --non-interactive stop
```

`start` 返回的 `studioUrl` 是面向人工的本地工作台。工作台可查看进度与截图证据、为人工任务选择路由和请求 Mock、监听目标 key，以及下载/导入工作簿。

初始化后需要调整路径、端口或浏览器参数时，编辑目标项目的 `.collect-i18n/config.json`，然后运行 `scan`。不要重复运行 `init` 覆盖已有配置。

## Skill + CLI 工作流

`skill/collect-i18n` 是 Agent 的操作层，CLI 和本地服务才是执行与事实层。Agent 只读取 `agent next` 返回的源码证据并生成受限的 TriggerPlan；路由、点击、填写、等待和请求 Mock 都由 CLI 在同一个真实浏览器中执行。

```powershell
node $CLI --project $PROJECT --json --non-interactive agent next --session <session-id>
node $CLI --project $PROJECT --json --non-interactive agent submit `
  --session <session-id> --task <task-id> --plan-file "D:/absolute/plan.json"
node $CLI --project $PROJECT --json --non-interactive agent execute `
  --session <session-id> --task <task-id>
```

执行 `agent execute` 时，不要同时用另一个自动化工具操作采集器的 Chrome。任务只有在真实页面中找到目标 key、取得可见区域并生成截图证据后才算完成；Agent 的文字声明不算证据。

Agent 无法可靠处理的任务由人工接手，而不是进行“教习”或录制：

```powershell
node $CLI --project $PROJECT --json --non-interactive manual open `
  --session <session-id>
```

人工按工作台给出的源码、路由与动作提示完成正常业务操作。目标 key 出现后，工具自动标记并截图，不需要人工裁图或标注。完整协议见 [CLI 参考](docs/cli-reference.md) 与 [TriggerPlan 规范](skill/collect-i18n/references/trigger-plan.md)。

## Excel 往返规则

- 只有一个可见工作表，且严格只有 `中文`、`英文`、`截图`、`Key Path` 四列。
- 每次导出都用中文原文填充英文列；不会把当前 `en-us` 文本带入翻译任务。
- 不创建状态列、隐藏表、批注或内部元数据；任务状态只存在于 CLI/工作台。
- 截图直接嵌入“截图”列；没有证据的词条仍可导出，但截图单元格为空。
- 回稿只按 `Key Path` 定位；中文被修改、重复/未知/缺失 key 或表头变化都会出现在校验报告中。
- 英文为空或与中文完全相同，视为尚未翻译，不写入语言包，也不在 Excel 中标记状态。
- `import --dry-run` 不写文件；只有 `--apply` 会写入 `en-us`。已有目标文件会生成 `.bak` 备份，写入限制在识别出的 `en-us` 根目录内。

## 本地状态与项目影响

正常采集不会修改目标项目源码或 Vite 配置。工具在目标项目创建：

```text
.collect-i18n/
├─ config.json
├─ state.sqlite
├─ service.json / service.log
├─ browser-profile/
├─ evidence/
├─ exports/ 与 imports/
└─ plans/
```

请把 `.collect-i18n/` 加入目标项目自己的 `.gitignore`。`import --apply` 是唯一会主动修改业务语言包的流程，应先 dry-run，并在版本控制干净时执行。

## 开发与发布

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm package:skill
```

`pnpm package:skill` 使用纯 Node 脚本生成可复现 ZIP：`release/collect-i18n-skill-v<version>.zip`。推送 `v*` 标签后，GitHub Actions 会用同一脚本创建 Release 附件。

Skill ZIP 是 Agent 操作层，不重复捆绑 CLI 和 Node.js 运行时。使用 Release 中的 Skill 前，需要先按“从源码安装”构建 CLI，或通过 `COLLECT_I18N_CLI` 指向另一份已安装的 `packages/cli/dist/bin.js`；Skill 会在修改目标项目之前验证 CLI 版本。

## 仓库结构

```text
apps/studio             本地可视化工作台
packages/analyzer       语言包、源码、路由与动作提示扫描
packages/runtime        浏览器运行时绑定登记与目标监听
packages/vite-vue       Vue SFC 开发态插桩
packages/runner         Playwright 执行器、Mock 与 TriggerPlan
packages/excel          四列 Excel 导出与安全回稿导入
packages/cli            CLI、SQLite、本地 HTTP 服务与任务编排
skill/collect-i18n      Agent Skill
```

进一步阅读：[架构设计](docs/architecture.md) · [CLI 参考](docs/cli-reference.md) · [安全与局限](docs/security-and-limitations.md)


扩充测试项目的界面，要求要处理的词条数达到600，然后使用 claude code 模拟用户使用工作流，完成工作，人工兜底可以有你操作电脑来执行或者不处理。然后改进工具，要求人工仅兜底5%，2小时内有可导出的excel。
