# Collect I18n v0.3.9

此版本针对真实应用三个常见场景优化采集引擎：路由组件异步加载（`component: () => import(...)`）、接口 mock 数据不全/响应慢导致的加载态、以及截图落在 loading 遮罩上的问题。

## 改进

- **路由异步加载等待**：页面打开（goto/刷新/路由跳转）后，不再只在「运行时就绪」就返回，而是继续等待导航完全稳定——无新 JS/CSS 资源加载的静默窗口 + 无 pending 运行时描述符；`settleNavigation` 同时纳入 loading 遮罩与资源静默检测，保证懒加载路由 chunk 挂载完成后再做快照/截图。
- **截图 loading 保护（准确率优先）**：`capture`/`captureBatch` 截图前等待可见 loading 遮罩清除；`screenshotEvidence` 在画标记前检查目标中心是否被 `.el-loading-mask`、`.el-skeleton`、`.el-icon.is-loading`、`.ant-spin-spinning` 或 `[data-collect-i18n-loading]` 覆盖，若 5s 内仍未清除则跳过该键而不是保存一张 spinner 截图（键回到队列，不会产生伪证据）。
- **mock 数据不全/慢的兜底**：接口 mock 响应慢或数据不全导致表格 loading/空态时，引擎现在等待 loading 清除后才判定「键是否挂载」，避免把加载中/空态误判为不可采集；数据本身缺失的键仍诚实进入 needs_agent/manual，不伪造数据。

## 验证

- 全量 138 项测试（新增 loading 指示器识别与选择器断言）、类型检查、构建通过。
- 实采验证详见 [v0.3.9 性能分析](docs/performance-analysis-oms-app-v039.md)（含 1000 词条 OMS hash 路由应用）。

## 修复

- 懒加载路由在 chunk 挂载前被采集导致整路由「键未挂载」降级。
- 慢接口下截图拍到 spinner/骨架屏被当作证据。
