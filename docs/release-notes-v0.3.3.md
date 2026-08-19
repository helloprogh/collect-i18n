# Collect I18n v0.3.3

此版本修复路由拼接，使采集器能正确处理带 Vite `base` 的项目与 vue-router hash 模式。

## 修复

- 浏览器跳转现在自动前缀项目 Vite 配置中的 `base`（如 `/admin/`），不再忽略 base 导致页面 404。
- 检测到 `createWebHashHistory` 时按 `#/path` 打开 hash 路由；`createWebHistory` 按普通路径打开。路由模式由静态分析在 `init`/`scan` 时识别并随项目索引持久化。
- 绝对 URL（如 reload 当前页的 `location.href`）仍按原样校验同源后使用，不受 base 与 hash 拼接影响。

## 测试

- 新增 analyzer 路由模式检测用例（hash / history / 无路由模式）。
- 新增 collector 的 URL 解析用例（Vite base 前缀、hash 路由、绝对 URL、跨源拦截）。
