import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface ServiceDescriptor {
  pid: number;
  projectRoot: string;
  sessionId: string;
  serviceUrl: string;
  studioUrl: string;
  appUrl: string;
  startedAt: string;
  capability: string;
}

export const serviceDescriptorPath = (projectRoot: string) => join(resolve(projectRoot), ".collect-i18n", "service.json");

export async function readServiceDescriptor(projectRoot: string): Promise<ServiceDescriptor> {
  try {
    const expectedRoot = resolve(projectRoot);
    const value = JSON.parse(await readFile(serviceDescriptorPath(expectedRoot), "utf8")) as Partial<ServiceDescriptor>;
    const serviceUrl = new URL(String(value.serviceUrl ?? ""));
    const studioUrl = new URL(String(value.studioUrl ?? ""));
    if (
      !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0 ||
      typeof value.sessionId !== "string" || value.sessionId.length === 0 ||
      typeof value.capability !== "string" || value.capability.length < 32 ||
      typeof value.startedAt !== "string" ||
      resolve(String(value.projectRoot ?? "")).toLowerCase() !== expectedRoot.toLowerCase() ||
      serviceUrl.protocol !== "http:" || serviceUrl.hostname !== "127.0.0.1" ||
      studioUrl.origin !== serviceUrl.origin
    ) {
      throw new Error("后台服务描述文件无效");
    }
    return value as ServiceDescriptor;
  } catch {
    throw new Error(`Collect I18n 后台服务尚未启动：${resolve(projectRoot)}`);
  }
}

export async function callService<T>(projectRoot: string, path: string, init?: RequestInit): Promise<T> {
  const service = await readServiceDescriptor(projectRoot);
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${service.capability}`);
  if (init?.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(new URL(path, service.serviceUrl), {
    ...init,
    headers,
  });
  const result = await response.json() as { ok: boolean; data?: T; error?: { message?: string } };
  if (!response.ok || !result.ok) throw new Error(result.error?.message ?? `后台服务请求失败：${response.status}`);
  return result.data as T;
}
