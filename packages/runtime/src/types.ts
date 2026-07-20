export type OccurrenceKind =
  | 'native'
  | 'text'
  | 'component-prop'
  | 'imperative-service'
  | 'virtual'

export interface SourceLocation {
  file?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

export interface OccurrenceDescriptor {
  occurrenceId: string
  key?: string
  keyExpression?: string
  kind: OccurrenceKind
  source?: SourceLocation
  component?: string
  prop?: string
  service?: ElementPlusServiceName | string
  renderedText?: string
  routeHints?: string[]
  actionHints?: string[]
  metadata?: Record<string, unknown>
}

export interface ElementAnchor {
  type: 'element'
  element: Element
}

export interface RangeAnchor {
  type: 'range'
  range: Range
}

export interface VirtualAnchor {
  type: 'virtual'
  reason?: string
}

export type OccurrenceAnchor = ElementAnchor | RangeAnchor | VirtualAnchor

export interface OccurrenceRegistration extends OccurrenceDescriptor {
  anchor?: OccurrenceAnchor
}

export interface RectSnapshot {
  x: number
  y: number
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}

export interface OccurrenceSnapshot extends OccurrenceDescriptor {
  anchorType: OccurrenceAnchor['type']
  connected: boolean
  visible: boolean
  text?: string
  rect?: RectSnapshot
  firstSeenAt: number
  lastSeenAt: number
}

export interface CollectorTarget {
  key?: string
  occurrenceId?: string
}

export type CollectorEventType =
  | 'registered'
  | 'updated'
  | 'removed'
  | 'target-changed'
  | 'target-found'
  | 'rendered-value'
  | 'destroyed'

export interface CollectorEvent {
  sequence: number
  type: CollectorEventType
  timestamp: number
  occurrence?: OccurrenceSnapshot
  target?: CollectorTarget
  details?: Record<string, unknown>
}

export interface WaitForTargetOptions {
  timeoutMs?: number
  signal?: AbortSignal
  requireVisible?: boolean
}

export type ElementPlusServiceName = 'ElMessage' | 'ElNotification' | 'ElMessageBox'

export interface ImperativeInvocation {
  descriptor: OccurrenceDescriptor
  text?: string
  invokedAt: number
}

export type CollectorEventListener = (event: CollectorEvent) => void

export interface CollectorRegistryApi {
  register(registration: OccurrenceRegistration): () => void
  registerElement(descriptor: OccurrenceDescriptor, element: Element): () => void
  registerRange(descriptor: OccurrenceDescriptor, range: Range): () => void
  registerVirtual(descriptor: OccurrenceDescriptor, reason?: string): () => void
  registerComponentProp(
    descriptor: OccurrenceDescriptor,
    target: Element | (() => Element | null | undefined),
  ): () => void
  registerImperativeInvocation(invocation: ImperativeInvocation): () => void
  recordRenderedValue(occurrenceId: string, value: unknown, actualKey?: string): unknown
  setTarget(target: CollectorTarget | null): void
  getTarget(): CollectorTarget | null
  focus(key: string): OccurrenceSnapshot | undefined
  focus(target: CollectorTarget): OccurrenceSnapshot | undefined
  waitForTarget(target: CollectorTarget, options?: WaitForTargetOptions): Promise<OccurrenceSnapshot>
  getOccurrence(occurrenceId: string): OccurrenceSnapshot | undefined
  getSnapshot(): OccurrenceSnapshot[]
  eventsSince(sequence?: number): CollectorEvent[]
  subscribe(listener: CollectorEventListener): () => void
  rescan(root?: ParentNode): void
  destroy(): void
}

export interface CollectorInstallOptions {
  document?: Document
  overlay?: boolean
  scanNativeAttributes?: boolean
  observeTeleport?: boolean
  eventBufferSize?: number
}

export interface PendingCollectorWindow extends Window {
  __COLLECT_I18N__?: CollectorRegistryApi
  __COLLECT_I18N_PENDING__?: OccurrenceDescriptor[]
}

declare global {
  interface Window {
    __COLLECT_I18N__?: CollectorRegistryApi
    __COLLECT_I18N_PENDING__?: OccurrenceDescriptor[]
  }
}
