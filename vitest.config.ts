import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@collect-i18n/core': source('./packages/core/src/index.ts'),
      '@collect-i18n/analyzer': source('./packages/analyzer/src/index.ts'),
      '@collect-i18n/runtime': source('./packages/runtime/src/index.ts'),
      '@collect-i18n/vite-vue': source('./packages/vite-vue/src/index.ts'),
      '@collect-i18n/runner': source('./packages/runner/src/index.ts'),
      '@collect-i18n/excel': source('./packages/excel/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html']
    }
  }
})
