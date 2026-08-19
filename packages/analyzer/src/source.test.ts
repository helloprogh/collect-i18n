import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { scanProjectSources } from './index.js'

const workspaces: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'collect-i18n-source-'))
  workspaces.push(root)
  await mkdir(path.join(root, 'src', 'views', 'users'), { recursive: true })
  return root
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) =>
      rm(workspace, { recursive: true, force: true }),
    ),
  )
})

describe('Vue and TypeScript source analysis', () => {
  it('classifies DOM, text, component props, validation, and services', async () => {
    const root = await createWorkspace()
    await writeFile(
      path.join(root, 'src', 'views', 'users', 'Create.vue'),
      `<script setup lang="ts">
const { t } = useI18n()
const rules = { name: [{ required: true, message: t('users.name.required'), trigger: 'blur' }] }
function save() { ElMessage.error(t('users.save.failed')) }
</script>
<template>
  <main>
    <h1>{{ t('users.create.title') }}</h1>
    <el-input :placeholder="t('users.name.placeholder')" />
    <button id="save" @click="save">{{ t('common.save') }}</button>
    <span :title="t('users.name.help')">?</span>
  </main>
</template>`,
    )

    const result = await scanProjectSources({ projectRoot: root })
    const byKey = new Map(
      result.occurrences.map((occurrence) => [occurrence.keyPath, occurrence]),
    )
    expect(byKey.get('users.create.title')?.kind).toBe('text_range')
    expect(byKey.get('users.name.placeholder')).toMatchObject({
      kind: 'component_prop',
      component: 'el-input',
      property: 'placeholder',
    })
    expect(byKey.get('users.name.help')?.kind).toBe('native_dom')
    expect(byKey.get('users.name.required')?.actionHints[0]).toMatchObject({
      kind: 'blur',
      source: 'validation_rule',
    })
    expect(byKey.get('users.save.failed')).toMatchObject({
      kind: 'imperative_service',
      service: 'ElMessage',
      serviceMethod: 'error',
      teleported: true,
    })
    expect(byKey.get('common.save')?.actionHints).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'click' })]),
    )
  })

  it('finds configured routes, navigation calls, and dynamic keys', async () => {
    const root = await createWorkspace()
    await writeFile(
      path.join(root, 'src', 'router.ts'),
      `const routes = [{ path: '/users/create', component: () => import('./views/users/Create.vue') }]
router.push('/users')
const label = t(resolveKey())`,
    )

    const result = await scanProjectSources({ projectRoot: root })
    expect(result.routeHints.map((hint) => hint.path)).toEqual(
      expect.arrayContaining(['/users/create', '/users']),
    )
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'dynamic_translation_key' }),
      ]),
    )
  })

  it('detects hash and history router modes from vue-router factories', async () => {
    const root = await createWorkspace()
    await writeFile(
      path.join(root, 'src', 'router.ts'),
      `import { createRouter, createWebHashHistory } from 'vue-router'
const router = createRouter({ history: createWebHashHistory(), routes: [] })
router.push('/users')`,
    )
    expect((await scanProjectSources({ projectRoot: root })).routerMode).toBe('hash')

    await writeFile(
      path.join(root, 'src', 'router.ts'),
      `import { createWebHistory } from 'vue-router'
createWebHistory()`,
    )
    expect((await scanProjectSources({ projectRoot: root })).routerMode).toBe('history')

    await writeFile(path.join(root, 'src', 'router.ts'), 'export default []')
    expect((await scanProjectSources({ projectRoot: root })).routerMode).toBeUndefined()
  })

  it('enumerates bounded message-key maps and propagates the importing view route', async () => {
    const root = await createWorkspace()
    await mkdir(path.join(root, 'src', 'services'), { recursive: true })
    await mkdir(path.join(root, 'src', 'router'), { recursive: true })
    await writeFile(
      path.join(root, 'src', 'services', 'ticketMessages.js'),
      `const MESSAGE_KEYS = {
  assigned: 'tickets.messages.assigned',
  closed: 'tickets.messages.closed',
}
const ERROR_KEYS = {
  conflict: 'tickets.errors.conflict',
  unavailable: 'tickets.errors.unavailable',
}
export const messageFor = (t, action) => t(MESSAGE_KEYS[action])
export const errorFor = (t, code) => t(ERROR_KEYS[code])`,
    )
    await writeFile(
      path.join(root, 'src', 'views', 'TicketsView.vue'),
      `<script setup>import { messageFor } from '../services/ticketMessages.js'</script>
<template><button @click="messageFor(t, 'assigned')">{{ t('tickets.title') }}</button></template>`,
    )
    await writeFile(
      path.join(root, 'src', 'router', 'index.ts'),
      `import TicketsView from '../views/TicketsView.vue'
const routes = [{ path: '/tickets', component: TicketsView }]`,
    )

    const result = await scanProjectSources({ projectRoot: root })
    const mapped = result.occurrences.filter((occurrence) =>
      occurrence.keyPath.startsWith('tickets.messages.') ||
      occurrence.keyPath.startsWith('tickets.errors.'),
    )

    expect(mapped.map((occurrence) => occurrence.keyPath).sort()).toEqual([
      'tickets.errors.conflict',
      'tickets.errors.unavailable',
      'tickets.messages.assigned',
      'tickets.messages.closed',
    ])
    expect(mapped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dynamic: true,
          routeHints: expect.arrayContaining([
            expect.objectContaining({ path: '/tickets', confidence: 0.99 }),
          ]),
        }),
      ]),
    )
    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'dynamic_translation_key' }),
      ]),
    )
  })

  it('uses the locale catalog to expand template prefixes and exact key literals', async () => {
    const root = await createWorkspace()
    await writeFile(
      path.join(root, 'src', 'views', 'users', 'Create.vue'),
      `<script setup>
const status = 'pending'
const options = [{ key: 'orders.actions.approve' }, { key: 'orders.actions.reject' }]
</script>
<template><p>{{ t(\`orders.status.\${status}\`) }}</p><button v-for="item in options">{{ t(item.key) }}</button></template>`,
    )

    const result = await scanProjectSources({
      projectRoot: root,
      catalogKeys: [
        'orders.status.pending',
        'orders.status.completed',
        'orders.actions.approve',
        'orders.actions.reject',
        'other.unrelated',
      ],
    })
    const keys = new Set(result.occurrences.map((occurrence) => occurrence.keyPath))
    expect([...keys]).toEqual(expect.arrayContaining([
      'orders.status.pending',
      'orders.status.completed',
      'orders.actions.approve',
      'orders.actions.reject',
    ]))
    expect(keys.has('other.unrelated')).toBe(false)
  })

  it('attaches a statically imported route to occurrences in its Vue component', async () => {
    const root = await createWorkspace()
    await mkdir(path.join(root, 'src', 'router'), { recursive: true })
    await writeFile(
      path.join(root, 'src', 'views', 'JobsView.vue'),
      `<template><h1>{{ t('jobs.title') }}</h1></template>`,
    )
    await writeFile(
      path.join(root, 'src', 'router', 'index.ts'),
      `import JobsView from '../views/JobsView.vue'
const routes = [{ path: '/jobs', component: JobsView }]`,
    )

    const result = await scanProjectSources({ projectRoot: root })
    const occurrence = result.occurrences.find(
      (candidate) => candidate.keyPath === 'jobs.title',
    )
    expect(occurrence?.routeHints[0]).toMatchObject({
      path: '/jobs',
      source: 'router_config',
      confidence: 0.99,
    })
    expect(occurrence?.routeHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/JobsView', source: 'filename' }),
      ]),
    )
  })

  it('resolves lazy and imported components through nested routes', async () => {
    const root = await createWorkspace()
    await mkdir(path.join(root, 'src', 'router'), { recursive: true })
    await Promise.all([
      writeFile(
        path.join(root, 'src', 'views', 'AdminLayout.vue'),
        `<template><span>{{ t('admin.title') }}</span></template>`,
      ),
      writeFile(
        path.join(root, 'src', 'views', 'JobsView.vue'),
        `<template><span>{{ t('jobs.list') }}</span></template>`,
      ),
      writeFile(
        path.join(root, 'src', 'views', 'JobDetail.vue'),
        `<template><span>{{ t('jobs.detail') }}</span></template>`,
      ),
    ])
    await writeFile(
      path.join(root, 'src', 'router', 'index.ts'),
      `import JobDetail from '@/views/JobDetail.vue'
const routes = [{
  path: '/admin',
  component: () => import('../views/AdminLayout.vue'),
  children: [
    { path: 'jobs', component: () => import('../views/JobsView.vue') },
    { path: 'jobs/:id', component: JobDetail }
  ]
}]`,
    )

    const result = await scanProjectSources({ projectRoot: root })
    const firstRoute = (keyPath: string): string | undefined =>
      result.occurrences.find((item) => item.keyPath === keyPath)?.routeHints[0]
        ?.path
    expect(firstRoute('admin.title')).toBe('/admin')
    expect(firstRoute('jobs.list')).toBe('/admin/jobs')
    expect(firstRoute('jobs.detail')).toBe('/admin/jobs/:id')
    expect(result.routeHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/admin/jobs',
          source: 'router_config',
        }),
      ]),
    )
  })

  it('resolves many top-level lazy component bindings without rescanning large literals', async () => {
    const root = await createWorkspace()
    await mkdir(path.join(root, 'src', 'views'), { recursive: true })
    const viewCount = 12
    await Promise.all(
      Array.from({ length: viewCount }, (_, index) =>
        writeFile(
          path.join(root, 'src', 'views', `View${index}.vue`),
          `<template><span>{{ t('v${index}.title') }}</span></template>`,
        ),
      ),
    )
    const bindings = Array.from(
      { length: viewCount },
      (_, index) => `const View${index} = () => import('./views/View${index}.vue')`,
    ).join('\n')
    const routeEntries = Array.from(
      { length: viewCount },
      (_, index) => `{ path: '/v${index}', component: View${index} },`,
    ).join('\n')
    await writeFile(
      path.join(root, 'src', 'router.ts'),
      `${bindings}\nconst routes = [\n${routeEntries}\n]`,
    )

    const result = await scanProjectSources({ projectRoot: root })
    expect(result.routeHints).toEqual(
      expect.arrayContaining(
        Array.from({ length: viewCount }, (_, index) =>
          expect.objectContaining({ path: `/v${index}` }),
        ),
      ),
    )
    expect(
      result.occurrences.find((item) => item.keyPath === 'v3.title')?.routeHints[0]?.path,
    ).toBe('/v3')
  })
})
