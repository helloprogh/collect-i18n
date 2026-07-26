import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import {
  buildMembers,
  buildOperationLogs,
  buildPermissionTree,
  ordersStore,
  rolesStore,
  type OrderItem,
  type OrderStatus,
  type Role,
} from './mockData'

type LabScenario = 'success' | 'error' | 'partial' | 'retry' | 'empty' | 'slow'

interface LabParams {
  scenario: LabScenario
  payloadSize?: 'small' | 'medium' | 'large'
  delay?: number
  statusCode?: number
  attempt?: number
}

const RETRY_SUCCEEDS_ON = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ok<T>(config: InternalAxiosRequestConfig, data: T, status = 200, delay = 220): Promise<AxiosResponse<T>> {
  return sleep(delay).then(() => ({
    data,
    status,
    statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : status === 206 ? 'Partial Content' : 'OK',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    config,
    request: {},
  })) as unknown as Promise<AxiosResponse<T>>
}

function fail(config: InternalAxiosRequestConfig, status: number, payload: unknown, delay = 220): Promise<AxiosResponse> {
  return sleep(delay).then(() => {
    const error: { response: AxiosResponse; isAxiosError: true; config: InternalAxiosRequestConfig } = {
      response: {
        data: payload,
        status,
        statusText: status === 500 ? 'Internal Server Error' : status === 422 ? 'Unprocessable Entity' : 'Error',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        config,
        request: {},
      },
      isAxiosError: true,
      config,
    }
    throw Object.assign(new Error(`Request failed with status code ${status}`), error)
  }) as unknown as Promise<AxiosResponse>
}

function requestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`
}

function labPayload(size: LabParams['payloadSize']) {
  const count = size === 'large' ? 100 : size === 'medium' ? 20 : 5
  return {
    items: Array.from({ length: count }, (_, index) => ({ id: index, name: `item-${index}`, ok: true })),
    count,
  }
}

function handleLabRequest(config: InternalAxiosRequestConfig, params: LabParams): Promise<AxiosResponse> {
  const attempt = Number(params.attempt ?? 1)
  const delay = Number(params.delay ?? 0)
  const baseDelay = params.scenario === 'slow' ? 1500 : 220 + delay
  const id = requestId('lab')

  if (params.statusCode) {
    return fail(config, params.statusCode, { requestId: id, code: 'OVERRIDE', message: 'status overridden' }, baseDelay)
  }

  switch (params.scenario) {
    case 'success':
      return ok(config, { requestId: id, ...labPayload(params.payloadSize) }, 200, baseDelay)
    case 'empty':
      return ok(config, { requestId: id, items: [], count: 0 }, 200, baseDelay)
    case 'partial': {
      const payload = labPayload(params.payloadSize)
      const failed = Math.max(1, Math.floor(payload.count / 4))
      return ok(config, {
        requestId: id,
        items: payload.items.map((item, index) => ({ ...item, ok: index % failed === 0 ? false : item.ok })),
        summary: { success: payload.count - failed, failed },
      }, 206, baseDelay)
    }
    case 'error':
      return fail(config, 500, { requestId: id, code: 'INTERNAL_ERROR', message: 'deterministic server error' }, baseDelay)
    case 'retry':
      return attempt < RETRY_SUCCEEDS_ON
        ? fail(config, 500, { requestId: id, code: 'RETRYABLE', message: `attempt ${attempt} failed` }, baseDelay)
        : ok(config, { requestId: id, ...labPayload(params.payloadSize) }, 200, baseDelay)
    case 'slow':
      return ok(config, { requestId: id, ...labPayload(params.payloadSize) }, 200, baseDelay)
    default:
      return ok(config, { requestId: id, ...labPayload(params.payloadSize) }, 200, baseDelay)
  }
}

function matchOrders(params: Record<string, unknown>): { items: OrderItem[]; total: number } {
  const search = String(params.search ?? '').trim().toLowerCase()
  const status = params.status ? String(params.status) : ''
  const level = params.level ? String(params.level) : ''
  let filtered = ordersStore.slice()
  if (search) filtered = filtered.filter((order) => order.orderNo.toLowerCase().includes(search) || order.customer.toLowerCase().includes(search))
  if (status) filtered = filtered.filter((order) => order.status === status)
  if (level) filtered = filtered.filter((order) => order.level === level)
  const page = Math.max(1, Number(params.page ?? 1))
  const pageSize = Math.max(1, Number(params.pageSize ?? 10))
  const start = (page - 1) * pageSize
  return { items: filtered.slice(start, start + pageSize), total: filtered.length }
}

export const mockAdapter: AxiosAdapter = async (config) => {
  const rawUrl = config.url ?? ''
  const url = rawUrl.split('?')[0]!.replace(/\/+$/, '')
  const method = (config.method ?? 'get').toLowerCase()
  const params = (config.params ?? {}) as Record<string, unknown>
  const body = config.data ? (typeof config.data === 'string' ? JSON.parse(config.data) : config.data) : {}

  // Request lab
  if (url === '/lab/request' && method === 'get') {
    return handleLabRequest(config, {
      scenario: (String(params.scenario ?? 'success')) as LabScenario,
      payloadSize: (params.payloadSize ?? 'small') as LabParams['payloadSize'],
      delay: Number(params.delay ?? 0),
      statusCode: params.statusCode ? Number(params.statusCode) : undefined,
      attempt: Number(params.attempt ?? 1),
    })
  }

  // Orders
  if (url === '/orders' && method === 'get') {
    const scenario = String(params.scenario ?? 'success')
    if (scenario === 'error') return fail(config, 500, { code: 'ORDERS_UNAVAILABLE', requestId: requestId('ord') })
    const delay = scenario === 'slow' ? 1200 : 260
    const result = matchOrders(params)
    return ok(config, { ...result, page: Number(params.page ?? 1), pageSize: Number(params.pageSize ?? 10) }, 200, delay)
  }
  if (url === '/orders/export' && method === 'post') return ok(config, { exported: true, count: ordersStore.length }, 200, 400)
  const orderAction = url.match(/^\/orders\/([^/]+)\/(cancel|reprint)$/)
  if (orderAction && method === 'post') {
    const action = orderAction[2]
    if (action === 'cancel') return ok(config, { id: orderAction[1], status: 'cancelled' as OrderStatus }, 200, 300)
    return ok(config, { id: orderAction[1], printed: true }, 200, 300)
  }

  // Permissions - roles
  if (url === '/roles' && method === 'get') return ok(config, rolesStore.slice(), 200, 220)
  if (url === '/roles' && method === 'post') {
    const role = body as Partial<Role>
    const created: Role = {
      id: `role-${Date.now().toString(36)}`,
      name: String(role.name ?? ''),
      code: String(role.code ?? ''),
      description: String(role.description ?? ''),
      status: role.status ?? 'enabled',
      memberCount: 0,
    }
    rolesStore.unshift(created)
    return ok(config, created, 201, 260)
  }
  const roleMatch = url.match(/^\/roles\/([^/]+)$/)
  if (roleMatch) {
    const id = roleMatch[1]!
    if (method === 'put') {
      const update = body as Partial<Role>
      const index = rolesStore.findIndex((role) => role.id === id)
      if (index >= 0) rolesStore[index] = { ...rolesStore[index]!, ...update, id }
      return ok(config, rolesStore[index] ?? null, 200, 260)
    }
    if (method === 'delete') {
      const role = rolesStore.find((item) => item.id === id)
      if (role && role.memberCount > 0) return fail(config, 422, { code: 'ROLE_HAS_MEMBERS', requestId: requestId('role') })
      const index = rolesStore.findIndex((item) => item.id === id)
      if (index >= 0) rolesStore.splice(index, 1)
      return ok(config, { id }, 200, 260)
    }
  }
  if (url === '/roles' && method === 'put') {
    return ok(config, body, 200, 220)
  }
  const membersMatch = url.match(/^\/roles\/([^/]+)\/members$/)
  if (membersMatch && method === 'get') return ok(config, buildMembers(membersMatch[1]!), 200, 240)

  // Permissions - tree
  if (url === '/permissions/tree' && method === 'get') return ok(config, buildPermissionTree(), 200, 240)
  if (url === '/permissions/tree' && method === 'put') return ok(config, { saved: true, ids: (body as { ids?: string[] }).ids ?? [] }, 200, 300)

  // Permissions - operation log
  if (url === '/operations/log' && method === 'get') return ok(config, buildOperationLogs(), 200, 240)

  // Onboarding
  if (url === '/onboarding' && method === 'post') {
    return ok(config, { id: `ONB-${Date.now().toString(36).toUpperCase()}` }, 201, 500)
  }

  return fail(config, 404, { code: 'NOT_FOUND', path: url })
}
