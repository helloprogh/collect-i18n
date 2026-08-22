# Collect I18n v0.3.13

本版本修复 v0.3.12 复盘发现的动态 Key 误分类、证据身份语义与浏览器回归验证缺口，并改善大任务集性能、工作台体积和版本治理。

## 准确性

- 动态模板候选不再静默截断到 200 个；大型表格和枚举命名空间中的后续 Key 会保留 occurrence。
- 新增 `source.translationCallees`，支持显式登记 `translate`、`i18nBridge.lookup` 等项目自定义翻译封装。
- 扫描发现无法解析的 `t(variable)` / 动态 `v-t` 时，无 occurrence 词条不再被认定为死键，而是以 `unresolved_dynamic_source` 进入人工确认。
- 纯动态 occurrence 的 Agent 任务第一次失败后由服务端直接转人工，不再依赖 Agent 遵循提示词完成防循环。
- 截图哈希成为证据表的独立身份列，同一任务的相同哈希全局去重；相同像素不会由较低等级的新观察覆盖高等级来源。
- 截图改用内容寻址文件名，重复捕获复用同一文件，避免时间戳截图形成孤儿文件。

## 性能与可维护性

- 会话创建一次批量加载 occurrence，任务列表和分页一次批量 hydrate，消除核心路径中的逐 Key SQLite 查询。
- 状态接口新增 `evidenceCount`、`capturedKeyCount`、`historicalEvidenceCount`、`duplicateHashCount`；旧字段继续兼容，但不再把不同像素的历史状态称为重复。
- Studio 改为按需注册 Element Plus 组件。
- TypeScript 开启未使用变量和参数检查，新增统一 `pnpm lint` 门禁。
- 新增版本一致性检查，确保根包、内部包、CLI、README、发布说明同步。

## 验证

- 新增真实 Chrome 烟测：执行导航、点击、运行时 Key 定位、截图和 SHA-256 校验；普通 CI 和发布 CI 均执行。
- 新增超过 200 个动态候选、自定义翻译封装、动态不确定分类、动态任务单次失败、旧库迁移、非相邻哈希去重和证据等级保留测试。
