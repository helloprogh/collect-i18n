# DSH 插件机制与安装规格 (DSH v0.1.1-rc.2)

> 调研人:researcher — 产出日期:本团队 t1 任务 — 基于本机真实安装逐项核实(非文档推测)。
> 适用范围:把 collect-i18n 改造成 DSH 插件并安装到本机 DSH v0.1.1-rc.2(web profile)。

## 0. 本机环境事实(已核实)

| 项目 | 值 |
|---|---|
| DSH CLI 版本 | dsh --version = 0.1.1-rc.2(安装于 C:\Users\93533\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh) |
| $DSH_HOME | C:\Users\93533\.dsh(profiles / sessions / storages / settings.yaml / .credentials.yaml) |
| 正在使用的 profile | web → C:\Users\93533\.dsh\profiles\web(GUI 位于 http://127.0.0.1:3080) |
| pnpm | 在 PATH(C:\Users\93533\AppData\Roaming\npm\pnpm.ps1)✓ |
| 已装第三方插件(样例) | @nanmicoder/dsh-agent-teams@0.1.13、dsh-better-sidebar@0.15.2(都在 web profile bundles 里) |
| 工作目录 | D:\ProjectSpace\vue-i18n-collect |

## 1. DSH 插件系统架构(核心概念)

DSH 0.1.1-rc.2 的插件模型 = **profile(配置档案)+ bundle(组合包,即“插件包”)+ cordis patch 层**:

- dsh CLI 只做三件事:profile 引导、dsh plugin(把参数转发给 pnpm)、web 别名。真正的应用由 cordis 装载。
- 每个 profile 是一个目录 $DSH_HOME/profiles/<name>,内含:
  - package.json —— **profile manifest**:记录树外插件依赖(dependencies)与**bundle 层列表**(dsh.profile.bundles,数组,按序应用)。
  - cordis.patch.yml —— **用户 patch 层**(顶层 YAML 数组,loader patch entry)。默认值 []。
  - cordis.yml —— 空根配置(每次启动被重写为 [];不要编辑)。
  - pnpm-workspace.yaml —— packages: [.]、nodeLinker: hoisted、autoInstallPeers: false(由 init 自动生成)。
- 配置树叠加顺序(同 id 后写覆盖整行 config):
  1. 每个 bundle 的 patch(dsh.profile.bundles 顺序);
  2. profile 自己的 cordis.patch.yml;
  3. $DSH_HOME/cordis.patch.yml(home 级用户层,对所有 profile 生效;本机当前不存在);
  4. dsh --profile web --patch <file> 覆盖层;
  5. telemetry 开关 patch。
- bundle 包解析顺序:先 dsh 安装目录(node_modules\@deepseek-ai\dsh\node_modules,内置包),后 profile 自身 node_modules。树外插件由 pnpm 装进 profile。
- 行(row)= cordis 插件条目:{ id, name, config?, disabled? }。name 必须是 Node 可解析包名;以 @ 开头的名字在 YAML 中必须加引号。

## 2. 什么是“DSH 插件”(两种可组合表面)

### 2.1 服务端插件(cordis plugin)—— 本任务主路径

一个 ESM npm 包,导出 cordis 插件语法:

    // lib/index.ts(编译到 lib/index.js)
    import z from '@deepseek-ai/schemastery';
    import { defineTool } from '@deepseek-ai/dsh-tools';

    export const name = 'collect-i18n';          // 与 cordis.patch.yml 行名一致
    export const inject = ['tools', 'llm', 'jobs', 'systemPrompt']; // 所需服务
    export const Config = z.object({
      cliPath: z.string().optional(),
      // ...
    });
    export function apply(ctx, config) {
      // 1) 注册模型工具(核心):
      ctx.tools.register(defineTool({
        name: 'collect_i18n_xxx',
        description: '...',
        parameters: { /* 参数 */ },
        output: { schema: { type: 'object', properties: {...} }, render: (args, value) => [...] },
        async execute(args, exec) { ... },
      }));
      // 2) 挂使用说明到全局 system prompt:
      ctx.systemPrompt.section({ name: 'collect-i18n:usage', order: <number>, text: '...' });
      // 3) 惰性绑定其他服务:
      ctx.inject(['commands'], (commandCtx) => { ... });
    }

- 工具注册 API 出处:defineTool from @deepseek-ai/dsh-tools(peer dep),注册后即出现在每个会话的工具目录。
- 后台执行:通过 ctx.jobs(jobs.start({ kind, label, owner, run }))跑长任务,搭配 @deepseek-ai/dsh-tool-jobs 的 job_output 模型;或直接在 execute 里 spawn CLI 并等待(skill 现有 bootstrap 即 spawnSync 风格)。
- 参照实现(本机已装,可直接抄袭结构):
  - @nanmicoder/dsh-agent-teams@0.1.13:注册 10 个 agent_teams_* 工具 + systemPrompt section + 惰性 Web 路由。文件:C:\Users\93533\.dsh\profiles\web\node_modules\@nanmicoder\dsh-agent-teams\{cordis.patch.yml, lib\index.js, lib\tools.js}。
  - 官方工具插件:...\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-tool-pwsh\lib\index.js(name/inject/Config/apply + defineTool + presentCall/presentResult 渲染)。

### 2.2 客户端插件(Web UI)—— 可选,本任务大概率不需要

包内额外:package.json dsh.client.inject: ["@deepseek-ai/dsh-client-..."]、dsh.client.platform: "web"、exports ./client。参照 dsh-better-sidebar。F1-F5 截图改进发生在 runner(Playwright 浏览器)内部,与 DSH UI 无关,不需要客户端插件。

### 2.3 bundle 声明(让 dsh plugin 识别为“组合包”)

package.json 增加:

    {
      "name": "<plugin-package-name>",      // 必须与 cordis.patch.yml 行 name 一致
      "type": "module",
      "main": "lib/index.js",
      "exports": {
        ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
        "./cordis.patch.yml": "./cordis.patch.yml",
        "./package.json": "./package.json"
      },
      "dsh": {
        "bundle": { "patch": "./cordis.patch.yml" },
        // "client": { "inject": [...], "platform": "web" }   // 仅客户端插件需要
      },
      "peerDependencies": {
        "@deepseek-ai/cordis": "^4.0.1",
        "@deepseek-ai/dsh-tools": "^0.1.1-rc.2",
        "@deepseek-ai/dsh-agent": "^0.1.1-rc.2"
        // ... 按实际 inject 的服务声明(可全部 optional)
      }
    }

### 2.4 bundle 的 cordis.patch.yml(装载行)

    # 顶层是 loader patch entry 数组(与 profile 的 cordis.patch.yml 同构)
    - insert:
        - id: collect-i18n
          name: 'collect-i18n'        # @ 开头必须引号;与包名一致
          config:
            # 任何 Config schema 允许的字段
            cliPath: <optional>

要点:patch 是“插入/覆盖行”的 YAML 数组,支持 insert、按 id config 覆盖、disabled;!!js 表达式可用(参照 dsh-base patch)。

## 3. dsh plugin 命令语义(安装机制)

dsh plugin --profile <name> <pnpm-args...> 的实现(核实自 ...\dsh\lib\plugin-*.js):

1. profile 不存在则 initProfile(web/headless 有内置模板 ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"];其他名字模板 = ["@deepseek-ai/dsh-base"])。
2. 在 profile 目录运行 pnpm <args...>(stdio inherit;Windows 走 shell);add . 等相对路径 spec 会被锚定到**调用 dsh 时的 cwd**(绝对路径与 registry 名原样透传)。
3. pnpm 成功退出后 **reconcile**:读回 dependencies(以 pnpm 真实写入的包名为准),凡解析到声明了 dsh.bundle.patch 的包 → 追加进 dsh.profile.bundles(依赖序);被删除或失去声明的包移出。未声明 bundle 的普通依赖仅作依赖安装(打一个提示警告)。

因此**安装一个本地插件 = 一条命令**,例如:

    dsh plugin --profile web add D:\ProjectSpace\vue-i18n-collect\packages\dsh-plugin
    # 或 npm 名: dsh plugin --profile web add @collect-i18n/dsh-plugin

注意:裸 add . 会解析成 profile 目录自身(自链接),**不要用**;用绝对路径或 file:/registry 名。

## 4. 安装路线(三条,按场景选)

### 方式 A — 正式:bundle 进 dsh.profile.bundles(产品化,推荐终态)

1. 构建插件包:tsc/tsup 产出 lib/*.js + cordis.patch.yml,package.json 含 dsh.bundle.patch(见 2.3/2.4)。
2. dsh plugin --profile web add <绝对路径或npm名> → pnpm 安装 + reconcile 写入 bundles。
3. 验证:dsh --profile web --dump-config 输出中出现 "# == <package>" 标记与插件行。
4. **重启 dsh web 服务进程**(不是浏览器刷新):新 bundle 不在热更新范围内(boot 时 bundlePatches 已冻结)。重启后新会话工具目录出现 collect_i18n_*。

### 方式 B — 开发期:依赖安装 + 用户 patch 热更(迭代最快)

1. 手动装依赖(同 pnpm 语义):
       pnpm --dir C:\Users\93533\.dsh\profiles\web add <插件绝对路径>
2. 把行写进 C:\Users\93533\.dsh\profiles\web\cordis.patch.yml(即该 profile 的用户层):
       - insert:
           - id: collect-i18n
             name: '<package-name>'
             config: {}
3. DSH 启动器会 watchUserPatches 监听 profile 与 home 两个 patch 文件,**保存即热应用,无需重启**(符合“改 collect-i18n 插件时不用反复重启 GUI”的开发节奏;若新会话未生效则重启一次)。
4. 稳定后切到方式 A 固化。

### 方式 C — 试验/覆盖层(零安装,临时)

- 启动时叠加:dsh --profile web --patch <overlay.yml>;或写进 $DSH_HOME/cordis.patch.yml(所有 profile 生效)。前提仍是 profile node_modules 里能解析该包(否则 boot 报 cannot resolve profile bundle / loader 找不到插件)。

### 卸载 / 更新

- dsh plugin --profile web remove <pkg>;依赖被移除且不再是 bundle 时自动移出 bundles。
- 更新:dsh plugin --profile web add <pkg>@<new>(reconcile 按已安装状态判定,新版本若新增 dsh.bundle 声明会自动激活)。

## 5. collect-i18n 插件化建议(供 plugin-engineer 落地)

现状:monorepo v0.3.14(packages: core/analyzer/runner/excel/runtime/vite-vue/cli;apps/studio),交付物是 skill(skill/collect-i18n/:SKILL.md + cli/bootstrap.mjs → 捆绑引擎 bin.js)+ release/collect-i18n-skill-v0.3.13.zip。CLI 是执行与 truth 层;playwright-core 懒加载到 ~/.collect-i18n/runtime 缓存。

- **插件形态**:服务端 cordis 插件(2.1),把 skill 的“操作协议”包装成 collect_i18n_* 工具;SKILL.md 的精简版作为 systemPrompt.section 文案。不需要客户端插件。
- **执行方式两选一**:
  1. 插件包内捆绑引擎(把 packages/cli 的 bundle 产物 bin.js 放进插件包),execute 中 spawn node <bundle>/cli/bootstrap.mjs <cmd>(保持现有缓存/不可变机制);长命令走 ctx.jobs,或直接 await spawn 输出(CLI 本身有 --deadline-minutes 等超时参数)。
  2. 插件调用 CLI 的 service 模式(packages/cli/src/service.ts / service-client.ts)做异步驱动——适合“启动本地服务由工具轮询”。
- **工具面建议**:至少 collect_i18n_run(一条命令走完?过长需 jobs)、collect_i18n_status、collect_i18n_export / collect_i18n_import;参数与 CLI 命令对齐,恒带 --project <abs> --json --non-interactive。若想拆细,参照 agent-teams 的 10 工具粒度。
- 必须携带 skill 的约束(不改目标项目、evidence 判完成、不要在 CLI 运行中操作浏览器、studioUrl 视为会话密钥等),精简后进 prompt section。
- peerDependencies 按实际 inject 服务声明(参考 dsh-tool-pwsh 列表);版本用 ^0.1.1-rc.2 与本机 DSH 一致。

## 6. 验证清单(端到端)

1. dsh --version → 0.1.1-rc.2。
2. dsh --profile web --dump-config | Select-String '<插件名>' → 行出现,bundle 头 "# == " 出现。
3. profile package.json 的 dsh.profile.bundles 含插件名(方式 A);依赖在 dependencies。
4. 重启 web 服务后,新会话工具目录可见 collect_i18n_*;systemPrompt section 生效。
5. 在 examples/vue-i18n-translation-lab 与 examples/oms-complex-app 上跑真实采集流程(对应团队后段任务)。
6. 失败排查速查:
   - "declares no dsh.bundle" → 包 package.json 缺 dsh.bundle.patch。
   - "cannot resolve profile bundle" → 包没装进 profile node_modules(dependencies 核对)。
   - pnpm 构建脚本被拦(Ignored build scripts) → profile 的 pnpm-workspace.yaml 加 allowBuilds: <pkg>: true 后重跑(web profile 当前无 allowBuilds;若插件依赖 esbuild 等需加)。
   - 工具没出现 → 行 name 与包名不一致 / @ 未加引号 / 未重启。

## 7. 关键路径速查

| 内容 | 路径 |
|---|---|
| dsh CLI 安装 | C:\Users\93533\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh |
| CLI 入口 | 同下 lib\bin.js |
| 插件管理器实现 | 同下 lib\plugin-*.js(一个哈希文件) |
| profile 引导实现 | 同下 lib\profile-boot-*.js |
| app-boot 内部(initProfile/loadProfile/compose) | ...\dsh\node_modules\@deepseek-ai\dsh-app-boot\lib\index.js |
| web profile | C:\Users\93533\.dsh\profiles\web(package.json / cordis.patch.yml / node_modules) |
| 服务端插件范例 | ...\profiles\web\node_modules\@nanmicoder\dsh-agent-teams |
| 客户端+bundle 范例 | ...\profiles\web\node_modules\dsh-better-sidebar |
| 官方 base bundle patch | ...\dsh\node_modules\@deepseek-ai\dsh-base\cordis.patch.yml(18KB,全部基础行) |
| 官方工具插件实现 | ...\dsh\node_modules\@deepseek-ai\dsh-tool-pwsh\lib\index.js |
| collect-i18n 仓库 | D:\ProjectSpace\vue-i18n-collect(skill: skill\collect-i18n;CLI: packages\cli) |
