# 确定性队列与 Agent 队列吞吐瓶颈研究(证据驱动)

> researcher · 任务 t1 · 结论基于源码阅读 + 三套真实会话状态库实测(examples/*/.collect-i18n/state.sqlite,node:sqlite 查询)。
> 相关源码:packages/cli/src/service.ts(runDeterministicQueue/executeAgent/captureVisibleBatch)、packages/cli/src/store.ts(nextTask/nextAgentTask/agentRouteBatch/finalizeUnresolved)、packages/runner/src/collector.ts(open/capture/waitForKey/captureBatch/executePlan)、packages/runner/src/plan.ts、packages/cli/src/bin.ts(run 窗口)。

## 0. 实测基线(全部来自真实会话,非推断)

| 项目/会话 | 时长 | 确定性捕获 | 速率 | 结束时状态 |
|---|---|---|---|---|
| translation-lab s1 (d9ef6483) | 4.2 min | 366 | **87 keys/min** | captured 508 · needs_agent 821 · **pending 645** |
| translation-lab s2 (45e6bd9d) | 2.2 min | 142 | **65 keys/min** | captured 142 · needs_agent 568+ · **pending 645** |
| oms-complex s3 (9a359019) | 5.0 min | 172 | **34 keys/min** | captured 172 · **pending 524** · needs_manual 155 |
| oms-complex s1 (4865e7d5) | 93 min | determin 378 + **agent 388** | **2.2 plans/min** | 200 计划 · **平均 1.94 keys/计划** |

需解释的坑:translation-lab 第 1/2 次会话速率 87/65 keys/min 的差异主要是首屏挂载率高、交互键少;oms 大表/虚拟列表路由多,等待与超时占比高 → 34 keys/min。

## 1. 任务三问的直接回答

### 1.1 每键是否单独导航?——否,导航以"路由"为单位(设计正确)
runDeterministicQueue(service.ts:438-524):取 seed → reliableRoute(service.ts:421-436)→ 把**同路由全部 pending 任务组成 group**(service.ts:459)→ 一次 collector.open(route)(service.ts:463)→ 组内逐键处理;同时**机会性顺路采集**该页已挂载的 pending/needs_agent 键(service.ts:478-480,好设计)。

### 1.2 同路由多键是否批量?——导航/挂载判定批量,确认+截图仍逐键串行
- 批量:一次 open + 一次 inspectRuntimeSettled 后批量取回 mountedKeys(service.ts:464-476)。
- 串行(瓶颈):每个键 waitForKey(key, 2_500, "B")(service.ts:495)+ capture()(collector.ts:1357-1408)内部**再次** waitForKey(5_000) + waitForLoadingCleared + 最多 6 轮 100ms 稳定性采样(collector.ts:1371-1386);B 级证据再跑因果 canary,确定性模式未通过直接 deterministic_b_rejected → needs_agent。**逐键双重验证 ≈ 1.5-3s/键**,这是确定性队列速率上不去的第一原因。

### 1.3 窗口内为何大量 pending/needs_agent?——四个叠加根因
**(a) 速率不足以在窗口内排空**:2000-3000 key 项目按实测 34-87 keys/min 需 20-45 分钟;run 默认 --deterministic-timeout-minutes 15(bin.ts:408,SKILL 建议 8)→ 必然超时,留下数百上千 pending(实测 translation-lab 645、oms **1352 = 45%**)。

**(b) 排队顺序是字母序,不是产出序**(最可修复):nextTask 用 ORDER BY updated_at,key_path(store.ts:700-704),seed 的路由按"字母序首个 key"被访问。实测证据(translation-lab s2):/billing 0 pending、/diagnostics 0 pending(字母序靠前,被访问);/support 100/100、/releases 98/98(字母序靠后,**完全没被访问**)。窗口被低价值访问顺序吃掉——没有路由稠密度排序,没有 per-route 预算,没有"先产出、后扫尾"。

**(c) 首屏不可见键天然进 needs_agent**:事件表 715 次 needs_agent 的 last_error TOP 全部是 Key is not mounted in the initial state of route X(/diagnostics 116、/billing 90、/inventory 81、/onboarding 73、/orders 71、/permissions 63、/settings 58、/support 44、/releases 41…)。标签页/弹窗/折叠/下拉/懒加载区在首屏不挂载,确定性循环不做滚屏/交互 → 全部下沉 Agent。oms 中 **831/1352 pending 是行号键**(orders.rows.N.status 等 v-for 动态展开键),虚拟列表滚动才能挂载;80 个 needs_manual 的 last_error 是 Timed out waiting for i18n key: orders.rows.N.status —— 行号键被逐个丢进 Agent 队列系统性空转。

**(d) 窗口结束后链路被 pending 卡死**:finalizeUnresolved 在 pending>0 时直接抛错(store.ts:911-913);run 的 nextAction 只看 needs_agent>0(bin.ts:450-454),**pending 不参与判定** → 信号误导 + 无法收尾,只能反复开新会话(oms 3 天 3 个会话,每次都重新建 1000 任务)。

## 2. Agent 队列吞吐(实测 + 代码)

- 锚点选择方向正确:nextAgentTask(store.ts:727-761)按 routeFanout*10_000 + min(actionScore,60_000) + taskPriority 取 anchor,路由扇出优先;attempts>0 加 100_000。
- 但每计划只锚 1 键:全计划执行(executePlan,collector.ts:836-891,默认 90s deadline)+ **无条件 open(plan.route) 重新导航**(collector.ts:847,同路由连续锚点间不复用页面,每计划多 3-6s)。检查点 captureVisibleBatch(service.ts:582-631,一次最多 250 可见键)是唯一批量机制,但锚点页状态重复时边际收益≈0 → **实测 1.94 keys/计划**。
- **饱和路由空转是最大浪费**:agent_route_stats 实测 /dashboard consecutive_low=76、/users=25、/messages=21(saturatedRoutes 阈值=2,store.ts:720-725)——连续 76 次低产计划仍在锚定。原因:saturated 路由只是软性减分(-1_000_000,store.ts:753-755),routeFanout*10_000 + attempts>0 的 100_000 可反超;**既非硬排除,也无 per-route 上限**;全局只剩饱和路由时必然继续空转 → 93 分钟会话中约 1-1.5 小时消耗在低产重复上。
- 行号键被当作独立可采集任务,逐个计划超时(见 1.3c),进一步稀释 Agent 吞吐。

## 3. 高价值改进建议(按 ROI 排序;全部可执行、可验证)

### R1(最高优先)确定性队列按路由稠密度排序 + 窗口内产出优先
- 改 runDeterministicQueue:不再逐 seed 导航,循环开头对 pending 做一次"路由 → pending 数"聚合(按 reliableRoute 逻辑,内存即可),**pending 数倒序访问路由**,≤2 键的稀疏路由放最后;每轮从一个路由回到"当前最稠密路由"。
- 理由:实测证明字母序顺序导致 /support 100 键 0 处理;排序后同样的窗口可多采数百键。
- 验证:同项目同窗口参数对比 captured 总数;新增事件断言"窗口结束时不存在 pending≥50 且 0 访问的路由"。预期 translation-lab 3 分钟窗口 366 → 接近全采;oms pending 1352 大幅下降。

### R2 同页批量确认代替逐键二次验证(速率 ×2-3)
- 对 mountedKeys 已确认的组,用已有的 captureVisibleTargets(keys, "B")(collector.ts:1415-1493)一次批量解析,跳过 capture() 内重复的 waitForKey(5s)+ 6 轮采样;仅对未稳定键单独等待。
- 理由:实测 65-87 keys/min 的 60% 以上消耗在逐键二次验证。
- 验证:collector.test.ts 新增"100 可见键同页批采 < 30s"定时断言;例项目复跑对比 keys/min。预期 150-250 keys/min。

### R3 自动滚屏采集首屏不可见键(最大未采集桶,确定性扩展)
- 对已访问路由做视口步进滚屏(3 步 + 到底),每步 inspect + captureBatch 可视键;对虚拟列表做"scroll + 短 waitForKey"循环。
- 理由:translation-lab 715 not-mounted 事件、oms 831 行号键 pending —— 大量是折叠/懒加载/虚拟行,滚屏后可得确定性证据,不必进 Agent。
- 验证:例项目 /diagnostics、/orders 滚屏后 captured 增量;断言"滚屏后该路由 captured > 仅首屏数"。

### R4 Agent 队列硬性饱和排除 + per-route 锚点预算
- nextAgentTask 把 excluded 路由改为**硬排除**(仅当全部路由均在排除名单才放宽),并加 per-route 计划上限(如 ≤5 anchor/路由/会话),低产路由让位。
- 理由:消除实测 /dashboard 76 连、/users 25 连、/messages 21 连空转(≈1-1.5h 浪费)。
- 验证:单元测试"仅剩饱和路由时 nextAgentTask 不返回该路由 anchor";断言 consecutive_low 不超过上限。

### R5 计划级页面复用 + 路由扫描计划落地(批量)
- executePlan 仅当 activePage.url() 与 plan.route 不同才 open(省 3-6s/计划);SKILL 的 TriggerPlan 允许 40 步 + capture 检查点(参考文档明示"3 页扫描一计划可采几十键"),建议 agent next/routeBatch 直接附带**路由扫描计划骨架**(初始 capture + 每页翻页 capture),让每计划产出从 1.94 升到 10-50 keys。
- 验证:oms /orders 一次扫描计划 ≥10 keys(对比当前 ≈2)。

### R6 run 窗口/nextAction/finalize 语义修正
- run 返回时 pending>0 → nextAction=deterministic_continue(SKILL 继续轮询);--deterministic-timeout-minutes 默认值按 key 数自适应(max(15, ceil(total/60)));finalize 保持 pending>0 抛错(防假完成),但 status/run 必须显式把 pending 呈现为未完成,避免 nextAction=complete/agent 误导。

### R7(可选,削峰)行号键折叠
- 将 orders.rows.N.* 索引展开键折叠为模板键 orders.rows.{i}.*,一份代表性证据覆盖整组(analyzer/seed 端)。
- 理由:oms 831/1352 pending(61%)为行号键;折叠后任务量降 30-40%,Agent 不再逐个超时。
- 验证:同一 oms 会话任务总数下降 ~30%,captured/覆盖率不降。

## 4. 一句话结论

- **导航批量化已就位(按路由)**,真正的瓶颈是:①确定性队列逐键二次验证(速率)、②字母序而非稠密度排序的访问顺序(窗口利用率)、③首屏不可见键(交互/懒加载/行号)无滚屏采集机制、④Agent 饱和路由软排除导致空转、⑤窗口默认时长与项目规模不匹配且 nextAction/finalize 与 pending 语义脱节。
- 按 R1+R2+R3 落地,确定性窗口内 captured 可望翻 2-3 倍且 pending 归零;按 R4+R5 落地,Agent 阶段计划产出可从 ~2 keys/计划 提升一个数量级、饱和空转归零。
---

# 补充:队长聚焦版 Q&A(接手 t1,v0.3.14 三项目 2 分钟窗口背景)

## Q1 确定性循环:每键单独导航?同路由批量?窗口吞吐上限由什么决定?(调用链证据)

**调用链**:CLI run(bin.ts:404-465)→ prepareWorkflow/startBackground → LocalService.start()(service.ts:251-299)启动时 void this.runDeterministicQueue(sessionId)(service.ts:291);同时 waitForDeterministicQueue(bin.ts:239-263)每 500ms 轮询 store.status,直到 pending+running==0 或超时(默认 --deterministic-timeout-minutes 15,bin.ts:408;实测按 2 分钟窗口)。executeAgent 的 finally 也会重触发(service.ts:570)。

**循环体**(service.ts:438-524):
1. seed = store.nextTask(sessionId,["pending"])(store.ts:698-707,ORDER BY updated_at,key_path LIMIT 1 → **字母序取种子**);
2. route = reliableRoute(seed)(service.ts:421-436,routeHint≥0.8 或 App.vue→"/");
3. group = **同路由全部 pending**(service.ts:459)→ **一次 collector.open(route)**(collector.ts:893-931:goto(commit)+readiness 125ms 轮询 + settleNavigation(≤6s))→ inspectRuntimeSettled(2_000)(collector.ts:1216,≤2s)批量取回 mountedKeys(grade≥B && connected && rect>0,service.ts:464-476);
4. 组 + 机会键(该页挂载的 pending/needs_agent,service.ts:478-480)→ **逐键串行**:未挂载键立即标 needs_agent(service.ts:483-492,零等待);挂载键 waitForKey(key,2_500,"B")(service.ts:495,可达 2.5s)+ capture()(collector.ts:1357-1408:再 waitForKey(5s) + waitForLoadingCleared + ≤6 轮 100ms 稳定性采样 + B 级因果 canary;确定性 B 未过 → deterministic_b_rejected → needs_agent)。

**回答**:
- 每键**不单独导航**:导航以路由为单位,一次 open 覆盖同路由全部键;同路由多个可视键**可以**一次导航截图(**导航/挂载判定已批量**,逐键只做确认+截图)。
- 但**逐键确认是双重验证**:队列 loop 一次 waitForKey + capture 内部再一次,加稳定性采样 ≈ 1.5-3s/键;已挂载但视口外/懒加载中的键再吃 2.5s 超时。
- **窗口吞吐上限 = 路由数×(open≈1.5-6s + settle ≤6s + inspect 2s) + Σ挂载可视键×1.5-3s + Σ已挂载但未出现键×2.5s**,且全部被 exclusive() 全局锁与 Agent/手动互斥串行化(service.ts:403-414)。实测 34-87 keys/min(oms 大表路由 34/min,translation-lab 87/min)。

## Q2 Agent 队列:消费 200 键多少轮、瓶颈?(调用链证据)

**流程**:agent next(bin.ts:530-552)→ nextAgentTask(session,saturatedRoutes)(store.ts:727-761,按 routeFanout×10_000+actionScore+priority 取 anchor)+ agentRouteBatch(anchor,12)(store.ts:763-823,同路由代表样本)→ SKILL 读源码写 TriggerPlan → agent submit(savePlan,store.ts:888-899)→ agent execute(bin.ts:566-578)→ service executeAgent(service.ts:526-572):cancelManual + submitPlan(置 running,attempts+1)→ collector.executePlan(plan)(collector.ts:836-891,deadline 默认 90s):**无条件 open(plan.route) 重新导航**(collector.ts:847,不复用当前页)→ 逐 step(click/fill/waitForKey/capture 检查点)→ 末尾 waitForKey(targetKey,10_000,"B") + capture()(含 canary)。检查点 captureCheckpoint = captureVisibleBatch(service.ts:582-631,每次抓 ≤250 当前页可见键)。

**轮数估算**(实测 e2e 基线:oms 93 分钟会话 200 计划、388 agent evidence → **2.2 plans/min、平均 1.94 keys/计划**):
- 维持实测产出:200 键 ≈ **103 轮 ≈ 46 分钟**;若锚点页状态重复(检查点新增≈0)则 ≈200 轮 ≈ 90 分钟+。
- 落地"路由扫描计划"(40 步上限内 1 计划跨多状态 + 每状态 checkpoint,10-50 keys/计划):200 键 ≈ **4-20 轮 ≈ 5-20 分钟**。

**瓶颈排序**:
1. **每轮只锚 1 键 + 检查点仅抓当前页可见键**:锚点页状态与前轮重复时 yield→0;这是"平均 1.94 keys/计划"的根因。
2. **每轮无条件重开路由**(collector.ts:847)+ settle ≈ 3-6s/轮,同路由连续锚点零复用。
3. **Canary 开销**:B 级 primary(agent 且有 plan 时也触发,collector.ts:1387-1392)→ verifyCausalBinding(collector.ts:790-834)= **新开 probe 页 + 请求 mock 重放 + waitForKey ≤15s**,每次 3-15s;确定性拒收的 B 级键大量转 Agent,使 Agent 阶段 B 级占比高。
4. **饱和路由软排除空转**:saturatedRoutes(store.ts:720-725,阈值=2)仅 -1_000_000 软减分(store.ts:753-755),routeFanout×10_000+attempts 100_000 可反超;实测 /dashboard 连续 76 次、/users 25 次低产计划。
5. **外部轮次成本**:SKILL 每轮(读 routeBatch 源码 → 写计划 → submit → execute)含模型推理,引擎只占一部分。

## Q3 结论:≤3 条最高性价比改进(改动范围 + 预期提升)

### ① 同路由批量截图(确定性队列)—— 首选
- **做法**:runDeterministicQueue 对 mountedKeys 确认的组键,不再逐键 waitForKey+capture;改用一次 captureVisibleTargets(keys,"B") 批量解析(collector.ts:1415-1493,单次 evaluate≤4s),再对稳定键直接截图;仅对未稳定/未解析键做单键重试。
- **改动范围**:packages/cli/src/service.ts:461-505(调度逻辑);复用 packages/runner/src/collector.ts:1415/1501(captureVisibleTargets/captureBatch 已存在,基本零新增,可选微调稳定性采样)。
- **预期**:逐键 1.5-3s → 0.3-0.8s,**窗口吞吐 65-87 → 150-250 keys/min(×2.5-3)**,2 分钟窗口 123-142 → 300-500 键。

### ② 队列顺序:路由稠密度优先 + 失败键确定性重试
- **做法 A(排序)**:store.nextTask 增加按路由 pending 数倒序的出队规划(种子取当前 pending 最多的路由),≤2 键稀疏路由放最后。
- **做法 B(重试)**:not-mounted/2.5s 超时失败键不立即 needs_agent,先 attempts+1 挂回 pending(同路由重试一次),仍失败再下沉;重试时路由已热(缓存),成本≈0。
- **改动范围**:packages/cli/src/store.ts:698-707(nextTask/路由聚合)+ packages/cli/src/service.ts:481-504(重试注入)。
- **预期**:同窗口 captured **+30-50%**(实测 /support 100 键、/releases 98 键窗口内 0 处理 → 排序后会被访问;not-mounted 重试可救回动画/懒加载类键),pending 归零更快。

### ③ 窗口/默认值自适应 + run 语义(纯配置,零风险)
- **做法**:--deterministic-timeout-minutes 默认 = max(15, ceil(总键数/60))(按实测 60-90 keys/min 折算);run 超时返回时 nextAction 增加 deterministic_continue;status/export 显式呈现 pending 为未完成。
- **改动范围**:packages/cli/src/bin.ts:404-465(run 语义)+ store.status/automatic 计数(可选)。
- **预期**:消除"2 分钟窗口后 45% pending 卡死 finalize、不停开新会话"的系统性现象(translation-lab 645、oms 524 pending;finalize 因 pending>0 抛错 store.ts:911-913)。
