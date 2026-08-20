# Collect I18n

Collect I18n 是一个以通用 Agent Skill 为入口、本地 CLI 为执行与事实层的 Vue 国际化截图采集工具。它面向真实的 Vue 3 + Vite + Vue I18n 项目，从中文语言包和源码建立任务清单，自动抵达页面并采集运行时证据，再由 Agent 和人工依次处理剩余交互场景。

最终产物是一份可直接交给翻译人员的 Excel：

| 中文 | 英文 | 截图 | Key Path |
| --- | --- | --- | --- |
| 中文原文 | 默认复制中文原文 | 对应界面截图；未采集时为空 | 稳定词条路径 |

当前版本为 `v0.3.9`。工具不会为了提高覆盖率向目标项目添加测试页面、预期词条、假路由或强制显示代码。

## 核心能力

- 从 `zh-cn` / `zh_CN` 与 `en-us` / `en_US` 文件夹递归加载 JSON 语言包。
- 支持一个界面一个 JSON 文件；新增文件后重新扫描即可，无需维护集中式导入表。
- 扫描 Vue、TypeScript 和 JavaScript 源码，关联 Key Path、源码位置、路由与动作提示。
- 启动目标项目自身的 Vite，并在内存中追加开发态采集插件，不修改业务源码或 Vite 配置。
- 路由拼接自动识别 Vite `base`（如 `/admin/`）与 vue-router 的 hash/history 模式，hash 路由按 `#/path` 打开，保证跳转落在真实页面。
- 覆盖普通 DOM、文本节点、组件属性、表单校验、Dialog、Drawer、Teleport、`ElMessage`、Notification 等场景。
- 通过 Vue VNode 生命周期把组件 occurrence 绑定到真实 Host roots，不依赖组件的属性透传，可处理多根节点、slots、`inheritAttrs: false` 与 Teleport。
- 使用受限 TriggerPlan 执行路由、点击、填写、选择、按键、等待和请求 Mock。
- 自动校验截图与目标 Key Path 的运行时绑定，避免图片与词条错配。
- 原生 DOM 仅写入不透明 sink ID，Vue 组件使用保留的 VNode 钩子；Key Path 保留在本地 Registry、SQLite 和 Excel 中，不注入页面文本或 DOM 属性。
- 运行时按 A/B/C 证据分级：确定性队列只接受 A 级，Agent 只接受 A/B 级，纯文本猜测不能自动写入证据。
- 安全的 B 级组件证据会在隔离页面执行一次性 Canary 因果验证，通过后提升为 A 级；有副作用的动作不会被自动重放。
- 自动处理期间，命令行和工作台持续显示已处理数、可信截图数、转交数、失败数和当前 Key。
- 一次 Agent 或人工操作建立业务状态后，会批量采集该状态中已挂载的其他 A/B 级词条；每个词条仍单独重新定位、标记和截图。
- Agent 按路由批量规划：返回全量 section/kind/service 统计、相关源码文件和最多 12 条代表样本，并可在一个 TriggerPlan 的多个 `capture` 检查点连续采集初始页、校验、弹窗、抽屉、表格和消息状态。
- 语义 radio/checkbox 会自动通过可见 label 激活被组件库包装的原生控件；通常无需为 Element Plus 编写专用选择器。
- 初始化会避开已占用的本机 Vite 端口；用户提供的端到端截止时间会持久化，Agent 到期后停止领取新任务并立即进入定案导出。
- Agent 最多尝试两次；仍无法可靠执行的任务进入人工辅助队列。
- Agent 队列结束后会进行可审计定案：源码无引用或仅用于 `aria-*` / 原生 `title` 的非可视词条明确留空，其余未解决词条进入人工辅助，不伪造截图。
- 人工只需完成正常业务操作。目标 key 出现后，工具自动高亮、截图并保存证据。
- 随时导出进度 Excel；没有截图的词条保留空白截图单元格，不阻塞翻译任务交付。
- 支持翻译回稿校验，并按 Key Path 安全写回 `en-us` JSON。

## 工作方式

```text
中文语言包 + Vue 源码
          ↓
静态分析并建立 SQLite 任务清单
          ↓
真实页面中的确定性路由与运行时截图
          ↓
Skill 驱动 Agent 处理剩余交互任务
          ↓
对无源码/仅非可视词条做可审计定案
          ↓
人工辅助完成最后少量复杂业务操作
          ↓
四列 Excel → 翻译回稿 → 校验并写回 en-us
```

任务只有在真实页面中找到目标 key、取得可见区域并成功生成截图后才算完成。静态文本命中、接口成功或 Agent 的文字声明都不能替代运行时证据。

## 环境要求

- Node.js `22.13.0` 或更高版本，并可使用随 Node.js 安装的 npm。
- 目标项目使用 Vue 3 和 Vite，并已安装依赖。
- 推荐目标项目使用 Vue I18n；Element Plus 已提供专门适配。
- 本机安装 Google Chrome。
- 首次执行需要网络访问，以便把匹配版本的 `playwright-core` 安装到用户可写的版本化运行缓存。安装后的 Skill 保持只读。

目标项目必须是本地可信且已获授权的代码库。采集过程会执行该项目的 Vite 配置、插件与前端代码。

## 推荐使用方式：只接入 Skill

从 [GitHub Releases](https://github.com/helloprogh/collect-i18n/releases/latest) 下载 `collect-i18n-skill-v0.3.11.zip`，解压后应形成：

```text
<skills-directory>/
└─ collect-i18n/
   ├─ SKILL.md
   ├─ cli/
   └─ references/
```

这是遵循开放 Agent Skills 格式的通用包，不包含 Claude Code、Codex 或 OpenAI 专属元数据。可安装到客户端支持的 Skill 目录，例如：

```text
.agents/skills/collect-i18n/
.claude/skills/collect-i18n/
.codex/skills/collect-i18n/
```

安装后，在目标 Vue 项目中向 Agent 发出类似指令：

```text
使用 collect-i18n Skill 处理当前项目，生成可交付的四列翻译 Excel。
自动完成能够可靠处理的任务，剩余任务交给人工辅助队列。
```

Skill 会解析自带 CLI，执行环境检查、初始化或刷新索引、启动采集器、等待确定性任务完成，并立即生成首版进度工作簿。已有采集服务仍在运行时会复用当前会话。用户不需要单独安装 Collect I18n CLI，也不需要手工组织命令。

## 一键工作流

Skill 默认执行的核心命令等价于：

```text
node <skill-root>/cli/bootstrap.mjs \
  --project <project-root> \
  --json \
  --non-interactive \
  run \
  --output <output.xlsx> \
  --deadline-minutes 120
```

`run` 会完成：

1. 检查 Node.js、Vue、Vite 和项目结构。
2. 首次运行时创建 `.collect-i18n/config.json`；启动新会话时复用配置并刷新索引。
3. 扫描语言包、源码、路由和动作提示。
4. 启动或复用采集服务、目标 Vite 和 Chrome。
5. 等待确定性队列完成，并持续显示当前词条和实时处理进度。
6. 导出一份立即可用的四列进度 Excel。
7. 返回 `sessionId`、工作台地址、项目地址、截止时间、任务统计和下一步动作。

如果确定性阶段仍有任务，Skill 按顺序消费 Agent 队列：

```text
agent next → agent submit → agent execute
```

每个任务最多执行两次 Agent 计划。两次失败后任务进入 `needs_manual`，不能再由 Agent 强行重开。

Agent 队列为空后，Skill 执行：

```text
finalize --session <session-id>
```

该步骤只把“语言包存在但源码无引用”以及“源码中仅用于 `aria-*` 或原生
`title` 的非可视内容”记为 `skipped`，并在事件中保存原因；其余未取证词条统一
进入 `needs_manual`。它只改变任务分类，不生成截图，也不会把内部状态写入 Excel。

## 人工辅助

Agent 队列处理结束后，仍无法可靠自动化的任务通过以下协议进入人工辅助：

```text
manual open --session <session-id>
```

工作台会显示当前词条、中文原文、源码位置、路由提示、动作提示和最后一次错误。人工在采集器打开的真实页面中完成登录、选择数据、提交表单等正常操作；工具持续监听目标 key，出现后自动标记并截图。

人工辅助不是“教习”或录制流程，不会把人的操作保存成未经验证的自动化脚本。

## 目标项目约定

语言目录名称大小写不敏感。推荐按界面拆分语言文件：

```text
src/locales/
├─ zh-cn/
│  ├─ common.json
│  └─ users/
│     └─ form.json
└─ en-us/
   ├─ common.json
   └─ users/
      └─ form.json
```

文件相对路径形成命名空间。例如：

```text
zh-cn/users/form.json
{ "nameRequired": "请输入姓名" }

→ users.form.nameRequired
```

扫描器只接受 JSON 叶子字符串。无效 JSON、非字符串叶子、重复 Key Path 和源码中的未知 key 会作为诊断返回。运行时拼接或远程下发的动态 key 不能保证获得完整的静态关联。

首次初始化会自动识别常见开发命令和语言 Cookie。需要调整语言包根目录、Vite 地址、启动命令、浏览器参数或 Cookie 时，编辑：

```text
.collect-i18n/config.json
```

修改后重新执行 `scan` 或再次运行 Skill。不要重复执行 `init` 覆盖有效配置。

## CLI 恢复与诊断

一般用户不需要直接操作 CLI。需要排查或恢复时，可通过 Skill 自带的 `bootstrap.mjs` 使用以下命令：

```text
doctor
init
scan
run
start
status
agent next
agent submit
agent execute
finalize
manual open
export
import
stop
```

所有项目命令都应携带：

```text
--project <absolute-project-root> --json --non-interactive
```

成功结果必须同时满足进程退出码为零且 JSON 中 `ok` 为 `true`。完整字段和命令参数见 [CLI JSON 协议](skill/collect-i18n/references/cli-protocol.md)。

采集命令若因调用方超时或进程退出而返回 `nextAction: restart`，Skill 会使用原 `sessionId` 执行 `start --session <session-id> --background`。不要直接运行无 `--session` 的 `start` 恢复工作；它会创建新会话，使既有任务 ID 和计划失效。`agent execute` 与 `manual open` 在没有其他活动会话时也会自动恢复自己的会话。

## Excel 导出规则

- 只有一个可见工作表。
- 严格只有 `中文`、`英文`、`截图`、`Key Path` 四列，并保持该顺序。
- 每次导出都用中文原文填充英文列，不读取当前 `en-us` 译文作为翻译任务内容。
- 不创建状态列、隐藏表、批注或内部任务元数据。
- 每个截图只锚定到对应 Key Path 的行。
- 没有有效证据时截图单元格保持为空。
- Excel 是否翻译过只通过“英文是否为空或是否仍与中文相同”判断。

任务状态、覆盖率和失败原因只保存在本地服务与 SQLite 中，不写入交付给翻译人员的工作簿。

## 翻译回稿

回稿必须保留四列表头、中文原文和 Key Path。先执行只读校验：

```text
import --session <session-id> --file <translated.xlsx> --dry-run
```

确认没有致命问题后再明确应用：

```text
import --session <session-id> --file <translated.xlsx> --apply
```

导入器会检查重复、未知或缺失 Key Path、被修改的中文、表头变化和目标文件映射。英文为空或仍与中文相同的行视为未翻译，不写入语言包，也不会在 Excel 中添加状态。

写回只允许发生在识别出的 `en-us` 根目录内。已有 JSON 会生成 `.bak` 备份，并尽量保留 BOM、缩进、换行和尾换行风格。

## 本地状态与安全

正常采集不会修改目标项目源码或 Vite 配置。工具会在目标项目创建：

```text
.collect-i18n/
├─ config.json
├─ state.sqlite
├─ service.json
├─ service.log
├─ browser-profile/
├─ evidence/
├─ exports/
├─ imports/
└─ plans/
```

请将 `.collect-i18n/` 加入目标项目的 `.gitignore`。该目录可能包含 Cookie、登录态、工作台临时凭据、页面截图、业务数据、请求 Mock 和翻译文件，不应提交或整体上传。

工作台与 API 只监听本机回环地址。`studioUrl` 包含当前会话的临时访问能力，不应复制到公共日志、工单或不受信任的聊天中，也不应通过端口转发或反向代理暴露。

`import --apply` 是唯一会主动修改业务语言包的流程。建议在版本控制干净时运行，先 dry-run，再通过 Git diff 审核写回结果。

更多边界说明见 [安全与局限](docs/security-and-limitations.md)。

## 从源码开发

```bash
git clone https://github.com/helloprogh/collect-i18n.git
cd collect-i18n
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:benchmark
pnpm build
pnpm package:skill
```

`pnpm package:skill` 生成：

```text
release/collect-i18n-skill-v<version>.zip
```

打包器会验证 Skill 必需文件、运行时模块依赖闭包，并拒绝把 `.claude/`、`.codex/` 或 `agents/` 等客户端私有元数据放入通用发布包。

## 仓库结构

```text
apps/studio                         本地人工辅助工作台
packages/analyzer                   语言包、源码、路由与动作提示扫描
packages/runtime                    DOM、Range、组件属性与服务节点登记
packages/vite-vue                   Vue SFC 开发态插桩
packages/runner                     Playwright、请求 Mock 与 TriggerPlan
packages/excel                      四列 Excel 导出与安全回稿导入
packages/cli                        CLI、SQLite、本地服务与任务编排
skill/collect-i18n                  通用 Agent Skill
examples/vue-i18n-translation-lab  601 词条的真实可运行基准项目
```

进一步阅读：

- [架构设计](docs/architecture.md)
- [CLI 参考](docs/cli-reference.md)
- [TriggerPlan 规范](skill/collect-i18n/references/trigger-plan.md)
- [v0.3.11 发布说明](docs/release-notes-v0.3.11.md)
- [v0.3.10 发布说明](docs/release-notes-v0.3.10.md)
- [1000 词条 OMS 应用性能分析 v0.3.10](docs/performance-analysis-oms-app-v0310.md)
- [v0.3.9 发布说明](docs/release-notes-v0.3.9.md)
- [v0.3.8 发布说明](docs/release-notes-v0.3.8.md)
- [v0.3.7 发布说明](docs/release-notes-v0.3.7.md)
- [1000 词条 OMS 应用性能分析 v0.3.8](docs/performance-analysis-oms-app-v038.md)
- [1000 词条 OMS 应用性能分析 v0.3.7-r2](docs/performance-analysis-oms-app-v037-r2.md)
- [1000 词条 OMS 应用性能分析 v0.3.6](docs/performance-analysis-oms-app.md)
- [v0.3.6 发布说明](docs/release-notes-v0.3.6.md)
- [v0.3.5 发布说明](docs/release-notes-v0.3.5.md)
- [v0.3.4 发布说明](docs/release-notes-v0.3.4.md)
- [v0.3.3 发布说明](docs/release-notes-v0.3.3.md)
- [v0.3.2 发布说明](docs/release-notes-v0.3.2.md)
- [v0.3.1 发布说明](docs/release-notes-v0.3.1.md)
