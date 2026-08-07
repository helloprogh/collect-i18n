# TriggerPlan version 1

TriggerPlan is a bounded JSON DSL. It cannot execute JavaScript, shell commands, cross-origin navigation, or arbitrary network operations.

```json
{
  "version": 1,
  "targetKey": "users.form.nameRequired",
  "route": "/users/create",
  "mocks": [],
  "steps": [
    { "type": "capture" },
    {
      "type": "click",
      "locator": { "kind": "role", "value": "button", "name": "保存" }
    },
    {
      "type": "waitForKey",
      "key": "users.form.nameRequired",
      "timeoutMs": 10000
    }
  ],
  "rationale": "Submitting the empty source-scanned form exposes its required validation."
}
```

## Locators

Use exactly one supported locator:

```json
{ "kind": "role", "value": "button", "name": "保存" }
{ "kind": "label", "value": "用户名", "exact": true }
{ "kind": "text", "value": "高级设置", "exact": true }
{ "kind": "testId", "value": "save-user" }
{ "kind": "testId", "value": "delete-row", "index": 0 }
{ "kind": "css", "value": "form.user-create button[type=submit]" }
```

Prefer role, label, and testId. Use CSS only when source evidence makes it stable. Never select by generated Element Plus class suffix or DOM index if a semantic locator exists.
Use zero-based `index` only when the source proves that the same stable locator is intentionally repeated (for example a `v-for` row action). Prefer a row-specific accessible name when one exists; otherwise select the smallest deterministic repeated instance needed by the source-defined scenario.

## Steps

- `goto`: `{ "type": "goto", "path": "/users/create" }`; same project origin only.
- `click`: locator plus optional `timeoutMs`. A semantic role locator that resolves to a covered native radio/checkbox is activated through its visible wrapping label, so prefer `role: radio` / `role: checkbox` over component-library CSS.
- `fill`: locator and a literal `value`. Resolves to the inner editable control when the locator targets a component-library wrapper (for example an Element Plus `.el-input` whose `data-testid` sits on the wrapper div). Never place credentials or secrets in a plan.
- `press`: locator and `key`; also resolves to the inner editable control for wrapped inputs.
- `select`: locator and `value`, where `value` is the visible option label. Works with native `<select>` and with custom dropdowns (for example Element Plus `el-select`): it opens the dropdown and clicks the option whose label matches.
- `hover`: locator.
- `wait`: `milliseconds`, maximum 5000.
- `waitForKey`: target key and optional timeout, maximum 60000.
- `waitForText`: exact visible-source text hint and optional timeout.
- `capture`: `{ "type": "capture" }`; record every currently visible A/B-grade unresolved key before continuing. Use after the initial route state and after each source-proven high-fan-out state. It does not replace the final target capture.

The engine may replay a read-only plan (`goto`, `reload`, `hover`, and bounded waits) in an isolated page to causally verify B-grade component evidence. Plans containing `click`, `fill`, `press`, or `select` are not replayed for this probe, so business side effects are never duplicated by Canary verification.
- `reload`: no additional fields.

A plan has at most 40 steps. Use the budget for one coherent route coverage path with checkpoints. Keep the anchor target visible in the final state and end with `waitForKey` for that target.

## Request mocks

Use mocks only to create a source-evidenced API state:

```json
{
  "id": "save-error",
  "url": "**/api/users",
  "method": "POST",
  "status": 500,
  "headers": { "content-type": "application/json" },
  "body": { "message": "source-evidenced error response" },
  "delayMs": 0,
  "once": true
}
```

Do not invent UI copy in the mock. Use response shape/value evidence from the project's API client, mock fixtures, or error handling source. If response requirements are unknown, omit the mock and hand the task to manual fallback.

## Planning patterns

- Required validation: navigate, click the source-identified submit control, wait for target key.
- Character validation: fill the source-identified field with a boundary-invalid value supported by its rule, blur or submit, wait for target key.
- Tab/drawer/dialog: navigate, click the semantic opener, wait for target key.
- Dropdown option / custom select: open the source-identified select, then `select` the option by its visible label (or click the option by role/text) and wait for the target key.
- Element Plus message/notification: perform the source-identified command; runtime service binding and document observer locate the Teleport node.
- HTTP error: install the smallest matching mock, perform the request action, wait for the error key.

Prefer a source-proven route path that reveals several related pending keys at each checkpoint. The service captures visible A/B-grade keys at every `capture` step and after the target succeeds, including custom Vue component props, fragment/slot/Teleport host text, and Element Plus service text. A TriggerPlan still has exactly one `targetKey`; checkpoints may cover related states on the same route, never unrelated pages.

Never add a page or phrase to the project to make these patterns succeed.
