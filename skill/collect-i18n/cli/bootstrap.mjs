#!/usr/bin/env node
// Collect I18n skill bootstrap.
//
// The Skill ships the full CLI engine bundled into bin.js. The only runtime
// dependency that cannot be bundled is playwright-core (it carries a
// platform-specific browser driver). Because the engine lazy-loads it only when
// a browser is actually launched, non-browser commands (doctor, init, scan,
// status, agent, manual, export, import) run instantly with no setup. Only
// `start`/`serve` (which drive Chrome) trigger a one-time install of
// playwright-core into this directory's node_modules. vite is resolved from the
// target project at runtime, so it is not needed here.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const enginePath = join(here, "bin.js");
const enginePkgPath = join(here, "package.json");
const playwrightCorePkg = join(here, "node_modules", "playwright-core", "package.json");

if (!existsSync(enginePath)) {
  console.error("[collect-i18n] Bundled engine bin.js is missing. The skill package is incomplete.");
  process.exit(1);
}

// Commands that launch a browser in this process (or spawn a detached daemon
// that does, bypassing this bootstrap). Every other command runs without
// playwright-core thanks to lazy loading.
const BROWSER_COMMANDS = new Set(["start", "serve"]);
const needsBrowser = process.argv.slice(2).some((arg) => BROWSER_COMMANDS.has(arg));

function ensurePlaywrightCore() {
  let required;
  try {
    required = JSON.parse(readFileSync(enginePkgPath, "utf8")).dependencies?.["playwright-core"];
  } catch {
    required = null;
  }
  if (!required) return;
  let installed = null;
  try {
    installed = JSON.parse(readFileSync(playwrightCorePkg, "utf8")).version;
  } catch {
    installed = null;
  }
  if (installed) return;
  console.error("[collect-i18n] First browser run: installing playwright-core (browser driver)...");
  const pkgMgr = existsSync(join(here, "pnpm-lock.yaml")) ? "pnpm" : "npm";
  const result = spawnSync(pkgMgr, ["install", "--prod", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: here,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error("[collect-i18n] Dependency setup failed. Ensure Node.js + npm are available, then re-run.");
    process.exit(result.status ?? 1);
  }
}

if (needsBrowser) ensurePlaywrightCore();

const child = spawnSync(process.execPath, [enginePath, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(child.status ?? 1);