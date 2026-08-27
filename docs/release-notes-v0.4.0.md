# v0.4.0 发布说明

面向真实工程可用性的大版本:采集状态全面外置(工程内零写入、不再触发项目 watcher 崩溃)、中文界面守卫、登录门控应用引导、深层控件扫描,以及基于开源复杂后台(vue-element-plus-admin)的验证工程。

## 采集状态外置(修复 watcher 风暴)

- **问题**:此前 SQLite 状态库、证据截图、浏览器配置全部写在 `<project>/.collect-i18n/` 内。采集服务托管的 Vite 开发服务器会 watch 工程根目录,高频截图写入触发频繁 HMR/重启,可能导致工程崩溃。
- **修复**:全部易变状态外置到 `~/.collect-i18n/projects/<项目哈希>/`(可用 `COLLECT_I18N_STATE_DIR` 覆盖父目录)。**工程内零写入**,只有两类低频交付物保留在工程内:初始化配置 `.collect-i18n/config.json` 与最终导出的 Excel 工作簿(一次性写入,并已在服务托管的 Vite 中忽略该目录的 watch)。
- **自动迁移**:首次打开旧工程时,状态库/证据截图/浏览器配置自动复制到外置目录,历史证据路径同步重写;旧目录保留可手动清理。
- **会话能力令牌外置**:service.json(含 studioUrl 令牌)同样移出工程目录。

## 中文界面守卫(截图必须呈现中文)

- **注入层**:Playwright 上下文 `addInitScript` 在应用脚本执行前把 14 个常见语言存储键(`locale`/`lang`/`language`/`i18nLocale` 等)预置为源语言(zh-CN),覆盖 profile 残留的英文选择;上下文 `locale` 同步为 zh-CN。
- **校验层**:会话首个路由检视后,抽样比较渲染文本与 zh-cn 词条原文;当样本充分且零匹配(界面渲染了英文占位)时,自动以 `?locale=zh-CN&lang=zh-CN` 重访一次该路由再继续采集。每会话至多恢复一次,不阻塞采集。

## 登录门控应用引导(R-login)

- 配置 `browser.login`(`path`/选择器/凭据)后,采集服务在首个路由访问前完成一次确定性登录;已认证则自动跳过。凭据可由 `COLLECT_I18N_LOGIN_USERNAME` / `COLLECT_I18N_LOGIN_PASSWORD` 环境变量注入,避免明文入库。
- 登录超时(30s 未离开登录路由)以结构化错误 `login_timeout` 上报,不会静默采集出整页登录截图。

## R7b 深层控件扫描

- R7 在树展开与分页步进之外,新增逐轮打开级联/下拉/日期选择器面板(选项文本挂载于 teleport 面板,仅在打开时可采集),先 Escape 关闭上一面板再推进;控件以 `data-collect-i18n-swept` 标记防重复,轮次与点击数照常有界。

## Vite 模式透传

- `COLLECT_I18N_VITE_MODE` 环境变量把 `--mode` 透传给采集服务托管的 Vite(如 `base`/`mock` 模式),应用按模式分支的 mock 服务器与 base 路径得以复现。

## 新增开源复杂验证工程

- `examples/oss/vue-element-plus-admin`(MIT,Vue 3 + Vite + Element Plus + vue-i18n 11,pnpm monorepo,mock 登录门控,复杂后台界面:动态路由、表格、树、级联、标签页),用于验证登录引导、中文守卫与 R7/R7b 在真实复杂度下的表现。其 TS 语言文件通过 `.collect-i18n/generate-json-locales.mjs` 桥接出 JSON 镜像供分析器发现。

## 兼容性

- 状态目录外置对 CLI/插件 API 透明;旧 `.collect-i18n` 目录首次打开自动迁移。`config.stateDirectory` 字段保留但仅用于识别旧迁移源。
- 其余行为(四列工作簿、Agent 计划协议、finalize 语义)与 0.3.x 完全兼容。

## 实测

- **oms-complex-app 回归**：纯确定性采集 **680/1000（68%）**，高于 v0.3.18 的 670（67%）；needs_agent 175 → 165；失败 0；680 张证据截图全部落在外置状态目录，工程内零高频写入。
- **vue-element-plus-admin（登录门控复杂后台，首次接入）**：登录页 7 个词条在未登录状态下被确定性捕获，登录引导成功进入仪表盘后再捕获仪表盘词条；含 Agent TriggerPlan 补采后共 **18/87**，失败 0——此前版本该项目因登录门控完全不可采集（0/87）。ECharts 画布渲染的轴图例等确认为不可 DOM 采集，诚实归入人工兜底。
- 门禁：11 包 typecheck、177/177 单测、lint、版本一致性（0.4.0）全绿。
