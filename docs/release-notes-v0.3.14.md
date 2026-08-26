# collect-i18n v0.3.14 发布说明

## 加载遮罩截图加固(F1-F5)

修复部分截图带 loading 遮罩污染的问题,核心改动在采集引擎:

- **F1 可配置遮罩选择器**:新增 `browser.loadingSelectors` 配置;内置列表覆盖 Element Plus、Ant Design、naive-ui、Arco Design、NProgress 与页面标记 `data-collect-i18n-loading` 共 9 项。
- **F2 整帧闸门 + 裁剪兜底**:截图前对视口内的可见遮罩元素计数;遮罩未清时先等待(缺省 5000ms),仍脏则退回目标矩形 48px 边距裁剪,干净时保持整幅截图。
- **F3 多点采样**:目标矩阵改为中心 + 四角 5 点采样,任一点命中遮罩即视为阻塞(取代原单中心点判定)。
- **F4 竞态收口**:标记与闸门在同一次页面求值中原子完成(双 rAF 等帧);截图后复检,若新遮罩入区则弃图重试一次,连续两次竞态报 `loading_overlay_race`。
- **F5 结构化错误码**:`CollectorError`(10 个 snake_case 码),任务消息以 `[CODE]` 前缀落库,方便自动化分支处理。

## DSH 插件化

- 新增 `@collect-i18n/dsh-plugin`(v\0.3.14),将 collect-i18n 封装为 DeepSeek Harness 服务端插件:注册 `collect_i18n_cli/run/status/export/import` 五个工具 + 系统提示 section,随 `dsh plugin --profile <name> add` 一键安装。
- 新增 `scripts/build-dsh-plugin.mjs`(幂等打包)与 `scripts/install-dsh-plugin.mjs`(幂等安装,支持 pnpm 10 storeDir 解析与陈旧检测重装)。
- 技能侧不变:同一份 `skill/collect-i18n/` 同时作为独立技能目录与插件内嵌技能。

## 其他

- 新增真实场景示例 `examples/vue-i18n-api-hash-lab`:真实 HTTP 接口(300-800ms 延迟)、hash 路由、Vite base,用于引擎回归验证。
- 文档同步:`docs/cli-reference.md`、`README.md` 选择器清单与默认值说明(48px / 5000ms,与改造前固定等待一致)。
