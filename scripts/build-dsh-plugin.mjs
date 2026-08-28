#!/usr/bin/env node
// Build the self-contained DSH plugin package for collect-i18n.
//
// plugins/dsh-collect-i18n/
// ├─ package.json        DSH bundle manifest (dsh.bundle.patch, exports)   [generated]
// ├─ cordis.patch.yml    mount row inserted into the profile                 [generated]
// ├─ lib/index.js        cordis plugin: collect_i18n_* tools + prompt       [hand-written, preserved]
// ├─ lib/index.d.ts      minimal type surface for tool output               [generated]
// ├─ README.md                                                                 [generated]
// ├─ SKILL.md            skill source (copied)
// ├─ references/         cli-protocol.md, trigger-plan.md (copied)
// └─ cli/
//    ├─ bootstrap.mjs    skill CLI entry (copied)
//    ├─ bin.js           bundled engine (packages/cli/bundle/bin.js)
//    ├─ package.json     @collect-i18n/skill-cli (playwright-core dep)
//    └─ runtime/         runtime dist modules + source maps
//
// Generated files are re-created from scratch every run; hand-written files
// (lib/index.js) are never deleted, so edits survive rebuilds. Prerequisites:
// pnpm build && pnpm --filter @collect-i18n/cli build:bundle.
//
// Usage: node scripts/build-dsh-plugin.mjs [--check]

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pluginDirectory = join(repositoryRoot, "plugins", "dsh-collect-i18n");
const skillDirectory = join(repositoryRoot, "skill", "collect-i18n");
const bundlePath = join(repositoryRoot, "packages", "cli", "bundle", "bin.js");
const runtimeDirectory = join(repositoryRoot, "packages", "runtime", "dist");

async function fileExists(path) {
  try { await stat(path); return true; } catch { return false; }
}

const checkOnly = process.argv.includes("--check");

const RUNTIME_NAMES = ["index.js", "index.js.map", "registry.js", "registry.js.map", "types.js", "types.js.map", "element-plus.js", "element-plus.js.map"];


const version = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")).version;

const prerequisites = [
  ["bundled engine", bundlePath],
  ["runtime entry", join(runtimeDirectory, "index.js")],
  ["skill SKILL.md", join(skillDirectory, "SKILL.md")],
  ["skill references", join(skillDirectory, "references", "cli-protocol.md")],
  ["skill bootstrap", join(skillDirectory, "cli", "bootstrap.mjs")],
  ["plugin entry", join(pluginDirectory, "lib", "index.js")],
];
const problems = [];
for (const [label, path] of prerequisites) {
  if (!(await fileExists(path))) problems.push(label + " missing at " + path);
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error('Run "pnpm build" then "pnpm --filter @collect-i18n/cli build:bundle" (and write lib/index.js) first.');
  process.exit(1);
}

if (checkOnly) {
  const required = ["package.json", "cordis.patch.yml", "SKILL.md", "references/cli-protocol.md", "references/trigger-plan.md", "cli/bootstrap.mjs", "cli/bin.js", "cli/package.json", "cli/runtime/index.js"];
  const missing = [];
  for (const rel of required) {
    if (!(await fileExists(join(pluginDirectory, rel)))) missing.push(rel);
  }
  if (missing.length) {
    console.error("Plugin incomplete, missing: " + missing.join(", "));
    process.exit(1);
  }

  // Content-level drift guard: the committed plugin must carry exactly the
  // current skill sources, engine bundle and runtime dist. This failed
  // silently twice before v0.6.0 (v0.4.0 SKILL.md shipped inside a v0.5.0
  // engine), so every copied artifact is compared byte-for-byte.
  const copied = [
    ["SKILL.md", join(skillDirectory, "SKILL.md")],
    ["references/cli-protocol.md", join(skillDirectory, "references", "cli-protocol.md")],
    ["references/trigger-plan.md", join(skillDirectory, "references", "trigger-plan.md")],
    ["cli/bootstrap.mjs", join(skillDirectory, "cli", "bootstrap.mjs")],
    ["cli/bin.js", bundlePath],
    ...RUNTIME_NAMES.map((name) => ["cli/runtime/" + name, join(runtimeDirectory, name)]),
  ];
  const drift = [];
  for (const [rel, source] of copied) {
    if (!(await fileExists(source))) {
      drift.push(rel + ": source missing (" + source + ")");
      continue;
    }
    const [plugin, origin] = await Promise.all([
      readFile(join(pluginDirectory, rel)),
      readFile(source),
    ]);
    if (!plugin.equals(origin)) drift.push(rel + " differs from " + source);
  }
  const pluginVersion = JSON.parse(await readFile(join(pluginDirectory, "package.json"), "utf8")).version;
  if (pluginVersion !== version) drift.push("package.json version " + pluginVersion + " != " + version);
  if (drift.length) {
    console.error("Plugin drifted from its sources:\n" + drift.join("\n"));
    console.error("Run: pnpm build && pnpm --filter @collect-i18n/cli build:bundle && node scripts/build-dsh-plugin.mjs");
    process.exit(1);
  }
  console.log("Plugin check passed (" + (await readdir(pluginDirectory, { recursive: true })).length + " entries, content matches sources).");
  process.exit(0);
}

const skillCliPkg = {
  name: "@collect-i18n/skill-cli",
  version,
  private: true,
  type: "module",
  dependencies: { "playwright-core": "^1.55.0" },
};

const pluginPackageJson = {
  name: "@collect-i18n/dsh-plugin",
  version,
  description: "collect-i18n for DeepSeek Harness: server-side tools that drive the bundled collect-i18n CLI/skill (i18n screenshot collection, Excel export/import, browser-based evidence) with F1-F5 loading-overlay hardening",
  type: "module",
  main: "lib/index.js",
  exports: {
    ".": { types: "./lib/index.d.ts", default: "./lib/index.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json",
  },
  files: ["lib", "SKILL.md", "references", "cli", "cordis.patch.yml", "README.md"],
  license: "MIT",
  keywords: ["dsh", "dsh-plugin", "deepseek-harness", "i18n", "collect-i18n", "vue", "screenshot"],
  engines: { node: ">=22" },
  dsh: { bundle: { patch: "./cordis.patch.yml" } },
  peerDependencies: {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-agent": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-system-prompt": "^0.1.1-rc.2",
    "@deepseek-ai/schemastery": "^3.18.1",
  },
  peerDependenciesMeta: {
    "@deepseek-ai/cordis": { optional: true },
    "@deepseek-ai/dsh-tools": { optional: true },
    "@deepseek-ai/dsh-agent": { optional: true },
    "@deepseek-ai/dsh-system-prompt": { optional: true },
    "@deepseek-ai/schemastery": { optional: true },
  },
};

const cordisPatchYml = [
  "# dsh-collect-i18n bundle patch: mounts the collect-i18n plugin into the",
  "# host composition of a dsh profile. The plugin registers its collect_i18n_*",
  "# tools into the shared tools registry and one usage section into the global",
  "# system prompt, so every session of the profile can drive i18n screenshot",
  "# collection, Excel export/import, and the whole collect-i18n CLI protocol",
  "# through natural language.",
  "#",
  "# Install: dsh plugin --profile <name> add <this package> (npm name or a",
  "# local absolute path). The dsh plugin command pnpm-installs the package into",
  "# the profile and reconciles it into the profile's dsh.profile.bundles list.",
  "- insert:",
  "    - id: collect-i18n",
  "      # Node-resolvable package name -- must stay in sync with package.json",
  "      # 'name'. Quoted because '@' is a reserved indicator in YAML.",
  "      name: '@collect-i18n/dsh-plugin'",
  "      config:",
  "        # Absolute path to cli/bootstrap.mjs; empty = bundled engine inside",
  "        # this package. Useful to point at a repo checkout while developing.",
  "        cliPath: ''",
  "",
].join("\n");

// Place generated files into well-known slots; never touch lib/index.js.
await mkdir(join(pluginDirectory, "references"), { recursive: true });
await rm(join(pluginDirectory, "cli", "runtime"), { recursive: true, force: true });
await mkdir(join(pluginDirectory, "cli", "runtime"), { recursive: true });

await cp(join(skillDirectory, "SKILL.md"), join(pluginDirectory, "SKILL.md"));
await cp(join(skillDirectory, "references", "cli-protocol.md"), join(pluginDirectory, "references", "cli-protocol.md"));
await cp(join(skillDirectory, "references", "trigger-plan.md"), join(pluginDirectory, "references", "trigger-plan.md"));
await cp(join(skillDirectory, "cli", "bootstrap.mjs"), join(pluginDirectory, "cli", "bootstrap.mjs"));
await cp(bundlePath, join(pluginDirectory, "cli", "bin.js"));
for (const name of RUNTIME_NAMES) {
  if (await fileExists(join(runtimeDirectory, name))) {
    await cp(join(runtimeDirectory, name), join(pluginDirectory, "cli", "runtime", name));
  }
}

await writeFile(join(pluginDirectory, "cli", "package.json"), JSON.stringify(skillCliPkg, null, 2) + "\n");
await writeFile(join(pluginDirectory, "package.json"), JSON.stringify(pluginPackageJson, null, 2) + "\n");
await writeFile(join(pluginDirectory, "cordis.patch.yml"), cordisPatchYml);
await writeFile(join(pluginDirectory, "lib", "index.d.ts"), "export interface CollectI18nCliResult {\n  ok: boolean;\n  exitCode: number | null;\n  stdout: string;\n  stderr: string;\n  command: string;\n}\n");
await writeFile(join(pluginDirectory, "README.md"), [
  "# @collect-i18n/dsh-plugin",
  "",
  "collect-i18n as a DeepSeek Harness server-side plugin (cordis bundle).",
  "",
  "## What it mounts",
  "",
  "- **Tools** (registered into the shared tools registry, prefixed collect_i18n_):",
  "  - collect_i18n_run - end-to-end collection run",
  "  - collect_i18n_status - session status counts",
  "  - collect_i18n_export - four-column workbook export",
  "  - collect_i18n_import - translated workbook return",
  "  - collect_i18n_cli - raw passthrough to node <plugin>/cli/bootstrap.mjs <args>",
  "- **Prompt section** - condensed operating rules.",
  "",
  "## Contents",
  "",
  "cli/bin.js = fully bundled engine; cli/runtime/* = runtime modules;",
  "cli/bootstrap.mjs = skill CLI entry (lazily installs playwright-core into",
  "~/.collect-i18n/runtime); SKILL.md + references/ = skill sources. Nothing",
  "outside the plugin directory is required at runtime.",
  "",
  "## Build & install",
  "",
  "```powershell",
  "pnpm build",
  "pnpm --filter @collect-i18n/cli build:bundle",
  "node scripts/build-dsh-plugin.mjs",
  "node scripts/install-dsh-plugin.mjs --profile web",
  "```",
  "",
  "Restart the dsh web service after installing (bundle layers are frozen at boot).",
  "",
  "## Verify",
  "",
  "```powershell",
  "node plugins/dsh-collect-i18n/cli/bootstrap.mjs --version",
  "dsh --profile web --dump-config | Select-String '@collect-i18n/dsh-plugin'",
  "```",
  "",
].join("\n"));

const pluginFiles = [];
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) await collect(abs);
    else pluginFiles.push(abs);
  }
}
await collect(pluginDirectory);
console.log(JSON.stringify({
  output: pluginDirectory,
  version,
  files: pluginFiles.length,
  engineBytes: (await stat(join(pluginDirectory, "cli", "bin.js"))).size,
}, null, 2));
