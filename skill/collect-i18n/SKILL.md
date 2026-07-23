---
name: collect-i18n
description: "Operate Collect I18n for real Vue 3/Vite/Vue I18n projects: diagnose and initialize a project, start the persistent local collector, process remaining UI translation keys with bounded Agent TriggerPlans, hand irreducible tasks to the assisted manual queue, export the exact four-column translation workbook, and validate or apply translated workbook returns. Use when the user asks to collect i18n screenshots, prepare translation Excel, process zh-cn/en-us locale JSON, capture form validation or Element Plus messages, or import translated en-us copy."
---

# Collect I18n

Use the stable `collect-i18n` CLI as the execution and truth layer. Let the local service own scanning, browser state, request mocks, evidence, SQLite state, Excel generation, and file writes. Use Agent reasoning only to turn a queued task's source evidence into the bounded TriggerPlan DSL.

## Resolve the CLI first

Resolve one command prefix once and reuse it for the whole run. The Skill ships a fully bundled engine, so the bundled CLI below is the default and needs no separate install:

1. Use the Skill bundled engine: `node <skill-directory>/cli/bootstrap.mjs`. This is the default. The first browser run installs the versioned browser driver into the user's writable `~/.collect-i18n/runtime` cache; it never modifies the installed Skill. Vite is resolved from the target project at runtime.
2. If `COLLECT_I18N_CLI` names an absolute `dist/bin.js`, use `node <that-file>` instead.
3. Otherwise, if `collect-i18n` is on `PATH`, use it directly.
4. When this Skill is running from a source checkout, the repository-relative `packages/cli/dist/bin.js` is also valid after confirming it exists.

Run `--version` before touching the target project. Treat `<skill-directory>` as the absolute path to the installed `collect-i18n` skill folder (the one containing `SKILL.md`).

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

### 1. Prepare and start with one command

Run `run --output <absolute-xlsx-path> --deadline-minutes 120`. This checks the environment, initializes or refreshes the real project index, starts or reuses the collector, waits for deterministic work, and writes an immediately usable four-column workbook. Record `sessionId`, `studioUrl`, `appUrl`, `deadlineAt`, `nextAction`, and the workbook path.

Stop on a failed required check and report the concrete project prerequisite. Do not replace an invalid existing configuration automatically. Report actual counts from JSON; never invent coverage.

The returned workbook is a valid progress delivery. Missing runtime evidence leaves only its screenshot cell empty; Chinese and English remain populated. Never delay the first workbook until every screenshot exists.

If `nextAction` is `failed`, stop the workflow and report the collector startup or infrastructure error. Do not reinterpret an unavailable browser as 100% Agent work.

Present progress using only returned fields, for example:

```text
词条总数：<counts.total>
已生成截图：<uniqueScreenshotCount>
等待 Agent：<counts.needs_agent>
等待人工：<counts.needs_manual>
当前处理：<current.key_path, if present>
```

### 2. Process the Agent queue

Call `agent next --session <id>`. If `done` is true, leave the loop.

For each returned task:

1. Use only its Chinese text, source file, occurrences, route hints, action hints, attempts, and last error.
2. Create one strict version-1 TriggerPlan. Prefer stable role, label, test-id, or exact source-derived CSS locators. Use request mocks only when the target is an API success/error state.
3. Save the JSON below `.collect-i18n/plans/`.
4. Run `agent submit`, then `agent execute`.
5. Accept the task only when execution returns evidence with the target key, visible rectangle, route, and screenshot path.
6. On the first failure, call `agent next` again and make one evidence-driven correction only when the task is returned. After the second failure the service moves it to `needs_manual` and rejects further Agent execution. Never bypass that state with a saved task id.

Process tasks sequentially so browser state and failure evidence remain attributable. Never alter source code to make an Agent plan succeed.

### 3. Deliver on time and hand off the irreducible remainder

Poll `status` between tasks. When `deadlineAt` is reached, or when `needs_agent` is zero, run `export` immediately even if manual items remain. Confirm unique screenshot count, duplicate evidence count, coverage, manual percentage, row count, and embedded image count.

Treat the workbook as delivered once export succeeds. Treat screenshot collection as fully complete only when no manual items remain. These are separate outcomes.

When Agent work is exhausted, run `manual open --session <id>` to activate the next remaining task. Return the Studio URL and summarize the exact target key, Chinese text, source file, route hints, action hints, and any last error.

The human performs normal business operations in the opened project. The tool listens for the target runtime binding across native DOM, text Range, component props, and Element Plus Teleport/service nodes. When the key appears, it automatically highlights and screenshots it. The human does not manually crop or label screenshots.

Repeat `manual open` only after the previous target is captured or the user asks to move on.

### 4. Export or import

For export, run `export --session <id> --output <absolute-xlsx-path>`. Confirm the returned row and image counts. The workbook must contain only `中文`, `英文`, `截图`, `Key Path`, in that order.

For a translated return, run `import --file <absolute-xlsx-path> --session <id> --dry-run` first. Report duplicate, unknown, missing, or modified-Chinese issues from the JSON response. Run the same command with `--apply` only when validation has no fatal issues and the user's request authorizes importing the return.

## Completion

Finish with session totals, unique screenshot count, duplicate evidence count, coverage, remaining manual count, deadline result, workbook path or written en-us files, and nonfatal diagnostics. If manual items remain, state that the workbook has been delivered with blank screenshot cells and hand those keys to the Studio queue; do not describe screenshot collection as complete.
