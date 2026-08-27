# v0.3.17 发布说明

针对确定性采集覆盖与导出可甄别性的第四轮改进:虚拟列表滚动直达、瞬时锚点扫描的架构加固,以及死键导出标注。

## 虚拟列表滚动采集(R3 扩展)

- `scrollForCapture` 不再只滚动窗口:自动识别页面内 overflow 为 `auto`/`scroll` 的滚动容器(按可滚动余量取前 3 个,如 Element Plus 虚拟表格 body),与窗口同步步进/直达底部。此前虚拟表格第 2 页及以后的行词条永远不可见,只能沉入 Agent 队列或人工队列。
- 确定性滚屏轮次从固定 3 步扩展到最多 12 步,并新增稳定性早退:某一步既无新可见键也无新证据时(且已至少滚 2 步)提前结束,不再空耗窗口时间。

## 瞬时 toast 锚点扫描:架构加固 + 精度/性能

- **修复生产隐患**:v0.3.16 的 exact-text 叶子扫描在 playwright `evaluate` 回调内直接引用打包后的模块函数——回调会被序列化到页面上下文执行,模块标识符并不存在,扫描路径一旦真正执行即抛 `ReferenceError`。现改为:浏览器侧只负责采集候选叶子几何数据(textContent 预筛,不触发布局重排;优先遍历位于 `.el-message` / `.el-message-box` / `.el-notification` / `role=alert|dialog` 等 imperative 宿主内的叶子),**精确匹配决策全部移到 Node 侧**由 `pickExactTextMatch` 完成——与单元测试守护的是同一段生产代码。
- **同文案静态元素不再遮蔽真实锚点**:imperative 宿主内的叶子优先命中,解决「首叶先得」可能把静态同文案元素误归为 toast 锚点的问题。
- `textMatch.ts` 新增 `pickExactTextMatch` 纯函数与生产决策单测。

## 死键导出标注(截图列=死键)

- 新增第三类导出标注:`needs_manual` 且**无任何源码 occurrence** 的键(被未解析动态调用保护挡在 `skipped` 之外的不可达键)在导出中排在正常词条之后、废弃词条之前,截图列填写「死键」(灰色斜体居中)。审稿人无需逐一排查即可直接清理。
- `localeCatalog` 同步返回 `deadKey` 标记(基于 occurrences 表计数子查询)。

## 实测(oms-complex-app,v0.3.17 引擎)

- **端到端验证通过**:`run` 30 分钟窗口纯确定性阶段(无 Agent 计划)排空 1000 键队列,captured 375、failed 0、`nextAction=agent` 正确;工作簿 1000 行/375 图正常导出。
- **死键标注验证**:155 个死键(无源码 occurrence、被未解析动态调用保护)全部在导出中标注「死键」,并恰好占据数据区末尾 155 行(第 847-1001 行),置底分组与字母序均正确;`finalize` 后 470 个未解决键正确收拢为 `needs_manual`。
- 门禁:typecheck 11 包通过、测试 **177/177**、e2e **2/2**(真实 Chrome)、lint:version 0.3.17 一致。滚动容器步进由 e2e 与真实运行覆盖;其对分页型表格(users 第 2/3 页需点击翻页)增益有限,主要收益面向虚拟滚动列表。

## 文档

- `docs/cli-reference.md` 与 `skill/collect-i18n/SKILL.md` 补充死键导出标注说明。
