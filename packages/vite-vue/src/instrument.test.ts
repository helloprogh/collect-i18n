import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { createServer, resolveConfig } from 'vite'
import { compileScript, compileTemplate, parse as parseSfc } from '@vue/compiler-sfc'
import { scanProjectSources } from '@collect-i18n/analyzer'
import {
  collectI18nVuePlugin,
  findTranslationCalls,
  instrumentScriptModule,
  instrumentVueSfc,
  createManifestScheduler,
  normalizeRuntimeImport,
} from './index.js'

const projectRoot = path.resolve('fixtures/project')
const componentId = path.join(projectRoot, 'src/views/UserForm.vue')

describe('findTranslationCalls', () => {
  it('finds static and dynamic keys without treating dynamic expressions as literals', () => {
    expect(findTranslationCalls("ok ? t('actions.save') : $t(field.labelKey)")).toEqual([
      expect.objectContaining({ key: 'actions.save' }),
      expect.objectContaining({ key: undefined, keyExpression: 'field.labelKey' }),
    ])
  })
})

describe('instrumentVueSfc', () => {
  it('marks native owners while preserving component and slot bindings as descriptors', () => {
    const source = `<template>
  <form>
    <input :placeholder="$t('form.name.placeholder')" />
    <el-input :placeholder="t('form.email.placeholder')" />
    <el-button>{{ t('actions.submit') }}</el-button>
    <button @click="ElMessage(t('messages.saved'))">{{ t(field.submitKey) }}</button>
  </form>
</template>
<script setup lang="ts">
const field = { submitKey: 'actions.submit' }
const notifyFailure = () => ElNotification({ message: t('messages.failed') })
</script>
`
    const result = instrumentVueSfc(source, componentId, { projectRoot })
    expect(result).toBeDefined()
    expect(result!.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'form.name.placeholder', kind: 'native' }),
        expect.objectContaining({
          key: 'form.email.placeholder',
          kind: 'component-prop',
          component: 'el-input',
          prop: 'placeholder',
        }),
        expect.objectContaining({
          key: 'actions.submit',
          kind: 'text',
          component: 'el-button',
          metadata: expect.objectContaining({ inlineTransport: true }),
        }),
        expect.objectContaining({
          key: 'messages.saved',
          kind: 'imperative-service',
          service: 'ElMessage',
        }),
        expect.objectContaining({
          key: 'messages.failed',
          kind: 'imperative-service',
          service: 'ElNotification',
        }),
        expect.objectContaining({
          keyExpression: 'field.submitKey',
          kind: 'text',
          metadata: expect.objectContaining({ inlineTransport: true }),
        }),
      ]),
    )

    const nativeInput = result!.code.match(/<input[^>]+>/)?.[0]
    const componentInput = result!.code.match(/<el-input[^>]+>/)?.[0]
    expect(nativeInput).toContain('data-collect-i18n-sink=')
    expect(nativeInput).not.toContain('data-i18n-key')
    expect(componentInput).not.toContain('data-collect-i18n-sink=')
    expect(componentInput).toContain('@vue:mounted="__collectI18nVNodeMounted(')
    expect(componentInput).toContain('@vue:updated="__collectI18nVNodeUpdated(')
    expect(componentInput).toContain('@vue:before-unmount="__collectI18nVNodeBeforeUnmount(')
    expect(result!.code).toContain('__collectI18nEnqueue(')
    expect(result!.code).toContain('__collectI18nValue(t(\'actions.submit\')')
    expect(result!.code).toContain(
      '__collectI18nValue(t(__collectI18nActualKey)',
    )
    expect(result!.code.match(/\)\(field\.submitKey\)/g)).toHaveLength(1)
    expect(result!.code).toContain('String(__collectI18nActualKey)')
    expect(result!.code).toContain("__collectI18nInvoke('ElMessage'")
  })

  it('preserves user VNode lifecycle hooks while adding the missing provenance hooks', () => {
    const source = `<template><CustomLabel @vue:mounted="onMounted">{{ t('label.name') }}</CustomLabel></template>`
    const result = instrumentVueSfc(source, componentId, { projectRoot })!
    const component = result.code.match(/<CustomLabel[^>]+>/)?.[0] ?? ''

    expect(component.match(/@vue:mounted=/g)).toHaveLength(1)
    expect(component).toContain('@vue:mounted="onMounted"')
    expect(component).toContain('data-collect-i18n-sink=')
    expect(component).toContain('@vue:updated="__collectI18nVNodeUpdated(')
    expect(component).toContain('@vue:before-unmount="__collectI18nVNodeBeforeUnmount(')
  })

  it('produces VNode provenance hooks accepted by the Vue SFC compiler', () => {
    const source = `<script setup lang="ts">const field = { label: 'form.label' }</script>
<template><Teleport to="body"><CustomLabel :title="t('form.title')">{{ t(field.label) }}</CustomLabel></Teleport></template>`
    const instrumented = instrumentVueSfc(source, componentId, { projectRoot })!
    const parsed = parseSfc(instrumented.code, { filename: componentId })
    expect(parsed.errors).toEqual([])
    const script = compileScript(parsed.descriptor, { id: 'provenance-test' })
    const template = compileTemplate({
      id: 'provenance-test',
      filename: componentId,
      source: parsed.descriptor.template!.content,
      compilerOptions: { bindingMetadata: script.bindings },
    })

    expect(template.errors).toEqual([])
    expect(template.code).toContain('onVnodeMounted')
    expect(template.code).toContain('__collectI18nVNodeMounted')
  })

  it('adds a compatible script setup block when the SFC has only an options script', () => {
    const source = `<template><p>{{ $t('hello') }}</p></template>
<script lang="ts">export default {}</script>`
    const result = instrumentVueSfc(source, componentId, { projectRoot })
    expect(result!.code).toContain('<script setup lang="ts">')
    expect(result!.code).toContain("$t('hello')")
  })

  it('does not create a trusted DOM sink for non-visual native attributes', () => {
    const source = `<template><button :aria-label="t('actions.accessible')" :class="t('actions.css')">{{ t('actions.visible') }}</button></template>`
    const result = instrumentVueSfc(source, componentId, { projectRoot })!
    const button = result.code.match(/<button[^>]+>/)?.[0] ?? ''
    const sinkIds = button.match(/data-collect-i18n-sink="([^"]+)"/)?.[1]?.split(' ') ?? []
    const byKey = new Map(result.occurrences.map((item) => [item.key, item]))

    expect(sinkIds).toEqual([byKey.get('actions.visible')?.occurrenceId])
    expect(byKey.get('actions.accessible')).toMatchObject({ kind: 'virtual' })
    expect(byKey.get('actions.css')).toMatchObject({ kind: 'virtual' })
  })

  it('tracks arbitrary component props and lets runtime visibility and canary prove the rendered sink', () => {
    const source = `<template><CustomChart :series-name="t('chart.series')" :title="t('chart.title')" /></template>`
    const result = instrumentVueSfc(source, componentId, { projectRoot })!
    const byKey = new Map(result.occurrences.map((item) => [item.key, item]))
    const component = result.code.match(/<CustomChart[^>]+>/)?.[0] ?? ''

    expect(byKey.get('chart.series')).toMatchObject({
      kind: 'component-prop',
      metadata: expect.objectContaining({ canarySafe: true }),
    })
    expect(byKey.get('chart.title')).toMatchObject({
      kind: 'component-prop',
      metadata: expect.objectContaining({ canarySafe: true }),
    })
    expect(component).toContain('@vue:mounted="__collectI18nVNodeMounted(')
    expect(component).toContain('@vue:updated="__collectI18nVNodeUpdated(')
    expect(component).toContain('@vue:before-unmount="__collectI18nVNodeBeforeUnmount(')
  })

  it('uses exactly the same occurrence IDs as static analysis', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'collect-i18n-id-'))
    const file = path.join(root, 'src', 'views', 'Form.vue')
    const source = `<script setup lang="ts">\nconst failed = () => ElMessage.error(t('form.failed'))\n</script>\n<template><h1>{{ t('form.title') }}</h1><el-input :placeholder="t('form.placeholder')" /></template>`
    try {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, source, 'utf8')
      const analyzed = await scanProjectSources({ projectRoot: root })
      const instrumented = instrumentVueSfc(source, file, { projectRoot: root })!
      const staticIds = new Map(analyzed.occurrences.map((item) => [item.keyPath, item.id]))
      const runtimeIds = new Map(instrumented.occurrences.map((item) => [item.key, item.occurrenceId]))
      for (const key of ['form.failed', 'form.title', 'form.placeholder']) {
        expect(runtimeIds.get(key)).toBe(staticIds.get(key))
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses inline provenance for script-defined display messages outside imperative services', () => {
    const source = `<script setup lang="ts">
const rules = {
  name: [{ required: true, message: t('validation.nameRequired'), trigger: 'blur' }],
  password: [{ validator: (_rule, _value, callback) => callback(new Error(t('validation.passwordWeak'))) }],
}
const stateTitle = () => t('states.ready')
const assignError = () => (errorText.value = t('states.failed'))
const notify = () => ElNotification({ message: t('messages.saved') })
</script>
<template><el-form :rules="rules" /></template>`
    const result = instrumentVueSfc(source, componentId, { projectRoot })!
    const byKey = new Map(result.occurrences.map((item) => [item.key, item]))

    expect(byKey.get('validation.nameRequired')).toMatchObject({
      kind: 'virtual',
      metadata: expect.objectContaining({
        inlineTransport: true,
        canarySafe: true,
      }),
    })
    expect(byKey.get('messages.saved')).toMatchObject({
      kind: 'imperative-service',
      service: 'ElNotification',
      metadata: expect.not.objectContaining({ inlineTransport: true }),
    })
    for (const key of ['validation.passwordWeak', 'states.ready', 'states.failed']) {
      expect(byKey.get(key)).toMatchObject({
        metadata: expect.objectContaining({ inlineTransport: true }),
      })
    }
  })

  it('instruments imperative translations in ordinary TypeScript modules', () => {
    const source = `export function notify(t: (key: string) => string) {\n  ElNotification({ title: t('errors.title'), message: t('errors.body') })\n}`
    const file = path.join(projectRoot, 'src', 'notify.ts')
    const result = instrumentScriptModule(source, file, { projectRoot })!
    expect(result.occurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'errors.title', kind: 'imperative-service', service: 'ElNotification' }),
      expect.objectContaining({ key: 'errors.body', kind: 'imperative-service', service: 'ElNotification' }),
    ]))
    expect(result.code.match(/__collectI18nValue\(/g)).toHaveLength(2)
    expect(result.code).toContain('__collectI18nInvoke("ElNotification"')
  })
})

describe('createManifestScheduler', () => {
  it('debounces a burst of schedules into a single write', () => {
    vi.useFakeTimers()
    try {
      const writes: number[] = []
      let call = 0
      const scheduler = createManifestScheduler({
        write: () => writes.push(call),
        delayMs: 250,
      })
      call = 1
      scheduler.schedule()
      call = 2
      scheduler.schedule()
      expect(writes).toEqual([])
      vi.advanceTimersByTime(250)
      expect(writes).toEqual([2])
      vi.advanceTimersByTime(250)
      expect(writes).toEqual([2])
    } finally {
      vi.useRealTimers()
    }
  })

  it('flush writes immediately and cancels the pending timer', () => {
    vi.useFakeTimers()
    try {
      const writes: string[] = []
      const scheduler = createManifestScheduler({
        write: () => writes.push('data'),
        delayMs: 1000,
      })
      scheduler.schedule()
      scheduler.flush()
      expect(writes).toEqual(['data'])
      vi.advanceTimersByTime(2000)
      expect(writes).toEqual(['data'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('flush is a no-op when nothing is scheduled', () => {
    const writes: number[] = []
    const scheduler = createManifestScheduler({ write: () => writes.push(1) })
    scheduler.flush()
    expect(writes).toEqual([])
  })
})

describe('collectI18nVuePlugin', () => {
  it('defaults to dev-only instrumentation and permits an explicit build opt-in', () => {
    const development = collectI18nVuePlugin()
    const applyDevelopment = development.apply as (
      config: Record<string, unknown>,
      environment: { command: 'build' | 'serve'; mode: string },
    ) => boolean
    expect(applyDevelopment({}, { command: 'serve', mode: 'development' })).toBe(true)
    expect(applyDevelopment({}, { command: 'build', mode: 'production' })).toBe(false)

    const explicit = collectI18nVuePlugin({ enabled: 'always' })
    const applyExplicit = explicit.apply as typeof applyDevelopment
    expect(applyExplicit({}, { command: 'build', mode: 'production' })).toBe(true)
  })

  it('resolves a CLI-provided runtime outside the analyzed project through Vite /@fs/', async () => {
    const externalProject = path.join(os.tmpdir(), 'collect-i18n-external-project')
    const runtimeEntry = fileURLToPath(new URL('../../runtime/src/index.ts', import.meta.url))
    const runtimeImport = normalizeRuntimeImport(runtimeEntry)
    const plugin = collectI18nVuePlugin({
      enabled: true,
      projectRoot: externalProject,
      runtimeImport: runtimeEntry,
    })

    expect(runtimeImport).toMatch(/^\/@fs\//)
    expect(normalizeRuntimeImport('D:\\tools\\collect-i18n\\runtime.js')).toBe(
      '/@fs/D:/tools/collect-i18n/runtime.js',
    )

    const config = await resolveConfig(
      { root: externalProject, logLevel: 'silent', plugins: [plugin] },
      'serve',
    )
    expect(config.server.fs.allow.map((entry) => path.normalize(entry))).toContain(
      path.dirname(runtimeEntry),
    )

    const server = await createServer({
      root: externalProject,
      logLevel: 'silent',
      server: { middlewareMode: true },
      plugins: [plugin],
    })
    try {
      const resolved = await server.pluginContainer.resolveId(
        runtimeImport,
        path.join(externalProject, 'src/main.ts'),
      )
      expect(path.normalize(resolved!.id)).toBe(runtimeEntry)
      const transformed = await server.transformRequest(runtimeImport)
      expect(transformed?.code).toContain('installGlobalCollector')
    } finally {
      await server.close()
    }
  })
})
