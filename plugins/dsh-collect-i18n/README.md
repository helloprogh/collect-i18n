# @collect-i18n/dsh-plugin

collect-i18n as a DeepSeek Harness server-side plugin (cordis bundle).

## What it mounts

- **Tools** (registered into the shared tools registry, prefixed collect_i18n_):
  - collect_i18n_run - end-to-end collection run
  - collect_i18n_status - session status counts
  - collect_i18n_export - four-column workbook export
  - collect_i18n_import - translated workbook return
  - collect_i18n_cli - raw passthrough to node <plugin>/cli/bootstrap.mjs <args>
- **Prompt section** - condensed operating rules.

## Contents

cli/bin.js = fully bundled engine; cli/runtime/* = runtime modules;
cli/bootstrap.mjs = skill CLI entry (lazily installs playwright-core into
~/.collect-i18n/runtime); SKILL.md + references/ = skill sources. Nothing
outside the plugin directory is required at runtime.

## Build & install

```powershell
pnpm build
pnpm --filter @collect-i18n/cli build:bundle
node scripts/build-dsh-plugin.mjs
node scripts/install-dsh-plugin.mjs --profile web
```

Restart the dsh web service after installing (bundle layers are frozen at boot).

## Verify

```powershell
node plugins/dsh-collect-i18n/cli/bootstrap.mjs --version
dsh --profile web --dump-config | Select-String '@collect-i18n/dsh-plugin'
```
