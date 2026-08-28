# v0.6.0 发布说明

发布主题：**自动化收集率提升**。围绕「更多词条由确定性队列与 Agent 自动完成、更少落入人工队列、采集过程不中断」落地一批引擎级修复：统一翻译调用识别、消除大项目静默截断、打通自定义路径别名的路由链路、把交互定位层扩展到 Element Plus 之外，并修复一批会导致采集中断或证据错配的并发缺陷。

## 核心新能力

### 1. 自定义翻译封装函数的运行时插桩（翻译调用识别统一）
- 静态分析（analyzer）与 Vite 插桩（vite-vue）此前各自实现 `isTranslationCallee` 且已分叉：配置 `source.translationCallees` 后，静态侧能扫到 occurrence，但运行时**永不插桩**，这些词条拿不到任何运行时证据，全部落入 Agent 队列；
- 现在识别逻辑收敛到 `@collect-i18n/core` 的共享模块（`dottedCalleeName` / `isTranslationCalleeName`），vite-vue 插桩遵守同一份 `source.translationCallees` 配置并从 CLI 透传，既有配置从此完整生效；
- 同时收紧 `xx.t()` 形式的误报面（仅 `i18n` / `locale` / `translator` 对象命中），两侧共用同一判定；
- 新增回归测试：配置封装函数后插桩生效，且运行时 occurrence ID 与静态分析逐字对齐。

### 2. 大项目静默截断修复
- 路由分组改用游标分页的 `listAllTasks`；滚动（R3）/ 组件（R7）/ 交互（R8）/ 镜像（R9）四个 sweep pass 与机会池改用轻量的 `listTaskSummaries`（不加载 occurrences，分页遍历无额外开销）；
- 此前默认 LIMIT 500 使超过 500 个未解决词条的项目只能看到 key_path 序前 500 条，尾部词条的确定性自动采集机会被无声丢弃且无任何告警；现在池子完整，且回归测试覆盖 601 个任务跨上限的完整枚举。

### 3. tsconfig/jsconfig 路径别名解析
- analyzer 自动读取项目 `tsconfig.json` / `jsconfig.json` 的 `compilerOptions.paths`（支持 extends 链与 baseUrl），路由通过 `@views/...`、`#lib/...` 等自定义别名导入组件时，route → component → occurrence 链路保持完整；
- 此类别名导入此前解析为零候选，相关组件内全部词条丢失高置信度路由提示、失去确定性队列资格；现在无需在采集工具侧做任何配置即可恢复；
- 无别名项目零影响（仅两次配置文件读取）。

### 4. 交互定位层通用化
- `select` 步骤的下拉项解析在 Element Plus 之外依次增加：ARIA `[role="option"]`（原有）→ Ant Design / naive-ui / Arco 的 option 类名 → 浮层内可见文本兜底；
- 对话框启发式增加 `.ant-modal` / `.n-modal` / `.arco-modal`；登录提交按钮默认选择器与 exact-text 宿主列表同样扩展；
- 非 Element Plus 项目的 Agent 计划与确定性 select 流程成功率提升；定位层口径与 README 一致：**检测/等待层可配置、证据层通用、交互定位层 EL-first + 通用兜底**。

## 可靠性修复（防采集中断与证据错配）

- **executePlan 超时不再可能崩溃服务进程**：deadline 竞速失败后仍在运行的 execution promise 补上 observer，消除 unhandledRejection 风险；
- **因果 canary 探针隔离**：探针改为显式 `probePage`，不再临时切换 `this.page`（此前并发的 deadline timer / ensureHealthy 可能落到错误的页面）；探针结束后**恢复调用方原有的 Mock 规则**（此前会被清空或改写，污染后续请求语义）；
- **命令式调用兜底超时**：ElMessage 等包装的 promise 永不 settle 时（如被吞掉的弹窗 promise），10 分钟后自动清理，stale invocation 不再永久匹配后续渲染；
- **findTextRanges 空白失配修复**：归一化文本命中但原始节点含连续空白时，用空白柔性正则把范围映射回真实文本，截图框不再退化为整个文本节点；`rescan` 增加 `defaultView=null`（页面卸载窗口期）边界防护；
- **插桩失败可观测**：vite-vue 解析失败从静默返回空结果改为 dev-server 日志告警（此前覆盖损失完全不可见）。

## 交付与工程

- Excel 导出遇到磁盘上已丢失的截图文件降级为空单元格（兑现「缺证据留空」的交付承诺，此前整个导出失败）；扩展名不符 / 哈希校验失败仍然严格拒绝；
- `waitForDeterministicQueue` 轮询循环复用单个 store 连接（此前每 500ms 重开库并全量跑迁移）；
- 同步 dsh 插件 SKILL.md 与引擎 bundle，修复「v0.4.0 说明 + v0.5.0 引擎」的漂移（该漂移曾连续两个版本窗口发生）；
- 仓库卫生：清理临时调试文件，`.gitignore` 增加 `.tmp-*`。

## 验证

- typecheck 全部通过；单测 **185/185**（新增 4 个回归测试：translationCallees 插桩与 ID 对齐、tsconfig 别名路由提示、601 任务跨 500 上限完整枚举、截图文件丢失降级）；
- 真实 Chrome e2e **2/2**（TriggerPlan 执行产出 A 级证据 + 100 词条批量采集 13s）；
- 601 词条基准项目 `verify-project` + Vite build 通过；
- Skill 校验与版本一致性检查通过。

## 升级

- 无破坏性变更；Excel 四列格式不变；`source.translationCallees` 为既有配置项，本次起对插桩侧完整生效；
- 已发布 skill 包的 DSH 用户请同步更新插件（内含引擎 bundle 与 SKILL.md 一致性修复）。
