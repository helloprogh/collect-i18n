import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import type { IncomingMessage, ServerResponse } from 'node:http'

// ---------------------------------------------------------------------------
// API 契约(与 src/api/contracts.ts 同步)。
// 本中间件构成测试项目的"真实后端":所有接口走真实 HTTP 请求,300-800ms 延迟,
// JSON 响应,Content-Type: application/json。契约字段以源码为准,Agent 编写
// TriggerPlan mock 时以本文件与 src/api/contracts.ts 为依据。
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
export interface DashboardPayload {
  metrics: DashboardMetric[]
  updatedAt: string
}
export interface SubmitOrderPayload {
  orderNo: string
  customer: string
  amount: number
}
export interface LoginPayload {
  username: string
  password: string
}
export interface ApiErrorBody {
  code: string
  message: string
  requestId: string
}

const NAMES = ['王小明', '李芳', '张伟', '刘洋', '陈静', '杨磊', '赵敏', '黄强', '周婷', '吴磊', '徐丽', '孙浩', '马超', '朱琳', '胡军', '郭芳', '林杰', '何欣', '高翔', '罗云']
const PRODUCTS = [
  { name: '机械键盘 K87', category: '外设', price: 399, stock: 120 },
  { name: '无线鼠标 M590', category: '外设', price: 189, stock: 240 },
  { name: '27 寸显示器', category: '显示器', price: 1599, stock: 45 },
  { name: 'USB-C 扩展坞', category: '配件', price: 329, stock: 88 },
  { name: '笔记本支架', category: '配件', price: 149, stock: 320 },
  { name: '降噪耳机 Pro', category: '音频', price: 899, stock: 66 },
  { name: '桌面音箱 2.0', category: '音频', price: 459, stock: 54 },
  { name: '4K 摄像头', category: '外设', price: 599, stock: 38 },
  { name: '人体工学椅', category: '家具', price: 1999, stock: 21 },
  { name: '升降桌 140cm', category: '家具', price: 2499, stock: 15 },
]
const STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'delivered', 'cancelled']

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}
function isoDay(offset: number): string {
  const date = new Date(Date.now() - offset * 86_400_000)
  return date.toISOString().slice(0, 10)
}
function orderRows(): Order[] {
  const rows: Order[] = []
  for (let index = 0; index < 137; index += 1) {
    const status = STATUSES[index % STATUSES.length]
    const itemCount = 1 + (index % 4)
    const items: OrderItem[] = Array.from({ length: itemCount }, (_, itemIndex) => {
      const product = PRODUCTS[(index + itemIndex) % PRODUCTS.length]
      return {
        id: `item-${index}-${itemIndex}`,
        product: product.name,
        quantity: 1 + ((index + itemIndex) % 3),
        price: product.price,
      }
    })
    const amount = Number(items.reduce((sum, item) => sum + item.quantity * item.price, 0).toFixed(2))
    rows.push({
      id: `ord-${pad(index + 1, 5)}`,
      orderNo: `ORD2026${pad(index + 1, 4)}`,
      customer: NAMES[index % NAMES.length],
      status,
      amount,
      paidAt: status === 'pending' ? '' : isoDay(index % 30),
      createdAt: isoDay(index % 60),
      items,
    })
  }
  return rows
}

const ORDERS = orderRows()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
function requestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}
function parseQuery(url: string | undefined): Record<string, string> {
  const query: Record<string, string> = {}
  const raw = url?.split('?')[1]
  if (!raw) return query
  for (const pair of raw.split('&')) {
    const [key, value = ''] = pair.split('=')
    if (key) query[decodeURIComponent(key)] = decodeURIComponent(value)
  }
  return query
}

function apiPlugin(): Plugin {
  return {
    name: 'api-hash-lab-middleware',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? ''
        const path = url.split('?')[0]
        const method = (req.method ?? 'GET').toUpperCase()

        if (!path.startsWith('/api/')) {
          next() // 非 API 请求放行给 Vite 继续处理
          return
        }

        const delay = 300 + Math.floor(Math.random() * 500) // 300-800ms: 制造 loading 态
        await sleep(delay)

        // GET /api/orders?page=&pageSize=  —— el-table + v-loading 分页
        if (method === 'GET' && path === '/api/orders') {
          const query = parseQuery(url)
          const page = Number(query.page ?? '1') || 1
          const pageSize = Number(query.pageSize ?? '10') || 10
          const start = (page - 1) * pageSize
          const payload: OrdersPayload = {
            items: ORDERS.slice(start, start + pageSize),
            total: ORDERS.length,
            page,
            pageSize,
          }
          sendJson(res, 200, payload)
          return
        }

        // GET /api/products?category=  —— 自定义 spinner + el-select 筛选
        if (method === 'GET' && path === '/api/products') {
          const query = parseQuery(url)
          const category = query.category ?? ''
          const filtered = PRODUCTS.map((product, index) => ({
            id: `sku-${pad(index + 1, 3)}`,
            name: product.name,
            category: product.category,
            price: product.price,
            stock: product.stock,
            online: index % 5 !== 3,
          })).filter((product) => !category || product.category === category)
          const payload: ProductsPayload = { items: filtered, total: filtered.length }
          sendJson(res, 200, payload)
          return
        }

        // GET /api/dashboard —— 指标卡动态 key
        if (method === 'GET' && path === '/api/dashboard') {
          const metrics: DashboardMetric[] = [
            { key: 'revenue', value: 286400, unit: '元', trend: '+12.4%' },
            { key: 'orders', value: 137, unit: '单', trend: '+8.1%' },
            { key: 'users', value: 3284, unit: '人', trend: '+5.6%' },
            { key: 'conversion', value: 3.8, unit: '%', trend: '-0.2%' },
            { key: 'refundRate', value: 0.9, unit: '%', trend: '-0.3%' },
          ]
          const payload: DashboardPayload = { metrics, updatedAt: new Date().toISOString() }
          sendJson(res, 200, payload)
          return
        }

        // POST /api/orders —— 提交新订单(ElMessageBox.confirm 后调用)
        if (method === 'POST' && path === '/api/orders') {
          const raw = await readBody(req)
          let input: SubmitOrderPayload
          try {
            input = JSON.parse(raw || '{}') as SubmitOrderPayload
          } catch {
            sendJson(res, 400, { code: 'BAD_REQUEST', message: '无效的请求体', requestId: requestId('err') } satisfies ApiErrorBody)
            return
          }
          if (!input.orderNo || !input.customer || !(input.amount > 0)) {
            sendJson(res, 422, { code: 'VALIDATION_FAILED', message: '订单字段不完整', requestId: requestId('err') } satisfies ApiErrorBody)
            return
          }
          const created: Order = {
            id: `ord-${pad(ORDERS.length + 1, 5)}`,
            orderNo: input.orderNo,
            customer: input.customer,
            status: 'pending',
            amount: Number(input.amount.toFixed(2)),
            paidAt: '',
            createdAt: new Date().toISOString().slice(0, 10),
            items: [],
          }
          ORDERS.unshift(created)
          sendJson(res, 201, { ok: true, id: created.id })
          return
        }

        // GET /api/boom —— 500 + JSON 错误体(错误态词条与 mock 验证)
        if (method === 'GET' && path === '/api/boom') {
          const body: ApiErrorBody = { code: 'BOOM_ERROR', message: '模拟服务端异常:后端炸了', requestId: requestId('boom') }
          sendJson(res, 500, body)
          return
        }

        // POST /api/login —— LoginView 登录(按钮 loading 与失败提示)
        if (method === 'POST' && path === '/api/login') {
          const raw = await readBody(req)
          let input: LoginPayload
          try {
            input = JSON.parse(raw || '{}') as LoginPayload
          } catch {
            sendJson(res, 400, { code: 'BAD_REQUEST', message: '无效的请求体', requestId: requestId('err') } satisfies ApiErrorBody)
            return
          }
          if (!input.username || !input.password) {
            sendJson(res, 422, { code: 'VALIDATION_FAILED', message: '请输入账号和密码', requestId: requestId('err') } satisfies ApiErrorBody)
            return
          }
          if (input.password.length < 6) {
            sendJson(res, 401, { code: 'LOGIN_FAILED', message: '用户名或密码错误', requestId: requestId('login') } satisfies ApiErrorBody)
            return
          }
          sendJson(res, 200, { ok: true, username: input.username, token: `token-${requestId('tok')}` })
          return
        }

        sendJson(res, 404, { code: 'NOT_FOUND', message: `未知接口 ${method} ${path}`, requestId: requestId('err') } satisfies ApiErrorBody)
      })
    },
  }
}

export default defineConfig({
  base: '/lab/',
  plugins: [vue(), apiPlugin()],
  server: { port: 5174, strictPort: true, host: '127.0.0.1' },
})
