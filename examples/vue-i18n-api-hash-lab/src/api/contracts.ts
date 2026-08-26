// ---------------------------------------------------------------------------
// API 契约(与 vite.config.ts 中 configureServer 中间件同步)。
// 这是采集器/Agent 编写 TriggerPlan mock 的唯一契约依据:
// 1) 所有字段类型与名称以本文件为准;
// 2) 接口路径/方法/延迟见端点注释;
// 3) 错误响应统一 { code, message, requestId }。
// ---------------------------------------------------------------------------

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled'

export interface OrderItem {
  id: string
  product: string
  quantity: number
  price: number
}

export interface Order {
  id: string
  orderNo: string
  customer: string
  status: OrderStatus
  amount: number
  paidAt: string
  createdAt: string
  items: OrderItem[]
}

// GET /api/orders?page=1&pageSize=10  -> 200
// 分页列表;total 为全量订单数。
export interface OrdersPayload {
  items: Order[]
  total: number
  page: number
  pageSize: number
}

export interface Product {
  id: string
  name: string
  category: string
  price: number
  stock: number
  online: boolean
}

// GET /api/products?category=外设 -> 200
export interface ProductsPayload {
  items: Product[]
  total: number
}

export interface DashboardMetric {
  key: string
  value: number
  unit: string
  trend: string
}

// GET /api/dashboard -> 200
// metrics[].key 决定动态词条 key:dashboard.metric.<key>;动态 key 见 locales。
export interface DashboardPayload {
  metrics: DashboardMetric[]
  updatedAt: string
}

// POST /api/orders -> 201 { ok: true, id }
// 请求体:SubmitOrderPayload;校验失败 422 { code: 'VALIDATION_FAILED' }。
export interface SubmitOrderPayload {
  orderNo: string
  customer: string
  amount: number
}

// POST /api/login -> 200 { ok, username, token }
// 请求体:LoginPayload;失败 401 { code: 'LOGIN_FAILED' }。
export interface LoginPayload {
  username: string
  password: string
}

// GET /api/boom -> 500;供错误态词条与 mock 验证使用。
export interface ApiErrorBody {
  code: string
  message: string
  requestId: string
}
