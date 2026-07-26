import axios, { AxiosError } from 'axios'
import { mockAdapter } from './mockAdapter'
import type {
  OperationLog,
  OrderItem,
  OrderStatus,
  CustomerLevel,
  PermissionNode,
  Role,
  RoleMember,
  RoleStatus,
} from './mockData'

export type { OperationLog, OrderItem, OrderStatus, CustomerLevel, PermissionNode, Role, RoleMember, RoleStatus }

export interface ApiErrorPayload { code?: string; requestId?: string }

const client = axios.create({
  baseURL: '/api',
  timeout: 8000,
  headers: { 'Content-Type': 'application/json' },
  adapter: mockAdapter,
})

export function getApiError(error: unknown): { code: string; requestId?: string } {
  if (error instanceof AxiosError) {
    const payload = error.response?.data as ApiErrorPayload | undefined
    return { code: payload?.code ?? 'NETWORK_ERROR', requestId: payload?.requestId }
  }
  return { code: 'UNKNOWN_ERROR' }
}

// ---- Orders ----
export type OrdersScenario = 'success' | 'empty' | 'error' | 'slow'

export interface OrderListParams {
  search?: string
  status?: OrderStatus | ''
  level?: CustomerLevel | ''
  page?: number
  pageSize?: number
  scenario?: OrdersScenario
}

export interface OrderListResult {
  items: OrderItem[]
  total: number
  page: number
  pageSize: number
}

export async function listOrders(params: OrderListParams): Promise<OrderListResult> {
  const response = await client.get<OrderListResult>('/orders', { params })
  return response.data
}

export async function cancelOrder(id: string): Promise<void> {
  await client.post(`/orders/${id}/cancel`)
}

export async function reprintOrder(id: string): Promise<void> {
  await client.post(`/orders/${id}/reprint`)
}

export async function exportOrders(): Promise<void> {
  await client.post('/orders/export')
}

// ---- Permissions ----
export async function listRoles(): Promise<Role[]> {
  const response = await client.get<Role[]>('/roles')
  return response.data
}

export type RoleInput = Omit<Role, 'id' | 'memberCount'>

export async function createRole(input: RoleInput): Promise<Role> {
  const response = await client.post<Role>('/roles', input)
  return response.data
}

export async function updateRole(id: string, input: Partial<RoleInput>): Promise<Role> {
  const response = await client.put<Role>(`/roles/${id}`, input)
  return response.data
}

export async function deleteRole(id: string): Promise<void> {
  await client.delete(`/roles/${id}`)
}

export async function getPermissionTree(): Promise<PermissionNode[]> {
  const response = await client.get<PermissionNode[]>('/permissions/tree')
  return response.data
}

export async function savePermissions(ids: string[]): Promise<void> {
  await client.put('/permissions/tree', { ids })
}

export async function listMembers(roleId: string): Promise<RoleMember[]> {
  const response = await client.get<RoleMember[]>(`/roles/${roleId}/members`)
  return response.data
}

export async function listOperationLogs(): Promise<OperationLog[]> {
  const response = await client.get<OperationLog[]>('/operations/log')
  return response.data
}

// ---- Onboarding ----
export interface OnboardingPayload {
  username: string
  accountType: string
  teamName?: string
  company?: string
  fullName: string
  country: string
  timezone: string
  language: string
  theme: string
  frequency: string
}

export async function submitOnboarding(payload: OnboardingPayload): Promise<{ id: string }> {
  const response = await client.post<{ id: string }>('/onboarding', payload)
  return response.data
}

// ---- Request lab ----
export type LabScenario = 'success' | 'error' | 'partial' | 'retry' | 'empty' | 'slow'
export type LabState = 'loading' | 'success' | 'error' | 'partial' | 'empty' | 'retrying' | 'retryExhausted'
export type BackoffStrategy = 'fixed' | 'linear' | 'exponential'
export type PayloadSize = 'small' | 'medium' | 'large'

export interface LabRequestOptions {
  scenario: LabScenario
  payloadSize: PayloadSize
  delay?: number
  statusCode?: number
  maxRetries: number
  retryDelay: number
  backoff: BackoffStrategy
  onRetry?: (attempt: number, remaining: number) => void
}

export interface LabResult {
  state: LabState
  scenario: LabScenario
  status: number
  requestId?: string
  attempt: number
  duration: number
  method: string
  url: string
  responseBody: unknown
}

function backoffDelay(strategy: BackoffStrategy, base: number, attempt: number): number {
  if (strategy === 'linear') return base * attempt
  if (strategy === 'exponential') return base * Math.pow(2, attempt - 1)
  return base
}

export async function sendLabRequest(options: LabRequestOptions): Promise<LabResult> {
  const startedAt = performance.now()
  const maxAttempts = 1 + Math.max(0, options.maxRetries)
  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1
    try {
      const response = await client.get('/lab/request', {
        params: {
          scenario: options.scenario,
          payloadSize: options.payloadSize,
          delay: options.delay ?? 0,
          statusCode: options.statusCode,
          attempt,
        },
      })
      const duration = Math.round(performance.now() - startedAt)
      const state: LabState = options.scenario === 'empty' ? 'empty' : options.scenario === 'partial' ? 'partial' : 'success'
      return {
        state,
        scenario: options.scenario,
        status: response.status,
        requestId: (response.data as { requestId?: string }).requestId,
        attempt,
        duration,
        method: 'GET',
        url: '/api/lab/request',
        responseBody: response.data,
      }
    } catch (error) {
      const axiosError = error as AxiosError<{ requestId?: string }>
      const status = axiosError.response?.status ?? 0
      const remaining = maxAttempts - attempt
      if (options.scenario === 'retry' && attempt < maxAttempts) {
        options.onRetry?.(attempt, remaining)
        await new Promise((resolve) => setTimeout(resolve, backoffDelay(options.backoff, options.retryDelay, attempt)))
        continue
      }
      const duration = Math.round(performance.now() - startedAt)
      const state: LabState = options.scenario === 'retry' ? 'retryExhausted' : 'error'
      return {
        state,
        scenario: options.scenario,
        status,
        requestId: axiosError.response?.data?.requestId,
        attempt,
        duration,
        method: 'GET',
        url: '/api/lab/request',
        responseBody: axiosError.response?.data ?? { message: axiosError.message },
      }
    }
  }
}
