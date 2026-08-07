# Collect I18n v0.3.2

此版本聚焦大型真实 Vue 项目的词条覆盖、Agent 路由批处理效率和 Element Plus 交互稳定性。

## 主要改进

- 静态分析可解析本地对象、数组与映射表中的动态 `t(...)` 调用，并结合语言包目录展开有界动态 key。
- Agent 按真实路由的未解决词条数量调度；`routeBatch` 提供全量 section/kind/service 统计、全部相关源码文件和最多 12 条代表样本，避免模型逐词条枚举。
- TriggerPlan 新增 `capture` 检查点，一次路由操作可在初始页、表单校验、弹窗、抽屉、表格、请求结果和 Element Plus 消息等多个状态持续采集证据。
- radio/checkbox 的语义定位会自动通过可见 label 激活被组件库包装的原生控件，无需为 Element Plus 编写专用选择器。
- Element Plus 异步 MessageBox 校验在 Promise 完成前保留命令式调用归因，避免回调中的词条降级为文本猜测。
- `run` 自动选择空闲本机端口，并将用户提供的端到端截止时间持久化；`agent next` 返回准确剩余秒数并在到期时停止分配新任务。
- Excel 始终仅包含 `中文`、`英文`、`截图`、`Key Path` 四列；无截图词条保持截图列为空。

## 1000 词条验收

真实 Vue 3/Vite/Vue I18n/Element Plus 项目包含 12 个路由与 1000 个词条，覆盖 JS 映射消息、表单校验、表格列、动态状态、Teleport 和命令式消息。验收工作簿为 1000 行四列，所有嵌入截图均通过截图哈希与所属 Key 的运行时证据交叉校验，未发现图片与词条错配。
