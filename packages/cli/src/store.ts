import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProjectAnalysis } from "@collect-i18n/analyzer";
import type { CollectedEvidence } from "@collect-i18n/runner";

export type TaskStatus = "pending" | "running" | "captured" | "needs_agent" | "needs_manual" | "failed" | "skipped";
export const MAX_AGENT_ATTEMPTS = 2;
/** Per-route Agent anchor budget per session: a route stops providing anchors
 * after this many plans (R4); the cap prevents low-yield routes from
 * consuming the whole Agent phase. */
export const MAX_AGENT_ANCHORS_PER_ROUTE = 5;

function evidenceGradeRank(grade: unknown): number {
  return grade === "A" ? 3 : grade === "B" ? 2 : grade === "C" ? 1 : 0;
}

function isNonVisualOccurrence(occurrence: unknown): boolean {
  if (typeof occurrence !== "object" || occurrence === null) return false;
  const item = occurrence as { property?: unknown; component?: unknown };
  const property = typeof item.property === "string" ? item.property.toLowerCase() : "";
  if (property.startsWith("aria-")) return true;
  return property === "title" && !item.component;
}
export type EventOrigin = "system" | "deterministic" | "agent" | "manual" | "unknown";

export interface StoredTask {
  id: string;
  sessionId: string;
  keyPath: string;
  status: TaskStatus;
  stage: "deterministic" | "agent" | "manual";
  chinese: string;
  relativeFile: string;
  occurrences: unknown[];
  routeHints: unknown[];
  actionHints: unknown[];
  attempts: number;
  lastError?: string;
  /** Set when the session pre-classified or finalize classified the task as skipped (no_source_occurrence / non_visual_source_only). */
  skipReason?: string | null;
  plan?: unknown;
}

interface AgentRouteHint {
  path: string
  confidence: number
  source: string | undefined
}

export interface AgentRouteBatch {
  route?: string
  total: number
  returned: number
  truncated: boolean
  sourceFiles: string[]
  sections: Array<{ name: string; count: number }>
  countsByKind: Record<string, number>
  countsByService: Record<string, number>
  tasks: Array<{
    id: string
    keyPath: string
    chinese: string
    relativeFile: string
    attempts: number
    kinds: string[]
    services: string[]
    locations: Array<{ file?: string; line?: number }>
    actionHints: unknown[]
  }>
}

export function representativeRouteTasks(
  candidates: StoredTask[],
  anchor: StoredTask,
  limit = 12,
): StoredTask[] {
  const bounded = Math.max(1, Math.trunc(limit));
  const ordered = [anchor, ...candidates.filter((task) => task.id !== anchor.id)]
    .sort((left, right) => {
      if (left.id === anchor.id) return -1;
      if (right.id === anchor.id) return 1;
      return agentTaskPriority(right) - agentTaskPriority(left) || left.keyPath.localeCompare(right.keyPath);
    });
  const selected: StoredTask[] = [];
  const signatures = new Set<string>();
  for (const task of ordered) {
    const section = task.keyPath.split(".").slice(0, 2).join(".");
    const kinds = task.occurrences
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => `${String(item.kind ?? "unknown")}:${String(item.service ?? "")}`)
      .sort()
      .join("+");
    const signature = `${section}|${kinds}`;
    if (task.id !== anchor.id && signatures.has(signature)) continue;
    signatures.add(signature);
    selected.push(task);
    if (selected.length >= bounded) return selected;
  }
  for (const task of ordered) {
    if (selected.some((item) => item.id === task.id)) continue;
    selected.push(task);
    if (selected.length >= bounded) break;
  }
  return selected;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function isDynamicOccurrence(occurrence: unknown): boolean {
  return (
    typeof occurrence === "object" &&
    occurrence !== null &&
    "dynamic" in occurrence &&
    (occurrence as { dynamic?: unknown }).dynamic === true
  );
}

export function preferredAgentRoute(task: StoredTask): string | undefined {
  const hints = task.routeHints
    .map(asRecord)
    .filter((hint): hint is Record<string, unknown> => Boolean(hint))
    .map((hint) => ({
      path: typeof hint.path === "string" ? hint.path : "",
      confidence: Number(hint.confidence ?? 0),
      source: typeof hint.source === "string" ? hint.source : undefined,
    }))
    .filter((hint): hint is AgentRouteHint => hint.path.startsWith("/"))
    .sort((left, right) =>
      (right.source === "router_config" ? 1 : 0) - (left.source === "router_config" ? 1 : 0)
      || right.confidence - left.confidence
      || left.path.localeCompare(right.path),
    );
  return hints[0]?.path;
}

/** Interaction potential of a task: how much a plan for this key can
 * drive new visible states (dialogs, form validation, pagination, messages). */
export function agentActionScore(task: StoredTask): number {
  const actionableHints = task.actionHints.filter(
    (hint) => typeof hint === "object" && hint !== null,
  ).length;
  const imperativeOccurrences = task.occurrences.filter(
    (occurrence) =>
      typeof occurrence === "object" &&
      occurrence !== null &&
      "kind" in occurrence &&
      String((occurrence as { kind?: unknown }).kind) === "imperative_service",
  ).length;
  return Math.min(actionableHints, 5) * 2_000 + Math.min(imperativeOccurrences, 2) * 800;
}

export function agentTaskPriority(task: StoredTask): number {
  const reliableRoutes = task.routeHints.filter(
    (hint) =>
      typeof hint === "object" &&
      hint !== null &&
      "confidence" in hint &&
      Number((hint as { confidence?: unknown }).confidence) >= 0.8,
  ).length;
  return (
    (task.attempts > 0 ? 100_000 : 0) +
    agentActionScore(task) +
    Math.min(reliableRoutes, 2) * 300 +
    (task.occurrences.length > 0 ? 200 : -500)
  );
}

export interface TaskPage {
  items: StoredTask[];
  nextAfterKey: string | null;
  hasMore: boolean;
}

export interface StoredEvent {
  id: number;
  type: string;
  created_at: string;
  origin: EventOrigin;
  data: Record<string, unknown>;
  data_json: string;
}

export interface EventPage {
  items: StoredEvent[];
  nextAfter: number;
  hasMore: boolean;
}

export interface FinalizeUnresolvedResult {
  skippedNoSource: string[];
  skippedNonVisual: string[];
  needsManual: string[];
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

const eventOrigins = new Set<EventOrigin>(["system", "deterministic", "agent", "manual", "unknown"]);

function legacyEventOrigin(type: string): EventOrigin {
  const namespace = type.split(".", 1)[0];
  if (namespace === "agent" || namespace === "manual" || namespace === "deterministic") return namespace;
  if (namespace === "session" || namespace === "system") return "system";
  // A historical task.* event does not reliably identify which executor
  // caused the transition. In particular, stage/source fields were not
  // consistently present, so do not guess an origin for those rows.
  return "unknown";
}

function hydrateEvent(row: Record<string, unknown>): StoredEvent {
  const data = parseJson<Record<string, unknown>>(row.data_json, {});
  const explicitOrigin = typeof data.origin === "string" && eventOrigins.has(data.origin as EventOrigin)
    ? data.origin as EventOrigin
    : undefined;
  return {
    id: Number(row.id),
    type: String(row.type),
    created_at: String(row.created_at),
    origin: explicitOrigin ?? legacyEventOrigin(String(row.type)),
    data,
    data_json: String(row.data_json),
  };
}

export class StateStore {
  readonly databasePath: string;
  private readonly db: DatabaseSync;

  private constructor(databasePath: string) {
    this.databasePath = databasePath;
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  static async open(projectRoot: string): Promise<StateStore> {
    const stateDirectory = join(resolve(projectRoot), ".collect-i18n");
    await mkdir(stateDirectory, { recursive: true });
    return new StateStore(join(stateDirectory, "state.sqlite"));
  }

  close(): void { this.db.close(); }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* Preserve the original error. */ }
      throw error;
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        root TEXT NOT NULL UNIQUE,
        config_json TEXT NOT NULL,
        router_mode TEXT,
        has_unresolved_dynamic INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS locale_keys (
        project_id TEXT NOT NULL,
        key_path TEXT NOT NULL,
        chinese TEXT NOT NULL,
        english TEXT,
        relative_file TEXT NOT NULL,
        json_path TEXT NOT NULL,
        PRIMARY KEY (project_id, key_path),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS occurrences (
        project_id TEXT NOT NULL,
        id TEXT NOT NULL,
        key_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY (project_id, id),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        service_url TEXT,
        base_url TEXT NOT NULL,
        deadline_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS session_locale_keys (
        session_id TEXT NOT NULL,
        key_path TEXT NOT NULL,
        chinese TEXT NOT NULL,
        english TEXT,
        relative_file TEXT NOT NULL,
        json_path TEXT NOT NULL,
        PRIMARY KEY (session_id, key_path),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        key_path TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        plan_json TEXT,
        last_error TEXT,
        skip_reason TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(session_id, key_path),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        key_path TEXT NOT NULL,
        source TEXT NOT NULL,
        screenshot_path TEXT NOT NULL,
        screenshot_sha256 TEXT,
        evidence_grade TEXT,
        route TEXT NOT NULL,
        data_json TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_session_status ON tasks(session_id, status);
      CREATE INDEX IF NOT EXISTS idx_tasks_session_key_path ON tasks(session_id, key_path);
      CREATE INDEX IF NOT EXISTS idx_tasks_session_status_key_path ON tasks(session_id, status, key_path);
      CREATE INDEX IF NOT EXISTS idx_evidence_session_key ON evidence(session_id, key_path);
      CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id, id);
      CREATE TABLE IF NOT EXISTS agent_route_stats (
        session_id TEXT NOT NULL,
        route TEXT NOT NULL,
        last_new_captured INTEGER NOT NULL DEFAULT 0,
        consecutive_low INTEGER NOT NULL DEFAULT 0,
        plans INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, route),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      INSERT OR IGNORE INTO session_locale_keys(session_id,key_path,chinese,english,relative_file,json_path)
      SELECT t.session_id,t.key_path,k.chinese,k.english,k.relative_file,k.json_path
      FROM tasks t
      JOIN sessions s ON s.id=t.session_id
      JOIN locale_keys k ON k.project_id=s.project_id AND k.key_path=t.key_path;
    `);
    const sessionColumns = this.db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    if (!sessionColumns.some((column) => column.name === "deadline_at")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN deadline_at TEXT");
    }
    const projectColumns = this.db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
    if (!projectColumns.some((column) => column.name === "router_mode")) {
      this.db.exec("ALTER TABLE projects ADD COLUMN router_mode TEXT");
    }
    if (!projectColumns.some((column) => column.name === "has_unresolved_dynamic")) {
      this.db.exec("ALTER TABLE projects ADD COLUMN has_unresolved_dynamic INTEGER NOT NULL DEFAULT 0");
    }
    const evidenceColumns = this.db.prepare("PRAGMA table_info(evidence)").all() as Array<{ name: string }>;
    if (!evidenceColumns.some((column) => column.name === "screenshot_sha256")) {
      this.db.exec("ALTER TABLE evidence ADD COLUMN screenshot_sha256 TEXT");
    }
    if (!evidenceColumns.some((column) => column.name === "evidence_grade")) {
      this.db.exec("ALTER TABLE evidence ADD COLUMN evidence_grade TEXT");
    }
    const taskColumns = this.db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    if (!taskColumns.some((column) => column.name === "skip_reason")) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN skip_reason TEXT");
    }
    const routeStatsColumns = this.db.prepare("PRAGMA table_info(agent_route_stats)").all() as Array<{ name: string }>;
    if (!routeStatsColumns.some((column) => column.name === "plans")) {
      this.db.exec("ALTER TABLE agent_route_stats ADD COLUMN plans INTEGER NOT NULL DEFAULT 0");
    }
    const legacyEvidence = this.db.prepare(
      "SELECT id,data_json FROM evidence WHERE screenshot_sha256 IS NULL OR evidence_grade IS NULL",
    ).all() as Array<{ id: string; data_json: string }>;
    const hydrateEvidence = this.db.prepare(
      "UPDATE evidence SET screenshot_sha256=?,evidence_grade=? WHERE id=?",
    );
    for (const row of legacyEvidence) {
      const data = parseJson<{ screenshotSha256?: string; evidenceGrade?: string }>(row.data_json, {});
      hydrateEvidence.run(data.screenshotSha256 ?? null, data.evidenceGrade ?? null, row.id);
    }
    // Older databases may already contain repeated hashes. Keep the strongest
    // (then newest) row before enforcing content identity for future writes.
    const duplicateGroups = this.db.prepare(`
      SELECT session_id,task_id,screenshot_sha256
      FROM evidence
      WHERE screenshot_sha256 IS NOT NULL
      GROUP BY session_id,task_id,screenshot_sha256
      HAVING COUNT(*)>1
    `).all() as Array<{ session_id: string; task_id: string; screenshot_sha256: string }>;
    const duplicateRows = this.db.prepare(`
      SELECT id,evidence_grade,captured_at,rowid
      FROM evidence
      WHERE session_id=? AND task_id=? AND screenshot_sha256=?
    `);
    const deleteEvidence = this.db.prepare("DELETE FROM evidence WHERE id=?");
    for (const group of duplicateGroups) {
      const rows = duplicateRows.all(group.session_id, group.task_id, group.screenshot_sha256) as Array<{
        id: string; evidence_grade: string | null; captured_at: string; rowid: number
      }>;
      rows.sort((left, right) =>
        evidenceGradeRank(right.evidence_grade) - evidenceGradeRank(left.evidence_grade)
        || right.captured_at.localeCompare(left.captured_at)
        || right.rowid - left.rowid,
      );
      for (const duplicate of rows.slice(1)) deleteEvidence.run(duplicate.id);
    }
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_task_sha
      ON evidence(session_id,task_id,screenshot_sha256)
      WHERE screenshot_sha256 IS NOT NULL;
    `);
  }

  syncProject(projectRoot: string, config: unknown, analysis: ProjectAnalysis): string {
    const root = resolve(projectRoot);
    const projectId = stableId("project", root.toLowerCase());
    const now = new Date().toISOString();
    this.transaction(() => {
      const active = this.db.prepare("SELECT id FROM sessions WHERE project_id=? AND status='running' LIMIT 1").get(projectId) as { id: string } | undefined;
      if (active) throw new Error(`项目存在活动采集会话，请先停止服务：${active.id}`);
      const hasUnresolvedDynamic = analysis.source.diagnostics.some(
        (diagnostic) => diagnostic.code === "dynamic_translation_key",
      );
      this.db.prepare("INSERT INTO projects(id, root, config_json, router_mode, has_unresolved_dynamic, created_at, updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET root=excluded.root,config_json=excluded.config_json,router_mode=excluded.router_mode,has_unresolved_dynamic=excluded.has_unresolved_dynamic,updated_at=excluded.updated_at")
        .run(projectId, root, JSON.stringify(config), analysis.routerMode ?? null, hasUnresolvedDynamic ? 1 : 0, now, now);
      // Refreshing the shared catalog while a session is active would make its
      // task-to-key joins observe a half-new snapshot, so the active-session
      // guard and the replacement live in this same write transaction.
      this.db.prepare("DELETE FROM locale_keys WHERE project_id=?").run(projectId);
      this.db.prepare("DELETE FROM occurrences WHERE project_id=?").run(projectId);
      const insertKey = this.db.prepare("INSERT INTO locale_keys(project_id,key_path,chinese,english,relative_file,json_path) VALUES(?,?,?,?,?,?)");
      for (const key of analysis.catalog.keys) {
        insertKey.run(projectId, key.keyPath, key.sourceText, key.targetText ?? null, key.relativeFile, JSON.stringify(key.jsonPath));
      }
      const insertOccurrence = this.db.prepare("INSERT INTO occurrences(project_id,id,key_path,kind,data_json) VALUES(?,?,?,?,?)");
      for (const occurrence of analysis.source.occurrences) {
        insertOccurrence.run(projectId, occurrence.id, occurrence.keyPath, occurrence.kind, JSON.stringify(occurrence));
      }
    });
    return projectId;
  }

  createSession(projectId: string, baseUrl: string, serviceUrl?: string): string {
    const id = `session_${randomUUID()}`;
    const now = new Date().toISOString();
    this.transaction(() => {
      const active = this.db.prepare("SELECT id FROM sessions WHERE project_id=? AND status='running' LIMIT 1").get(projectId) as { id: string } | undefined;
      if (active) throw new Error(`项目已存在活动采集会话：${active.id}`);
      this.db.prepare("INSERT INTO sessions(id,project_id,status,service_url,base_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
        .run(id, projectId, "running", serviceUrl ?? null, baseUrl, now, now);

      this.db.prepare(`
        INSERT INTO session_locale_keys(session_id,key_path,chinese,english,relative_file,json_path)
        SELECT ?,key_path,chinese,english,relative_file,json_path
        FROM locale_keys
        WHERE project_id=?
      `).run(id, projectId);
      const keys = this.db.prepare("SELECT key_path FROM session_locale_keys WHERE session_id=? ORDER BY key_path").all(id) as Array<{ key_path: string }>;
      const occurrenceRows = this.db.prepare(
        "SELECT key_path,data_json FROM occurrences WHERE project_id=? ORDER BY key_path",
      ).all(projectId) as Array<{ key_path: string; data_json: string }>;
      const occurrencesByKey = new Map<string, Array<Record<string, unknown>>>();
      for (const row of occurrenceRows) {
        const values = occurrencesByKey.get(row.key_path) ?? [];
        values.push(parseJson<Record<string, unknown>>(row.data_json, {}));
        occurrencesByKey.set(row.key_path, values);
      }
      const project = this.db.prepare(
        "SELECT has_unresolved_dynamic FROM projects WHERE id=?",
      ).get(projectId) as { has_unresolved_dynamic: number } | undefined;
      const hasUnresolvedDynamic = Number(project?.has_unresolved_dynamic ?? 0) === 1;
      const insertTask = this.db.prepare("INSERT INTO tasks(id,session_id,key_path,status,stage,last_error,skip_reason,updated_at) VALUES(?,?,?,?,?,?,?,?)");
      for (const key of keys) {
        const parsed = occurrencesByKey.get(key.key_path) ?? [];
        const noSource = parsed.length === 0;
        const nonVisualOnly = !noSource && parsed.every(isNonVisualOccurrence);
        if (noSource && hasUnresolvedDynamic) {
          const taskId = stableId("task", `${id}:${key.key_path}`);
          const message = "存在无法静态解析的动态 i18n 调用，需运行时或人工确认";
          insertTask.run(taskId, id, key.key_path, "needs_manual", "manual", message, null, now);
          this.addEvent(id, "task.needs_manual", {
            taskId,
            keyPath: key.key_path,
            stage: "manual",
            origin: "system",
            reason: "unresolved_dynamic_source",
          });
          continue;
        }
        if (noSource || nonVisualOnly) {
          const taskId = stableId("task", `${id}:${key.key_path}`);
          const reason = noSource ? "no_source_occurrence" : "non_visual_source_only";
          insertTask.run(taskId, id, key.key_path, "skipped", "agent", null, reason, now);
          this.addEvent(id, "task.skipped", { taskId, keyPath: key.key_path, stage: "agent", origin: "system", reason });
          continue;
        }
        const deterministic = parsed.some((occurrence) =>
          (occurrence.kind === "native_dom" || occurrence.kind === "text_range" || occurrence.kind === "component_prop") && (
            (typeof occurrence.location === "object" && occurrence.location !== null &&
              "file" in occurrence.location && /(?:^|\/)src\/App\.vue$/i.test(String((occurrence.location as { file?: unknown }).file))) ||
            (Array.isArray(occurrence.routeHints) && occurrence.routeHints.some((hint) =>
              typeof hint === "object" && hint !== null &&
              "confidence" in hint && Number((hint as { confidence?: unknown }).confidence) >= 0.8,
            ))
          ),
        );
        insertTask.run(stableId("task", `${id}:${key.key_path}`), id, key.key_path, deterministic ? "pending" : "needs_agent", deterministic ? "deterministic" : "agent", null, null, now);
      }
      this.addEvent(id, "session.created", { projectId, keyCount: keys.length, origin: "system" });
    });
    return id;
  }

  private addEvent(sessionId: string, type: string, data: unknown): void {
    this.db.prepare("INSERT INTO events(session_id,type,data_json,created_at) VALUES(?,?,?,?)")
      .run(sessionId, type, JSON.stringify(data), new Date().toISOString());
  }

  updateService(sessionId: string, serviceUrl: string): void {
    this.db.prepare("UPDATE sessions SET service_url=?,updated_at=? WHERE id=?").run(serviceUrl, new Date().toISOString(), sessionId);
  }

  setDeadline(sessionId: string, deadlineAt: string): void {
    if (!Number.isFinite(Date.parse(deadlineAt))) throw new Error(`Invalid workflow deadline: ${deadlineAt}`);
    this.db.prepare("UPDATE sessions SET deadline_at=?,updated_at=? WHERE id=?")
      .run(deadlineAt, new Date().toISOString(), sessionId);
  }

  closeSession(sessionId: string, status: "stopped" | "interrupted" | "failed" = "stopped"): void {
    this.transaction(() => {
      const session = this.session(sessionId);
      if (!session || session.status !== "running") return;
      const now = new Date().toISOString();
      this.db.prepare("UPDATE sessions SET status=?,updated_at=? WHERE id=?").run(status, now, sessionId);
      this.addEvent(sessionId, `session.${status}`, { origin: "system" });
    });
  }

  resumeSession(sessionId: string): void {
    this.transaction(() => {
      const session = this.session(sessionId);
      if (!session) throw new Error(`会话不存在：${sessionId}`);
      if (session.status === "failed") throw new Error(`失败会话不能恢复：${sessionId}`);
      if (session.status === "running") return;

      const active = this.db.prepare(
        "SELECT id FROM sessions WHERE project_id=? AND status='running' AND id<>? LIMIT 1",
      ).get(String(session.project_id), sessionId) as { id: string } | undefined;
      if (active) throw new Error(`项目已存在活动采集会话：${active.id}`);

      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE tasks
        SET status='pending',last_error=NULL,updated_at=?
        WHERE session_id=? AND status='running' AND stage='deterministic'
      `).run(now, sessionId);
      this.db.prepare(`
        UPDATE tasks
        SET status=CASE WHEN attempts>=? THEN 'needs_manual' ELSE 'needs_agent' END,
            last_error='Agent 执行被中断；重试前请检查已保存的计划',
            updated_at=?
        WHERE session_id=? AND status='running' AND stage='agent'
      `).run(MAX_AGENT_ATTEMPTS, now, sessionId);
      this.db.prepare(`
        UPDATE tasks
        SET status='needs_manual',last_error=NULL,updated_at=?
        WHERE session_id=? AND status='running' AND stage='manual'
      `).run(now, sessionId);
      this.db.prepare(
        "UPDATE sessions SET status='running',service_url=NULL,updated_at=? WHERE id=?",
      ).run(now, sessionId);
      this.addEvent(sessionId, "session.resumed", { previousStatus: session.status, origin: "system" });
    });
  }

  interruptProjectSessions(projectRoot: string): string[] {
    const projectId = stableId("project", resolve(projectRoot).toLowerCase());
    return this.transaction(() => {
      const sessions = this.db.prepare("SELECT id FROM sessions WHERE project_id=? AND status='running' ORDER BY created_at").all(projectId) as Array<{ id: string }>;
      const now = new Date().toISOString();
      const update = this.db.prepare("UPDATE sessions SET status='interrupted',updated_at=? WHERE id=? AND status='running'");
      for (const session of sessions) {
        update.run(now, session.id);
        this.addEvent(session.id, "session.interrupted", { reason: "stale_service_recovery", origin: "system" });
      }
      return sessions.map((session) => session.id);
    });
  }

  session(sessionId: string): Record<string, unknown> | undefined {
    return this.db.prepare(`SELECT s.*, p.root AS project_root, p.has_unresolved_dynamic FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=?`).get(sessionId) as Record<string, unknown> | undefined;
  }

  /** Router history mode detected for the project, if any. */
  projectRouterMode(projectId: string): "hash" | "history" | undefined {
    const row = this.db.prepare("SELECT router_mode FROM projects WHERE id=?").get(projectId) as { router_mode: string | null } | undefined;
    return row?.router_mode === "hash" || row?.router_mode === "history" ? row.router_mode : undefined;
  }

  latestSession(): Record<string, unknown> | undefined {
    return this.db.prepare(`SELECT s.*, p.root AS project_root FROM sessions s JOIN projects p ON p.id=s.project_id ORDER BY s.created_at DESC LIMIT 1`).get() as Record<string, unknown> | undefined;
  }

  status(sessionId: string): Record<string, unknown> {
    const session = this.session(sessionId);
    if (!session) throw new Error(`会话不存在：${sessionId}`);
    const rows = this.db.prepare("SELECT status,COUNT(*) AS count FROM tasks WHERE session_id=? GROUP BY status").all(sessionId) as Array<{ status: string; count: number }>;
    const counts: Record<string, number> = { total: 0, pending: 0, running: 0, captured: 0, needs_agent: 0, needs_manual: 0, failed: 0, skipped: 0 };
    for (const row of rows) { counts[row.status] = Number(row.count); counts.total += Number(row.count); }
    const current = this.db.prepare("SELECT key_path,stage,status,last_error FROM tasks WHERE session_id=? AND status IN ('running','needs_manual') ORDER BY updated_at LIMIT 1").get(sessionId) as Record<string, unknown> | undefined;
    const evidenceCounts = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT key_path) AS captured_keys,
        COUNT(*) - COUNT(DISTINCT task_id || ':' || COALESCE(screenshot_sha256,id)) AS duplicate_hashes
      FROM evidence WHERE session_id=?
    `).get(sessionId) as { total: number; captured_keys: number; duplicate_hashes: number };
    const evidenceCount = Number(evidenceCounts.total);
    const capturedKeyCount = Number(evidenceCounts.captured_keys);
    const historicalEvidenceCount = Math.max(0, evidenceCount - capturedKeyCount);
    const duplicateHashCount = Math.max(0, Number(evidenceCounts.duplicate_hashes));
    const coveragePercent = counts.total === 0 ? 100 : Number(((counts.captured / counts.total) * 100).toFixed(2));
    const manualPercent = counts.total === 0 ? 0 : Number(((counts.needs_manual / counts.total) * 100).toFixed(2));
    const automaticProcessed = Math.max(0, counts.total - counts.pending - counts.running);
    const automaticPercent = counts.total === 0
      ? 100
      : Number(((automaticProcessed / counts.total) * 100).toFixed(2));
    return {
      ...session,
      counts,
      evidenceCount,
      capturedKeyCount,
      historicalEvidenceCount,
      duplicateHashCount,
      // Backward-compatible aliases for v0.3.x clients. These now describe
      // actual content identity instead of treating every historical state as
      // a duplicate.
      screenshotCount: evidenceCount,
      uniqueScreenshotCount: capturedKeyCount,
      duplicateEvidenceCount: duplicateHashCount,
      coveragePercent,
      manualPercent,
      exportReady: counts.pending === 0 && counts.running === 0,
      current,
      automatic: {
        phase: counts.pending > 0 || counts.running > 0 ? "running" : "complete",
        processed: automaticProcessed,
        total: counts.total,
        percent: automaticPercent,
        captured: counts.captured,
        deferred: counts.needs_agent + counts.needs_manual,
        failed: counts.failed,
        currentKey:
          current?.status === "running" &&
          current?.stage === "deterministic" &&
          typeof current.key_path === "string"
            ? current.key_path
            : undefined,
      },
    };
  }

  task(taskId: string): StoredTask | undefined {
    const row = this.db.prepare(`
      SELECT t.*, k.chinese, k.relative_file, s.project_id
      FROM tasks t JOIN sessions s ON s.id=t.session_id
      JOIN session_locale_keys k ON k.session_id=t.session_id AND k.key_path=t.key_path
      WHERE t.id=?
    `).get(taskId) as Record<string, unknown> | undefined;
    return row ? this.hydrateTask(row) : undefined;
  }

  nextTask(sessionId: string, statuses: TaskStatus[] = ["needs_agent"]): StoredTask | undefined {
    const placeholders = statuses.map(() => "?").join(",");
    const row = this.db.prepare(`
      SELECT t.*, k.chinese, k.relative_file, s.project_id
      FROM tasks t JOIN sessions s ON s.id=t.session_id
      JOIN session_locale_keys k ON k.session_id=t.session_id AND k.key_path=t.key_path
      WHERE t.session_id=? AND t.status IN (${placeholders}) ORDER BY t.updated_at,t.key_path LIMIT 1
    `).get(sessionId, ...statuses) as Record<string, unknown> | undefined;
    return row ? this.hydrateTask(row) : undefined;
  }

  recordRouteCapture(sessionId: string, route: string, newCaptured: number): void {
    const row = this.db.prepare(
      "SELECT last_new_captured,consecutive_low FROM agent_route_stats WHERE session_id=? AND route=?",
    ).get(sessionId, route) as { last_new_captured: number; consecutive_low: number } | undefined;
    const low = newCaptured <= 1;
    const consecutiveLow = low ? (row?.consecutive_low ?? 0) + 1 : 0;
    this.db.prepare(
      "INSERT INTO agent_route_stats(session_id,route,last_new_captured,consecutive_low,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(session_id,route) DO UPDATE SET last_new_captured=excluded.last_new_captured, consecutive_low=excluded.consecutive_low, updated_at=excluded.updated_at",
    ).run(sessionId, route, newCaptured, consecutiveLow, new Date().toISOString());
  }

  routePlanCounts(sessionId: string): Map<string, number> {
    const rows = this.db.prepare(
      "SELECT route,plans FROM agent_route_stats WHERE session_id=? AND plans>0",
    ).all(sessionId) as Array<{ route: string; plans: number }>;
    return new Map(rows.map((row) => [row.route, Number(row.plans)]));
  }

  /**
   * Count one submitted Agent plan against the route anchor budget
   * (MAX_AGENT_ANCHORS_PER_ROUTE plans per session).
   */
  recordRoutePlan(sessionId: string, route: string): void {
    this.db.prepare(
      "INSERT INTO agent_route_stats(session_id,route,last_new_captured,consecutive_low,plans,updated_at) VALUES(?,?,0,0,1,?) ON CONFLICT(session_id,route) DO UPDATE SET plans=plans+1, updated_at=excluded.updated_at",
    ).run(sessionId, route, new Date().toISOString());
  }

  saturatedRoutes(sessionId: string, threshold = 2): string[] {
    const rows = this.db.prepare(
      "SELECT route FROM agent_route_stats WHERE session_id=? AND consecutive_low>=?",
    ).all(sessionId, threshold) as Array<{ route: string }>;
    return rows.map((row) => row.route);
  }

  /**
   * Next Agent anchor with saturation and budget hardening (R4):
   * - Saturated routes (consecutive low-yield runs) are hard-excluded; when
   *   every candidate route is saturated the queue reports no anchor instead
   *   of grinding the same low-yield route, so consecutive_low can never
   *   grow unbounded from repeated anchoring.
   * - Each route gets at most MAX_AGENT_ANCHORS_PER_ROUTE plans per session;
   *   over-budget routes stop providing anchors. The budget relaxes only
   *   when every remaining non-saturated route is over budget, so a healthy
   *   route is never left idling.
   */
  nextAgentTask(sessionId: string, excludedRoutes: string[] = [], maxAnchorsPerRoute = MAX_AGENT_ANCHORS_PER_ROUTE): StoredTask | undefined {
    const excluded = new Set(excludedRoutes);
    // Zero-occurrence keys are confirmed non-renderable and belong to
    // finalize's skippedNoSource; never hand them to an Agent as an anchor.
    const withOccurrences = this.listTasks(sessionId, ["needs_agent"], 2_000)
      .filter((task) => task.occurrences.length > 0);
    // Prefer anchors with at least one concrete literal occurrence. Keys that
    // only match dynamic template interpolation are low-confidence and mostly
    // non-renderable; they stay in the queue and are anchored on only after
    // every static anchor has been processed.
    const staticCandidates = withOccurrences.filter((task) =>
      task.occurrences.some((occurrence) => !isDynamicOccurrence(occurrence)));
    const tasks = staticCandidates.length > 0 ? staticCandidates : withOccurrences;
    const routeCounts = new Map<string, number>();
    const routeActionScores = new Map<string, number>();
    for (const task of tasks) {
      const route = preferredAgentRoute(task);
      if (!route) continue;
      routeCounts.set(route, (routeCounts.get(route) ?? 0) + 1);
      routeActionScores.set(route, (routeActionScores.get(route) ?? 0) + agentActionScore(task));
    }
    const candidateRoutes = [...routeCounts.keys()];
    const saturated = new Set(this.saturatedRoutes(sessionId));
    // Verification A: only saturated routes remain -> no anchor. The Agent
    // phase ends cleanly instead of spinning on low-yield repeats.
    if (candidateRoutes.length > 0 && candidateRoutes.every((route) => saturated.has(route))) {
      return undefined;
    }
    const routeBudget = this.routePlanCounts(sessionId);
    const unsaturated = candidateRoutes.filter((route) => !saturated.has(route));
    const unsaturatedUnderBudget = unsaturated.filter(
      (route) => (routeBudget.get(route) ?? 0) < maxAnchorsPerRoute,
    );
    const relaxBudget = unsaturated.length > 0 && unsaturatedUnderBudget.length === 0;
    const allowRoute = (route: string | undefined): boolean => {
      if (!route) return true;
      if (saturated.has(route)) return false;
      const plans = routeBudget.get(route) ?? 0;
      return plans < maxAnchorsPerRoute || relaxBudget;
    };
    return tasks
      .map((task, index) => {
        const route = preferredAgentRoute(task);
        const routeFanout = route ? routeCounts.get(route) ?? 1 : 0;
        const routeActionScore = route ? routeActionScores.get(route) ?? 0 : 0;
        const priority =
          (route && excluded.has(route) ? -1_000_000 : 0) +
          routeFanout * 10_000 +
          Math.min(routeActionScore, 60_000) +
          agentTaskPriority(task);
        return { task, index, priority, route };
      })
      .filter((item) => allowRoute(item.route))
      .sort((left, right) => right.priority - left.priority || left.index - right.index)[0]?.task;
  }

  agentRouteBatch(sessionId: string, anchor: StoredTask, limit = 12): AgentRouteBatch {
    const route = preferredAgentRoute(anchor);
    const candidates = this.listTasks(sessionId, ["needs_agent"], 2_000)
      .filter((task) => task.occurrences.length > 0)
      .filter((task) => route ? preferredAgentRoute(task) === route : task.relativeFile === anchor.relativeFile);
    const selected = representativeRouteTasks(candidates, anchor, limit);
    const sourceFiles = new Set<string>();
    const sections = new Map<string, number>();
    const countsByKind = new Map<string, number>();
    const countsByService = new Map<string, number>();
    for (const task of candidates) {
      const section = task.keyPath.split(".").slice(0, 2).join(".");
      sections.set(section, (sections.get(section) ?? 0) + 1);
      for (const occurrence of task.occurrences) {
        const record = asRecord(occurrence);
        if (!record) continue;
        if (typeof record.kind === "string") countsByKind.set(record.kind, (countsByKind.get(record.kind) ?? 0) + 1);
        if (typeof record.service === "string") countsByService.set(record.service, (countsByService.get(record.service) ?? 0) + 1);
        const location = asRecord(record.location);
        if (typeof location?.file === "string") sourceFiles.add(location.file);
      }
    }
    const tasks = selected.map((task) => {
      const kinds = new Set<string>();
      const services = new Set<string>();
      const locations: Array<{ file?: string; line?: number }> = [];
      for (const occurrence of task.occurrences) {
        const record = asRecord(occurrence);
        if (!record) continue;
        if (typeof record.kind === "string") kinds.add(record.kind);
        if (typeof record.service === "string") services.add(record.service);
        const location = asRecord(record.location);
        const file = typeof location?.file === "string" ? location.file : undefined;
        const line = typeof location?.line === "number" ? location.line : undefined;
        if (file) sourceFiles.add(file);
        if (locations.length < 3 && (file || line !== undefined)) locations.push({ file, line });
      }
      return {
        id: task.id,
        keyPath: task.keyPath,
        chinese: task.chinese,
        relativeFile: task.relativeFile,
        attempts: task.attempts,
        kinds: [...kinds],
        services: [...services],
        locations,
        actionHints: task.actionHints.slice(0, 5),
      };
    });
    return {
      route,
      total: candidates.length,
      returned: tasks.length,
      truncated: candidates.length > tasks.length,
      sourceFiles: [...sourceFiles].sort(),
      sections: [...sections].map(([name, count]) => ({ name, count })).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
      countsByKind: Object.fromEntries([...countsByKind].sort()),
      countsByService: Object.fromEntries([...countsByService].sort()),
      tasks,
    };
  }

  private hydrateTask(
    row: Record<string, unknown>,
    prefetchedOccurrences?: ReadonlyMap<string, Array<Record<string, unknown>>>,
  ): StoredTask {
    const occurrences = prefetchedOccurrences?.get(String(row.key_path)) ??
      (this.db.prepare("SELECT data_json FROM occurrences WHERE project_id=? AND key_path=?").all(row.project_id as string, row.key_path as string) as Array<{ data_json: string }>)
        .map((item) => parseJson<Record<string, unknown>>(item.data_json, {}));
    const routeHints = occurrences.flatMap((item) => Array.isArray(item.routeHints) ? item.routeHints : []);
    const actionHints = occurrences.flatMap((item) => Array.isArray(item.actionHints) ? item.actionHints : []);
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      keyPath: row.key_path as string,
      status: row.status as TaskStatus,
      stage: row.stage as StoredTask["stage"],
      chinese: row.chinese as string,
      relativeFile: row.relative_file as string,
      occurrences,
      routeHints,
      actionHints,
      attempts: Number(row.attempts),
      lastError: typeof row.last_error === "string" ? row.last_error : undefined,
      skipReason: typeof row.skip_reason === "string" ? row.skip_reason : null,
      plan: parseJson(row.plan_json, undefined),
    };
  }

  private hydrateTasks(rows: Array<Record<string, unknown>>): StoredTask[] {
    if (rows.length === 0) return [];
    const projectId = String(rows[0]!.project_id);
    const keyPaths = [...new Set(rows.map((row) => String(row.key_path)))];
    const occurrenceRows = this.db.prepare(`
      SELECT key_path,data_json
      FROM occurrences
      WHERE project_id=? AND key_path IN (${keyPaths.map(() => "?").join(",")})
      ORDER BY key_path
    `).all(projectId, ...keyPaths) as Array<{ key_path: string; data_json: string }>;
    const occurrencesByKey = new Map<string, Array<Record<string, unknown>>>();
    for (const occurrence of occurrenceRows) {
      const values = occurrencesByKey.get(occurrence.key_path) ?? [];
      values.push(parseJson<Record<string, unknown>>(occurrence.data_json, {}));
      occurrencesByKey.set(occurrence.key_path, values);
    }
    return rows.map((row) => this.hydrateTask(row, occurrencesByKey));
  }

  submitPlan(taskId: string, plan: unknown): void {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE tasks
      SET plan_json=?,status='running',stage='agent',attempts=attempts+1,last_error=NULL,updated_at=?
      WHERE id=? AND status='needs_agent' AND attempts<?
    `).run(JSON.stringify(plan), now, taskId, MAX_AGENT_ATTEMPTS);
    if (Number(result.changes) !== 1) {
      const task = this.task(taskId);
      if (!task) throw new Error(`任务不存在：${taskId}`);
      if (task.status !== "needs_agent") throw new Error(`任务状态为 ${task.status}，不能执行 Agent 计划：${task.keyPath}`);
      throw new Error(`任务已达到 Agent 最大尝试次数 ${MAX_AGENT_ATTEMPTS}：${task.keyPath}`);
    }
    const task = this.task(taskId);
    if (task) {
      this.addEvent(task.sessionId, "agent.plan_submitted", { taskId, keyPath: task.keyPath, stage: "agent", origin: "agent" });
      // R4: count the plan against the route anchor budget.
      const route = preferredAgentRoute(task);
      if (route) this.recordRoutePlan(task.sessionId, route);
    }
  }

  savePlan(taskId: string, plan: unknown): void {
    const result = this.db.prepare("UPDATE tasks SET plan_json=?,updated_at=? WHERE id=? AND status='needs_agent' AND attempts<?")
      .run(JSON.stringify(plan), new Date().toISOString(), taskId, MAX_AGENT_ATTEMPTS);
    if (Number(result.changes) !== 1) {
      const task = this.task(taskId);
      if (!task) throw new Error(`任务不存在：${taskId}`);
      if (task.status !== "needs_agent") throw new Error(`任务状态为 ${task.status}，不能提交 Agent 计划：${task.keyPath}`);
      throw new Error(`任务已达到 Agent 最大尝试次数 ${MAX_AGENT_ATTEMPTS}：${task.keyPath}`);
    }
    const task = this.task(taskId);
    if (task) this.addEvent(task.sessionId, "agent.plan_saved", { taskId, keyPath: task.keyPath, stage: "agent", origin: "agent" });
  }

  markTask(taskId: string, status: TaskStatus, error?: string): void {
    this.db.prepare("UPDATE tasks SET status=?,last_error=?,updated_at=? WHERE id=?")
      .run(status, error ?? null, new Date().toISOString(), taskId);
    const task = this.task(taskId);
    if (task) this.addEvent(task.sessionId, `task.${status}`, { taskId, keyPath: task.keyPath, error, stage: task.stage, origin: task.stage });
  }

  finalizeUnresolved(sessionId: string): FinalizeUnresolvedResult {
    const status = this.status(sessionId);
    const counts = status.counts as Record<string, number>;
    if (Number(counts.pending ?? 0) > 0 || Number(counts.running ?? 0) > 0) {
      throw new Error("自动或 Agent 任务仍在运行，不能执行 finalize");
    }

    const unresolved: StoredTask[] = [];
    let afterKey: string | undefined;
    for (;;) {
      const page = this.taskPage(sessionId, ["needs_agent"], afterKey, 500);
      unresolved.push(...page.items);
      if (!page.hasMore) break;
      afterKey = page.nextAfterKey ?? undefined;
    }
    const result: FinalizeUnresolvedResult = {
      skippedNoSource: [],
      skippedNonVisual: [],
      needsManual: [],
    };
    const hasUnresolvedDynamic = Number(this.session(sessionId)?.has_unresolved_dynamic ?? 0) === 1;

    this.transaction(() => {
      const update = this.db.prepare(
        "UPDATE tasks SET status=?,stage=?,last_error=NULL,skip_reason=?,updated_at=? WHERE id=? AND status='needs_agent'",
      );
      for (const task of unresolved) {
        const noSource = task.occurrences.length === 0;
        const nonVisualOnly =
          !noSource && task.occurrences.every((occurrence) => isNonVisualOccurrence(occurrence));
        const nextStatus: TaskStatus = (noSource && !hasUnresolvedDynamic) || nonVisualOnly
          ? "skipped"
          : "needs_manual";
        const nextStage = nextStatus === "needs_manual" ? "manual" : task.stage;
        const reason = noSource
          ? hasUnresolvedDynamic ? "unresolved_dynamic_source" : "no_source_occurrence"
          : nonVisualOnly
            ? "non_visual_source_only"
            : "assisted_manual_fallback";
        const changed = update.run(
          nextStatus,
          nextStage,
          nextStatus === "skipped" ? reason : null,
          new Date().toISOString(),
          task.id,
        );
        if (Number(changed.changes) !== 1) continue;
        if (reason === "no_source_occurrence") result.skippedNoSource.push(task.keyPath);
        else if (reason === "non_visual_source_only") result.skippedNonVisual.push(task.keyPath);
        else result.needsManual.push(task.keyPath);
        this.addEvent(sessionId, `task.${nextStatus}`, {
          taskId: task.id,
          keyPath: task.keyPath,
          stage: nextStage,
          origin: "system",
          reason,
        });
      }
    });
    return result;
  }

  addEvidence(taskId: string, evidence: CollectedEvidence): string {
    let id = `evidence_${randomUUID()}`;
    this.transaction(() => {
      const task = this.task(taskId);
      if (!task) throw new Error(`任务不存在：${taskId}`);
      if (evidence.key !== task.keyPath) {
        throw new Error(`Evidence key ${evidence.key} does not match task key ${task.keyPath}`);
      }
      const gradeRank = evidenceGradeRank(evidence.evidenceGrade);
      const requiredRank = evidence.source === "deterministic" ? 3 : evidence.source === "agent" ? 2 : 1;
      if (gradeRank < requiredRank) {
        throw new Error(
          `${evidence.source} evidence for ${task.keyPath} requires grade ${
            evidence.source === "deterministic" ? "A" : evidence.source === "agent" ? "B" : "C"
          }, received ${evidence.evidenceGrade ?? "C"}`,
        );
      }
      const session = this.session(task.sessionId);
      if (!session || session.status !== "running") throw new Error(`会话已结束，不能写入截图证据：${task.sessionId}`);
      const existing = this.db.prepare(`
        SELECT id,source,screenshot_path,evidence_grade,data_json,captured_at
        FROM evidence
        WHERE session_id=? AND task_id=? AND screenshot_sha256=?
        LIMIT 1
      `).get(task.sessionId, taskId, evidence.screenshotSha256) as {
        id: string; source: string; screenshot_path: string; evidence_grade: string | null;
        data_json: string; captured_at: string
      } | undefined;
      if (existing) {
        id = existing.id;
        // Identical pixels are one piece of evidence. Only replace its
        // provenance when the new observation is at least as strong, so a
        // later manual observation cannot downgrade deterministic A evidence.
        if (gradeRank >= evidenceGradeRank(existing.evidence_grade)) {
          this.db.prepare(`
            UPDATE evidence
            SET source=?,screenshot_path=?,screenshot_sha256=?,evidence_grade=?,route=?,data_json=?,captured_at=?
            WHERE id=?
          `).run(
            evidence.source,
            evidence.screenshotPath,
            evidence.screenshotSha256,
            evidence.evidenceGrade ?? "C",
            evidence.route,
            JSON.stringify(evidence),
            evidence.capturedAt,
            existing.id,
          );
        }
      } else {
        this.db.prepare("INSERT INTO evidence(id,session_id,task_id,key_path,source,screenshot_path,screenshot_sha256,evidence_grade,route,data_json,captured_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
          .run(id, task.sessionId, taskId, task.keyPath, evidence.source, evidence.screenshotPath, evidence.screenshotSha256, evidence.evidenceGrade ?? "C", evidence.route, JSON.stringify(evidence), evidence.capturedAt);
      }
      const now = new Date().toISOString();
      this.db.prepare("UPDATE tasks SET status='captured',last_error=NULL,updated_at=? WHERE id=?").run(now, taskId);
      this.addEvent(task.sessionId, "task.captured", {
        taskId,
        evidenceId: id,
        keyPath: task.keyPath,
        stage: task.stage,
        source: evidence.source,
        origin: evidence.source,
      });
    });
    return id;
  }

  startManual(taskId: string): void {
    this.db.prepare("UPDATE tasks SET status='needs_manual',stage='manual',last_error=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), taskId);
    const task = this.task(taskId);
    if (task) this.addEvent(task.sessionId, "manual.listening", { taskId, keyPath: task.keyPath, stage: "manual", origin: "manual" });
  }

  localeCatalog(sessionId: string, englishRoot: string): Array<{ keyPath: string; chinese: string; english?: string; relativeFile: string; targetFile: string; jsonPath: string[]; screenshotPath?: string; screenshotSha256?: string; deprecated?: boolean; nonVisual?: boolean }> {
    const rows = this.db.prepare(`
      SELECT k.*, t.status AS task_status, t.skip_reason, (
        SELECT e.screenshot_path
        FROM evidence e
        WHERE e.session_id=k.session_id AND e.task_id=t.id AND e.key_path=k.key_path
        ORDER BY e.captured_at DESC,e.rowid DESC
        LIMIT 1
      ) screenshot_path, (
        SELECT e.data_json
        FROM evidence e
        WHERE e.session_id=k.session_id AND e.task_id=t.id AND e.key_path=k.key_path
        ORDER BY e.captured_at DESC,e.rowid DESC
        LIMIT 1
      ) evidence_json
      FROM session_locale_keys k
      JOIN tasks t ON t.session_id=k.session_id AND t.key_path=k.key_path
      WHERE k.session_id=?
      ORDER BY k.key_path
    `).all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const evidence = parseJson<{ screenshotSha256?: string }>(row.evidence_json, {});
      return {
        keyPath: row.key_path as string,
        chinese: row.chinese as string,
        english: row.english as string | undefined,
        deprecated: row.task_status === "skipped" && row.skip_reason === "no_source_occurrence",
        nonVisual: row.task_status === "skipped" && row.skip_reason === "non_visual_source_only",
        relativeFile: row.relative_file as string,
        targetFile: join(resolve(englishRoot), row.relative_file as string),
        jsonPath: parseJson<string[]>(row.json_path, (row.key_path as string).split(".")),
        screenshotPath: row.screenshot_path as string | undefined,
        screenshotSha256: evidence.screenshotSha256,
      };
    });
  }

  taskByKey(sessionId: string, keyPath: string): StoredTask | undefined {
    const row = this.db.prepare("SELECT id FROM tasks WHERE session_id=? AND key_path=?").get(sessionId, keyPath) as { id: string } | undefined;
    return row ? this.task(row.id) : undefined;
  }

  listTasks(sessionId: string, statuses?: TaskStatus[], limit = 500): StoredTask[] {
    const bounded = Math.max(1, Math.min(limit, 2_000));
    const rows = statuses?.length
      ? this.db.prepare(`
          SELECT t.*,k.chinese,k.relative_file,s.project_id
          FROM tasks t JOIN sessions s ON s.id=t.session_id
          JOIN session_locale_keys k ON k.session_id=t.session_id AND k.key_path=t.key_path
          WHERE t.session_id=? AND t.status IN (${statuses.map(() => "?").join(",")})
          ORDER BY t.updated_at,t.key_path LIMIT ?
        `).all(sessionId, ...statuses, bounded)
      : this.db.prepare(`
          SELECT t.*,k.chinese,k.relative_file,s.project_id
          FROM tasks t JOIN sessions s ON s.id=t.session_id
          JOIN session_locale_keys k ON k.session_id=t.session_id AND k.key_path=t.key_path
          WHERE t.session_id=? ORDER BY t.updated_at,t.key_path LIMIT ?
        `).all(sessionId, bounded);
    return this.hydrateTasks(rows as Array<Record<string, unknown>>);
  }

  taskPage(sessionId: string, statuses?: TaskStatus[], afterKey?: string, limit = 500): TaskPage {
    const bounded = Math.max(1, Math.min(Math.trunc(limit), 500));
    const statusClause = statuses?.length ? ` AND t.status IN (${statuses.map(() => "?").join(",")})` : "";
    const cursorClause = afterKey ? " AND t.key_path>?" : "";
    const parameters: Array<string | number> = [sessionId, ...(statuses ?? [])];
    if (afterKey) parameters.push(afterKey);
    parameters.push(bounded + 1);
    const rows = this.db.prepare(`
      SELECT t.*,k.chinese,k.relative_file,s.project_id
      FROM tasks t JOIN sessions s ON s.id=t.session_id
      JOIN session_locale_keys k ON k.session_id=t.session_id AND k.key_path=t.key_path
      WHERE t.session_id=?${statusClause}${cursorClause}
      ORDER BY t.key_path
      LIMIT ?
    `).all(...parameters) as Array<Record<string, unknown>>;
    const hasMore = rows.length > bounded;
    const pageRows = hasMore ? rows.slice(0, bounded) : rows;
    const items = this.hydrateTasks(pageRows);
    return {
      items,
      nextAfterKey: hasMore ? String(pageRows.at(-1)?.key_path ?? "") || null : null,
      hasMore,
    };
  }

  listEvidence(sessionId: string, limit = 500): Array<Record<string, unknown>> {
    return (this.db.prepare("SELECT id,task_id,key_path,source,screenshot_path,screenshot_sha256,evidence_grade,route,data_json,captured_at FROM evidence WHERE session_id=? ORDER BY captured_at DESC LIMIT ?").all(sessionId, Math.max(1, Math.min(limit, 2_000))) as Array<Record<string, unknown>>)
      .map((row) => ({ ...row, data: parseJson(row.data_json, {}) }));
  }

  evidence(evidenceId: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT id,session_id,task_id,key_path,source,screenshot_path,screenshot_sha256,evidence_grade,route,data_json,captured_at FROM evidence WHERE id=?").get(evidenceId) as Record<string, unknown> | undefined;
  }

  events(sessionId: string, after = 0): StoredEvent[] {
    return this.eventPage(sessionId, after, 200).items;
  }

  eventPage(sessionId: string, after = 0, limit = 200): EventPage {
    const bounded = Math.max(1, Math.min(Math.trunc(limit), 500));
    const rows = this.db.prepare("SELECT id,type,data_json,created_at FROM events WHERE session_id=? AND id>? ORDER BY id LIMIT ?")
      .all(sessionId, after, bounded + 1) as Array<Record<string, unknown>>;
    const hasMore = rows.length > bounded;
    const pageRows = hasMore ? rows.slice(0, bounded) : rows;
    const items = pageRows.map(hydrateEvent);
    return {
      items,
      nextAfter: items.at(-1)?.id ?? after,
      hasMore,
    };
  }
}
