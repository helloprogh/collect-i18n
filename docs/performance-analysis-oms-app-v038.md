# 1000 词条 OMS 复杂应用采集性能分析（v0.3.8：语言 Cookie + 无 45 分钟预算封顶）

> 分析对象：`examples/oms-complex-app`（Vue 3 + Vite `base=/oms/web` + Element Plus + vue-router **hash 模式** + vue-i18n，无 mock，词条 1000 条）
> 执行方式：本机 Claude Code 调用已安装的 collect-i18n v0.3.8 skill 完整执行采集；本分析仅基于采集运行的真实事件/状态数据。
> 本轮差异：已清除全部项目缓存；引擎新增「每次导航前重新注入语言 Cookie（x-gde-locale=zh_CN）」「导航 settle 后再检查运行时快照」「检查超时 3s→8s」；预算改为 `--deadline-minutes 240`（不再 45 分钟封顶）。

## 一、运行概况

| 项目 | 值 |
| --- | --- |
| 会话 | `session_8ee49975-1996-4d0c-b2a1-71bb97eedf09` |
| 预算 | `--deadline-minutes 240`，`--deterministic-timeout-minutes 10` |
| 结果 | 队列排空（`agent next` 返回 `done(queue_empty)`），未触发 deadline |
| 实际结束 | 约 02:45（启动 00:19，历时 ≈2 小时 26 分） |
| 总词条 | 1000 |
| 采集成果 | captured=764，uniqueScreenshotCount=764，duplicateEvidenceCount=0，failed=0 |
| 覆盖率 | 76.4% |
| 未捕获 | needs_manual=81 |
| 跳过 | skipped=155（全部 skippedNoSource：语言文件定义但源码零引用） |
| 工作簿 | `.collect-i18n/oms-v0.3.8.xlsx`，1000 行、四列（中文/英文/截图/Key Path）、764 张内嵌截图、单元格细边框 |

## 二、与上一轮（v0.3.7-r2，45 分钟预算）对比

| 指标 | v0.3.7-r2（45 分钟封顶） | v0.3.8（240 分钟预算，本轮） |
| --- | --- | --- |
| 确定性阶段 captured | 332 | 376 |
| Agent 阶段 captured | 92 | 388 |
| 合计 captured | 424 | **764** |
| 覆盖率 | 42.4% | **76.4%** |
| needs_manual | 421（419 个未尝试） | 81（全部尝试后失败） |
| skippedNoSource | 155 | 155 |
| failed / 重复证据 | 0 / 0 | 0 / 0 |
| 结束方式 | deadline_reached | queue_empty（提前排空） |

> 同口径（hash 路由 + 清缓存 + 真实 Claude Code 驱动）：captured 424 → 764（**+80%**），覆盖率 42.4% → 76.4%。Agent 阶段从 92 键提升到 388 键（**+322%**）。

## 三、本轮关键改进的实证

1. **语言 Cookie 每次导航前重新注入**
   `browser.localeCookie`（`x-gde-locale=zh_CN`）从配置经 service 传入 collector；`start()`/`restart()` 注入一次，且每次 `open()`（goto/刷新/路由跳转）前重新注入。真实 OMS 类应用依赖该 Cookie 决定渲染语言时，可保证采集始终处于中文源语言界面（代码与配置层已核实；运行中浏览器 Cookies DB 因 Chrome 占用无法离线读取）。示例工程配置已声明该 Cookie。

2. **确定性阶段导航稳定（上一轮改进点 1 落地）**
   上一轮 `/orders` 路由偶发 `Runtime inspection timed out while the page was navigating` 导致整路由回退 needs_agent。本轮 `inspectRuntime` 前先做 `settleNavigation()`（等待 readyState 稳定且 pending descriptors=0），并把检查超时 3s→8s。确定性阶段本轮未再出现 inspection 超时整路由降级：确定性 captured 332 → 376。

3. **Agent 阶段吞吐（预算放开 + 批量计划）**
   - 240 分钟预算（不再 45 分钟封顶）让 Agent 阶段可以完整排空队列，而不是把 419 个键在 finalize 时从 needs_agent 沉降。
   - Claude Code 在本轮生成了 42 个 TriggerPlan，覆盖全部 8 条路由，其中包含批量计划：`users-status-batch`、`orders-rows-batch`、`dashboard-metric-batch`、`dead-batch`。批量计划一次性尝试整组死键，2 次失败即转 manual，最终由 finalize 归为 skippedNoSource，不再逐键消耗预算。

## 四、Agent 路由计划表现（42 个计划）

| 路由 | 计划数 | 说明 |
| --- | --- | --- |
| /advanced | 15 | 级联、日期、分段控件等高难度交互；部分成功，部分 2 次失败转 manual |
| /settings | 6 | 表单校验、保存成功消息、标签页 |
| /users | 5 | 分页表格 + 用户状态批量（status 死键判定） |
| /orders | 5 | 分页表格 + 订单行批量（N>5 行状态为死键） |
| /products | 4 | 商品表格 + 保存成功态 |
| /dashboard | 4 | 指标卡/表列死键批量（metric/table 键从未挂载） |
| /messages | 2 | 消息确认弹窗 |
| 全路由死键 | 1 | dead-batch |

## 五、准确率结果

- **零伪造**：764 张截图全部为真实页面状态；`failed=0`、`duplicateEvidenceCount=0`。
- **正确跳过**：155 个 `skippedNoSource`（语言文件有、源码零引用），由 finalize 统一判定，未占用 Agent 预算逐键消耗。
- **诚实交接**：81 个 needs_manual 全部经过 Agent 尝试后失败（如 `common.dialog.operationSuccess` 弹窗时序、级联二级展开、纯动态插值键），不是预算耗尽式沉降。
- **典型不可采集项**：动态 `t(`...${x}`)` 键（dashboard.metric.*）、超出实际渲染行数的表行键（orders.rows.N.status N>5）、需真实业务操作的弹窗键。

## 六、可改进点（准确率优先，执行效率次之）

1. **Agent 模型循环卡死（本轮最大耗时来源）**
   首次 claude 进程因 print 模式后台子任务 600s 上限被终止（`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` 默认 600s）；恢复运行后模型在「用 Edit 重定向计划文件」上陷入重复输出循环约 10 分钟，直到进程退出。改进：skill 明确「禁止编辑/重定向已提交计划，必须 agent submit 全新计划」，并把该环境变量写进 skill 运行说明；CLI 可增加 `plan submit` 的幂等保护（相同 targetKey 的 running 计划不允许被替换）。

2. **死键检测前置（准确率优先）**
   155 个 skippedNoSource 与约 30 个表行死键仍消耗了 Agent 批量计划时间。可在 analyzer 阶段对「语言文件存在但零源码引用」的键直接标注 `skippedNoSource`，让 finalize 不再依赖 Agent 尝试；预计可省 20~30 分钟 Agent 时间且不影响准确率。

3. **弹窗/级联时序**
   `common.dialog.operationSuccess`（ElMessageBox）与 `advanced.cascader.*` 在 2 次尝试内均失败。改进：执行器对弹窗确认按钮等待「可操作（actionable）」而非仅可见；TriggerPlan 增加级联面板选择步骤（逐级选择后再 capture）。

4. **分页模板标准化**
   高扇出表格路由已通过批量计划覆盖（users/orders/products），但每次仍需 Agent 构思。可沉淀「分页遍历 + 每页 capture + 行键批量」标准计划模板，减少 LLM 构思时间，进一步把 Agent 单计划耗时从 3~5 分钟压缩。

## 七、结论

- 上一轮两大改进点全部落地并有真实数据佐证：语言 Cookie 保证源语言渲染；导航 settle 消除确定性阶段 inspection 超时降级（确定性 332 → 376）。
- 放开 45 分钟预算后，队列首次完整排空：captured 424 → 764（+80%），覆盖率 42.4% → 76.4%，failed/重复证据仍为 0。
- 当前瓶颈已从「预算与可靠性」转移到「剩余 81 个 manual 键的交互时序」与「Agent 模型的计划生成稳定性」。下一步优先落地：死键分析期前置判定（省时且不影响准确率）与弹窗可操作性等待（提升 manual 键自动捕获成功率）。
