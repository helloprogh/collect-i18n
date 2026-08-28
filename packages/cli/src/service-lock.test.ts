import { rm } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireServiceLock, hasLiveServiceLock, isPidAlive, serviceLockPath } from "./service-lock.js";

const temporaryRoots: string[] = [];

beforeEach(() => {
  const base = join(tmpdir(), `collect-i18n-state-${randomUUID()}`);
  temporaryRoots.push(base);
  process.env.COLLECT_I18N_STATE_DIR = base;
});

afterEach(async () => {
  delete process.env.COLLECT_I18N_STATE_DIR;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("service startup lock", () => {
  it("claims and releases the lock, leaving no file behind", () => {
    const projectRoot = "/virtual/lock-basic";
    const lock = acquireServiceLock(projectRoot, "session_a");
    expect(existsSync(serviceLockPath(projectRoot))).toBe(true);
    expect(hasLiveServiceLock(projectRoot)).toBe(true);
    lock.release();
    expect(existsSync(serviceLockPath(projectRoot))).toBe(false);
    expect(hasLiveServiceLock(projectRoot)).toBe(false);
  });

  it("fails a concurrent claim with an actionable message while the holder is alive", () => {
    const projectRoot = "/virtual/lock-conflict";
    const lock = acquireServiceLock(projectRoot, "session_a");
    try {
      // This process owns the lock, so its PID is alive.
      expect(() => acquireServiceLock(projectRoot, "session_b")).toThrow(/另一个采集服务/);
    } finally {
      lock.release();
    }
    // After release the next claim succeeds.
    const second = acquireServiceLock(projectRoot, "session_b");
    second.release();
  });

  it("steals a lock left behind by a dead process", () => {
    const projectRoot = "/virtual/lock-stale";
    const lock = acquireServiceLock(projectRoot, "session_dead");
    lock.release();
    // Simulate a crashed daemon: recreate the lock with a PID that cannot
    // exist. PIDs are positive, so negative values are never alive.
    const path = serviceLockPath(projectRoot);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ pid: -1, sessionId: "session_dead", startedAt: "", token: "stale" }));
    expect(hasLiveServiceLock(projectRoot)).toBe(false);
    const stolen = acquireServiceLock(projectRoot, "session_new");
    expect(hasLiveServiceLock(projectRoot)).toBe(true);
    stolen.release();
    expect(existsSync(path)).toBe(false);
  });

  it("never releases a lock file it does not own (token check)", () => {
    const projectRoot = "/virtual/lock-owner";
    const first = acquireServiceLock(projectRoot, "session_a");
    first.release();
    // First releaser runs again after another writer re-created the lock:
    // its stale token must not delete the new owner's lock file.
    const second = acquireServiceLock(projectRoot, "session_b");
    first.release();
    expect(existsSync(serviceLockPath(projectRoot))).toBe(true);
    second.release();
    expect(existsSync(serviceLockPath(projectRoot))).toBe(false);
  });

  it("treats malformed and non-positive PIDs as not alive", () => {
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-5)).toBe(false);
    expect(isPidAlive(Number.NaN)).toBe(false);
    expect(isPidAlive(process.pid)).toBe(true);
  });
});
