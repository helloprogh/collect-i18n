# Collect I18n v0.3.10

修复 v0.3.9 在真实浏览器验证中发现的采集回归：loading 遮罩检测在 `page.evaluate` 内引用了模块级函数，浏览器上下文无法访问，导致整条路由确定性采集失败并批量降级到 Agent 队列（1000 词条验证中 938 条被错误标记）。

## 修复

- **`page.evaluate` 作用域回归（关键）**：`targetBlockedByLoading` 在浏览器内执行时引用了模块级 `isLoadingElement`，而模块函数不在页面作用域中，抛出 `ReferenceError: isLoadingElement is not defined`，一条路由失败会把该路由全部 pending 任务降级为 `needs_agent`。修复：将检查逻辑内联到 evaluate 回调中（与导出函数保持同步注释），单元测试因 mock 了 `page.evaluate` 无法发现该问题，本次新增真实浏览器回归验证。
- **轮询/热更新页面不再拖慢导航**：`settleNavigation` 原逻辑要求「无新资源静默 300ms」才返回；持续请求的页面（轮询接口、Vite HMR、dev sourcemap）永远不会静默，导致每次导航固定等待 6s。改为「连续两次干净采样（≥300ms）即返回；资源持续变化时也最多再等 1s」，既覆盖懒加载 chunk 抓取，又不会卡住采集。

## 验证

- 全量 138 项测试、类型检查、构建通过。
- 新增真实浏览器回归：对 1000 词条 OMS 应用（hash 路由 + `/oms/web` base）全部 7 个路由执行 open→inspectRuntimeSettled→capture，全部通过并产出真实截图；单路由打开 1.0–3.8s，无 ReferenceError、无 spinner 截图。
- 实采验证详见 [v0.3.10 性能分析](docs/performance-analysis-oms-app-v0310.md)。

## 影响

- v0.3.9 的懒加载等待、loading 截图保护、mock 兜底逻辑全部保留；本版本只修复其在真实浏览器中的作用域回归并加速稳定判定。
