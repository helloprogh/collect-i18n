export interface SessionStatus {
  id: string;
  project_root: string;
  status: string;
  base_url: string;
  service_url: string;
  counts: Record<string, number> & { total: number; captured: number; needs_agent: number; needs_manual: number; failed: number; pending: number };
  screenshotCount: number;
  current?: { key_path: string; stage: string; status: string; last_error?: string };
}

export interface Task {
  id: string;
  sessionId: string;
  keyPath: string;
  status: string;
  stage: string;
  chinese: string;
  relativeFile: string;
  routeHints: Array<{ path?: string; confidence?: number; source?: string }>;
  actionHints: Array<{ kind?: string; label?: string; selector?: string; confidence?: number }>;
  attempts: number;
  lastError?: string;
  plan?: Record<string, unknown>;
}

export interface SessionEvent {
  id: number;
  type: string;
  created_at: string;
  origin?: "system" | "deterministic" | "agent" | "manual" | "unknown";
  data: {
    taskId?: string;
    keyPath?: string;
    error?: string;
    stage?: "deterministic" | "agent" | "manual";
    source?: string;
    [key: string]: unknown;
  };
}

export interface Evidence {
  id: string;
  task_id: string;
  key_path: string;
  source: string;
  route: string;
  captured_at: string;
}

export interface ImportIssue { code: string; keyPath?: string; row?: number; message: string; fatal: boolean }
export interface ImportReport {
  totalRows: number;
  translatedRows: number;
  unchangedRows: number;
  canApply: boolean;
  applied: boolean;
  issues: ImportIssue[];
  writtenFiles: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") throw new Error("本地服务返回了无法识别的数据");
  const envelope = payload as { ok?: boolean; data?: T; error?: { message?: string } };
  if (!response.ok || envelope.ok !== true) throw new Error(envelope.error?.message ?? `请求失败：${response.status}`);
  if (!("data" in envelope)) throw new Error("本地服务响应缺少 data 字段");
  return envelope.data as T;
}

const EVENT_PAGE_SIZE = 200;

interface TaskPage {
  items: Task[];
  nextAfterKey: string | null;
  hasMore: boolean;
}

interface EventPage {
  items: SessionEvent[];
  nextAfter: number;
  hasMore: boolean;
}

async function tasks(session: string): Promise<Task[]> {
  const collected: Task[] = [];
  let afterKey = "";
  for (;;) {
    const query = `/api/tasks?session=${encodeURIComponent(session)}&limit=250${afterKey ? `&afterKey=${encodeURIComponent(afterKey)}` : ""}`;
    const page = await request<unknown>(query);
    if (Array.isArray(page)) {
      // Compatibility with services released before cursor pagination.
      return request<Task[]>(`/api/tasks?session=${encodeURIComponent(session)}&limit=2000`);
    }
    if (!page || typeof page !== "object" || !Array.isArray((page as TaskPage).items)) throw new Error("本地服务返回了无效任务列表");
    const typed = page as TaskPage;
    collected.push(...typed.items);
    if (!typed.hasMore) return collected;
    if (!typed.nextAfterKey || typed.nextAfterKey <= afterKey) throw new Error("本地服务任务游标无效");
    afterKey = typed.nextAfterKey;
  }
}

async function events(session: string, after = 0): Promise<SessionEvent[]> {
  const collected: SessionEvent[] = [];
  let cursor = after;
  for (;;) {
    const page = await request<unknown>(`/api/events?session=${encodeURIComponent(session)}&after=${cursor}&limit=500`);
    const legacy = Array.isArray(page);
    const batch = legacy ? page as SessionEvent[] : (page as EventPage | undefined)?.items;
    if (!Array.isArray(batch)) throw new Error("本地服务返回了无效事件列表");
    if (!batch.length) return collected;
    collected.push(...batch);
    const nextCursor = legacy ? batch.at(-1)?.id : (page as EventPage).nextAfter;
    if (typeof nextCursor !== "number" || nextCursor <= cursor) throw new Error("本地服务事件游标无效");
    cursor = nextCursor;
    const hasMore = legacy ? batch.length >= EVENT_PAGE_SIZE : (page as EventPage).hasMore;
    if (!hasMore) return collected;
  }
}

export const api = {
  health: async () => {
    const data = await request<unknown>("/api/health");
    if (!data || typeof data !== "object" || typeof (data as { sessionId?: unknown }).sessionId !== "string" || !(data as { sessionId: string }).sessionId) {
      throw new Error("本地服务没有返回有效的 sessionId");
    }
    return data as { sessionId: string };
  },
  status: (session: string) => request<SessionStatus>(`/api/status?session=${encodeURIComponent(session)}`),
  tasks,
  evidence: (session: string) => request<Evidence[]>(`/api/evidence?session=${encodeURIComponent(session)}&limit=2000`),
  events,
  manualOpen: (body: { sessionId: string; keyPath: string; route?: string; mocks?: unknown[] }) => request<Record<string, unknown>>("/api/manual/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  importWorkbook: async (session: string, file: File, apply: boolean) => request<ImportReport>(`/api/import-upload?session=${encodeURIComponent(session)}&apply=${apply}`, { method: "POST", headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: await file.arrayBuffer() }),
};
