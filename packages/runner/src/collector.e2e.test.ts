import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { BrowserCollector } from './collector.js'

describe('real browser collection smoke test', () => {
  let collector: BrowserCollector
  let root = ''
  let server: ReturnType<typeof createServer>

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'collect-i18n-browser-e2e-'))
    const artifactDir = path.join(root, 'evidence')
    const userDataDir = path.join(root, 'profile')
    await mkdir(artifactDir, { recursive: true })
    server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      if ((request.url ?? '').startsWith('/batch')) {
        // A dense visible-key page: 100 native-DOM sinks, all inside the
        // first viewport, for the R2 batch throughput timing assertion.
        const rows = Array.from({ length: 100 }, (_v, index) =>
          `<span data-i18n-key="batch.key${index}" data-i18n-occurrence="occ_batch_${index}">批量文本${index}</span>`,
        ).join('\n')
        response.end(`<!doctype html>
          <html><head><style>
            body { font: 4px sans-serif; padding: 0; margin: 0; }
            span { display: block; height: 6px; line-height: 6px; font-size: 4px; }
          </style></head><body>
            <main>${rows}</main>
            <script>
              window.__COLLECT_I18N__ = {
                rescan() {},
                setTarget() {},
                focus() {},
                targets() { return [] },
                getSnapshot() { return [] },
              }
            </script>
          </body></html>`);
        return
      }
      response.end(`<!doctype html>
        <html><head><style>
          body { font: 16px sans-serif; padding: 32px; }
          #dialog { margin-top: 24px; padding: 20px; border: 1px solid #ccc; }
        </style></head><body>
          <button data-testid="open-dialog">Open</button>
          <section id="dialog" hidden>
            <h1 data-i18n-key="smoke.dialog.title" data-i18n-occurrence="occ_smoke">采集烟测</h1>
          </section>
          <script>
            window.__COLLECT_I18N__ = {
              rescan() {},
              setTarget() {},
              focus() {},
              targets() { return [] },
              getSnapshot() { return [] },
            }
            document.querySelector('[data-testid="open-dialog"]').addEventListener('click', () => {
              document.querySelector('#dialog').hidden = false
            })
          </script>
        </body></html>`);
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing smoke-test port')
    const origin = `http://127.0.0.1:${address.port}`
    collector = new BrowserCollector({
      baseUrl: origin,
      artifactDir,
      userDataDir,
      channel: 'chrome',
      headless: true,
      viewport: { width: 1000, height: 700 },
      defaultTimeoutMs: 10_000,
    })
    await collector.start()
  })

  afterAll(async () => {
    await collector?.close().catch(() => undefined)
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('executes a plan and persists content-addressed screenshot evidence', async () => {
    const evidence = await collector.executePlan({
      version: 1,
      targetKey: 'smoke.dialog.title',
      route: '/',
      steps: [
        { type: 'goto', path: '/' },
        { type: 'click', locator: { kind: 'testId', value: 'open-dialog' } },
        { type: 'waitForKey', key: 'smoke.dialog.title', timeoutMs: 5_000 },
      ],
      rationale: `browser smoke ${randomUUID()}`,
    }, 'agent')

    const bytes = await readFile(evidence.screenshotPath)
    expect(bytes.length).toBeGreaterThan(1_000)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(evidence.screenshotSha256)
    expect(path.basename(evidence.screenshotPath)).toContain(evidence.screenshotSha256)
    expect(evidence).toMatchObject({
      key: 'smoke.dialog.title',
      evidenceGrade: 'A',
      evidenceProof: 'compiler-native-sink',
      source: 'agent',
    })
  })

  it('batch-captures 100 visible keys well inside the 30s budget (R2)', async () => {
    await collector.open('/batch')
    const keys = Array.from({ length: 100 }, (_v, index) => `batch.key${index}`)
    const started = Date.now()
    const results = await collector.captureDeterministicBatch(keys)
    const elapsedMs = Date.now() - started
    expect(results).toHaveLength(100)
    expect(results.every((item) => item.evidence !== undefined)).toBe(true)
    expect(elapsedMs).toBeLessThan(30_000)
  })
})
