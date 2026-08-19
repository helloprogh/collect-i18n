# Collect I18n v0.3.5

此版本优化大型项目的采集性能并修复绝对 URL base 的边界情况。

## 改进

- Vite 插件的 instrument manifest 改为防抖写入：HMR 或大规模构建中连续插桩不再每次全量重写 JSON，构建结束时仍会刷盘，保证 manifest 完整且最新。
- 静态分析对懒加载组件的 `import()` 检测改为窄路径扫描，不再为每个变量声明重复遍历整棵 AST（如大型路由表），大文件分析提速。
- `resolveProjectUrl` 支持 Vite `base` 为绝对 URL（如 CDN 地址）的配置：只取该 URL 的路径段拼接到项目同源地址，避免生成错误路由。

## 修复

- 修复 Vite `base` 配置为完整 URL 时浏览器打开路径拼接错误的问题。

## 测试

- 新增 manifest 防抖调度用例（合并写入、立即 flush、无操作场景）。
- 新增绝对 URL base 与 hash 路由组合的路由解析用例。
- 新增多个顶层懒加载组件绑定 + 大型路由表同时存在时的分析用例。
