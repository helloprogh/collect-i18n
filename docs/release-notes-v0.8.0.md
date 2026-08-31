# v0.8.0 发布说明

发布主题：**Skill 协议连续性修复 + 契约收敛 + 采集路径维护性**。本版本修复了自 v0.5.0 起 `run` 与 Skill 协议之间的会话生命周期断裂（这正是真实发布验证暴露的「采集命令说继续、会话却被关闭」问题），把协议 schema 收敛到与实现一致并加漂移守护，同时合并了三条扫描通道的重复实现、加固了浏览器崩溃判定。

## 关键修复

### run 不再卡死 Skill 的后续流程（v0.5.0 以来的协议断裂）
- `run` 在输出 `nextAction: deterministic_continue` 的同时却把会话**无条件关闭为 stopped**：Skill 按文档「会话仍在运行、继续轮询」操作的是一个死会话，Agent/人工证据写入被「会话已结束」守卫拒绝，且对存活服务执行 `start --session` 只复用描述符、不恢复会话——所有文档化后续步骤全部卡死；
- 现在 `run` 在仍有剩余工作时（deterministic_continue / agent / manual）**保持会话 running**；仅 complete / failed / restart 关闭；
- 新增 `POST /api/deterministic/resume`：deterministic_continue 时 run 在存活服务上重新拉起确定性队列，Skill 的「继续轮询 status」能看到持续进展（幂等，队列守卫去重）；
- `ensureSessionService` 加固：Agent/人工命令复用存活服务但会话处于 stopped 时，经 `POST /api/session/resume` 自动恢复（补齐 SKILL.md 承诺的恢复语义，文档已同步）。

### 协议 schema 收敛 + 漂移守护
- `SessionStatusSchema` 从 8 个从未被写入方产出的「愿景状态」收敛为真实生命周期四态（running / stopped / interrupted / failed）；
- `SessionSummarySchema` / 新增 `SessionCountsSchema` 对齐 `status()` 实际输出；`EvidenceSchema` 对齐存储的证据 JSON；
- 新增漂移守护测试：`status()` 的 counts 与存储的证据行必须持续通过 core schema 校验——store 侧任何改名不再能无声破坏 JSON 协议消费方（Skill / DSH 工具 / 工作台）。

## 采集路径维护性

- **R3/R7/R8 三条扫描通道合并重复尾部**：完全相同的「过滤可见池 → 批量解析截图 → 记录结果」逻辑（约 60 行 × 3）收敛为 `captureVisibleSummaries`，各通道保留自己的驱动方式与空转退出规则（交互通道的 dismiss 时序经 `beforeBatch` 钩子精确保留）；调度测试全量通过证明行为等价；
- **浏览器崩溃判定加固**：`isBrowserGoneError` 的 Playwright 消息集从 4 条扩充到 17 条（browser closed/died/disconnected、target/page/context closed、CDP 连接丢失等），大小写不敏感并容忍尾点——漏报一条会把「可自愈的浏览器崩溃」变成任务失败；
- **大导出流式下载**：`/api/export-file` 改为流式响应，不再把整个截图密集型工作簿读进内存。

## 交付与工程

- 工作台对任务列表与计数不一致从抛错中断降级为告警；
- 导入上传文件名加随机后缀，防同毫秒并发覆盖；
- mock `url` 匹配语义文档化：`/` 前缀规则只匹配 pathname（忽略 query），glob 规则匹配完整 URL——需要区分 query 变体的计划使用 glob 形式；
- README 基准项目描述修正为「千词条级」（旧值 601 已过期），release notes 索引补齐早期 5 篇；
- architecture.md 新增「自动采集通道」一节（R2-R9 顺序、canary 提升、run 会话语义）。

## 验证

- 单测 **200/200**（新增：schema 漂移守护、isBrowserGoneError 消息矩阵）；
- 真实 Chrome e2e 2/2；lint（含版本一致性与插件逐字节校验）全绿；
- **打包产物冒烟**（每次 push/PR 与发布前的固定关卡）：skill zip 解压 → 1000 词条项目完整 run（后台 daemon + headless Chrome，0 失败）→ 四列工作簿校验 → 干净 stop；dsh tarball 打包解压后引擎 `--version` / `doctor` 通过；
- 本轮两轮提交的 CI（含冒烟）均 completed/success。

## 升级

- 无破坏性变更；Excel 四列格式、config schema、CLI JSON 协议不变；
- 新增两个服务端点（`/api/deterministic/resume`、`/api/session/resume`）仅改变 `run` / `agent execute` / `manual open` 的内部衔接，Skill 无需改动（文档语义本就如此，本次让实现与文档一致）。