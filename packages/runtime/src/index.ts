import { CollectorRegistry } from './registry.js'
import type {
  CollectorInstallOptions,
  CollectorRegistryApi,
  EvidenceAssessment,
  OccurrenceDescriptor,
} from './types.js'

export * from './element-plus.js'
export * from './registry.js'
export * from './types.js'

interface ActiveImperativeInvocation {
  invocationId: string
  service: string
  occurrenceIds: Set<string>
  registered: Set<string>
  invokedAt: number
}

let activeImperativeInvocation: ActiveImperativeInvocation | undefined
let imperativeInvocationSequence = 0

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
  const registry = window.__COLLECT_I18N__
  registry?.recordRenderedValue(occurrenceId, value, actualKey)
  const invocation = activeImperativeInvocation
  if (
    registry &&
    invocation?.occurrenceIds.has(occurrenceId) &&
    !invocation.registered.has(occurrenceId)
  ) {
    const snapshot = registry.getOccurrence(occurrenceId)
    if (snapshot) {
      invocation.registered.add(occurrenceId)
      registry.registerImperativeInvocation({
        invocationId: invocation.invocationId,
        descriptor: {
          ...snapshot,
          kind: 'imperative-service',
          service: invocation.service,
          metadata: {
            ...snapshot.metadata,
            invocationId: invocation.invocationId,
          },
        },
        text:
          typeof value === 'string' || typeof value === 'number'
            ? String(value)
            : undefined,
        invokedAt: invocation.invokedAt,
      })
    }
  }
  return value
}

/**
 * Establish an invocation identity before Element Plus evaluates translated
 * arguments. The wrapped call remains synchronous and receives/returns the
 * exact same values as the original expression.
 */
export function runImperativeInvocation<T>(
  service: string,
  occurrenceIds: string[],
  invoke: () => T,
): T {
  if (typeof window === 'undefined') return invoke()
  const previous = activeImperativeInvocation
  activeImperativeInvocation = {
    invocationId: `invocation:${service}:${Date.now()}:${++imperativeInvocationSequence}`,
    service,
    occurrenceIds: new Set(occurrenceIds),
    registered: new Set(),
    invokedAt: Date.now(),
  }
  try {
    return invoke()
  } finally {
    activeImperativeInvocation = previous
  }
}

export function registerTextRange(
  descriptor: OccurrenceDescriptor,
  start: Node,
  end: Node = start,
  evidence: EvidenceAssessment = { grade: 'A', proof: 'compiler-text-sink' },
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const registry = window.__COLLECT_I18N__ ?? installGlobalCollector()
  const range = window.document.createRange()
  if (start.nodeType === 3) range.setStart(start, 0)
  else range.setStartBefore(start)
  if (end.nodeType === 3) range.setEnd(end, end.nodeValue?.length ?? 0)
  else range.setEndAfter(end)
  return registry.registerRange({ ...descriptor, kind: 'text' }, range, evidence)
}
