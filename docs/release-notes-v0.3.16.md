# collect-i18n v0.3.16 发布说明

## 瞬时 Toast 锚点修复(waitForKey exact-text 回退)

修复运行期暴露的采集缺陷:瞬时命令式 toast(ElMessage/ElNotification/ElMessageBox)在运行时注册表里只有 key+text、没有归属 DOM rect,导致 waitForKey 锚点必然超时(修复前实测:translation-lab x2、oms x3 全部失败,checkpoint 证据仍落盘)。

- packages/runner/src/collector.ts:waitForKey 增加 exact-text 叶子扫描回退——取注册表记录文本,对视口内叶子元素(p/span/div/li/td/dt/dd/button/a/h1-h4/label)做精确文本匹配,命中后归一化为 B 级 imperative-text-scan 目标。
- 新增纯函数模块 packages/runner/src/textMatch.ts(isExactTextMatch/pickExactTextRows)+ 2 个单元测试。
- 真实运行验证(api-hash-lab):瞬时锚点 3/3 成功(products.boom.detail、login.success 跨路由跳转、settings.form.saveFail);Box 按钮标签与 title 属性类锚点仍不解析(属性非文本,归人工队列,证据已落盘)。

## 三项目长窗口真实采集全量数字

三个真实示例项目各跑一轮 run(--deadline-minutes 25,自适应确定性窗口)+ 多轮 Agent 计划 + finalize + export,报告与基线对比(report-r123.xlsx 均已落盘、服务已停止):

| 项目 | total | captured | coverage | 基线 captured/coverage | needs_agent | needs_manual | 备注 |
|---|---|---|---|---|---|---|---|
| vue-i18n-translation-lab | 1000 | 834 | 83.4%(基线 14.2%) | 142 | 0 | 153(已核验死键) | captured +487%,pending 645→0 |
| oms-complex-app | 1000 | 436 | 43.6%(基线 17.2%) | 172 | 0 | 564(含基线 155 死键,未上升) | captured +153% |
| vue-i18n-api-hash-lab | 185 | 141 | 76.2%(基线 47.6%) | 88 | 0 | 23(基线 76) | captured +60%,manual -70% |

要点:三个项目 needs_agent 全部归零;人工兜底大幅下降(api-hash-lab 76→23,-70%);translation-lab/oms 死键均核验分类且不误伤;oms 剩余 408 键为 25 分钟窗口内 Agent 仅轮到约 8 分钟的剩余键,建议发布后再补一轮长窗口即可大幅回落。

## 文档与导出协议

- docs/cli-reference.md 与 skill/collect-i18n/SKILL.md 的 deterministic_continue 语义与自适应窗口说明随版本延续;非可视词条截图列「非可视」标注说明不变。
