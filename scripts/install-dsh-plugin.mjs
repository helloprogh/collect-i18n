#!/usr/bin/env node
// Install the collect-i18n DSH plugin (plugin package + Agent skill catalog).
//
// Idempotent: rerunning converges to the same state and never leaves residue.
//  1. builds the plugin package (scripts/build-dsh-plugin.mjs) when the bundled
//     engine is missing or --rebuild is passed;
//  2. mirrors the Agent skill (SKILL.md + references/ + cli/) into
//     <dshHome>/skills/collect-i18n/ (created on demand) with exact-prune, so
//     stale files from older versions do not survive;
//  3. installs the cordis bundle into the profile (default "web") via
//     `dsh plugin --profile <name> add <abs>` when not already present and
//     reconciles it into dsh.profile.bundles; falls back to pnpm + a row in
//     the profile cordis.patch.yml when the dsh CLI is unavailable.
//  4. verifies: node <plugin>/cli/bootstrap.mjs --version and
//     dsh --profile <name> --dump-config mentioning the package.
//
// The DSH npm installation itself is never modified; only <dshHome> user data
// (skills catalog + profile) is touched.
//
// Usage: node scripts/install-dsh-plugin.mjs [--profile web] [--home <dir>]
//        [--rebuild] [--skills-only] [--no-verify] [--plugin <abs-dir>]

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PLUGIN_NAME = "@collect-i18n/dsh-plugin";
const SKILL_NAME = "collect-i18n";
const VERSION = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")).version;

function parseArgs(argv) {
  const out = { profile: "web", home: "", rebuild: false, skillsOnly: false, noVerify: false, plugin: join(repositoryRoot, "plugins", "dsh-collect-i18n") };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const take = (name) => { out[name] = argv[++i]; };
    if (arg === "--profile") take("profile");
    else if (arg === "--home") take("home");
    else if (arg === "--plugin") take("plugin");
    else if (arg === "--rebuild") out.rebuild = true;
    else if (arg === "--skills-only") out.skillsOnly = true;
    else if (arg === "--no-verify") out.noVerify = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/install-dsh-plugin.mjs [--profile web] [--home <dir>] [--rebuild] [--skills-only] [--no-verify] [--plugin <abs-dir>]");
      process.exit(0);
    } else {
      console.error("Unknown option: " + arg);
      process.exit(2);
    }
  }
  return out;
}

const options = parseArgs(process.argv.slice(2));
const dshHome = options.home || process.env.DSH_HOME || join(homedir(), ".dsh");
const pluginDir = resolve(options.plugin);
const profileDir = join(dshHome, "profiles", options.profile);
const skillsDir = join(dshHome, "skills");
const skillTarget = join(skillsDir, SKILL_NAME);

function shellNeeded(command) {
  if (process.platform !== "win32") return false;
  // Bare shim names and .cmd/.bat must be launched through the shell; real
  // executables (node) must NOT (shell concatenates args and mangles paths
  // containing spaces, e.g. "C:\Program Files\nodejs\node.exe").
  if (!command.includes("\\") && !command.includes("/")) return /^(dsh|pnpm|npm)$/i.test(command);
  return /\\.(cmd|bat)$/i.test(command);
}

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, shell: shellNeeded(command), stdio: "inherit", timeout: 10 * 60 * 1000 });
}

function capture(command, args, cwd) {
  return spawnSync(command, args, { cwd, shell: shellNeeded(command), encoding: "utf8", timeout: 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
}

/** Read the store-dir referenced by an existing profile node_modules, if any.
 * Profiles created by older pnpm versions record their store location in
 * node_modules/.modules.yaml; pnpm refuses to link from a different store, so
 * pass the recorded one through --store-dir when present. */
function recordedStoreDir(profileDir) {
  try {
    const text = readFileSync(join(profileDir, "node_modules", ".modules.yaml"), "utf8");
    // pnpm 10 writes JSON; older pnpm wrote YAML with "storeDir: <path>".
    if (text.trimStart().startsWith("{")) {
      const storeDir = JSON.parse(text).storeDir;
      return typeof storeDir === "string" ? storeDir : "";
    }
    const match = text.match(/^\s*storeDir:\s*["']?([^"\n'\r]+)["']?\s*$/m);
    return match ? match[1].replace(/\\/g, "\\") : "";
  } catch {
    return "";
  }
}

function mkdirSyncSafe(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Copy one file, creating parents; returns true when created/updated, false when unchanged. */
function copyFileIfChanged(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  const srcStat = statSync(source);
  if (existsSync(target)) {
    const dstStat = statSync(target);
    const same = dstStat.size === srcStat.size;
    if (same) {
      const a = readFileSync(source);
      const b = readFileSync(target);
      if (a.equals(b)) return false;
    }
  }
  writeFileSync(target, readFileSync(source));
  return true;
}

/** List file paths relative to the root directory (recursive). */
function listFiles(root, dir = root) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(root, abs));
    else out.push(relative(root, abs));
  }
  return out.sort();
}

/** Mirror selected files (all, or a set of top-level prefixes) from source into
 * target with exact pruning: any file in the target that is not in the source
 * set is removed, so reruns leave no residue. */
function mirrorDirectory(source, target, prefixes = null) {
  const sourceFiles = listFiles(source);
  const selected = prefixes === null ? sourceFiles : sourceFiles.filter((rel) => prefixes.some((p) => rel === p || rel.startsWith(p + "/") || rel.startsWith(p + "\\")));
  let copied = 0;
  for (const rel of selected) {
    if (copyFileIfChanged(join(source, rel), join(target, rel))) copied++;
  }
  if (existsSync(target)) {
    const allowed = new Set(selected);
    for (const rel of listFiles(target)) {
      if (!allowed.has(rel)) rmSync(join(target, rel), { force: true });
    }
  }
  return copied;
}

// ---------------------------------------------------------------------------
// Step 1: ensure the plugin package is built.
// ---------------------------------------------------------------------------
const enginePath = join(pluginDir, "cli", "bin.js");
if (!existsSync(enginePath) || options.rebuild) {
  const build = run(process.execPath, [join(repositoryRoot, "scripts", "build-dsh-plugin.mjs")]);
  if (build.status !== 0) {
    console.error("build-dsh-plugin.mjs failed; aborting.");
    process.exit(1);
  }
} else {
  console.log("plugin engine found: " + enginePath);
}

if (!existsSync(join(pluginDir, "lib", "index.js"))) {
  console.error("Plugin entry lib/index.js is missing; aborting.");
  process.exit(1);
}

// Pack the plugin into a tarball and install from it. A raw directory add
// would create a junction to the repo path, so Node ESM peer resolution walks
// up from the repo (where @deepseek-ai/* is absent) instead of the healed
// profiles/node_modules fallback. The tarball is materialized as a real
// directory under the profile, where peer resolution succeeds.
const releaseDir = join(repositoryRoot, "release");
await mkdirSyncSafe(releaseDir);
const tarball = join(releaseDir, "collect-i18n-dsh-plugin-" + VERSION + ".tgz");
/** True when the tarball is missing or any plugin source file is newer than it. */
function tarballIsStale() {
  if (!existsSync(tarball)) return true;
  const tarballMtime = statSync(tarball).mtimeMs;
  for (const rel of listFiles(pluginDir)) {
    if (rel.includes('node_modules')) continue;
    if (statSync(join(pluginDir, rel)).mtimeMs > tarballMtime + 1000) return true;
  }
  return false;
}
if (tarballIsStale() || options.rebuild) {
  const packed = capture("pnpm", ["--dir", pluginDir, "pack", "--pack-destination", releaseDir]);
  if (packed.status !== 0) {
    console.error("pnpm pack failed; aborting.");
    console.error(packed.stderr || "");
    process.exit(1);
  }
} else {
  console.log("plugin tarball found: " + tarball);
}

// ---------------------------------------------------------------------------
// Step 2: Agent skill catalog mirror (exact prune, idempotent).
// ---------------------------------------------------------------------------
console.log("\n[1/3] skill catalog -> " + skillTarget);
const copiedSkill = mirrorDirectory(pluginDir, skillTarget, ["SKILL.md", "references", "cli"]);
console.log((copiedSkill ? copiedSkill + " file(s) updated" : "already up to date") + " (" + listFiles(skillTarget).length + " file(s) total)");

// ---------------------------------------------------------------------------
// Step 3: cordis bundle install into the profile.
// ---------------------------------------------------------------------------
let bundleState = "skipped";
if (!options.skillsOnly) {
  console.log("\n[2/3] bundle install -> profile '" + options.profile + "'");
  let installed = false;
  if (existsSync(join(profileDir, "package.json"))) {
    try {
      const profilePkg = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));
      const deps = profilePkg.dependencies || {};
      const bundles = profilePkg.dsh?.profile?.bundles || [];
      installed = Boolean(deps[PLUGIN_NAME]) && bundles.includes(PLUGIN_NAME);
    } catch {
      installed = false;
    }
  }
  const installedNm = join(profileDir, "node_modules", "@collect-i18n", "dsh-plugin");
  /** All files that ship in the package (lib, cli, SKILL.md, references, manifest
   * and patch), excluding gitignored/linked dirs. */
  function installableFiles() {
    return listFiles(pluginDir).filter((rel) => !rel.split(/[\\/]/).some((seg) => seg === "node_modules" || seg === ".git"));
  }
  /** True when any shipped file differs from the materialized installed copy. */
  function installedTreeStale() {
    if (!existsSync(installedNm)) return true;
    for (const rel of installableFiles()) {
      const srcFile = join(pluginDir, rel);
      const dstFile = join(installedNm, rel);
      if (!existsSync(dstFile)) return true;
      const a = readFileSync(srcFile);
      const b = readFileSync(dstFile);
      if (!a.equals(b)) return true;
    }
    return false;
  }
  const copyStale = installedTreeStale();
  if (installed && !copyStale) {
    bundleState = "already-installed";
    console.log("already present in profile dependencies and dsh.profile.bundles (all files in sync); skipping.");
  } else {
    if (installed) {
      console.log("installed copy differs from the plugin dir (engine or lib changed); reinstalling from tarball.");
      // pnpm treats an unchanged file: spec as up-to-date and refuses to
      // re-materialize, so drop the installed dir first.
      if (existsSync(installedNm)) rmSync(installedNm, { recursive: true, force: true });
    }
    const storeDir = recordedStoreDir(profileDir);
    const storeArgs = storeDir ? ["--store-dir", storeDir] : [];
    const tryDsh = () => {
      const result = capture("dsh", ["plugin", "--profile", options.profile, "add", tarball, ...storeArgs], dshHome);
      return result.status === 0;
    };
    if (tryDsh()) {
      bundleState = "installed-via-dsh";
      console.log("installed via: dsh plugin --profile " + options.profile + " add " + tarball);
    } else {
      console.log("dsh CLI unavailable/failed; falling back to pnpm + profile cordis.patch.yml row.");
      const pnpm = run("pnpm", ["--dir", profileDir, "add", tarball, ...storeArgs]);
      if (pnpm.status !== 0) {
        console.error("pnpm add failed; aborting.");
        process.exit(1);
      }
      const patchPath = join(profileDir, "cordis.patch.yml");
      const row = "- insert:\n    - id: " + SKILL_NAME + "\n      name: '" + PLUGIN_NAME + "'\n      config:\n        cliPath: ''\n";
      if (existsSync(patchPath)) {
        const existing = readFileSync(patchPath, "utf8");
        if (!existing.includes(PLUGIN_NAME)) {
          writeFileSync(patchPath, existing.trimEnd() + "\n" + row);
        }
      } else {
        writeFileSync(patchPath, row);
      }
      bundleState = "installed-via-pnpm-patch";
    }
  }
}

// ---------------------------------------------------------------------------
// Step 4: verification.
// ---------------------------------------------------------------------------
if (!options.noVerify) {
  console.log("\n[3/3] verify");
  const versionRun = capture(process.execPath, [join(pluginDir, "cli", "bootstrap.mjs"), "--version"]);
  const versionOut = (versionRun.stdout || "").trim();
  const versionOk = versionRun.status === 0 && versionOut === VERSION;
  console.log("node <plugin>/cli/bootstrap.mjs --version -> " + (versionOk ? versionOut + " (ok)" : JSON.stringify(versionOut)));
  if (!options.skillsOnly && bundleState !== "skipped") {
    const dump = capture("dsh", ["--profile", options.profile, "--dump-config"]);
    const mentioned = (dump.stdout || "").includes(PLUGIN_NAME);
    console.log("dsh --profile " + options.profile + " --dump-config mentions " + PLUGIN_NAME + ": " + (mentioned ? "yes" : "no"));
    if (dump.status !== 0) console.log("(dump-config exit code: " + dump.status + ")");
  }
}

console.log("\nDone. bundle=" + bundleState + " skill=" + skillTarget);
if (bundleState === "installed-via-dsh" || bundleState === "installed-via-pnpm-patch") {
  console.log("The dsh web service must be restarted (bundle layers are frozen at boot) for the new tools to appear in sessions.");
}
