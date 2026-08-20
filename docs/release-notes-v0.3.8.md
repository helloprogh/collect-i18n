# Collect I18n v0.3.8

此版本根据 1000 词条 OMS 复杂应用（Vue3 + Vite base=/oms/web + Element Plus + hash 路由）的完整采集运行数据，修复真实应用「打开界面即切换语言」的 Cookie 缺失问题，并落地上一轮确定性阶段导航稳定改进；预算不再 45 分钟封顶，首次完整排空队列。

## 改进

- **语言 Cookie 每次导航前重新注入**：新增 `browser.localeCookie` 配置（如 `x-gde-locale=zh_CN`），采集器在启动、重启以及每次打开页面/路由跳转前重新写入该 Cookie，保证依赖 Cookie 决定渲染语言的应用始终停留在中文源语言界面；现有 `browser.cookies` 仅在建上下文时注入一次。
- **导航 settle 后再检查运行时快照**：`inspectRuntime` 前等待页面 readyState 稳定且 pending 描述符清空，消除上一轮 `/orders` 等路由「Runtime inspection timed out while the page was navigating」导致的整路由确定性回退；检查超时从 3s 放宽到 8s。
- **无预算封顶的完整排空**：验证轮使用 `--deadline-minutes 240`，Agent 队列首次完整排空（`agent next` 返回 `done(queue_empty)`），不再把大量未尝试键在 finalize 时沉降。

## 验证（hash 路由 + 清缓存，1000 词条 OMS 应用，Claude Code 驱动）

- v0.3.7-r2（45 分钟封顶）：captured 424 / needs_manual 421 / skipped 155，覆盖率 42.4%。
- v0.3.8（240 分钟预算）：**captured 764 / needs_manual 81 / skipped 155，failed=0，duplicateEvidenceCount=0，覆盖率 76.4%**；确定性阶段 332 → 376，Agent 阶段 92 → 388。
- 工作簿 `.collect-i18n/oms-v0.3.8.xlsx`：1000 行、四列（中文/英文/截图/Key Path）、764 张内嵌截图、单元格细边框。
- 详见 [v0.3.8 性能分析](docs/performance-analysis-oms-app-v038.md)。

## 修复

- CLI 硬编码版本号未随包升级同步（`--version` 仍显示 0.3.7）。
- Claude Code print 模式后台子任务 600s 上限导致 Agent 循环被终止（`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` 可关闭）。

## 测试

- 新增 localeCookie 配置检测与传递断言；全量 134 项测试、类型检查、构建通过。
