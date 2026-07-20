import { CollectorRegistry } from './registry.js'
import type {
  CollectorInstallOptions,
  CollectorRegistryApi,
  OccurrenceDescriptor,
} from './types.js'

export * from './element-plus.js'
export * from './registry.js'
export * from './types.js'

export function installGlobalCollector(options: CollectorInstallOptions = {}): CollectorRegistryApi {
  const targetWindow = options.document?.defaultView ?? globalThis.window
  if (!targetWindow) throw new Error('collect-i18n runtime can only be installed in a browser')
  if (targetWindow.__COLLECT_I18N__) return targetWindow.__COLLECT_I18N__

  const registry = new CollectorRegistry({ ...options, document: options.document ?? targetWindow.document })
  targetWindow.__COLLECT_I18N__ = registry
  for (const descriptor of targetWindow.__COLLECT_I18N_PENDING__ ?? []) {
    registry.registerVirtual(descriptor, 'compiled descriptor awaiting a DOM anchor')
  }
  targetWindow.__COLLECT_I18N_PENDING__ = []
  return registry
}

/** Stable public factory used by the Vite adapter and the CLI-injected bootstrap. */
export const installCollectorRuntime = installGlobalCollector

export function uninstallGlobalCollector(targetWindow: Window = globalThis.window): void {
  targetWindow.__COLLECT_I18N__?.destroy()
  delete targetWindow.__COLLECT_I18N__
}

export function enqueueDescriptors(descriptors: OccurrenceDescriptor[]): void {
  if (typeof window === 'undefined') return
  const registry = window.__COLLECT_I18N__
  if (registry) {
    for (const descriptor of descriptors) {
      registry.registerVirtual(descriptor, 'compiled descriptor awaiting a DOM anchor')
    }
    return
  }
  const pending = (window.__COLLECT_I18N_PENDING__ ??= [])
  const byId = new Map(pending.map((descriptor) => [descriptor.occurrenceId, descriptor]))
  for (const descriptor of descriptors) byId.set(descriptor.occurrenceId, descriptor)
  window.__COLLECT_I18N_PENDING__ = [...byId.values()]
}

/**
 * Preserve a rendered Vue expression while teaching the runtime its current text.
 * The Vite adapter injects this helper only in collector mode.
 */
export function recordRenderedValue<T>(value: T, occurrenceId: string, actualKey?: string): T {
  if (typeof window === 'undefined') return value
  window.__COLLECT_I18N__?.recordRenderedValue(occurrenceId, value, actualKey)
  return value
}

export function registerTextRange(
  descriptor: OccurrenceDescriptor,
  start: Node,
  end: Node = start,
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const registry = window.__COLLECT_I18N__ ?? installGlobalCollector()
  const range = window.document.createRange()
  if (start.nodeType === 3) range.setStart(start, 0)
  else range.setStartBefore(start)
  if (end.nodeType === 3) range.setEnd(end, end.nodeValue?.length ?? 0)
  else range.setEndAfter(end)
  return registry.registerRange({ ...descriptor, kind: 'text' }, range)
}
