import axios, { AxiosError, type AxiosInstance } from 'axios'
import type {
  ApiErrorBody,
  DashboardMetric,
  DashboardPayload,
  LoginPayload,
  Order,
  OrdersPayload,
  OrderStatus,
  Product,
  ProductsPayload,
  SubmitOrderPayload,
} from './contracts'

// 真实 HTTP 请求:baseURL 走 vite configureServer 中间件(/api/*)。
// 中间件端点契约见 vite.config.ts 顶部注释与 contracts.ts。
const http: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
})

export interface ApiErrorInfo {
  code: string
  message?: string
  requestId?: string
}

export function getApiError(error: unknown): ApiErrorInfo {
  if (error instanceof AxiosError) {
    const body = error.response?.data as ApiErrorBody | undefined
    if (body?.code) return { code: body.code, message: body.message, requestId: body.requestId }
    return { code: 'NETWORK_ERROR' }
  }
  return { code: 'UNKNOWN_ERROR' }
}

// GET /api/orders?page=&pageSize=
export async function listOrders(page: number, pageSize: number): Promise<OrdersPayload> {
  const response = await http.get<OrdersPayload>('/orders', { params: { page, pageSize } })
  return response.data
}

// GET /api/products?category=
export async function listProducts(category = ''): Promise<ProductsPayload> {
  const response = await http.get<ProductsPayload>('/products', { params: { category } })
  return response.data
}

// GET /api/dashboard
export async function fetchDashboard(): Promise<DashboardPayload> {
  const response = await http.get<DashboardPayload>('/dashboard')
  return response.data
}

// POST /api/orders
export async function submitOrder(input: SubmitOrderPayload): Promise<{ ok: true; id: string }> {
  const response = await http.post<{ ok: true; id: string }>('/orders', input)
  return response.data
}

// POST /api/login
export async function login(input: LoginPayload): Promise<{ ok: true; username: string; token: string }> {
  const response = await http.post<{ ok: true; username: string; token: string }>('/login', input)
  return response.data
}

// GET /api/boom —— 仅用于演示错误态;成功时不该被调用。
export async function triggerBoom(): Promise<never> {
  const response = await http.get<ApiErrorBody>('/boom')
  throw new Error('Unexpected success: ' + JSON.stringify(response.data))
}

export type { DashboardMetric, Order, OrdersPayload, OrderStatus, Product, ProductsPayload }
