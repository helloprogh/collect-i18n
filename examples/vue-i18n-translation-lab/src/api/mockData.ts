// Deterministic in-memory data for the local axios mock adapter.
// No randomness: every value is derived from an index so requests are reproducible.

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled' | 'refunded' | 'completed'
export type CustomerLevel = 'vip' | 'normal' | 'new'

export interface OrderItem {
  id: string
  orderNo: string
  customer: string
  level: CustomerLevel
  status: OrderStatus
  amount: number
  createdAt: string
  contact: string
  paymentMethod: string
  address: string
  remark: string
  items: Array<{ product: string; quantity: number; price: number }>
}

const CUSTOMERS = ['Acme Co.', 'Globex', 'Initech', 'Umbrella', 'Soylent', 'Hooli', 'Pied Piper', 'Stark Industries']
const PRODUCTS = ['Sync Agent', 'Data Pipeline', 'Stream Connector', 'Edge Runtime', 'Schema Mapper', 'Batch Worker']
const STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'cancelled', 'refunded', 'completed']
const LEVELS: CustomerLevel[] = ['vip', 'normal', 'new']
const PAYMENTS = ['credit_card', 'alipay', 'wechat', 'bank_transfer']

function pad(value: number, size: number): string {
  return String(value).padStart(size, '0')
}

function buildOrders(): OrderItem[] {
  const orders: OrderItem[] = []
  for (let index = 0; index < 48; index += 1) {
    const status = STATUSES[index % STATUSES.length]!
    const level = LEVELS[index % LEVELS.length]!
    const customer = CUSTOMERS[index % CUSTOMERS.length]!
    const day = pad((index % 27) + 1, 2)
    const month = pad((index % 12) + 1, 2)
    const itemCount = (index % 3) + 1
    orders.push({
      id: `ord-${1000 + index}`,
      orderNo: `SO${20260000 + index}`,
      customer,
      level,
      status,
      amount: Math.round((index + 1) * 12.5 * 100) / 100,
      createdAt: `2026-${month}-${day}`,
      contact: `+1 555 01${pad(index % 100, 2)}`,
      paymentMethod: PAYMENTS[index % PAYMENTS.length]!,
      address: `${100 + index} Market St, Suite ${index % 20 + 1}`,
      remark: index % 4 === 0 ? 'Priority handling' : '',
      items: Array.from({ length: itemCount }, (_, itemIndex) => ({
        product: PRODUCTS[(index + itemIndex) % PRODUCTS.length]!,
        quantity: ((index + itemIndex) % 5) + 1,
        price: Math.round(((index + 1) * 3.2 + itemIndex) * 100) / 100,
      })),
    })
  }
  return orders
}

export const ordersStore: OrderItem[] = buildOrders()

export type RoleStatus = 'enabled' | 'disabled'
export interface Role {
  id: string
  name: string
  code: string
  description: string
  status: RoleStatus
  memberCount: number
}

const initialRoles: Role[] = [
  { id: 'role-1', name: 'Administrator', code: 'admin', description: 'Full access to all modules', status: 'enabled', memberCount: 2 },
  { id: 'role-2', name: 'Order manager', code: 'order_manager', description: 'Manage orders and customers', status: 'enabled', memberCount: 5 },
  { id: 'role-3', name: 'Operator', code: 'operator', description: 'Run sync tasks and view logs', status: 'enabled', memberCount: 8 },
  { id: 'role-4', name: 'Auditor', code: 'auditor', description: 'Read-only access to audit data', status: 'disabled', memberCount: 3 },
  { id: 'role-5', name: 'Billing', code: 'billing', description: 'Manage invoices and payments', status: 'enabled', memberCount: 2 },
]

export const rolesStore: Role[] = [...initialRoles]

export interface PermissionNode {
  id: string
  label: string
  category: string
  children?: PermissionNode[]
}

const CATEGORY_DEFS: Array<{ code: string; name: string }> = [
  { code: 'dashboard', name: 'dashboard' },
  { code: 'orders', name: 'orders' },
  { code: 'permissions', name: 'permissions' },
  { code: 'settings', name: 'settings' },
  { code: 'notifications', name: 'notifications' },
]

const NODE_DEFS = ['view', 'create', 'edit', 'delete', 'export', 'approve']

export function buildPermissionTree(): PermissionNode[] {
  return CATEGORY_DEFS.map((category) => ({
    id: `cat-${category.code}`,
    label: category.name,
    category: category.name,
    children: NODE_DEFS.map((node) => ({
      id: `${category.code}.${node}`,
      label: node,
      category: category.name,
    })),
  }))
}

export interface RoleMember {
  id: string
  name: string
  dept: string
  joinedAt: string
}

const MEMBER_NAMES = ['Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank', 'Grace', 'Henry']
const DEPTS = ['Engineering', 'Operations', 'Finance', 'Support']

export function buildMembers(roleId: string): RoleMember[] {
  const seed = Math.abs(hashCode(roleId))
  const count = (seed % 4) + 2
  return Array.from({ length: count }, (_, index) => ({
    id: `${roleId}-m-${index}`,
    name: MEMBER_NAMES[(seed + index) % MEMBER_NAMES.length]!,
    dept: DEPTS[(seed + index) % DEPTS.length]!,
    joinedAt: `2026-${pad((index % 12) + 1, 2)}-${pad((index % 27) + 1, 2)}`,
  }))
}

export interface OperationLog {
  id: string
  operator: string
  action: string
  target: string
  time: string
  result: 'success' | 'failed'
}

const ACTIONS = ['create', 'edit', 'delete', 'export', 'approve', 'disable', 'enable']
const TARGETS = ['role:admin', 'role:order_manager', 'order:SO20260001', 'permission:orders.edit', 'role:auditor']

export function buildOperationLogs(): OperationLog[] {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `log-${index}`,
    operator: MEMBER_NAMES[index % MEMBER_NAMES.length]!,
    action: ACTIONS[index % ACTIONS.length]!,
    target: TARGETS[index % TARGETS.length]!,
    time: `2026-07-${pad(20 - index, 2)} ${pad(9 + index, 2)}:${pad((index * 7) % 60, 2)}`,
    result: index % 5 === 0 ? 'failed' : 'success',
  }))
}

function hashCode(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return hash
}
