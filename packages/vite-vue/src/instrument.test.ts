import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createServer, resolveConfig } from 'vite'
import { scanProjectSources } from '@collect-i18n/analyzer'
import {
  collectI18nVuePlugin,
  findTranslationCalls,
  instrumentScriptModule,
  instrumentVueSfc,
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
        expect.objectContaining({ key: 'actions.submit', kind: 'text', component: 'el-button' }),
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
        expect.objectContaining({ keyExpression: 'field.submitKey', kind: 'text' }),
      ]),
    )

    const nativeInput = result!.code.match(/<input[^>]+>/)?.[0]
    const componentInput = result!.code.match(/<el-input[^>]+>/)?.[0]
    expect(nativeInput).toContain('data-i18n-key="form.name.placeholder"')
    expect(nativeInput).toContain('data-collect-i18n-bindings=')
    expect(componentInput).not.toContain('data-i18n-key')
    expect(result!.code).toContain('__collectI18nEnqueue(')
    expect(result!.code).toContain('__collectI18nValue(t(\'actions.submit\')')
    expect(result!.code).toContain('__collectI18nValue(t(field.submitKey)')
  })

  it('adds a compatible script setup block when the SFC has only an options script', () => {
    const source = `<template><p>{{ $t('hello') }}</p></template>
<script lang="ts">export default {}</script>`
    const result = instrumentVueSfc(source, componentId, { projectRoot })
    expect(result!.code).toContain('<script setup lang="ts">')
    expect(result!.code).toContain("$t('hello')")
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

  it('instruments imperative translations in ordinary TypeScript modules', () => {
    const source = `export function notify(t: (key: string) => string) {\n  ElNotification({ title: t('errors.title'), message: t('errors.body') })\n}`
    const file = path.join(projectRoot, 'src', 'notify.ts')
    const result = instrumentScriptModule(source, file, { projectRoot })!
    expect(result.occurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'errors.title', kind: 'imperative-service', service: 'ElNotification' }),
      expect.objectContaining({ key: 'errors.body', kind: 'imperative-service', service: 'ElNotification' }),
    ]))
    expect(result.code.match(/__collectI18nValue\(/g)).toHaveLength(2)
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
