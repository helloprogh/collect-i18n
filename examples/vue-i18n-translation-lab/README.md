# Vue I18n Translation Lab

Versioned, runnable benchmark application for Collect I18n. It contains 601 locale keys across ordinary navigation, forms, validation, component props, dialogs, teleported messages, request success/error states, loading, empty states, and route-dependent screens.

The application contains no expected screenshots, target selectors, scoring labels, or collector-specific fixtures. Evaluation expectations belong outside this directory so an installed Skill sees the same project a user would.

```powershell
pnpm install --frozen-lockfile
pnpm run verify:i18n
pnpm build
```
