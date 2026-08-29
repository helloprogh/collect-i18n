# v0.7.0 发布说明

发布主题：**真实调用验证驱动的修复 + 收集率与可靠性收尾**。本版本最重要的变化是：发布前首次对打包产物做了真实链路验证（打包 skill 对 1000 词条基准项目完整 run、真实 dsh CLI 安装插件），并借此发现并修复了一个自 v0.5.0 起就存在的后台守护进程启动 bug。

## 关键修复

### 后台守护进程把 node.exe 当入口脚本解析（v0.5.0 引入的真实回归）
- `startBackground` 构造的 `commandLine` 已含前置 `process.execPath`，而 `spawn(process.execPath, commandLine)` 又传入一次：daemon 的实际 argv 变成 `[node, node, bin.js, ...]`，node 把 node.exe 当作入口脚本解析（PE/MZ 语法错误），**任何真实的后台启动都会在写出 service.json 前静默死亡**，表现为「后台服务启动超时」；
- v0.5.0 发布说明中的「run 后台孵化在无控制台宿主下不可靠，新增 --foreground」正是该 bug 的症状，当时被当作环境问题用 `--foreground` 绕过；
- 现在 `commandLine` 只含脚本与参数，`buildServeCommand` 抽为可单测的纯模块，回归测试断言 argv 中不出现 node 可执行文件；
- 真实验证闭环：修复后打包 skill 对 1000 词条项目 run，后台 daemon 正常启动（service.json/service.lock 落盘、Vite 与 Chrome 拉起）、采集与导出完成、`stop` 干净退出。

## 收集率与吞吐

- **registry 变更批处理去重**：MutationObserver 回调先统一处理移除树与属性目标，再对去重后的最顶层根每根只扫一次——此前每条 mutation 记录都对目标子树全量扫描，深 DOM 页面可能饿死采集器自身的 page.evaluate；
- **canary 探针解析缓存**：探针载荷按原始字符串缓存，不再在每个翻译值渲染时重复 JSON.parse sessionStorage；
- **Agent 队列跨上限完整**：`nextAgentTask` / `agentRouteBatch` / Agent 检查点批量捕获改用游标分页列举，超过 2000 条的 Agent 队列不再被静默截断（回归测试覆盖 2101 条队列的尾锚点可达）；
- **注释误报清除**：静态扫描的引号字面量兜底不再命中 JS/HTML 注释——只在注释中出现的 key 保持可被判为死键，不再消耗 Agent 尝试预算；
- **walkAst 去 O(depth²) 拷贝**：祖先数组改为 push/pop 共享，大文件扫描分配开销显著下降。

## 可靠性

- 任务状态迁移守卫（`markTask` 可选 expected 状态集）应用于确定性队列与 Agent 执行的全部降级写点：CLI 自动驱动与后台服务双进程并发时，已 captured 的任务不会被回退；
- auto-drive 以任务真实状态判定失败：HTTP 调用失败但任务已捕获时不再计入连续失败、不再降级；
- 服务启动互斥锁（`service.lock`，O_EXCL + PID 存活探测 + 死锁自动接管）：并发 start 快速失败并给出可操作提示，不再打断启动中服务的会话；
- `browser.controls` 交互定位配置化：下拉选项 / 对话框 / toast 宿主三组选择器可按项目追加（内置 Element Plus + ARIA + Ant Design/naive-ui/Arco 兜底），追加语义与 `loadingSelectors` 一致；
- R7 sweep 默认值补充侧边栏折叠子菜单展开（`.el-sub-menu__title`，纯客户端状态）。

## 工程与防漂移

- `build-dsh-plugin --check` 升级为逐字节内容比对（skill 源 / 引擎 bundle / runtime dist），进入 CI 与 release workflow；`check-version` 纳入 plugin manifest；
- 文档刷新：README/架构/安全文档同步外置状态根模型与 `service.lock`，仓库结构补齐 plugins/benchmarks。

## 真实验证记录

- **Skill 链路**：`pnpm package:skill` 产物解压后，对 1000 词条基准项目执行完整 `run`（确定性窗口 4 分钟、截止 12 分钟）：daemon 正常启动、确定性捕获 404 条（0 失败）、`nextAction: deterministic_continue`、导出 1000 行 Excel（466 张嵌入截图、严格四列）、`stop` 干净退出；
- **DSH 插件链路**：真实 `dsh plugin --profile validate add <tgz>` 安装成功；`dsh --dump-config` 确认插件挂载；从安装位置调用插件 CLI `--version` 与 `doctor`（6/6 检查通过）；skill 镜像与源逐字节一致；
- 单测 197/197、真实 Chrome e2e 2/2、lint（含版本一致性与插件内容校验）全绿。

## 升级

- 无破坏性变更；此前依赖 `run --foreground` 的用户可恢复默认后台模式（本次修复的正是该路径）。
