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
}

export interface Evidence {
  id: string;
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
  const payload = await response.json() as { ok: boolean; data?: T; error?: { message?: string } };
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? `请求失败：${response.status}`);
  return payload.data as T;
}

export const api = {
  health: () => request<{ sessionId: string }>("/api/health"),
  status: (session: string) => request<SessionStatus>(`/api/status?session=${encodeURIComponent(session)}`),
  tasks: (session: string, statuses: string[]) => request<Task[]>(`/api/tasks?session=${encodeURIComponent(session)}&status=${encodeURIComponent(statuses.join(","))}`),
  evidence: (session: string) => request<Evidence[]>(`/api/evidence?session=${encodeURIComponent(session)}`),
  manualOpen: (body: { sessionId: string; keyPath: string; route?: string; mocks?: unknown[] }) => request<Record<string, unknown>>("/api/manual/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  importWorkbook: async (session: string, file: File, apply: boolean) => request<ImportReport>(`/api/import-upload?session=${encodeURIComponent(session)}&apply=${apply}`, { method: "POST", headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: await file.arrayBuffer() }),
};
