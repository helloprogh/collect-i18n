import axios, { AxiosError } from 'axios'

export interface CreateJobInput {
  name: string
  email: string
  endpoint: string
  retries: number
  environment: string
  description: string
}

export interface CreateJobResult { id: string }
export interface ApiErrorPayload { code?: string; requestId?: string }

const client = axios.create({
  baseURL: '/api',
  timeout: 5000,
  headers: { 'Content-Type': 'application/json' },
})

export async function createJob(input: CreateJobInput): Promise<CreateJobResult> {
  const response = await client.post<CreateJobResult>('/jobs', input, {
    params: { environment: input.environment },
  })
  return response.data
}

export interface SyncJob {
  id: string
  name: string
  environment: string
  status: 'running' | 'completed'
}

export async function listJobs(): Promise<SyncJob[]> {
  const response = await client.get<{ items: SyncJob[] }>('/jobs')
  return response.data.items
}

export function getApiError(error: unknown): { code: string; requestId?: string } {
  if (error instanceof AxiosError) {
    const payload = error.response?.data as ApiErrorPayload | undefined
    return { code: payload?.code ?? 'NETWORK_ERROR', requestId: payload?.requestId }
  }
  return { code: 'UNKNOWN_ERROR' }
}
