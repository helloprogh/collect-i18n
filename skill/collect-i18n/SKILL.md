---
name: collect-i18n
description: "Operate Collect I18n for real Vue 3/Vite/Vue I18n projects: diagnose and initialize a project, start the persistent local collector, process remaining UI translation keys with bounded Agent TriggerPlans, hand irreducible tasks to the assisted manual queue, export the exact four-column translation workbook, and validate or apply translated workbook returns. Use when the user asks to collect i18n screenshots, prepare translation Excel, process zh-cn/en-us locale JSON, capture form validation or Element Plus messages, or import translated en-us copy."
---

# Collect I18n

Use the stable `collect-i18n` CLI as the execution and truth layer. Let the local service own scanning, browser state, request mocks, evidence, SQLite state, Excel generation, and file writes. Use Agent reasoning only to turn a queued task's source evidence into the bounded TriggerPlan DSL.

## Resolve the CLI first

Resolve one command prefix once and reuse it for the whole run:

1. If `COLLECT_I18N_CLI` names an absolute `dist/bin.js`, use `node <that-file>`.
2. Otherwise, if `collect-i18n` is on `PATH`, use it directly.
3. When this Skill is running from a source checkout, use the repository-relative `packages/cli/dist/bin.js` after confirming it exists.

Run `--version` before touching the target project. If none of these choices is available, stop and ask for the installed CLI path; the Skill ZIP intentionally does not hide or duplicate the execution engine.

## Operating rules

- Run commands against the user's real project. Never add expected strings, test-only pages, fake routes, or forced visibility code to improve coverage.
- Add `--project <absolute-path> --json --non-interactive` to every command.
- Treat successful runtime evidence as completion. Static text matches and Agent claims are hints, not evidence.
- Do not manipulate the project browser while `agent execute` is running. Wait for the CLI result, then analyze its evidence or error.
- Do not use arbitrary browser evaluation, shell steps, external navigation, or unbounded waits in a TriggerPlan.
- Treat the capability embedded in `studioUrl` as a local session secret. Show or open it only for the requesting user; never copy it into TriggerPlans, project files, commits, issues, or shared logs, and redact it from summaries.
- Keep English equal to Chinese in a newly exported workbook. Do not create a status column or annotate untranslated cells.
- When importing a return, treat empty English or English equal to Chinese as untranslated and leave the target JSON unchanged.

Read [CLI protocol](references/cli-protocol.md) before operating the tool. Read [TriggerPlan](references/trigger-plan.md) before creating an Agent plan.

## End-to-end workflow

### 1. Diagnose and initialize

Run `doctor` first and inspect each required check. Stop on a failed required check and report the concrete missing project prerequisite.

Run `init` when `.collect-i18n/config.json` is absent or the user explicitly requests reinitialization. Otherwise run `scan` to refresh the real locale/source index without replacing configuration.

Report actual counts from JSON: locale keys, occurrences, route hints, action hints, unknown keys, and diagnostics. Do not invent a target count or expected coverage.

### 2. Start or reuse the collector

Run `start --background`. Record `sessionId`, `studioUrl`, and `appUrl`. A reused service is valid; use the returned session instead of starting a second browser.

Run `status --session <id>` after startup. Present progress using only returned fields, for example:

```text
词条总数：<counts.total>
已生成截图：<counts.captured>
等待 Agent：<counts.needs_agent>
等待人工：<counts.needs_manual>
当前处理：<current.key_path, if present>
```

The deterministic queue runs in the background. Poll status at a reasonable interval until `pending` and `running` reach zero before consuming Agent work.

### 3. Process the Agent queue

Call `agent next --session <id>`. If `done` is true, leave the loop.

For each returned task:

1. Use only its Chinese text, source file, occurrences, route hints, action hints, attempts, and last error.
2. Create one strict version-1 TriggerPlan. Prefer stable role, label, test-id, or exact source-derived CSS locators. Use request mocks only when the target is an API success/error state.
3. Save the JSON below `.collect-i18n/plans/`.
4. Run `agent submit`, then `agent execute`.
5. Accept the task only when execution returns evidence with the target key, visible rectangle, route, and screenshot path.
6. On failure, call `agent next` again. Make at most one evidence-driven correction; the service moves repeated failures to the manual queue.

Process tasks sequentially so browser state and failure evidence remain attributable. Never alter source code to make an Agent plan succeed.

### 4. Hand off the irreducible remainder

When Agent work is exhausted, run `manual open --session <id>` to activate the next remaining task. Return the Studio URL and summarize the exact target key, Chinese text, source file, route hints, action hints, and any last error.

The human performs normal business operations in the opened project. The tool listens for the target runtime binding across native DOM, text Range, component props, and Element Plus Teleport/service nodes. When the key appears, it automatically highlights and screenshots it. The human does not manually crop or label screenshots.

Repeat `manual open` only after the previous target is captured or the user asks to move on.

### 5. Export or import

For export, run `export --session <id> --output <absolute-xlsx-path>`. Confirm the returned row and image counts. The workbook must contain only `中文`, `英文`, `截图`, `Key Path`, in that order.

For a translated return, run `import --file <absolute-xlsx-path> --session <id> --dry-run` first. Report duplicate, unknown, missing, or modified-Chinese issues from the JSON response. Run the same command with `--apply` only when validation has no fatal issues and the user's request authorizes importing the return.

## Completion

Finish with the session totals, evidence count, remaining manual count, workbook path or written en-us files, and any nonfatal diagnostics. If manual items remain, do not call the run complete; clearly hand them to the Studio queue.
