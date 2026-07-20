# Collect I18n v0.1.0

首个可用版本建立了完整的 Vue 国际化截图与翻译工作簿闭环：

- 扫描 `zh-cn` / `en-us` JSON、Vue 源码、路由与交互提示，不向目标项目写入测试页面或预期词条。
- 通过 Vite 开发态插桩记录 DOM、文本 Range、组件属性，以及 Element Plus 命令式服务与 Teleport 词条。
- 按“确定性采集 → Skill/Agent TriggerPlan → 人工兜底”顺序生成真实页面证据。
- 在人工兜底时监听目标 Key，出现后自动标记并截图。
- 导出严格只有 `中文`、`英文`、`截图`、`Key Path` 的单工作表 Excel；英文默认复制中文。
- 回稿先预检，再按 Key Path 安全写入 `en-us` JSON；空白或中英文相同的行不会写入。
- 本地服务使用随机 capability、HttpOnly SameSite Cookie 和同源检查保护工作台接口。

## 安装说明

Release 中的 `collect-i18n-skill-v0.1.0.zip` 是 Agent Skill 附件，不包含 CLI 或 Node.js 运行时。请先克隆本仓库，安装依赖并执行 `pnpm build`，再安装 Skill；也可以设置 `COLLECT_I18N_CLI`，指向已经构建好的 `packages/cli/dist/bin.js`。

运行环境：Node.js 22.13 或更高版本、pnpm 11.9、本机 Google Chrome，以及 Vue 3 + Vite 目标项目。
