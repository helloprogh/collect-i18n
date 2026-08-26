import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";

/**
 * collect-i18n for DeepSeek Harness (server-side cordis plugin).
 *
 * Registers a small tool family that drives the bundled collect-i18n CLI:
 *   collect_i18n_cli     - raw passthrough: node <plugin>/cli/bootstrap.mjs <args...>
 *   collect_i18n_run     - end-to-end collection run (start/reuse + deterministic queue + export)
 *   collect_i18n_status  - session status with authoritative evidence counts
 *   collect_i18n_export  - four-column workbook export (中文/英文/截图/Key Path)
 *   collect_i18n_import  - translated workbook import (dry-run validation or apply)
 *
 * The plugin is self-contained: cli/bin.js is the fully bundled engine,
 * cli/runtime/* are its runtime modules, cli/bootstrap.mjs is the skill CLI
 * entry that lazily installs playwright-core into ~/.collect-i18n/runtime.
 * @module @collect-i18n/dsh-plugin
 */
const name = "collect-i18n";
const inject = ["tools", "systemPrompt"];

/** Runtime configuration for the collect-i18n plugin. */
const Config = z.object({
  /** Absolute path to a bootstrap entry; empty string = bundled engine of this package. */
  cliPath: z.string().default(""),
  /** Order for the usage prompt section in the global system prompt. */
  promptSectionOrder: z.number().default(113),
});

/** Plugin root: the directory that contains package.json. */
const pluginRoot = fileURLToPath(new URL("..", import.meta.url));

/** Every CLI invocation must carry these flags (CLI truth-layer protocol). */
const MANDATORY_FLAGS = ["--json", "--non-interactive"];

/**
 * Spawn the bundled CLI synchronously and capture stdout/stderr in full.
 * The CLI is the truth layer: callers must check both the exit code and the
 * ok field of the JSON envelope printed on stdout, never guess from text.
 * @param {string} cliPath - absolute path to cli/bootstrap.mjs
 * @param {string[]} args - CLI arguments (project flags, command, options)
 * @param {object} [options]
 * @param {string} [options.cwd] - working directory for the child process
 * @param {number} [options.timeoutMs] - kill the child after this many ms
 * @returns {Promise<{ok: boolean, exitCode: number, stdout: string, stderr: string, command: string}>}
 */
async function runCli(cliPath, args, options = {}) {
  const command = [cliPath, ...args].join(" ");
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs ?? 15 * 60 * 1000,
    windowsHide: true,
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const exitCode = result.error ? -1 : (result.status ?? -1);
  let ok = false;
  if (exitCode === 0) {
    // The CLI contract: project commands print one JSON envelope (ok must be
    // true inside it); simple commands like --version print plain text and
    // a zero exit is success.
    let envelope = null;
    try {
      envelope = JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? "");
    } catch {
      envelope = null;
    }
    ok = envelope === null ? true : envelope.ok === true;
  }
  return { ok, exitCode, stdout, stderr, command };
}

/** Render a CLI result for the model: stdout, marked stderr, then exit marker. */
function renderResult(value) {
  let text = "";
  if (value.stdout) text += value.stdout.replace(/\s+$/, "") + "\n";
  if (value.stderr) text += "\n[stderr]\n" + value.stderr.replace(/\s+$/, "") + "\n";
  if (value.exitCode !== 0) text += "[exit code: " + value.exitCode + "]" + (value.ok ? "" : " (ok=false)");
  if (!value.stdout && !value.stderr) text = "(no output)" + (value.exitCode !== 0 ? "\n[exit code: " + value.exitCode + "]" : "");
  return text;
}

/** Shared output schema for all collect_i18n_* tools. */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean", required: true },
    exitCode: { type: "number", required: true },
    stdout: { type: "string", required: true },
    stderr: { type: "string", required: true },
    command: { type: "string", required: true },
  },
  additionalProperties: false,
};

function registerCollectI18nTools(ctx, config) {
  const cliPath = config.cliPath || join(pluginRoot, "cli", "bootstrap.mjs");
  const run = (args, cwd, timeoutMs) => runCli(cliPath, args, { cwd, timeoutMs });

  ctx.tools.register(defineTool({
    name: "collect_i18n_cli",
    description: "Run the bundled collect-i18n CLI with raw arguments (passthrough to `node <plugin>/cli/bootstrap.mjs <args>`). Use for any command (doctor, init, scan, start, stop, finalize, agent next/submit/execute, manual open, ...) when the dedicated collect_i18n_run/status/export/import tools do not fit. The CLI is the truth layer: it prints one JSON envelope on stdout (ok true/false, data), and you must check both the process exit code and the ok field. Every project-scoped command needs --project <absolute-path> plus --json and --non-interactive (added automatically unless you pass --no-mandatory-json). Pass each argument as its own array element.",
    parameters: {
      args: {
        type: "array",
        required: true,
        description: "Raw CLI arguments, one element per token, e.g. {\"args\":[\"status\",\"--session\",\"s_123\"]}. --json and --non-interactive are prepended automatically; pass \"--no-mandatory-json\" as the first element to suppress them.",
      },
      cwd: {
        type: "string",

        description: "Working directory for the CLI subprocess (defaults to the session working directory).",
      },
      timeoutMs: {
        type: "number",

        description: "Kill the CLI after this many milliseconds (default 900000). Long runs should rely on the CLI's own --deadline-minutes instead.",
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (args, value) => [{ type: "text", text: renderResult(value) }],
    },
    async execute(args, exec) {
      const raw = Array.isArray(args.args) ? args.args : [];
      const withJson = raw[0] === "--no-mandatory-json" ? raw.slice(1) : [...MANDATORY_FLAGS, ...raw];
      const cwd = args.cwd || exec?.agent?.session?.header?.cwd || process.cwd();
      return run(withJson, cwd, args.timeoutMs);
    },
  }));

  ctx.tools.register(defineTool({
    name: "collect_i18n_run",
    description: "End-to-end collection run for a Vue project: environment check, init/refresh index as needed, start or reuse the local collection service, wait for the deterministic evidence queue to finish, and export the first four-column workbook (中文/英文/截图/Key Path). Safe to call repeatedly (reuses an existing session). Long runs: the CLI waits up to deadlineMinutes for deterministic capture; the tool's own subprocess timeout is deadlineMinutes * 60s + 60s buffer (default 120m deadline -> about 121m tool timeout), so the call covers the full workflow deadline; pass a smaller deadlineMinutes to bound both. Results report sessionId/studioUrl/appUrl/deadlineAt/status/workbook. After the run, iterate with collect_i18n_status + collect_i18n_cli (agent next/submit/execute) for deferred evidence, then finalize and collect_i18n_export.",
    parameters: {
      project: {
        type: "string",
        required: true,
        description: "Absolute path of the target Vue project root.",
      },
      output: {
        type: "string",

        description: "Absolute .xlsx path for the first exported workbook. Defaults to <project>/.collect-i18n/collect-i18n-first.xlsx.",
      },
      deadlineMinutes: {
        type: "number",

        description: "Deterministic capture budget in minutes (CLI default 120; minimum 1). The tool's subprocess timeout is deadlineMinutes * 60s + 60s buffer, so the call never cuts the workflow deadline short.",
      },
      session: {
        type: "string",

        description: "Resume/continue an existing session id; omit to create or reuse the latest session.",
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (args, value) => [{ type: "text", text: renderResult(value) }],
    },
    async execute(args, exec) {
      const deadlineMinutes = Math.max(1, Number(args.deadlineMinutes) || 120);
      const explicit = args.deadlineMinutes != null;
      const flags = ["run", "--project", args.project, ...(args.output ? ["--output", args.output] : []), ...(explicit ? ["--deadline-minutes", String(deadlineMinutes)] : []), ...(args.session ? ["--session", args.session] : [])];
      const cwd = exec?.agent?.session?.header?.cwd || process.cwd();
      const timeoutMs = deadlineMinutes * 60 * 1000 + 60 * 1000;
      return run([...MANDATORY_FLAGS, ...flags], cwd, timeoutMs);
    },
  }));

  ctx.tools.register(defineTool({
    name: "collect_i18n_status",
    description: "Authoritative session status for a project: task counts (total/pending/running/captured/needs_agent/needs_manual/failed/skipped), capturedKeyCount, evidenceCount, coveragePercent, manualPercent, exportReady and the automatic phase feed. Prefer this over guessing from logs. Omit session to read the latest session.",
    parameters: {
      project: {
        type: "string",
        required: true,
        description: "Absolute path of the target Vue project root.",
      },
      session: {
        type: "string",

        description: "Session id; omitted = latest session.",
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (args, value) => [{ type: "text", text: renderResult(value) }],
    },
    async execute(args, exec) {
      const flags = ["status", "--project", args.project, ...(args.session ? ["--session", args.session] : [])];
      const cwd = exec?.agent?.session?.header?.cwd || process.cwd();
      return run([...MANDATORY_FLAGS, ...flags], cwd);
    },
  }));

  ctx.tools.register(defineTool({
    name: "collect_i18n_export",
    description: "Export the in-session workbook for a project: one visible sheet with exactly four columns 中文/英文/截图/Key Path; the English column copies the Chinese source verbatim (it is not a translation pass). Returns the output path, row count and embedded image count.",
    parameters: {
      project: {
        type: "string",
        required: true,
        description: "Absolute path of the target Vue project root.",
      },
      output: {
        type: "string",

        description: "Absolute .xlsx path; defaults to <project>/.collect-i18n/collect-i18n-export.xlsx.",
      },
      session: {
        type: "string",

        description: "Session id; omitted = latest session.",
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (args, value) => [{ type: "text", text: renderResult(value) }],
    },
    async execute(args, exec) {
      const flags = ["export", "--project", args.project, ...(args.output ? ["--output", args.output] : []), ...(args.session ? ["--session", args.session] : [])];
      const cwd = exec?.agent?.session?.header?.cwd || process.cwd();
      return run([...MANDATORY_FLAGS, ...flags], cwd);
    },
  }));

  ctx.tools.register(defineTool({
    name: "collect_i18n_import",
    description: "Return a translated workbook into a session. Only rows with a non-empty English column differing from the Chinese source form changes. Dry-run (default) never writes files and reports canApply/issues/changes; use apply=true to write the translations back into the locale files. Fatal issues (duplicates, unknown/missing keys, Chinese edits, illegal directories) block application.",
    parameters: {
      project: {
        type: "string",
        required: true,
        description: "Absolute path of the target Vue project root.",
      },
      file: {
        type: "string",
        required: true,
        description: "Absolute .xlsx path of the translated workbook.",
      },
      session: {
        type: "string",

        description: "Session id; omitted = latest session.",
      },
      apply: {
        type: "boolean",

        description: "Apply the changes to locale files (default false = dry-run validation only).",
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (args, value) => [{ type: "text", text: renderResult(value) }],
    },
    async execute(args, exec) {
      const flags = ["import", "--project", args.project, "--file", args.file, ...(args.session ? ["--session", args.session] : []), args.apply ? "--apply" : "--dry-run"];
      const cwd = exec?.agent?.session?.header?.cwd || process.cwd();
      return run([...MANDATORY_FLAGS, ...flags], cwd);
    },
  }));
}

/** Condensed operating rules mirrored from SKILL.md for the global prompt. */
function usageSectionText() {
  return [
    "collect-i18n: use the collect_i18n_* tools to collect Chinese-to-English translation evidence (runtime screenshots) from Vue projects and produce four-column workbooks (中文/英文/截图/Key Path).",
    "The bundled CLI is the truth layer: every tool prints one JSON envelope (ok/data or ok/error) and returns the process exit code; trust only that, never console text.",
    "Rules: (1) always pass --project <absolute-project-root>; the plugin does it for the dedicated tools. (2) Never edit the target project. (3) Evidence decides: A-level host-DOM evidence is captured deterministically; B-level Vue evidence needs a side-effect-free canary probe; when in doubt, defer to the agent queue and execute TriggerPlan v1 plans (40 steps max, plan file under .collect-i18n/plans/). (4) Do not operate the project browser while the CLI is running a session; single session per project. (5) studioUrl/appUrl returned by run/start are session secrets - do not share or leak them. (6) finalize is only valid after pending and running counts reach zero; then export and let the user review.",
  ].join("\n");
}

function apply(ctx, config = {}) {
  const resolved = { cliPath: "", promptSectionOrder: 113, ...config };
  registerCollectI18nTools(ctx, resolved);
  ctx.systemPrompt.section({
    name: "collect-i18n:usage",
    order: resolved.promptSectionOrder,
    text: usageSectionText(),
  });
}

export { Config, apply, inject, name };
