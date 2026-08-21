# Collect I18n v0.3.12

针对准确率与执行效率的第三轮改进：把「死键/非可视化键」的判定提前到会话创建，消除重复截图证据，并强化 Agent 规划指导（翻页 sweep 与动态 key 防循环）。

## 改进

- **会话创建时预分类死键与非可视化键（效率+状态准确性）**：`createSession` 创建任务时立即把「源码无任何 `t()` 调用」的词条记为 `skipped`（原因 `no_source_occurrence`），把「全部 occurrence 都是 `aria-*` / 原生 `title`」的词条记为 `skipped`（原因 `non_visual_source_only`），写入带原因的系统事件。这些键不再进入 `needs_agent` 队列、不会被 Agent 反复空跑，`finalize` 只需复核剩余键；导出工作簿仍包含全部词条，人工可核对。
- **重复截图证据去重（准确性）**：同一任务在内容哈希（`screenshotSha256`）相同时刷新原证据行，不再插入重复行；内容不同的证据仍各自保留。上一轮验证中的 1 张重复截图由此消除，`duplicateEvidenceCount` 更真实。
- **Skill 规划指导（Agent 阶段效率）**：`trigger-plan.md` 新增「高扇出表格翻页 sweep」模板（goto → 每页 click next + capture 检查点），把一次执行可批量采集的表格键从「逐键计划」降为「单计划数十键」；新增「动态 key 与重命名渲染目标」指引，超时后先读表达式判断是否渲染的是另一 key（如 `dashboard.metric.totalUsers` vs `dashboard.metric.newUsers`），每个死动态 key 只允许一次有证据的尝试，禁止反复重试，直击上轮模型死键循环的时间黑洞。`SKILL.md` 同步更新 finalize 与防循环说明。

## 验证

- 全量 139 项测试（新增 2 项：会话创建预分类、证据去重）、类型检查、构建、Skill 打包全部通过。
- 真实 OMS 项目索引验证：创建新会话后立即 `skipped=155`（与上轮 finalize 的 `skippedNoSource` 完全一致）、`pending=828`、`needs_agent=17`，未启动浏览器、未改动现有证据。
- 现有 finalize 语义保持不变（对仍为 `needs_agent` 的键做同样复核），导出/导入不受影响。

## 影响

- 任务状态从会话一开始就反映最终分类，`status` 的 `automatic.processed` 更早进入完整态；Agent 队列只包含有渲染可能的键。
- 对动态 key 较多的应用，Agent 阶段预计显著减少无效重试耗时；表格密集应用配合翻页 sweep 计划可单计划批量覆盖数十键。
