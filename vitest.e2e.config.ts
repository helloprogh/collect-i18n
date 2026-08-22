import { defineConfig } from 'vitest/config'

import workspaceConfig from './vitest.config'

export default defineConfig({
  resolve: workspaceConfig.resolve,
  test: {
    include: ['packages/**/*.e2e.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
