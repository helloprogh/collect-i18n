import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Volatile collection state (SQLite database, evidence screenshots, browser
 * profile, logs, exports) lives OUTSIDE the target project. High-frequency
 * screenshot writes inside the project root would be observed by the
 * project's own file watcher: a Vite dev server watching the project root
 * reloads on every captured screenshot and can crash under the churn. The
 * directory is a stable hash of the project root, so concurrent collections
 * of different projects never share state. `COLLECT_I18N_STATE_DIR`
 * overrides the parent directory (the per-project hash folder is still
 * appended).
 */
export function resolveStateRoot(projectRoot: string): string {
  const base = process.env.COLLECT_I18N_STATE_DIR
    ? resolve(process.env.COLLECT_I18N_STATE_DIR)
    : join(homedir(), ".collect-i18n");
  const hash = createHash("sha256").update(resolve(projectRoot)).digest("hex").slice(0, 16);
  return join(base, "projects", hash);
}

/** In-project directory used before v0.4.0; migrated to the state root. */
export function legacyStateRoot(projectRoot: string): string {
  return join(resolve(projectRoot), ".collect-i18n");
}
