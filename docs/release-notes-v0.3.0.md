# Collect I18n v0.3.0

This release rebuilds Vue capture around compiler provenance plus renderer-time Host-root
resolution, while preserving the existing Skill-only user workflow.

## Highlights

- Vue template text sinks now carry an invisible, occurrence-scoped transport token.
  The runtime resolves that token back to the exact text Range or outer Host element and
  removes no business text.
- Vue component occurrences are associated through reserved VNode lifecycle hooks,
  including fragments, slots, Suspense, Teleport, `inheritAttrs: false`, and multiple
  Host roots.
- Element Plus component props and imperative Message/Notification calls receive
  syntax-aware provenance instead of global text matching.
- Runtime tokens use a compact four-symbol encoding and guarded, non-reentrant rendered
  resolution. This removes the dense-page queue stall found during the benchmark.
- Evidence is graded A/B/C. Deterministic capture requires A; Agent capture requires A
  or B; text-only guesses cannot become automatic evidence.
- Safe component evidence can be promoted with an isolated causal canary. Potentially
  side-effecting actions are never replayed for this check.
- Automatic and Agent execution report processed, captured, deferred, failed, current
  Key, and percentage progress.
- The new `finalize` command records locale-only and provably non-visual source keys as
  skipped with explicit reasons, and routes every other unresolved key to assisted
  manual fallback without generating fake screenshots.
- Excel export verifies screenshot hashes and binds each image to the row selected by
  its Key Path after sorting. Rows without evidence stay blank.

## Acceptance

The release was exercised on a real Vue 3 + Vite + Vue I18n + Element Plus application
containing 601 locale keys, dynamic forms, validation, dialogs, drawers, tables,
Teleport/slots/fragments, notifications, API success/error/empty states, retries, and
request mocks. The project contains no expected screenshot list or forced-visibility
test code.

- 601/601 automatic tasks processed, with no terminal failures.
- 539 unique runtime screenshots.
- 39 unresolved keys conservatively classified as no-source or source-only non-visual.
- 23 assisted-manual keys (3.83%, below the 5% target).
- 601 Excel rows, exactly four columns, and English initialized from Chinese.
- 539/539 image anchors matched the exact evidence Key Path; all persisted source
  screenshot hashes matched.
- Visual samples confirmed that screenshots mark only the target text and never render
  the Key Path over the application.

The captured screenshot percentage is 89.68%; coverage is deliberately not inflated by
synthetic images for the 39 non-visual/no-source keys or the remaining assisted-manual
queue. Correct evidence-to-key association is preferred over a higher nominal coverage
number.

A separate clean-install smoke test used only the contents of the release ZIP. It
resolved version `0.3.0`, prepared its writable browser-driver cache, processed all 601
deterministic tasks in about 110 seconds, produced 142 initial screenshots with zero
failures, exported a 601-row workbook, returned the next Agent task, and stopped cleanly.
