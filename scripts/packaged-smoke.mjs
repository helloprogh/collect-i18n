#!/usr/bin/env node
// Packaged-artifact smoke test: the verification chain that unit tests and
// the in-repo e2e cannot cover — install the PACKAGED skill zip the way a
// user does, drive a real workflow against a real project (background
// daemon, Vite, headless Chrome), and validate the JSON protocol and the
// delivered workbook. Also packs the DSH plugin tarball and smoke-tests its
// bundled engine from the extracted package.
//
// This chain caught the v0.5.0-v0.6.0 background-daemon regression (node
// parsed node.exe as its entry script) that every other check missed.
//
// Usage:
//   node scripts/packaged-smoke.mjs <skill-zip> <target-project-root>
//        [--deadline-minutes 6] [--deterministic-timeout-minutes 3]

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const expectedVersion = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")).version;

function fail(message) {
  console.error(`[packaged-smoke] FAIL: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { deadline: "6", deterministic: "3" };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--deadline-minutes") out.deadline = argv[++i];
    else if (arg === "--deterministic-timeout-minutes") out.deterministic = argv[++i];
    else positional.push(arg);
  }
  if (positional.length !== 2) {
    console.error("Usage: node scripts/packaged-smoke.mjs <skill-zip> <target-project-root> [--deadline-minutes N] [--deterministic-timeout-minutes M]");
    process.exit(2);
  }
  out.zip = resolve(positional[0]);
  out.projectRoot = resolve(positional[1]);
  return out;
}

const options = parseArgs(process.argv.slice(2));
if (!existsSync(options.zip)) fail(`skill zip not found: ${options.zip}`);
if (!existsSync(join(options.projectRoot, "package.json"))) fail(`target project not found: ${options.projectRoot}`);

function shellNeeded(command) {
  if (process.platform !== "win32") return false;
  return !command.includes("\\") && !command.includes("/");
}

/** Run a command; on failure print captured output and abort. */
function run(command, args, { capture = false, timeoutMs = 12 * 60 * 1000, cwd = repositoryRoot } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    shell: shellNeeded(command),
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error || result.status !== 0) {
    console.error(result.stdout?.slice?.(-4_000));
    console.error(result.stderr?.slice?.(-4_000));
    fail(`${command} ${args.join(" ")} exited with ${result.status ?? result.error?.message}`);
  }
  return result;
}

/** Run the packaged bootstrap CLI with the stable JSON protocol flags. */
function bootstrap(cliDirectory, args, { timeoutMs } = {}) {
  const bootstrapPath = join(cliDirectory, "bootstrap.mjs");
  if (!existsSync(bootstrapPath)) fail(`packaged bootstrap missing: ${bootstrapPath}`);
  const result = spawnSync(process.execPath, [
    bootstrapPath,
    "--project", options.projectRoot,
    "--json", "--non-interactive",
    ...args,
  ], {
    cwd: options.projectRoot,
    encoding: "utf8",
    timeout: timeoutMs ?? 12 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const parsed = (() => {
    const start = stdout.indexOf("{");
    if (start < 0) return undefined;
    try { return JSON.parse(stdout.slice(start)); } catch { return undefined; }
  })();
  if (result.error || result.status !== 0 || !parsed?.ok) {
    console.error(`[packaged-smoke] bootstrap ${args.join(" ")} failed (exit ${result.status ?? result.error?.message}):`);
    console.error((result.stderr ?? "").slice(-4_000));
    console.error(stdout.slice(-4_000));
    fail(`bootstrap ${args[0]} did not return ok:true`);
  }
  return parsed;
}

const workspace = join(tmpdir(), `collect-i18n-smoke-${randomUUID()}`);
const extractedZip = join(workspace, "skill");
const outputWorkbook = join(workspace, "smoke-report.xlsx");
try {
  mkdirSync(extractedZip, { recursive: true });

  // ---------------------------------------------------------------- install
  const zipBytes = statSync(options.zip).size;
  if (zipBytes < 1_000_000) fail(`skill zip suspiciously small (${zipBytes} bytes)`);
  run("unzip", ["-q", options.zip, "-d", extractedZip]);
  const zipCliDirectory = join(extractedZip, "collect-i18n", "cli");
  const packagedVersion = JSON.parse(readFileSync(join(zipCliDirectory, "package.json"), "utf8")).version;
  if (packagedVersion !== expectedVersion) fail(`packaged engine version ${packagedVersion} != repository version ${expectedVersion}`);
  console.log(`[1/6] skill zip installed (${Math.round(zipBytes / 1e6)} MB, engine v${packagedVersion})`);

  // ----------------------------------------------------------------- doctor
  const doctor = bootstrap(zipCliDirectory, ["doctor"]);
  if (!doctor.data.ready) fail(`doctor reports the target project is not ready: ${JSON.stringify(doctor.data.checks)}`);
  console.log(`[2/6] doctor ready (${doctor.data.checks.filter((c) => c.required && c.ok).length} required checks ok)`);

  // ------------------------------------------------------------------- init
  // Fresh config, then force headless: the smoke must drive the real
  // background daemon + Vite + Chrome on a display-less runner.
  bootstrap(zipCliDirectory, ["init"]);
  const configPath = join(options.projectRoot, ".collect-i18n", "config.json");
  if (!existsSync(configPath)) fail("init did not create .collect-i18n/config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.browser.headless = true;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`[3/6] initialized (${config.locales.roots.join(", ")}, headless forced)`);

  // -------------------------------------------------------------------- run
  // Default background mode on purpose: the daemon spawn path is exactly
  // what in-repo tests never exercised and what v0.5.0 broke silently.
  const runResult = bootstrap(zipCliDirectory, [
    "run",
    "--output", outputWorkbook,
    "--deadline-minutes", options.deadline,
    "--deterministic-timeout-minutes", options.deterministic,
  ], { timeoutMs: (Number(options.deadline) + 4) * 60 * 1000 });
  const data = runResult.data;
  const counts = data.status?.counts ?? {};
  const blockedActions = new Set(["failed", "restart"]);
  if (!Number(counts.total)) fail(`run reported no tasks: ${JSON.stringify(counts)}`);
  if (!Number(counts.captured)) fail(`run captured nothing: ${JSON.stringify(counts)}`);
  if (Number(counts.failed) !== 0) fail(`run had failures: ${JSON.stringify(counts)}`);
  if (blockedActions.has(data.nextAction)) fail(`run nextAction is ${data.nextAction}`);
  if (!existsSync(data.workbook?.outputPath ?? "")) fail(`workbook missing: ${data.workbook?.outputPath}`);
  console.log(`[4/6] run ok: total ${counts.total}, captured ${counts.captured}, pending ${counts.pending}, needs_agent ${counts.needs_agent}, needs_manual ${counts.needs_manual}, failed 0, nextAction ${data.nextAction}`);

  // ---------------------------------------------------------------- workbook
  const requireFromExcel = createRequire(pathToFileURL(join(repositoryRoot, "packages", "excel", "package.json")));
  const ExcelJS = requireFromExcel("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(data.workbook.outputPath);
  const sheet = workbook.worksheets[0];
  const header = [1, 2, 3, 4].map((column) => sheet.getCell(1, column).text);
  if (workbook.worksheets.length !== 1) fail(`workbook has ${workbook.worksheets.length} worksheets`);
  if (header.join("|") !== "中文|英文|截图|Key Path") fail(`workbook header drifted: ${header.join(" | ")}`);
  if (sheet.actualRowCount !== Number(counts.total) + 1) fail(`workbook rows ${sheet.actualRowCount} != keys+1 (${Number(counts.total) + 1})`);
  const embeddedImages = workbook.model.media?.length ?? 0;
  if (!embeddedImages) fail("workbook contains no embedded screenshots");
  if (embeddedImages !== Number(data.workbook.stats?.captured ?? -1)) {
    fail(`embedded images ${embeddedImages} != export stats.captured ${data.workbook.stats?.captured}`);
  }
  console.log(`[5/6] workbook verified: 1 sheet, exact four-column header, ${embeddedImages} embedded screenshots`);

  // -------------------------------------------------------------------- stop
  const stop = bootstrap(zipCliDirectory, ["stop"]);
  if (stop.data.stopped === false && !stop.data.alreadyStopped) fail(`stop did not shut the service down: ${JSON.stringify(stop.data)}`);
  console.log("[6/6] service stopped cleanly");

  // ------------------------------------------------------- dsh tgz (engine)
  const tgzDir = join(workspace, "tgz");
  mkdirSync(tgzDir, { recursive: true });
  // --dir packs the PLUGIN manifest; a positional directory arg makes pnpm
  // pack the workspace root instead.
  run("pnpm", ["--dir", join(repositoryRoot, "plugins", "dsh-collect-i18n"), "pack", "--pack-destination", tgzDir]);
  const tgzName = readdirSync(tgzDir).find((name) => name.endsWith(".tgz"));
  if (!tgzName) fail("pnpm pack produced no tarball");
  if (!tgzName.includes(expectedVersion)) fail(`tarball ${tgzName} does not carry version ${expectedVersion}`);
  const extractedTgz = join(tgzDir, "package");
  // --force-local: GNU tar reads "C:/..." as a remote host otherwise.
  run("tar", ["-xzf", join(tgzDir, tgzName), "-C", tgzDir, ...(process.platform === "win32" ? ["--force-local"] : [])]);
  const tgzVersion = JSON.parse(readFileSync(join(extractedTgz, "cli", "package.json"), "utf8")).version;
  if (tgzVersion !== expectedVersion) fail(`tarball engine version ${tgzVersion} != ${expectedVersion}`);
  const tgzDoctor = bootstrap(join(extractedTgz, "cli"), ["doctor"]);
  if (!tgzDoctor.data.ready) fail("doctor failed from the packed dsh plugin engine");
  console.log(`[packaged-smoke] dsh tarball ${tgzName}: engine v${tgzVersion}, doctor ready`);

  console.log(`[packaged-smoke] PASSED — packaged artifacts drive a real workflow end to end.`);
} catch (error) {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  // Always release the target project's service and remove the temp tree.
  try {
    const bootstrapPath = join(extractedZip, "collect-i18n", "cli", "bootstrap.mjs");
    if (existsSync(bootstrapPath)) {
      spawnSync(process.execPath, [bootstrapPath, "--project", options.projectRoot, "--json", "--non-interactive", "stop"], {
        cwd: options.projectRoot, encoding: "utf8", timeout: 60_000,
      });
    }
  } catch { /* best effort */ }
  rmSync(workspace, { recursive: true, force: true });
}
