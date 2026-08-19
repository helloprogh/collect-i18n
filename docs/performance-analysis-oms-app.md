# 1000 词条 OMS 复杂应用采集性能分析（v0.3.6）

> 分析对象：`examples/oms-complex-app`（Vue 3 + Vite `base=/oms/web` + Element Plus + vue-router + vue-i18n，无 mock，词条 1000 条）
> 执行方式：本机 Claude Code 调用已安装的 collect-i18n v0.3.6 skill 完整执行采集；本分析仅基于采集运行的真实事件/状态数据。

## 一、运行概况

| 项目 | 值 |
| --- | --- |
| 会话 | `session_31fe28fb-d471-4a73-8e58-21caea99002c` |
| 开始 | 2026-08-19 17:31:14 UTC+8 |
| 预算 | `--deadline-minutes 45`，`--deterministic-timeout-minutes 8` |
| 实际结束 | 18:12:53 finalize，18:15:21 停止采集器（未耗尽预算） |
| 总词条 | 1000 |
| 采集成果 | captured=731，uniqueScreenshotCount=731，duplicateEvidenceCount=0，failed=0 |
| 覆盖率 | 73.1%（coveragePercent） |
| 未捕获 | needs_manual=114（9 个由 Agent 归入 + 105 个 finalize 归入） |
| 跳过 | skipped=155（全部 `skippedNoSource`，语言文件定义但源码零引用） |
| 工作簿 | `.collect-i18n/oms-v0.3.6.xlsx`，1000 行、四列、731 张内嵌截图（约 98 MB） |

## 二、性能数据

### 2.1 分阶段耗时

| 阶段 | 时间窗 | 耗时 | 新增 captured | 速率 |
| --- | --- | --- | --- | --- |
| 确定性采集 | 17:31:14 → 17:40:15 | ≈ 9 分钟 | 373 | ≈ 41 keys/min |
| Agent 路由批量（有效捕获） | 17:45 → 18:03 | ≈ 23 分钟 | 358 | ≈ 16 keys/min |
| Agent 尾部（零新增） | 18:03 → 18:12:53 | ≈ 9.5 分钟 | 0 | 0 keys/min |
| 合计 | 17:31 → 18:13 | ≈ 42 分钟 | 731 | ≈ 17 keys/min |

### 2.2 捕获增长时间线（分钟级累计）

```text
17:31 +31=31   17:36 +30=199   17:45 +19=392   17:54 +3=680
17:32 +4=35    17:37 +40=239   17:46 +6=398    17:55 +5=685
17:33 +62=97   17:38 +62=301   17:49 +81=479   17:58 +18=703
17:34 +42=139  17:39 +57=358   17:51 +108=587  17:59 +15=718
17:35 +30=169  17:40 +15=373   17:53 +90=677   18:00 +8=726
                                             18:01 +1=727  18:02 +3=730  18:03 +1=731
```

### 2.3 每路由批次表现（P2-4 检查点捕获）

| 批次计划 | 主要路由 | 锚点结果 | 检查点新增 captured |
| --- | --- | --- | --- |
| dashboard-route ×2 | /dashboard | 锚点失败→manual | +31（静态页可见键） |
| users-route | /users | 成功（deleteSuccess 弹窗链路） | +25（dialog/save/分页） |
| orders-rows（经 dashboard 锚点） | /orders | 锚点失败→manual | +81（orders.rows 跨 3 页） |
| users-rows-page | /users | 锚点失败→manual | +108（users.rows 4 页全量） |
| products-route | /products | 锚点失败→manual | +93（products.rows/status/category） |
| settings+advanced | /settings→/advanced | 锚点失败→manual | +18（三标签页 + 静态组件） |
| messages / advanced 交互 | /messages /advanced | 部分成功 | messages.*、drawer/popconfirm/result 等 |
| 其余 dashboard 图表孤儿键 | /dashboard | 全部失败→manual | 每次补充 0~5 个可见键 |

单计划最高收益：users-rows-page 一次执行通过 4 次分页检查点捕获 **108 个词条**；orders 3 页捕获 **81 个**；products 捕获 **93 个**。这正是 P2-4 “按路由批量 + capture 检查点”的核心收益。

## 三、准确率结果

- **零伪造**：全部 731 张截图均为真实页面状态的运行时证据；`failed=0`、`duplicateEvidenceCount=0`。
- **正确跳过**：155 个 `skippedNoSource` 词条（如 `advanced.badge.messages`、`common.action.back`、`advanced.result.retry`）在语言文件中存在但源码从未引用，finalize 正确归类，未进入截图流程。
- **诚实交接**：114 个 `needs_manual` 中，Agent 尝试过 2 次的锚点（`dashboard.chart.axis.*`、`categoryShare`、`legend.*`、`orderTrend` 等）均确认是源码不渲染的图表/枚举键，未伪造截图，转人工辅助队列。
- **典型不可采集项**：`orders.rows.N.status/payMethod`（视图用枚举变量渲染，静态分析无对应 occurrence）、`dashboard.chart/table/metric/*`（图表/表格标签用硬编码数组）、`advanced.cascader.*`（下拉未展开状态）。

## 四、可改进点（准确率优先，执行效率次之）

1. **Agent 队列先排除零 occurrence 词条（准确率 + 效率）**
   已确认 `dashboard.chart.categoryShare`、`axis.month`、`legend.orders` 等 155 个键在 instrumentation manifest 中 occurrence=0，却仍被 `agent next` 作为锚点下发，每个消耗约 2 次执行（约 2~4 分钟）后必然失败。改进：`agent next` 应只返回 occurrence≥1 的键作为锚点；零 occurrence 键直接留给 finalize 的 `skippedNoSource`。仅此项可消除本次运行尾部约 9.5 分钟的零产出。

2. **路由批量饱和检测（效率）**
   当同一路由连续多个计划的 capture 检查点新增 captured≈0 时（本次 /dashboard 在 18:03 后 0 新增），应切换到下一个未饱和路由，而不是继续在同一路由锚定新孤儿键。

3. **运行时不透明标记与 Playwright 定位器兼容（准确率）**
   运行时在渲染文本后追加不可见标记（U+2060/U+2061/U+2062/U+2063，如 `新建⁣⁡⁡⁡⁣`），污染了 accessible name，导致 `getByRole(..., { name: '打开抽屉' })` 等精确匹配超时（第一次失败运行中已复现）。改进：执行器在构造 role/text/label 定位器时剥离标记字符，或对 `name` 使用可忽略标记的正则。

4. **Element Plus 弹层/消息框点击可靠性（准确率）**
   ElMessageBox/Teleport 弹层动画导致确认/取消按钮短暂 “not visible”，多个 messages 计划因此超时。改进：点击弹层按钮前先等待其可见（或对确认按钮使用 `force: true`），并把弹层文本加入 `waitForText` 预检。

5. **确定性阶段后优先处理“可交互高扇出路由”（效率）**
   本次确定性阶段 9 分钟捕获 373 键后，前两个 Agent 计划仍消耗在 /dashboard 静态键上；若 `agent next` 直接优先 /users、/products、/orders 等分页/表单路由，23 分钟有效工作可进一步压缩（当前 358 个 Agent 捕获中，分页/表单路由占 90% 以上）。

## 五、结论

- P2-4 路由批量 + capture 检查点在真实 1000 词条应用上验证有效：单计划最高捕获 108 键，Agent 阶段 23 分钟内完成 358 键，且零伪造证据。
- 当前瓶颈不在捕获能力，而在**队列锚点选择**：155 个零 occurrence 键与 114 个不可渲染键占用了约一半的 Agent 计划时间。按准确率优先原则，先修“锚点可渲染性过滤”，再修“路由饱和切换”，预计同等预算下覆盖率可提升至 80%+，且 45 分钟预算内可提前 10 分钟以上结束。
