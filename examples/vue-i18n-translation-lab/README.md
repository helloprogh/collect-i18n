# GDE Data Operations Console

A Vue 3 administration console for user onboarding, order processing, access control, notifications, system settings, API diagnostics, and runtime operations.

The application uses Vite, Axios, Element Plus, Vue Router, and Vue I18n. Locale files are organized by business page under `src/locales/zh-cn` and `src/locales/en-us`; adding a JSON file requires no central import update. Requests use a deterministic local Axios adapter, so development does not depend on external services.

```powershell
pnpm install --frozen-lockfile
pnpm run verify:i18n
pnpm build
```
