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
- If `init` or `scan` reports an active session, do not stop it merely to obtain a fresh run. Use `run`/`status` to reuse it, or report the conflicting owner when its session ID differs from the one returned to this workflow.
- Treat the capability embedded in `studioUrl` as a local session secret. Show or open it only for the requesting user; never copy it into TriggerPlans, project files, commits, issues, or shared logs, and redact it from summaries.
- Keep English equal to Chinese in a newly exported workbook. Do not create a status column or annotate untranslated cells.
- When importing a return, treat empty English or English equal to Chinese as untranslated and leave the target JSON unchanged.
- Never invent screenshots for locale-only or non-visual keys. After Agent work, use the CLI `finalize` command as the only authority for classifying unresolved tasks.

Read [CLI protocol](references/cli-protocol.md) before operating the tool. Read [TriggerPlan](references/trigger-plan.md) before creating an Agent plan.

## End-to-end workflow

### 1. Prepare and start with one command

Run `run --output <absolute-xlsx-path> --deadline-minutes <user-budget> --deterministic-timeout-minutes 8`. Use 120 minutes only when the user supplied no deadline. Give the command an execution-tool timeout of at least 10 minutes; do not let a short default shell timeout terminate its collector. This checks the environment, initializes or refreshes the real project index, starts or reuses the collector, waits for deterministic work, and writes an immediately usable four-column workbook. Record `sessionId`, `studioUrl`, `appUrl`, `deadlineAt`, `nextAction`, and the workbook path.

Stop on a failed required check and report the concrete project prerequisite. Do not replace an invalid existing configuration automatically. Report actual counts from JSON; never invent coverage.

The returned workbook is a valid progress delivery. Missing runtime evidence leaves only its screenshot cell empty; Chinese and English remain populated. Never delay the first workbook until every screenshot exists.

If `nextAction` is `restart`, or the returned session `status` is not `running` while unresolved tasks remain, run `start --session <same-sessionId> --background`. Never recover with an unqualified `start`: that creates a new session, invalidates task IDs and plans, and can associate screenshots with the wrong run. Poll `status` until `pending` and `running` are both zero, then run `export` again to refresh the progress workbook before entering the Agent queue.

If `nextAction` is `deterministic_continue`, the deterministic window ended early but the session is still running: keep polling `status` for the same session until `pending` and `running` are both zero, then run `export` again to refresh the workbook. The default `--deterministic-timeout-minutes` adapts to the key count as `max(15, ceil(total/60))`. After the deterministic queue drains, `run` auto-drives the Agent queue with generated router-hint plans (goto → waitForKey → capture, bounded by the deadline and route saturation, up to 120 plans) and reuses verified plans from previous sessions of the same project instead of re-deriving them. The deterministic pass walks scrolling (window plus in-page scroll containers), a bounded client-side widget sweep (tree expands, pagination next, one cascader/select/date panel per round), a generic interaction sweep (ARIA `role=tab` first, then native `button`/`role=button`, one target per round with Escape dismissal — no component-library selectors), a runtime evidence mirror (every `t()` value is recorded offscreen, so canvas formatters, transient toasts and imperative dialogs yield B-grade evidence), a source-locale guard (common localStorage language keys are seeded with `browser.locale` before app scripts, and a first-route rendered-text sample can trigger one `?locale=` recovery reload), and an optional one-shot login when `browser.login` is configured (credentials may come from `COLLECT_I18N_LOGIN_USERNAME` / `COLLECT_I18N_LOGIN_PASSWORD`). Dynamic-prefix keys created as manual are promoted automatically the moment their full instance key actually mounts in the DOM or the mirror. Collection state (database, screenshots, browser profile, logs) lives outside the project under `~/.collect-i18n/projects/<hash>` (override with `COLLECT_I18N_STATE_DIR`), so the project's own watcher never observes high-frequency writes; only the config file and the exported workbook stay in the project. `COLLECT_I18N_VITE_MODE` passes a Vite `--mode` through to the hosted dev server.

If `nextAction` is `failed`, stop the workflow and report the collector startup or infrastructure error. Do not reinterpret an unavailable browser as 100% Agent work. Do not treat the session-level `status: stopped` or `status: interrupted` as an automatic-phase result; `automatic.phase` is the automatic-phase field.

Present progress using only returned fields, for example:

```text
词条总数：<counts.total>
已生成截图：<uniqueScreenshotCount>
等待 Agent：<counts.needs_agent>
等待人工：<counts.needs_manual>
当前处理：<current.key_path, if present>
```

### 2. Process the Agent queue

Call `agent next --session <id>`. It returns the persisted end-to-end `deadlineAt` and `remainingSeconds`; do not estimate the budget from wall-clock memory. If `done` is true, leave the loop. `reason: deadline_reached` means finalize and export immediately. The response includes `routeBatch`: section/kind/service counts and source files for all unresolved tasks on the selected route, plus a deliberately small representative task sample.

For each returned task:

1. Treat `routeBatch` as the unit of work, not the single anchor key. Use its aggregate counts to understand the route; do not enumerate or classify every key in the representative sample. Read each listed source file at most once for that route, using reported occurrence lines and only directly referenced handlers, validation rules, request clients, or local mock fixtures. When `truncated` is true, let runtime checkpoints discover the omitted keys rather than requesting or reconstructing a complete static list.
2. Build a source-evidenced route coverage path. Start from the route's initial state, then visit the smallest set of high-fan-out states: tabs, drawers, dialogs, validation groups, table loads, request outcomes, and Element Plus services. Insert a `capture` checkpoint after the initial state and after every state transition; each checkpoint records every visible A/B-grade unresolved key before the next transition changes the page.
3. Create one strict version-1 TriggerPlan for the route batch, within the 40-step limit. Keep the returned task as `targetKey` and make its state the final state so primary evidence remains attributable. Prefer stable role, label, test-id, or exact source-derived CSS locators. Prefer role locators for semantic radio and checkbox controls: the executor clicks their visible wrapping label even when a component library covers the native input. Use a zero-based locator `index` only when the source proves the same stable locator is intentionally repeated. Use request mocks only when the target is an API success/error state and the response contract is source-evidenced.
4. Save the JSON below `.collect-i18n/plans/`.
5. Run `agent submit`, then `agent execute`.
6. Accept the task only when execution returns evidence with the target key, visible rectangle, route, and screenshot path. Count checkpoint and final-state `additionalEvidence` as completed work. A successful route plan should normally remove dozens of keys; do not create separate plans for keys captured at checkpoints.
7. On the first failure, call `agent next` again and make one evidence-driven correction only when the task is returned. A task whose occurrences are all `dynamic` is automatically moved to `needs_manual` after its first failed execution; do not try to reopen it with a saved task id. Other tasks move to `needs_manual` after the second failure. Read dynamic expressions before planning so the single allowed attempt is source-evidenced and targets a state that can actually render the catalog key.

`agent next` prioritizes the unresolved route with the largest fan-out, then an actionable anchor inside that route. Process one route plan at a time so browser state and failure evidence remain attributable. If the same route remains, make one focused follow-up plan only for states the first route plan missed; do not restart source analysis. Never alter source code to make an Agent plan succeed.

`agent execute` automatically restores its own stopped/interrupted session when no service is alive. If it reports that another session is active, stop and report the conflicting session ID; never create or switch to another session behind the user's back.

### 3. Finalize, deliver on time, and hand off the irreducible remainder

Poll `status` between tasks. When `deadlineAt` is reached, or when `agent next` returns `done`, first require `pending` and `running` to be zero, then run `finalize --session <id>` exactly once. Do not classify keys from prose or coverage targets. Keys with no source occurrence are pre-classified as `skipped` only when the project has no unresolved dynamic translation calls; otherwise they enter `needs_manual` with reason `unresolved_dynamic_source`. Source-only non-visual `aria-*`/native `title` keys remain safely skipped. Finalize re-checks the same predicates and every other unresolved key becomes `needs_manual`.

After finalization, run `export` immediately even if manual items remain. Confirm finalized category counts, unique screenshot count, duplicate evidence count, coverage, manual percentage, row count, and embedded image count.

Treat the workbook as delivered once export succeeds. Treat screenshot collection as fully complete only when no manual items remain. These are separate outcomes.

When Agent work is exhausted, run `manual open --session <id>` to activate the next remaining task. Return the Studio URL and summarize the exact target key, Chinese text, source file, route hints, action hints, and any last error.

The human performs normal business operations in the opened project. The tool listens for the target runtime binding across native DOM, text Range, Vue component Host roots (including fragments, slots, and Teleport), and Element Plus service nodes. Safe component evidence may be causally verified in an isolated canary page; side-effecting actions are never replayed for that probe. When the key appears, the tool automatically highlights and screenshots it. The human does not manually crop or label screenshots.

Repeat `manual open` only after the previous target is captured or the user asks to move on.

### 4. Export or import

For export, run `export --session <id> --output <absolute-xlsx-path>`. Confirm the returned row and image counts. The workbook must contain only `中文`, `英文`, `截图`, `Key Path`, in that order. Keys the finalize step classified as deprecated (no source occurrence) are grouped at the end of the sheet with 词条废弃 in the 截图 column. Dead keys (needs_manual with zero source occurrences, held out of the deprecated skip only by unresolved dynamic calls) are grouped after the normal rows with 死键 in the 截图 column. Non-visual keys (every occurrence is an `aria-*` or native `title` property) keep their alphabetical position with 非可视 in the 截图 column.

For a translated return, run `import --file <absolute-xlsx-path> --session <id> --dry-run` first. Report duplicate, unknown, missing, or modified-Chinese issues from the JSON response. Run the same command with `--apply` only when validation has no fatal issues and the user's request authorizes importing the return.

## Completion

Stop the collector only with `stop --session <id>` so a concurrent or newer workflow cannot be terminated accidentally.

Finish with session totals, unique screenshot count, duplicate evidence count, coverage, skipped count and reasons, remaining manual count, deadline result, workbook path or written en-us files, and nonfatal diagnostics. If manual items remain, state that the workbook has been delivered with blank screenshot cells and hand those keys to the Studio queue; do not describe screenshot collection as complete.
