# 架构设计

## 设计原则

Collect I18n 的完成信号是“真实运行时证据”，不是静态文本命中，也不是 Agent 声称已完成。系统把问题拆成三个成本逐级上升的执行层，并让它们共享同一份任务、运行时绑定和证据模型：

```mermaid
flowchart LR
  A["zh-cn / en-us JSON"] --> B["静态分析器"]
  S["Vue / TS 源码"] --> B
  B --> Q["SQLite 任务队列"]
  Q --> D["确定性浏览器采集"]
  D -->|"剩余任务"| G["Skill + Agent TriggerPlan"]
  G -->|"仍无法可靠执行"| H["人工辅助兜底"]
  D --> E["统一证据校验"]
  G --> E
  H --> E
  E --> X["四列 Excel"]
  X --> I["回稿校验与 en-us 写回"]
```

系统不尝试让 Agent 自由控制一切。确定性能力负责可证明、可重复的部分；Agent 只补足“如何抵达状态”的推理；人工只处理认证、复杂业务数据或不可预测环境等最后边界。

## 模块边界

| 模块 | 责任 | 不负责 |
| --- | --- | --- |
| `core` | 稳定 ID、配置与跨进程协议 | 浏览器或文件写入 |
| `analyzer` | 发现语言包、扁平化 key、扫描 `$t`/`t`、关联路由和动作提示 | 判断页面是否真的显示 |
| `vite-vue` | 开发态转换 Vue SFC，注入稳定 occurrence 描述和运行时入口 | 修改磁盘上的目标源码 |
| `runtime` | 登记 DOM、Range、组件属性、命令式服务/Teleport 目标并监听 key | 导航或业务操作 |
| `runner` | 在同源页面执行受限 TriggerPlan、Mock 请求、等待目标并截图 | 任意 JavaScript、Shell 或跨域导航 |
| `cli` | 配置、SQLite、服务生命周期、任务状态机与工作台 API | 生成 Agent 推理 |
| `excel` | 严格四列工作簿、截图嵌入、回稿验证和受限写回 | 保存任务状态到 Excel |
| `studio` | 面向人工的进度、证据、Mock、监听与 Excel 界面 | 替代 CLI 事实协议 |
| `skill` | 指挥 Agent 按 CLI 协议完成剩余任务 | 绕过 CLI 直接篡改页面或任务 |

## 一次会话的生命周期

1. `doctor` 只读检查 Node、目标项目结构与关键依赖。
2. `init` 生成 `.collect-i18n/config.json`，扫描语言包/源码并将索引同步到 SQLite。
3. `start` 创建会话，加载目标项目自身的 Vite 配置，同时追加 Collect I18n 插件；目标源码和配置文件不落盘修改。
4. 服务按高置信路由批量处理 `pending` 任务。能在真实页面定位 key 的任务进入 `captured`，其余进入 `needs_agent`。
5. Skill 从 `agent next` 取得一个任务，生成版本化 TriggerPlan，经 `agent submit` 校验后由 `agent execute` 顺序执行。
6. `start` 创建会话时即把「可证明无 occurrence」与「全部 occurrence 非可视」的词条预分类为 `skipped`（带原因事件）；如果项目存在未解析动态调用，无 occurrence 词条改为 `needs_manual`。Agent 队列处理完后，`finalize` 对剩余未解决项做同样的保守复核。
7. `manual open` 打开目标路由并持续监听；人工触发真实状态后自动采集。
8. `export` 从会话目录与证据表生成工作簿；`import` 先对照同一会话目录做 dry-run，再按授权写入 `en-us`。

任务执行被串行化，避免确定性队列、Agent 和人工监听同时争用同一个浏览器页面。状态与失败原因写入 SQLite，因此 CLI、工作台与 Skill 看到的是同一事实。

## Key 与 occurrence

语言文件路径形成命名空间。例如：

```text
zh-cn/users/form.json + { "nameRequired": "请输入姓名" }
→ users.form.nameRequired
```

一个 Key Path 可以在源码出现多次，每次出现都有由文件位置和表达式计算出的稳定 occurrence ID。静态扫描保存以下信息：

- 源文件、行列与原始表达式；
- `native_dom`、`text_range`、`component_prop` 或 `imperative_service` 类型；
- 从路由配置、导航调用和组件文件得到的路由提示及置信度；
- 从模板事件、表单校验和脚本调用得到的动作提示。

确定性阶段只消费可靠路由和可直接定位的 DOM/文本 occurrence，避免把文件名猜测当成证据。低置信或需要操作的词条留给 Agent。

## 运行时绑定

系统不会把 Key Path 写入目标 DOM。Vite 插件在原生 Host 渲染出口写入不透明
`data-collect-i18n-sink` ID；对于 Vue 组件则注入保留的 VNode 生命周期钩子，不向组件
传递普通业务属性。Key Path 与源码信息只保存在运行时登记表：

```text
编译期 occurrence + opaque native sink / VNode provenance hook
        ↓
渲染值与动态 Key 回报 / 组件实例 Host roots / 文本 Range / 组件属性关联
        ↓
CollectorRegistry A/B/C 证据快照
        ↓
按 target key 监听
        ↓
可见矩形 + 路由 + occurrence + 截图
```

直接文本和原生属性能够形成编译器 sink 到 Host DOM 的连续链，记为 A 级。
组件内部转发由 VNode 生命周期绑定到对应组件实例的真实 Host roots，再在该范围内唯一
定位文本或视觉属性，记为 B 级。这条链不依赖组件透传 `$attrs`，可覆盖
`inheritAttrs: false`、多根节点、slots、Suspense 与 Teleport。
只有最终文本相同、CSS 或时间窗口等启发式信息时记为 C 级，不能进入自动证据。

对于编译器确认可安全替换的视觉 B 级 occurrence，确定性采集会在隔离的新页面中把该
occurrence 的渲染值临时替换为一次性 Canary。只有同一 occurrence 的目标节点随之精确
变化时，证据才提升为 A 级；Canary 页面不截图、不修改语言包，并在验证后立即销毁。
包含点击、填写、提交等可能产生副作用的 Agent 计划不会自动重放 Canary。

Agent 或人工把页面推进到一个新业务状态后，服务会读取该状态中所有已挂载且达到 A/B
级的待处理 occurrence，并逐项重新聚焦、稳定布局、标记和截图。批处理共享业务状态，
不共享截图或矩形，因此能减少重复导航与重复操作，同时仍保持一词条一证据。

确定性路由同样先取得一次运行时挂载快照：只对当前状态中真实存在的 A/B 目标执行定位
与截图，其余词条立即转交 Agent，不再为每个尚未触发的校验、弹窗或请求状态逐项等待
超时。

Element Plus 的 Message、Notification 等服务通常 Teleport 到 `body`，生命周期也很短。
插件为每次服务调用建立 `invocationId`，运行时只在对应调用时间窗和服务容器内关联节点；
并发调用无法唯一证明时自动降为 C 级。监听器先锁定目标，再由业务操作触发，因此不要求提示长期显示。

插桩仅用于采集开发服务器。正常生产构建不需要、也不应携带采集标记。

## TriggerPlan 安全边界

TriggerPlan 是版本化 JSON DSL，当前只允许：

- 同一项目源站内的 `goto` / `reload`；
- 由 role、label、text、test-id 或有源码依据的 CSS 定位器执行 click、fill、press、select、hover；
- 有上限的 wait、waitForText、waitForKey；
- 数量、延迟、响应体和匹配范围均受校验的请求 Mock。

计划步数和总执行时间都有硬上限。DSL 不支持 JavaScript 求值、Shell、任意文件访问、环境变量读取或跨域导航。

## 证据模型

截图只有同时满足下列条件才会令任务进入 `captured`：

- 目标 `Key Path` 与任务一致；
- key 已在当前真实页面绑定到可定位目标；
- 确定性采集必须是 A 级证据，Agent 采集必须是 A/B 级证据；
- 记录当前路由和采集时间；
- 截图成功写入会话 evidence 目录；
- 能取得时保存可见矩形、occurrence 和动作轨迹。

静态扫描、Agent 返回文本或仅出现中文字符串都不能替代上述证据。Excel 中没有截图的行表示当前会话没有可嵌入证据，不代表隐藏的“待翻译”状态。

`skipped` 也不会产生合成证据。当前只允许两类可审计原因：
`no_source_occurrence`（语言包有词条、源码没有引用，且项目不存在无法解析的动态翻译调用）和
`non_visual_source_only`（所有引用都仅服务于非可视可访问性/原生提示属性）。
如果扫描器发现无法映射到具体 Key 的动态调用，无 occurrence 词条以
`unresolved_dynamic_source` 进入人工队列。任何仍可能在界面中显示的 occurrence
都进入人工队列，避免为了降低人工比例而错误留空。

## 数据与文件写入

目标项目内的 `.collect-i18n/state.sqlite` 保存项目、任务、证据与事件。浏览器资料、截图、计划、服务描述和导入导出临时文件也位于 `.collect-i18n/`，应被目标项目忽略。

Excel 导出始终以中文原文初始化英文列，不把当前 `en-us` 译文带入新任务。导入先检查工作表与四列表头，再核对 Key Path、中文原文和目录映射。写回路径必须解析到发现的 `en-us` 根目录内；JSON 写入保留 BOM、缩进、换行和尾换行风格，采用临时文件替换，并为已有文件创建 `.bak`。

## 扩展点

- 新框架适配器可以产生相同 occurrence 描述并接入 `runtime`。
- 新组件库适配器可以把命令式服务或 Teleport 节点登记到同一 Registry。
- 新 Agent 只需遵守 CLI JSON 协议和 TriggerPlan v1，不应直接依赖 SQLite 表结构。
- 新导出格式应以 Key Path 和证据目录为输入，不能把工作流状态塞进翻译工作簿。
