# Collect I18n v0.3.10 性能分析（1000 词条 OMS 应用）

> 验证目标：修复 v0.3.9 的 `page.evaluate` 作用域回归后，在真实复杂应用（Vite + Element Plus + vue-router hash + vue-i18n JSON，1000 词条）上的采集准确率与执行效率。
> 工程栈：Vite(base=`/oms/web`) + Vue3 + Element Plus + vue-router（hash 模式、全部路由懒加载）+ vue-i18n；中文/英文词条分 `zh-cn`/`en-us` 两个目录、json 文件名作为第一层 key；启动时注入 `x-gde-locale=zh_CN` cookie。

## 1. 结论

| 指标 | v0.3.8（基线） | v0.3.9（回归） | **v0.3.10（本次）** |
|---|---|---|---|
| captured | 764（76.4%） | **0** | **765（76.5%）** |
| uniqueScreenshotCount | — | 0 | 765 |
| duplicateEvidenceCount | 0 | 0 | 1 |
| failed | 0 | 0 | 0 |
| needs_manual | 81 | 0（938 被误标记 needs_agent） | 80 |
| skipped（no_source） | 155 | 0 | 155 |
| 总耗时 | ~2h26m | —（全程失败） | **~1h28m** |
| 工作簿 | 1000 行 × 4 列 | — | 1000 行 × 4 列，4004/4004 单元格有边框，嵌入 765 张截图 |

v0.3.10 修复了 v0.3.9 的关键回归，采集成功率恢复并小幅超过 v0.3.8 基线，且总耗时从 ~2h26m 缩短到 ~1h28m。

## 2. 回归根因（v0.3.9 → v0.3.10）

- **根因**：`targetBlockedByLoading` 在 `page.evaluate` 回调内引用了模块级函数 `isLoadingElement`，浏览器页面上下文无法访问，抛出 `ReferenceError: isLoadingElement is not defined`。单条路由失败会把该路由全部 pending 任务降级为 `needs_agent`，1000 词条验证中 938 条被错误标记。
- **单元测试盲区**：测试 mock 了 `page.evaluate`，无法发现作用域序列化问题；本次新增真实浏览器回归（对 7 条路由执行 open→inspectRuntimeSettled→capture）。
- **附带加固**：`settleNavigation` 不再依赖「资源计数静默 300ms」（轮询接口/Vite HMR 页面永不静默会固定等待 6s），改为「连续两次干净采样即返回 + 资源持续变化时最多再等 1s」，覆盖懒加载 chunk 又不卡采集。

## 3. 本次运行时间线（session_4865e7d5）

| 阶段 | 时间 | 结果 |
|---|---|---|
| 确定性采集 | 19:24 → 19:34（~11min） | captured=495，failed=0（v0.3.9 同阶段为 0） |
| Agent 阶段（首次驱动） | 19:34 → 20:16 | +25 键（advanced 树/弹层计划），后因模型对死键重复分析陷入循环退出 |
| Agent 阶段（恢复 R1） | 20:16 → 20:24 | 最简计划逐键处理，交互类键大多诚实转 needs_manual |
| Agent 阶段（恢复 R2，分页策略） | 20:24 → 20:51 | **一条 /orders 分页计划批量 +79 键**（orders.rows.16-42 的 amount/customer/orderNo），队列清零 |
| finalize + export | 20:51 | 765 captured / 155 skipped / 80 needs_manual / 0 failed |

## 4. 准确率优先的验证点

- **懒加载路由**：全部 7 条路由为 `component: () => import(...)`；`open()` 后先等运行时就绪再 settle（loading 遮罩 + pending 描述符 + 干净采样），确定性阶段 7 条路由全部成功打开，无「键未挂载」整路由回退。
- **mock 数据不全**：指标卡/表格在 mock 数据到达后渲染；确定性阶段对「首屏未挂载」键诚实 defer，Agent 阶段用 15s `waitForKey` 重试。最终 `dashboard.metric.newUsers / pendingOrders / visits`、`orders.rows.N.payMethod`、`products.rows.N.category` 等确认为**死键**（源码渲染的是 `orders.pay.*` / `products.category.*` / `dashboard.metric.totalUsers` 等动态 key），走 `no_source_occurrence`/needs_manual 而非伪造。
- **截图 loading 保护**：`screenshotEvidence` 在画标记前检查目标中心是否被 loading 遮罩覆盖，5s 内不清除则跳过该键；本次 766 张截图仅 1 张重复（滚动/时间戳变化导致内容相同），**0 张 spinner 截图**。

## 5. 从「准确率优先、执行效率次之」的可改进点

1. **分析阶段预分类死键（准确率+效率双收）**：155 个 `skippedNoSource` + 92 个死行键（`orders.rows.*.payMethod`、`products.rows.*.category`）在源码中无任何 `t()` 调用点。在 `analyze` 阶段即可标记「dead/renamed_to」，避免 Agent 逐键空跑，同时保留在输出中供人工核对，不静默删除。
2. **分页扫描计划自动生成（已验证高收益）**：一条 /orders 翻 3 页计划一次 execute 批量采集约 79 键。CLI 可在发现 `.el-pagination` 时自动生成「翻页 sweep」计划（goto → 翻 N 页 → 每页 capture），把高扇出表格从「Agent 逐键交互」降为「一次计划批量采集」，准确率不变、效率数量级提升。
3. **动态 key 溯源**：`t(\`orders.pay.${pay}\`)`、`t(category.labelKey)` 这类动态 key 通过 derived occurrence 正常采集，但静态 JSON 中对应的 `orders.rows.N.payMethod` 仍是死键。建议在运行时把「渲染出的动态 key 集合」回写为静态键的 `renamed_to` 提示，方便译者确认迁移关系。
4. **CLI 批量 Agent 循环（降低对模型循环的依赖）**：本次需要 3 次 Claude Code 驱动（首次模型对死键重复分析陷入循环）。可提供 `agent-loop` 批量模式：对可路由键自动生成「goto+waitForKey 15s+capture」计划并执行（2 次重试），仅将新交互模式交给 LLM 规划；既消除模型重复循环，又保持因果校验的准确率防线。
5. **waitForKey 默认时长**：保留 15s 计划默认值（懒加载 + mock 慢响应足够），上限 60s 兜底；`settleNavigation` 的 6s 上限在正常页面 ~300ms 即返回，不构成瓶颈。

## 6. 验证产物

- 工作簿：`examples/oms-complex-app/.collect-i18n/oms-v0.3.10.xlsx`（1000 行，中文/英文/截图/Key Path 四列，全边框，765 张内嵌截图）。
- 截图证据：`examples/oms-complex-app/.collect-i18n/evidence/session_4865e7d5-8b6a-4e8f-9139-1599733ee2a7/`（766 张 PNG，1440×900）。
- 真实浏览器回归 harness：对 7 条路由 open→inspectRuntimeSettled→capture 全通过（单路由 1.0–3.8s）。
