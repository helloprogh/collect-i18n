import { randomUUID } from "node:crypto";
import { mkdirSync, openSync, readFileSync, rmSync, writeSync, closeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveStateRoot } from "./state-root.js";

/**
 * Mutual exclusion for the per-project collection service.
 *
 * The service descriptor (service.json) is only written after Vite, the
 * browser and the HTTP listener are all up, so a service that is still
 * booting is invisible to descriptor-based health probes. The previous
 * heuristic treated "descriptor missing" as "service dead" and interrupted
 * the booting service's running sessions — a concurrent `start` could kill
 * a capture mid-flight and surface a misleading EADDRINUSE.
 *
 * The lock is created with O_EXCL at the very beginning of service startup
 * (before Vite boots) and removed on shutdown, so:
 * - a second service start fails fast with an actionable message;
 * - "stale descriptor cleanup" can check the lock and leave a booting
 *   service's sessions alone;
 * - a crashed daemon leaves a lock whose PID no longer exists, and the next
 *   start steals it.
 */
export const SERVICE_LOCK_FILE = "service.lock";

export interface ServiceLock {
  pid: number;
  sessionId: string;
  startedAt: string;
  token: string;
}

export function serviceLockPath(projectRoot: string): string {
  return join(resolveStateRoot(resolve(projectRoot)), SERVICE_LOCK_FILE);
}

/** True when the PID belongs to a live process (EPERM counts as alive). */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(path: string): ServiceLock | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ServiceLock>;
    if (typeof parsed.pid !== "number" || typeof parsed.token !== "string") return undefined;
    return {
      pid: parsed.pid,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : "",
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
      token: parsed.token,
    };
  } catch {
    return undefined;
  }
}

export interface AcquiredServiceLock {
  /** Opaque token; only the matching token releases the lock file. */
  token: string;
  release(): void;
}

/**
 * Create the service lock with O_EXCL. Throws an actionable error when
 * another live service (or booting service) holds it; steals a lock whose
 * owner PID no longer exists. Synchronous on purpose: the claim must be
 * race-free against concurrent starts.
 */
export function acquireServiceLock(projectRoot: string, sessionId: string): AcquiredServiceLock {
  const path = serviceLockPath(projectRoot);
  const claim = (): AcquiredServiceLock => {
    const token = randomUUID();
    const lock: ServiceLock = { pid: process.pid, sessionId, startedAt: new Date().toISOString(), token };
    mkdirSync(dirname(path), { recursive: true });
    // "wx" fails when the file already exists — the O_EXCL race guard.
    const handle = openSync(path, "wx");
    try {
      writeSync(handle, `${JSON.stringify(lock, null, 2)}\n`);
    } finally {
      closeSync(handle);
    }
    return {
      token,
      release(): void {
        try {
          const current = readLock(path);
          // Only the owner removes the lock: a PID-reused or re-created lock
          // file must never be deleted by a stale releaser.
          if (current?.token === token) rmSync(path, { force: true });
        } catch { /* A lock we cannot read is not ours to remove. */ }
      },
    };
  };

  try {
    return claim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const existing = readLock(path);
  if (existing && isPidAlive(existing.pid)) {
    throw new Error(
      `另一个采集服务正在运行或启动中（PID ${existing.pid}，会话 ${existing.sessionId || "未知"}）。` +
      `请先运行 collect-i18n stop，或确认该进程已结束后删除 ${path}`,
    );
  }
  // Stale lock: the owning process is gone. Steal it once; losing this race
  // to a concurrent start is fine — the loser gets the live-lock error above.
  rmSync(path, { force: true });
  try {
    return claim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error(`采集服务锁竞争失败，请重试：${path}`);
  }
}

/**
 * True when a live process holds the service lock — the signal for descriptor
 * cleanup to leave "descriptor missing" services alone instead of interrupting
 * their sessions.
 */
export function hasLiveServiceLock(projectRoot: string): boolean {
  const lock = readLock(serviceLockPath(projectRoot));
  return Boolean(lock && isPidAlive(lock.pid));
}
