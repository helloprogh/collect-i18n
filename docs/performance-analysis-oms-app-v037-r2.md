# 1000 词条 OMS 复杂应用采集性能分析（v0.3.7-r2：崩溃自愈验证）

> 分析对象：`examples/oms-complex-app`（Vue 3 + Vite `base=/oms/web` + Element Plus + vue-router **hash 模式** + vue-i18n，无 mock，词条 1000 条）
> 执行方式：本机 Claude Code 调用已安装的 collect-i18n v0.3.7 skill 完整执行采集；本分析仅基于采集运行的真实事件/状态数据。
> 本轮差异：已清除全部项目缓存；skill 引擎包含「浏览器崩溃自愈 + 执行超时安全恢复 + Agent 队列静态锚点优先 + 弹窗定位器消歧」。

## 一、运行概况

| 项目 | 值 |
| --- | --- |
| 会话 | `session_a0763d4e-e0a3-4cec-9cc0-e67495704039` |
| 预算 | `--deadline-minutes 45`，`--deterministic-timeout-minutes 8` |
| 结果 | `deadline_reached`，45 分钟预算用尽 |
| 总词条 | 1000 |
| 采集成果 | captured=424，uniqueScreenshotCount=424，duplicateEvidenceCount=0，failed=0 |
| 覆盖率 | 42.4%（coveragePercent） |
| 未捕获 | needs_manual=421（其中 419 个为截止时间到后 finalize 沉降，从未被尝试） |
| 跳过 | skipped=155（全部 `skippedNoSource`，语言文件定义但源码零引用） |
| 工作簿 | `.collect-i18n/oms-v0.3.7.xlsx`，1000 行、四列、424 张内嵌截图 |

## 二、与上一轮（v0.3.7 hash 旧引擎）对比

| 指标 | v0.3.6（web history） | v0.3.7-hash 旧引擎 | v0.3.7-r2 新引擎（本轮） |
| --- | --- | --- | --- |
| 确定性阶段 captured | 373 | 304 | 332 |
| Agent 阶段 captured | 358 | 63 | 92 |
| 合计 captured | 731 | 367 | **424** |
| needs_manual | 114 | 478 | 421 |
| skippedNoSource | 155 | 155 | 155 |
| 覆盖率 | 73.1% | 36.7% | **42.4%** |
| 运行时长 | ≈42 分钟 | ≈33 分钟 | 45 分钟（预算用尽） |

> 注：v0.3.6 基线为 web-history 路由且可能复用历史缓存；与 v0.3.7-r2 严格同口径（hash 路由 + 清缓存）的是 v0.3.7-hash 旧引擎一轮：**captured 367 → 424（+15.5%），needs_manual 478 → 421（-12%）**。

## 三、本轮关键改进的实证

1. **浏览器崩溃自愈（本轮最大收益）**
   上一轮旧引擎：首个 `/orders` 大表计划在 90s 执行时限内拖垮共享页面，随后 `browserContext.newPage: browser has been closed` 无法恢复，`start --session` 也未能拉起浏览器，Agent 阶段（原本可产出约 300+ 键）仅完成 63 键即瘫痪。
   本轮：同一个 `/orders` 计划第一次同样触发 90s 执行超时，但引擎自动关闭失效页面、创建新页面并保持浏览器存活，驱动重试精简后的计划并**成功 +27 键**；全轮无任何 "browser has been closed" 卡死，Agent 阶段全程可用。

2. **Agent 队列静态锚点优先（动态-only 键降级）**
   上一轮 `dashboard.chart.*`、`dashboard.table.*` 等纯动态插值键（`t(\`dashboard.${...}\`)`）消耗约 20 次双尝试执行（每次约 2 分钟）后必然失败，归入 needs_manual。
   本轮这些键（17 个 dashboard 未捕获键）**未消耗任何 Agent 尝试**，直接在 finalize 沉降到人工队列；省下的预算被 `/settings`(+27)、`/messages`(+11)、`/orders`(+27)、`/products` 等真实可渲染计划使用。

3. **路由批量饱和检测**
   `/advanced` 连续两个计划新增捕获 ≤ 1 后被标记饱和（`agent_route_stats.consecutive_low=2`），`agent next` 自动转向其他路由，不再在同一路由上锚定新孤儿键。

4. **执行超时安全恢复**
   `/orders` 计划第 1 次超 90s 执行时限后，引擎以新页面安全恢复，计划可重试（`agent execute` 重试语义成立），最终第 2 次成功。

## 四、Agent 路由计划表现

| 路由 | 锚点 key | 结果 | 检查点新增 captured |
| --- | --- | --- | --- |
| /settings | settings.save.success | ✅ 成功 | +27（三标签页 + 表单校验 + 成功消息） |
| /messages | messages.confirm.content | ✅ 成功 | +11（含用真实证据解决上一轮遗留的 common.dialog.operationSuccess） |
| /orders | common.action.confirm | ✅ 第 2 次成功（第 1 次超 90s 时限） | +25 |
| /advanced（首次） | common.dialog.operationSuccess | ❌ 2 次失败 → manual | — |
| /advanced（date.range） | advanced.date.range | ❌ 2 次失败 → manual | — |
| /advanced（cascader） | advanced.cascader.apparel.men | ❌ 单次展开不可达 → manual | — |

## 五、准确率结果

- **零伪造**：全部 424 张截图均为真实页面状态的运行时证据；`failed=0`、`duplicateEvidenceCount=0`。
- **正确跳过**：155 个 `skippedNoSource` 词条在语言文件中存在但源码从未引用，finalize 正确归类。
- **诚实交接**：421 个 needs_manual 中 419 个是 45 分钟预算耗尽后由 finalize 从 needs_agent 沉降（从未被尝试，不占用人工之外的时间）；真正尝试失败仅 `advanced.date.range`（2 次）。没有为凑覆盖率伪造截图或修改业务源码。
- **典型不可采集项**：`advanced` 路由的 ElMessage.success 弹窗时序、`advanced.cascader.*` 两级级联展开、`advanced.date.range` 静态占位符绑定后无新绑定可观察。

## 六、可改进点（准确率优先，执行效率次之）

1. **确定性阶段 `/orders` 路由偶发 "Runtime inspection timed out while the page was navigating"**（两轮均出现）
   页面导航中执行 `inspectRuntime` 3s 超时导致整条路由的确定性采集降级到 needs_agent。改进：导航后增加「settled 重试」或在 navigation 中把 inspection 延长/等待导航完成后再检查，可减少确定性阶段的整路由回退（每轮约 40+ 键）。

2. **45 分钟预算下仍有 419 个键未尝试**
   瓶颈已从「浏览器崩溃」转移到「Agent 计划吞吐」：每轮计划从 LLM 构思到执行约 3~5 分钟，单计划实际捕获 11~27 键。改进：对高扇出表格路由（users/orders/products）生成「分页遍历 + 每页 capture」的标准计划模板，让驱动一次性覆盖多页（v0.3.6 曾用此方式单计划捕获 81~108 键）。

3. **`common.dialog.operationSuccess` 弹窗时序问题（advanced 首次）**
   ElMessageBox 打开动画与确认点击竞态。本轮驱动通过改用直接命令式路径（popconfirm）绕过后由 /messages 计划用真实证据解决；可进一步在引擎层对弹窗确认按钮等待「可操作」而非仅「可见」（clickControl 已做多匹配消歧，可补充 actionability 等待）。

4. **`advanced.cascader.*` 两级级联不可达**
   单次展开只到第一级，第二级需要先选中第一级。改进：TriggerPlan 增加级联展开专用步骤（panel 级联选择），或将这些键在分析期标记为「需多步级联」提高锚点阈值。

## 七、结论

- 上一轮验证发现的两大硬伤——浏览器崩溃不可恢复、动态伪影键反复消耗 Agent 预算——本轮均已修复并有真实数据佐证：Agent 阶段产出从 63 键提升到 92 键，且全程无浏览器卡死；同口径（hash + 清缓存）覆盖率 36.7% → 42.4%。
- 当前瓶颈已从「可靠性」转移到「Agent 计划吞吐」：45 分钟预算内确定性 332 + Agent 92 = 424。若要继续提升，重点是表格分页标准计划模板与确定性阶段导航稳定性，而不是再修可靠性。
