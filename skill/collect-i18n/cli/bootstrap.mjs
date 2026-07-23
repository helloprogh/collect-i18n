#!/usr/bin/env node
// Collect I18n skill bootstrap.
//
// The Skill ships the full CLI engine bundled into bin.js. The only runtime
// dependency that cannot be bundled is playwright-core (it carries a
// platform-specific browser driver). Because the engine lazy-loads it only when
// a browser is actually launched, non-browser commands (doctor, init, scan,
// status, agent, manual, export, import) run instantly with no setup. Only
// `start`/`serve`/`run` (which drive Chrome) prepare playwright-core in a
// versioned, user-writable cache. The installed Skill remains immutable. Vite
// is resolved from the target project at runtime, so it is not needed here.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const enginePath = join(here, "bin.js");
const enginePkgPath = join(here, "package.json");

if (!existsSync(enginePath)) {
  console.error("[collect-i18n] Bundled engine bin.js is missing. The skill package is incomplete.");
  process.exit(1);
}

// Commands that launch a browser in this process (or spawn a detached daemon
// that does, bypassing this bootstrap). Every other command runs without
// playwright-core thanks to lazy loading.
const BROWSER_COMMANDS = new Set(["start", "serve", "run"]);
const needsBrowser = process.argv.slice(2).some((arg) => BROWSER_COMMANDS.has(arg));

function ensurePlaywrightCore() {
  let required;
  let engineVersion = "unknown";
  try {
    const enginePackage = JSON.parse(readFileSync(enginePkgPath, "utf8"));
    required = enginePackage.dependencies?.["playwright-core"];
    engineVersion = enginePackage.version ?? engineVersion;
  } catch {
    required = null;
  }
  if (!required) return;
  const cacheRoot = process.env.COLLECT_I18N_CACHE || join(homedir(), ".collect-i18n", "runtime");
  const cacheDirectory = join(cacheRoot, engineVersion);
  const playwrightCorePkg = join(cacheDirectory, "node_modules", "playwright-core", "package.json");
  let installed = null;
  try {
    installed = JSON.parse(readFileSync(playwrightCorePkg, "utf8")).version;
  } catch {
    installed = null;
  }
  const parseVersion = (value) => String(value).replace(/^[^0-9]*/, "").split(".").slice(0, 3).map((part) => Number(part) || 0);
  const satisfies = (version, range) => {
    const actual = parseVersion(version);
    const minimum = parseVersion(range);
    if (String(range).startsWith("^")) {
      return actual[0] === minimum[0] && (
        actual[1] > minimum[1] || (actual[1] === minimum[1] && actual[2] >= minimum[2])
      );
    }
    return actual.join(".") === minimum.join(".");
  };
  if (!installed || !satisfies(installed, required)) {
    console.error(`[collect-i18n] Preparing browser driver ${required} in ${cacheDirectory}...`);
    mkdirSync(cacheDirectory, { recursive: true });
    writeFileSync(join(cacheDirectory, "package.json"), `${JSON.stringify({
      name: "collect-i18n-runtime-cache",
      private: true,
      version: engineVersion,
      dependencies: { "playwright-core": required },
    }, null, 2)}\n`, "utf8");
    const npmCliCandidates = [
      process.env.npm_execpath,
      join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
      join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    ].filter(Boolean);
    const npmCli = npmCliCandidates.find((candidate) => existsSync(candidate));
    if (!npmCli) {
      console.error("[collect-i18n] Cannot locate npm-cli.js beside the active Node.js runtime.");
      process.exit(1);
    }
    const result = spawnSync(process.execPath, [
      npmCli,
      "install",
      "--prefix", cacheDirectory,
      "--cache", join(cacheDirectory, ".npm-cache"),
      "--prod",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
    ], {
      cwd: cacheDirectory,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      if (result.error) console.error(`[collect-i18n] ${result.error.message}`);
      console.error("[collect-i18n] Browser driver setup failed. Ensure Node.js + npm and network access are available, then re-run.");
      process.exit(result.status ?? 1);
    }
  }
  process.env.COLLECT_I18N_PLAYWRIGHT_MODULE = pathToFileURL(join(cacheDirectory, "node_modules", "playwright-core", "index.mjs")).href;
}

if (needsBrowser) ensurePlaywrightCore();

const child = spawnSync(process.execPath, [enginePath, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(child.status ?? 1);
