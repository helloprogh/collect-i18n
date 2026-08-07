# CLI JSON protocol

In the examples below, `<CLI>` is the command prefix resolved by `SKILL.md` (either `collect-i18n` or `node <absolute-dist/bin.js>`). Every project command must include:

```text
--project <absolute-project-root> --json --non-interactive
```

Successful output has this envelope:

```json
{
  "ok": true,
  "command": "status",
  "timestamp": "2026-07-19T00:00:00.000Z",
  "data": {},
  "warnings": []
}
```

Failed output is written to stderr and has `ok: false`, `error.code`, `error.message`, `error.details`, and `error.retryable`. Never infer success from exit text; require both exit code zero and `ok: true`.

## Lifecycle

```text
<CLI> doctor
<CLI> init
<CLI> scan
<CLI> run --output <absolute-xlsx> --deadline-minutes 120
<CLI> start --background
<CLI> start --session <session-id> --background
<CLI> status --session <session-id>
<CLI> finalize --session <session-id>
<CLI> stop --session <session-id>
```

`run` is the Skill default. It diagnoses, initializes or refreshes, starts or reuses the service, waits for deterministic work, and exports a progress workbook. It returns `sessionId`, `studioUrl`, `appUrl`, `deadlineAt`, `nextAction`, status, and workbook details. Give it an execution-tool timeout longer than its deterministic timeout.

`nextAction: restart` means the service stopped or was interrupted while unresolved work remains. Recover only with `start --session <same-session-id> --background`; an unqualified `start` creates a different session with different task IDs. Resuming restores interrupted deterministic work to `pending` and safely returns an interrupted Agent task to the appropriate Agent/manual state.

Use `stop --session <session-id>` for workflow cleanup. It refuses to stop a different live session. Never stop an active session merely because `init` or `scan` reports it; reuse it through `run`/`status` unless the user explicitly asks to discard it.

Status counts are authoritative:

- `total`: indexed source-locale keys.
- `pending`: deterministic tasks not yet attempted.
- `running`: an executor currently owns the task.
- `captured`: tasks with validated runtime screenshot evidence.
- `needs_agent`: tasks available to the Skill.
- `needs_manual`: tasks handed to assisted human fallback.
- `failed`: tasks that stopped with a recorded error.
- `screenshotCount`: all persisted evidence records, including replacements.
- `uniqueScreenshotCount`: distinct keys with screenshot evidence; use this for user-visible progress.
- `duplicateEvidenceCount`: replacement evidence beyond the latest unique-key set.
- `coveragePercent`: captured tasks divided by total tasks.
- `manualPercent`: currently queued manual tasks divided by total tasks.
- `exportReady`: deterministic work is settled, so a clean progress workbook can be delivered.

## Agent queue

```text
<CLI> agent next --session <id>
<CLI> agent submit --session <id> --task <task-id> --plan-file <absolute-json>
<CLI> agent execute --session <id> --task <task-id>
```

`agent next` returns `done`, `reason`, persisted `deadlineAt`, exact `remainingSeconds`, `task`, `routeBatch`, and current status. Stop Agent planning on `reason: deadline_reached`; finalize and export immediately. The task is the required evidence anchor. `routeBatch` summarizes all unresolved keys sharing its preferred route with total/returned counts, section/kind/service counts and source files, plus a small representative sample of key paths, Chinese text, locations, and source-proven action hints. It is deliberately capped and reports `truncated` when runtime checkpoints should discover additional keys.

`agent submit` performs schema and task/key correlation checks. `agent execute` owns the real browser interaction and automatically resumes the requested stopped/interrupted session when no service is alive. It refuses to hijack a different live session. Do not use a separate browser tool during execution. A task receives at most two Agent executions; after the second failure it enters `needs_manual`, and further Agent submissions or executions are rejected. A `capture` step records all currently visible A/B-grade unresolved keys at that checkpoint; the final target capture remains mandatory.

The queue prioritizes the largest reliable route batch, then retryable/source-evidenced actions inside it. After a successful plan, `additionalEvidence` combines keys captured at explicit checkpoints and in the final browser state. Treat those keys as complete and continue with a fresh `agent next`; do not replay the same interaction once per key.

## Finalization

```text
<CLI> finalize --session <id>
```

Run only after `pending` and `running` are both zero, and after Agent processing is exhausted or the deadline is reached. The command settles remaining `needs_agent` tasks without creating evidence:

- `skippedNoSource`: locale keys with no source occurrence (`no_source_occurrence`);
- `skippedNonVisual`: keys whose occurrences are all `aria-*` or native-element `title` properties (`non_visual_source_only`);
- `needsManual`: every other unresolved key (`assisted_manual_fallback`).

The result contains `settled`, the exact `keys` in each category, and the latest `status`. These classifications remain in SQLite/events only. Do not add status columns, notes, colors, or placeholders to the workbook.

## Assisted manual queue

```text
<CLI> manual open --session <id>
<CLI> manual open --session <id> --key <key-path> --route <path>
```

The result supplies the Studio URL and target context. The command activates runtime listening; it does not ask the user to teach or record a reusable procedure.

## Excel

```text
<CLI> export --session <id> --output <absolute-xlsx>
<CLI> import --session <id> --file <absolute-xlsx> --dry-run
<CLI> import --session <id> --file <absolute-xlsx> --apply
```

Exported rows are stable by Key Path. The workbook has one visible worksheet and exactly four visible columns: `中文`, `英文`, `截图`, `Key Path`. Missing evidence leaves the screenshot cell empty and never blocks export. Import validation and write results remain in CLI/Studio JSON; never add them to the workbook.
