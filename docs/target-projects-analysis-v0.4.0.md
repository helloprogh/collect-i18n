# 对象项目全面分析(v0.4.0 实测数据)

分析对象:examples/oms-complex-app(自建复杂后台,1000 词条)与 examples/oss/vue-element-plus-admin(开源 MIT 后台,87 词条,登录门控)。数据取自 v0.4.0 外置状态库的真实会话。

## 一、采集漏斗总览

| 指标 | oms-complex-app | vue-element-plus-admin |
|---|---|---|
| 总词条 | 1000 | 87 |
| 确定性捕获 | 680(68%) | 18(20.7%) |
| 待 Agent 计划 | 165 | 36 |
| 人工兜底 | 155 | 31 |
| 失败 | 0 | 0 |
| 证据截图 | 680 张 | 18 张 |

## 二、oms 失分点解剖(320 词条)

### needs_manual 155(全部 unresolved_dynamic_source,0 静态出现)
- products.rows.N.*(45)+ orders.rows.N.*(42)= 87 词条:**模拟数据驱动的行级动态键**。源码形如 t("products.rows." + row.type + ".category"),行号/枚举由 mock 数据决定,静态分析无法穷举实例,任务创建时即判人工。
- common.action.*(12):操作列按钮动态拼接 t('common.action.' + name)。
- users.detail.*(8)、common.misc/placeholder/dialog/pagination(25)、settings.section.*(3):同类动态拼接或藏在弹窗。

### needs_agent 165(按源文件分布)
- **Messages.vue = 77**:messages.msg.* 全部渲染在**瞬态弹窗**里(ElMessage 1.5s 自动消失、ElMessageBox/ElNotification 需点击按钮触发)。必须「点击按钮 → 窗口期内截屏」配对完成。
- **Dashboard.vue = 71**:ECharts 画布渲染的轴标签/图例,DOM 无对应文本节点。
- Settings.vue = 35:子标签页与开关确认框之后的内容。
- Users.vue = 28 / Advanced.vue = 23:行内操作下拉、级联面板(部分已被 R7b 覆盖)。
- Orders.vue = 11 / Products.vue = 7:表格行操作菜单。
- 本会话 Agent 队列 **0 个计划被提交**(仅验证了确定性阶段),上述数字是「可被计划采走」的上限。

## 三、vue-element-plus-admin 失分点解剖(49 词条)

### needs_manual 31(28 死键 + 3 有出现)
- 28 个死键:zh-CN.ts 存在词条但源码无对应 t() 调用(文案由配置/画布数据引用)。

### needs_agent 36(按源文件)
- RegisterForm.vue = 13:注册 Tab 从未被打开(默认停在登录 Tab)。
- echarts-data.ts = 8:图表配置中的画布文本。
- UserInfo.vue 6 / LayoutSwitcher 5 / TagsView 4 / Collapse 2:头像下拉、布局切换下拉、标签右键菜单——全部 hover/点击后才挂载。
- LoginForm.vue = 3:应用登录后弹回登录页(bounce),占位符类键只在窗口期可见。

## 四、改进点(按 ROI 排序)

### 引擎侧
1. **P0 · 组件配方库(Recipe Library)**:为高频 Element Plus 交互模式内置参数化计划——① 瞬态消息:点击触发按钮后 300ms 内批采 .el-message/.el-message-box/.el-notification(v0.3.17 的 imperative-host 优先级已能定位,缺的是「触发+立即截」配对);② 下拉菜单:click/hover .el-dropdown 后采 .el-dropdown-menu;③ Tab 遍历:逐个 .el-tabs__item;④ 对话框:点击打开 → 采 → Escape。预计直接吃掉 oms Messages 77 + 下拉/对话框约 60、OSS Register 13 + 下拉 17。
2. **P0 · 动态键运行时转正**:创建任务时把 unresolved_dynamic_source 键标记为 dynamic_prefix;确定性阶段对运行时实际挂载的完整实例键(如 products.rows.3.category)自动建任务并采集。oms 87 词条可直接转正,人工兜底 155 → 约 68。
3. **P1 · run 内自动驱动 Agent 队列**:确定性阶段结束后自动执行有界计划循环(当前需独立 CLI 驱动),饱和路由冷却后二次尝试,尽量在单次 run 内收敛。
4. **P1 · 画布文本降级采集**:对 ECharts 调用 chart.getOption() 提取 axis/legend/series 文案,以「实例文本 + 整卡截图」作为 B 级证据;不可得时在报告中标注「画布渲染」,替代笼统死键。
5. **P2 · 计划缓存复用**:同一工程跨会话复用已验证计划(菜单路径/Tab 序列),二次采集零推理。
6. **P3 · 报告原因细分**:needs_manual 按「动态拼接/画布/死键/瞬态」分列展示并给出处理建议,人工兜底可按批处理。

### 对象工程侧(提高其自身可采集性)
- oms:动态行键改静态枚举映射;ECharts 文本同步写 aria-label;瞬态消息提供长驻 demo 模式。
- OSS:Register/Login 双 Tab 默认可达;图表图例维护在 locale 引用处注释。

## 五、结论
- oms 剩余 320 词条中,约 164 词条(动态 87 + 瞬态 77)属「配方+动态转正」可自动化范畴,理论覆盖率可达约 84%;ECharts 71 词条需画布降级方案。
- OSS 剩余 49 词条中,36 个 needs_agent 全部为配方可解;死键 28 个建议工程侧清理。
