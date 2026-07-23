# Collect I18n v0.2.0

This release makes the installed Agent Skill the primary product entry point.

## Highlights

- Adds `run`, which diagnoses, initializes or refreshes, starts the collector, waits for deterministic capture, and immediately exports a clean progress workbook.
- Enforces a maximum of two Agent executions per key. Repeated failures move to manual fallback and cannot be silently reopened by Agent commands.
- Reports unique screenshot coverage separately from replacement evidence.
- Stores the browser driver in a versioned user-writable cache instead of modifying the installed Skill.
- Packages every browser runtime module and verifies relative-import closure before creating the release ZIP.
- Includes the 601-key Vue/Vite benchmark project without expected screenshots, selectors, or scoring fixtures.
- Keeps progress exports available when manual screenshots remain; missing evidence produces an empty screenshot cell.

## Validation target

The release is accepted only after the packaged ZIP is installed into a clean copy of the benchmark and invoked by local Claude Code as a normal user-facing Skill. Source-checkout CLI runs do not count as release validation.

The v0.2.0 acceptance run used `minimax-m2.7` and produced 582 unique screenshots for 601 keys (96.84% coverage) before the external model quota was exhausted. The final workbook retained exactly four columns, 601 rows, 582 unique image anchors, and zero image-to-key mismatches; the remaining 19 screenshot cells were empty.
