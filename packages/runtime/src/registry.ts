import type {
  CollectorEvent,
  CollectorEventListener,
  CollectorInstallOptions,
  CollectorRegistryApi,
  CollectorTarget,
  ImperativeInvocation,
  OccurrenceAnchor,
  OccurrenceDescriptor,
  OccurrenceRegistration,
  OccurrenceSnapshot,
  RectSnapshot,
  WaitForTargetOptions,
} from './types.js'

interface StoredOccurrence {
  descriptor: OccurrenceDescriptor
  anchors: Map<symbol, OccurrenceAnchor>
  firstSeenAt: number
  lastSeenAt: number
}

interface PendingInvocation {
  invocation: ImperativeInvocation
  dispose: () => void
  timeout: ReturnType<typeof setTimeout>
}

interface ImperativeBinding {
  anchorNode: Node
  anchorType: 'element' | 'range'
  startOffset?: number
  endOffset?: number
  dispose: () => void
}

const NATIVE_SELECTOR = '[data-i18n-key],[data-collect-i18n-bindings]'
const ELEMENT_PLUS_SELECTORS =
  '.el-message,.el-notification,.el-message-box,.el-message-box__wrapper'

const anchorRank: Record<OccurrenceAnchor['type'], number> = {
  virtual: 0,
  range: 1,
  element: 2,
}

function now(): number {
  return Date.now()
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).replace(/\s+/g, ' ').trim()
  }
  return undefined
}

function rectToSnapshot(rect: DOMRect): RectSnapshot {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  }
}

function getRangeRect(range: Range): DOMRect | undefined {
  const primary = range.getBoundingClientRect?.()
  if (primary && (primary.width > 0 || primary.height > 0)) return primary

  const rects = Array.from(range.getClientRects?.() ?? [])
  if (rects.length === 0) return primary
  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.right))
  const bottom = Math.max(...rects.map((rect) => rect.bottom))
  return {
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect
}

function anchorIsConnected(anchor: OccurrenceAnchor): boolean {
  if (anchor.type === 'virtual') return false
  if (anchor.type === 'element') return anchor.element.isConnected
  return anchor.range.startContainer.isConnected && anchor.range.endContainer.isConnected
}

function anchorElement(anchor: OccurrenceAnchor): Element | undefined {
  if (anchor.type === 'element') return anchor.element
  if (anchor.type === 'virtual') return undefined
  const container = anchor.range.startContainer
  return container.nodeType === 1 ? (container as Element) : container.parentElement ?? undefined
}

function rankAnchor(entry: StoredOccurrence, anchor: OccurrenceAnchor): number {
  if (entry.descriptor.kind === 'text' && anchor.type === 'range') return 3
  return anchorRank[anchor.type]
}

function selectAnchor(entry: StoredOccurrence): OccurrenceAnchor {
  const anchors = [...entry.anchors.values()]
  const connected = anchors
    .filter(anchorIsConnected)
    .sort((left, right) => rankAnchor(entry, right) - rankAnchor(entry, left))
  return (
    connected[0] ??
    anchors.sort((left, right) => rankAnchor(entry, right) - rankAnchor(entry, left))[0] ?? {
      type: 'virtual',
      reason: 'descriptor-only',
    }
  )
}

function targetMatches(target: CollectorTarget, descriptor: OccurrenceDescriptor): boolean {
  if (target.occurrenceId && target.occurrenceId !== descriptor.occurrenceId) return false
  if (target.key && target.key !== descriptor.key) return false
  return Boolean(target.key || target.occurrenceId)
}

function parseBindings(element: Element): OccurrenceDescriptor[] {
  const encoded = element.getAttribute('data-collect-i18n-bindings')
  if (encoded) {
    try {
      const parsed: unknown = JSON.parse(encoded)
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is OccurrenceDescriptor =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as OccurrenceDescriptor).occurrenceId === 'string' &&
            typeof (item as OccurrenceDescriptor).kind === 'string',
        )
      }
    } catch {
      // A malformed development-only marker must never affect the host application.
    }
  }

  const key = element.getAttribute('data-i18n-key')
  if (!key) return []
  return [
    {
      occurrenceId:
        element.getAttribute('data-i18n-occurrence') ??
        `native:${key}:${element.tagName.toLowerCase()}`,
      key,
      kind: 'native',
    },
  ]
}

function elementPlusServiceFor(element: Element): string | undefined {
  if (element.matches('.el-message')) return 'ElMessage'
  if (element.matches('.el-notification')) return 'ElNotification'
  if (element.matches('.el-message-box,.el-message-box__wrapper')) return 'ElMessageBox'
  return undefined
}

export class CollectorRegistry implements CollectorRegistryApi {
  readonly #document: Document
  readonly #options: Required<Omit<CollectorInstallOptions, 'document'>>
  readonly #entries = new Map<string, StoredOccurrence>()
  readonly #listeners = new Set<CollectorEventListener>()
  readonly #events: CollectorEvent[] = []
  readonly #nativeDisposers = new WeakMap<Element, Array<() => void>>()
  readonly #renderedDisposers = new Map<string, () => void>()
  readonly #pendingInvocations: PendingInvocation[] = []
  readonly #imperativeDisposers = new WeakMap<Element, Map<string, ImperativeBinding>>()
  readonly #observer: MutationObserver | undefined
  readonly #overlay: HTMLDivElement | undefined
  readonly #overlayLabel: HTMLDivElement | undefined
  #target: CollectorTarget | null = null
  #lastTargetFound: string | undefined
  #sequence = 0
  #destroyed = false
  #resolveScheduled = false

  constructor(options: CollectorInstallOptions = {}) {
    const documentRef = options.document ?? globalThis.document
    if (!documentRef) throw new Error('collect-i18n runtime requires a browser Document')

    this.#document = documentRef
    this.#options = {
      overlay: options.overlay ?? true,
      scanNativeAttributes: options.scanNativeAttributes ?? true,
      observeTeleport: options.observeTeleport ?? true,
      eventBufferSize: options.eventBufferSize ?? 500,
    }

    if (this.#options.overlay) {
      const { overlay, label } = this.#createOverlay()
      this.#overlay = overlay
      this.#overlayLabel = label
    }

    const MutationObserverCtor = documentRef.defaultView?.MutationObserver
    if (MutationObserverCtor) {
      this.#observer = new MutationObserverCtor((mutations) => this.#handleMutations(mutations))
      const observerRoot = this.#options.observeTeleport
        ? documentRef.documentElement
        : documentRef.body
      if (observerRoot) {
        this.#observer.observe(observerRoot, {
          subtree: true,
          childList: true,
          characterData: this.#options.observeTeleport,
          attributes: this.#options.scanNativeAttributes,
          attributeFilter: this.#options.scanNativeAttributes
            ? ['data-i18n-key', 'data-i18n-occurrence', 'data-collect-i18n-bindings']
            : undefined,
        })
      }
    }

    if (this.#options.scanNativeAttributes) this.rescan(documentRef)
    this.#scanElementPlus(documentRef)

    documentRef.defaultView?.addEventListener('scroll', this.#refreshOverlay, true)
    documentRef.defaultView?.addEventListener('resize', this.#refreshOverlay)
  }

  register(registration: OccurrenceRegistration): () => void {
    this.#assertActive()
    const token = Symbol(registration.occurrenceId)
    const timestamp = now()
    const previous = this.#entries.get(registration.occurrenceId)
    const descriptor: OccurrenceDescriptor = previous
      ? {
          ...previous.descriptor,
          ...registration,
          source: registration.source ?? previous.descriptor.source,
          metadata: {
            ...previous.descriptor.metadata,
            ...registration.metadata,
          },
        }
      : { ...registration }
    delete (descriptor as Partial<OccurrenceRegistration>).anchor

    const entry: StoredOccurrence = previous ?? {
      descriptor,
      anchors: new Map(),
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
    }
    entry.descriptor = descriptor
    entry.lastSeenAt = timestamp
    entry.anchors.set(token, registration.anchor ?? { type: 'virtual' })
    this.#entries.set(descriptor.occurrenceId, entry)
    this.#emit(previous ? 'updated' : 'registered', this.#snapshot(entry))
    this.#checkTarget(entry)
    this.#scheduleRenderedResolution()

    let disposed = false
    return () => {
      if (disposed || this.#destroyed) return
      disposed = true
      const current = this.#entries.get(descriptor.occurrenceId)
      if (!current) return
      current.anchors.delete(token)
      current.lastSeenAt = now()
      if (current.anchors.size === 0) {
        const snapshot = this.#snapshot(current)
        this.#entries.delete(descriptor.occurrenceId)
        this.#emit('removed', snapshot)
      } else {
        this.#emit('updated', this.#snapshot(current))
      }
      this.#refreshOverlay()
    }
  }

  registerElement(descriptor: OccurrenceDescriptor, element: Element): () => void {
    return this.register({ ...descriptor, anchor: { type: 'element', element } })
  }

  registerRange(descriptor: OccurrenceDescriptor, range: Range): () => void {
    return this.register({ ...descriptor, anchor: { type: 'range', range } })
  }

  registerVirtual(descriptor: OccurrenceDescriptor, reason = 'descriptor-only'): () => void {
    return this.register({ ...descriptor, anchor: { type: 'virtual', reason } })
  }

  registerComponentProp(
    descriptor: OccurrenceDescriptor,
    target: Element | (() => Element | null | undefined),
  ): () => void {
    const element = typeof target === 'function' ? target() : target
    if (element) return this.registerElement({ ...descriptor, kind: 'component-prop' }, element)
    return this.registerVirtual(
      { ...descriptor, kind: 'component-prop' },
      'component root is not mounted',
    )
  }

  registerImperativeInvocation(invocation: ImperativeInvocation): () => void {
    const dispose = this.registerVirtual(
      { ...invocation.descriptor, kind: 'imperative-service', renderedText: invocation.text },
      'waiting for imperative service DOM',
    )
    const pending: PendingInvocation = {
      invocation,
      dispose,
      timeout: setTimeout(() => {
        const index = this.#pendingInvocations.indexOf(pending)
        if (index >= 0) this.#pendingInvocations.splice(index, 1)
        dispose()
      }, 15_000),
    }
    this.#pendingInvocations.push(pending)
    return () => {
      clearTimeout(pending.timeout)
      const index = this.#pendingInvocations.indexOf(pending)
      if (index >= 0) this.#pendingInvocations.splice(index, 1)
      dispose()
    }
  }

  recordRenderedValue(occurrenceId: string, value: unknown, actualKey?: string): unknown {
    const entry = this.#entries.get(occurrenceId)
    if (!entry) return value
    const renderedText = normalizeText(value)
    entry.descriptor = {
      ...entry.descriptor,
      key: actualKey ?? entry.descriptor.key,
      renderedText,
    }
    entry.lastSeenAt = now()
    this.#emit('rendered-value', this.#snapshot(entry), { renderedText, actualKey })
    this.#scheduleRenderedResolution()
    return value
  }

  setTarget(target: CollectorTarget | null): void {
    this.#target = target && (target.key || target.occurrenceId) ? { ...target } : null
    this.#lastTargetFound = undefined
    this.#emit('target-changed', undefined, undefined, this.#target ?? undefined)
    if (this.#target) {
      for (const entry of this.#entries.values()) this.#checkTarget(entry)
    }
    this.#refreshOverlay()
  }

  getTarget(): CollectorTarget | null {
    return this.#target ? { ...this.#target } : null
  }

  focus(key: string): OccurrenceSnapshot | undefined
  focus(target: CollectorTarget): OccurrenceSnapshot | undefined
  focus(keyOrTarget: string | CollectorTarget): OccurrenceSnapshot | undefined {
    const target = typeof keyOrTarget === 'string' ? { key: keyOrTarget } : keyOrTarget
    this.setTarget(target)

    const candidates = [...this.#entries.values()]
      .filter((entry) => targetMatches(target, entry.descriptor))
      .map((entry) => ({ entry, snapshot: this.#snapshot(entry) }))
      .filter(({ snapshot }) => snapshot.connected)
      .sort((left, right) => {
        if (left.snapshot.visible !== right.snapshot.visible) return left.snapshot.visible ? -1 : 1
        return right.entry.lastSeenAt - left.entry.lastSeenAt
      })
    const selected = candidates[0]
    if (!selected) return undefined

    const anchor = selectAnchor(selected.entry)
    anchorElement(anchor)?.scrollIntoView?.({ behavior: 'auto', block: 'center', inline: 'center' })
    const snapshot = this.#snapshot(selected.entry)
    this.#checkTarget(selected.entry)
    this.#refreshOverlay()
    return snapshot
  }

  waitForTarget(
    target: CollectorTarget,
    options: WaitForTargetOptions = {},
  ): Promise<OccurrenceSnapshot> {
    const requireVisible = options.requireVisible ?? true
    const existing = this.getSnapshot().find(
      (item) => targetMatches(target, item) && (!requireVisible || item.visible),
    )
    if (existing) return Promise.resolve(existing)

    this.setTarget(target)
    return new Promise((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      const cleanup = () => {
        unsubscribe()
        if (timeout) clearTimeout(timeout)
        options.signal?.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        cleanup()
        reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      const unsubscribe = this.subscribe((event) => {
        if (event.type !== 'target-found' || !event.occurrence) return
        if (requireVisible && !event.occurrence.visible) return
        cleanup()
        resolve(event.occurrence)
      })

      if (options.timeoutMs && options.timeoutMs > 0) {
        timeout = setTimeout(() => {
          cleanup()
          reject(new Error(`Timed out waiting for i18n target after ${options.timeoutMs}ms`))
        }, options.timeoutMs)
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      if (options.signal?.aborted) onAbort()
    })
  }

  getOccurrence(occurrenceId: string): OccurrenceSnapshot | undefined {
    const entry = this.#entries.get(occurrenceId)
    return entry ? this.#snapshot(entry) : undefined
  }

  getSnapshot(): OccurrenceSnapshot[] {
    return [...this.#entries.values()]
      .map((entry) => this.#snapshot(entry))
      .sort((left, right) => left.occurrenceId.localeCompare(right.occurrenceId))
  }

  eventsSince(sequence = 0): CollectorEvent[] {
    return this.#events.filter((event) => event.sequence > sequence).map((event) => ({ ...event }))
  }

  subscribe(listener: CollectorEventListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  rescan(root: ParentNode = this.#document): void {
    if (this.#destroyed) return
    const elements: Element[] = []
    if (root instanceof this.#document.defaultView!.Element && root.matches(NATIVE_SELECTOR)) {
      elements.push(root)
    }
    elements.push(...Array.from(root.querySelectorAll(NATIVE_SELECTOR)))
    for (const element of elements) this.#registerNativeElement(element)
    this.#scanElementPlus(root)
    this.#scheduleRenderedResolution()
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#observer?.disconnect()
    this.#document.defaultView?.removeEventListener('scroll', this.#refreshOverlay, true)
    this.#document.defaultView?.removeEventListener('resize', this.#refreshOverlay)
    this.#overlay?.remove()
    for (const dispose of this.#renderedDisposers.values()) dispose()
    for (const pending of this.#pendingInvocations) {
      clearTimeout(pending.timeout)
      pending.dispose()
    }
    this.#renderedDisposers.clear()
    this.#pendingInvocations.length = 0
    this.#entries.clear()
    this.#emit('destroyed')
    this.#listeners.clear()
  }

  #assertActive(): void {
    if (this.#destroyed) throw new Error('collect-i18n runtime has been destroyed')
  }

  #snapshot(entry: StoredOccurrence): OccurrenceSnapshot {
    const anchor = selectAnchor(entry)
    let rect: DOMRect | undefined
    let text: string | undefined
    if (anchor.type === 'element') {
      rect = anchor.element.getBoundingClientRect()
      text = normalizeText(
        anchor.element.textContent ||
          anchor.element.getAttribute('placeholder') ||
          anchor.element.getAttribute('title') ||
          anchor.element.getAttribute('aria-label'),
      )
    } else if (anchor.type === 'range') {
      rect = getRangeRect(anchor.range)
      text = normalizeText(anchor.range.toString())
    }
    const connected = anchorIsConnected(anchor)
    const view = this.#document.defaultView
    const styledElement = anchorElement(anchor)
    const style = styledElement ? view?.getComputedStyle(styledElement) : undefined
    const viewportWidth = view?.innerWidth ?? this.#document.documentElement.clientWidth
    const viewportHeight = view?.innerHeight ?? this.#document.documentElement.clientHeight
    const intersectsViewport = Boolean(
      rect &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < viewportHeight &&
        rect.left < viewportWidth,
    )
    const visible = Boolean(
      connected &&
        rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        intersectsViewport &&
        style?.display !== 'none' &&
        style?.visibility !== 'hidden',
    )
    return {
      ...entry.descriptor,
      anchorType: anchor.type,
      connected,
      visible,
      text: text ?? entry.descriptor.renderedText,
      rect: rect ? rectToSnapshot(rect) : undefined,
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
    }
  }

  #emit(
    type: CollectorEvent['type'],
    occurrence?: OccurrenceSnapshot,
    details?: Record<string, unknown>,
    target?: CollectorTarget,
  ): void {
    const event: CollectorEvent = {
      sequence: ++this.#sequence,
      type,
      timestamp: now(),
      occurrence,
      target,
      details,
    }
    this.#events.push(event)
    if (this.#events.length > this.#options.eventBufferSize) this.#events.shift()
    for (const listener of this.#listeners) listener(event)
    const view = this.#document.defaultView
    view?.dispatchEvent(new view.CustomEvent('collect-i18n:event', { detail: event }))
  }

  #registerNativeElement(element: Element): void {
    const previous = this.#nativeDisposers.get(element)
    if (previous) {
      for (const dispose of previous) dispose()
    }
    const disposers = parseBindings(element).map((descriptor) =>
      this.registerElement({ ...descriptor, kind: descriptor.kind ?? 'native' }, element),
    )
    this.#nativeDisposers.set(element, disposers)
  }

  #handleMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      if (
        mutation.type === 'attributes' &&
        mutation.target instanceof this.#document.defaultView!.Element
      ) {
        this.#registerNativeElement(mutation.target)
      }
      for (const node of Array.from(mutation.removedNodes)) {
        if (!(node instanceof this.#document.defaultView!.Element)) continue
        this.#disposeNativeTree(node)
        this.#disposeImperativeTree(node)
      }
      for (const node of Array.from(mutation.addedNodes)) {
        if (!(node instanceof this.#document.defaultView!.Element)) continue
        if (this.#options.scanNativeAttributes) this.rescan(node)
        else this.#scanElementPlus(node)
      }
      const mutationElement =
        mutation.target instanceof this.#document.defaultView!.Element
          ? mutation.target
          : mutation.target.parentElement
      if (mutationElement) this.#scanElementPlus(mutationElement)
    }
    this.#scheduleRenderedResolution()
    this.#refreshOverlay()
  }

  #disposeNativeTree(root: Element): void {
    const candidates = [root, ...Array.from(root.querySelectorAll(NATIVE_SELECTOR))]
    for (const element of candidates) {
      for (const dispose of this.#nativeDisposers.get(element) ?? []) dispose()
      this.#nativeDisposers.delete(element)
    }
  }

  #disposeImperativeTree(root: Element): void {
    const candidates = [root, ...Array.from(root.querySelectorAll(ELEMENT_PLUS_SELECTORS))]
    for (const element of candidates) {
      for (const binding of this.#imperativeDisposers.get(element)?.values() ?? []) {
        binding.dispose()
      }
      this.#imperativeDisposers.delete(element)
    }
  }

  #scanElementPlus(root: ParentNode): void {
    const elements = new Set<Element>()
    if (root instanceof this.#document.defaultView!.Element) {
      const container = root.closest(ELEMENT_PLUS_SELECTORS)
      if (container) elements.add(container)
    }
    for (const element of Array.from(root.querySelectorAll(ELEMENT_PLUS_SELECTORS))) {
      elements.add(element)
    }
    for (const element of elements) this.#bindElementPlusElement(element)
  }

  #bindElementPlusElement(element: Element): void {
    if (
      element.matches('.el-message-box__wrapper') &&
      element.querySelector('.el-message-box')
    ) {
      return
    }
    const service = elementPlusServiceFor(element)
    const containerText = normalizeText(element.textContent)
    const descriptors = [...this.#entries.values()]
      .filter(
        (entry) =>
          entry.descriptor.kind === 'imperative-service' &&
          (!service || !entry.descriptor.service || entry.descriptor.service === service) &&
          Boolean(normalizeText(entry.descriptor.renderedText)),
      )
      .sort((left, right) => {
        const leftTarget = this.#target && targetMatches(this.#target, left.descriptor) ? 1 : 0
        const rightTarget = this.#target && targetMatches(this.#target, right.descriptor) ? 1 : 0
        return rightTarget - leftTarget || right.lastSeenAt - left.lastSeenAt
      })

    const matches = descriptors.flatMap(({ descriptor }) => {
      const text = normalizeText(descriptor.renderedText)
      if (!text) return []
      const ranges = this.#findTextRanges(text, element)
      if (ranges.length !== 1) return []
      return [{ descriptor, text, range: ranges[0]! }]
    })
    const composite = matches.length > 1
    const bindings = this.#imperativeDisposers.get(element) ?? new Map<string, ImperativeBinding>()
    const matchedIds = new Set(matches.map(({ descriptor }) => descriptor.occurrenceId))

    for (const [occurrenceId, binding] of bindings) {
      if (matchedIds.has(occurrenceId)) continue
      binding.dispose()
      bindings.delete(occurrenceId)
    }

    for (const { descriptor, text, range } of matches) {
      const useElement = !composite && containerText === text
      const anchorType = useElement ? 'element' : 'range'
      const anchorNode = useElement ? element : range.startContainer
      const existing = bindings.get(descriptor.occurrenceId)
      if (
        existing &&
        existing.anchorType === anchorType &&
        existing.anchorNode === anchorNode &&
        (useElement ||
          (existing.startOffset === range.startOffset && existing.endOffset === range.endOffset))
      ) {
        this.#settlePendingInvocation(descriptor.occurrenceId)
        continue
      }
      existing?.dispose()
      const dispose = useElement
        ? this.registerElement({ ...descriptor, renderedText: text }, element)
        : this.registerRange({ ...descriptor, renderedText: text }, range)
      bindings.set(descriptor.occurrenceId, {
        anchorNode,
        anchorType,
        startOffset: useElement ? undefined : range.startOffset,
        endOffset: useElement ? undefined : range.endOffset,
        dispose,
      })
      this.#settlePendingInvocation(descriptor.occurrenceId)
    }

    if (bindings.size > 0) this.#imperativeDisposers.set(element, bindings)
    else this.#imperativeDisposers.delete(element)
  }

  #settlePendingInvocation(occurrenceId: string): void {
    for (let index = this.#pendingInvocations.length - 1; index >= 0; index -= 1) {
      const pending = this.#pendingInvocations[index]!
      if (pending.invocation.descriptor.occurrenceId !== occurrenceId) continue
      this.#pendingInvocations.splice(index, 1)
      clearTimeout(pending.timeout)
      pending.dispose()
    }
  }

  #scheduleRenderedResolution(): void {
    if (this.#resolveScheduled || this.#destroyed) return
    this.#resolveScheduled = true
    queueMicrotask(() => {
      this.#resolveScheduled = false
      if (!this.#destroyed) this.#resolveRenderedOccurrences()
    })
  }

  #resolveRenderedOccurrences(): void {
    const entries = [...this.#entries.values()].sort((left, right) => {
      const leftTarget = this.#target && targetMatches(this.#target, left.descriptor) ? 1 : 0
      const rightTarget = this.#target && targetMatches(this.#target, right.descriptor) ? 1 : 0
      return rightTarget - leftTarget
    })

    for (const entry of entries) {
      const descriptor = entry.descriptor
      const text = normalizeText(descriptor.renderedText)
      if (!text || descriptor.kind === 'native' || descriptor.kind === 'imperative-service') continue
      const existing = selectAnchor(entry)
      const needsTextRange = descriptor.kind === 'text' && existing.type !== 'range'
      const needsComponentElement =
        descriptor.kind === 'component-prop' && existing.type !== 'element'
      if (
        !needsTextRange &&
        !needsComponentElement &&
        existing.type !== 'virtual' &&
        anchorIsConnected(existing)
      ) {
        continue
      }

      const match =
        descriptor.kind === 'component-prop'
          ? this.#findComponentPropAnchor(descriptor, text)
          : this.#findTextRange(text)
      if (!match) {
        if (descriptor.kind === 'component-prop' && existing.type === 'range') {
          this.#renderedDisposers.get(descriptor.occurrenceId)?.()
          this.#renderedDisposers.delete(descriptor.occurrenceId)
        }
        continue
      }
      if (
        match instanceof this.#document.defaultView!.Range &&
        existing.type === 'range' &&
        anchorIsConnected(existing) &&
        existing.range.startContainer === match.startContainer &&
        existing.range.startOffset === match.startOffset &&
        existing.range.endContainer === match.endContainer &&
        existing.range.endOffset === match.endOffset
      ) {
        continue
      }
      this.#renderedDisposers.get(descriptor.occurrenceId)?.()
      const dispose =
        match instanceof this.#document.defaultView!.Range
          ? this.registerRange(descriptor, match)
          : this.registerElement(descriptor, match)
      this.#renderedDisposers.set(descriptor.occurrenceId, dispose)
    }
  }

  #findComponentPropAnchor(
    descriptor: OccurrenceDescriptor,
    text: string,
  ): Element | Range | undefined {
    const attributes = [descriptor.prop, 'placeholder', 'title', 'aria-label', 'value'].filter(
      (attribute): attribute is string => Boolean(attribute),
    )
    const seen = new Set<Element>()
    for (const attribute of attributes) {
      for (const element of Array.from(this.#document.querySelectorAll(`[${attribute}]`))) {
        if (seen.has(element)) continue
        seen.add(element)
        if (normalizeText(element.getAttribute(attribute)) === text) return element
      }
    }
    // Component libraries often render a prop as text instead of forwarding it
    // as a DOM attribute. Prefer one exact text node before considering
    // substring matches: e.g. the table header "运行状态" must not become
    // ambiguous merely because a page subtitle contains "…及其运行状态".
    const exactTextRanges = this.#findTextRanges(text, undefined, true)
    if (exactTextRanges.length > 0) {
      return exactTextRanges.length === 1 ? exactTextRanges[0] : undefined
    }
    const textRanges = this.#findTextRanges(text)
    return textRanges.length === 1 ? textRanges[0] : undefined
  }

  #findTextRange(text: string): Range | undefined {
    return this.#findTextRanges(text)[0]
  }

  #findTextRanges(
    text: string,
    root: ParentNode = this.#document.body ?? this.#document.documentElement,
    exactOnly = false,
  ): Range[] {
    const NodeFilterRef = this.#document.defaultView?.NodeFilter
    const walker = this.#document.createTreeWalker(
      root,
      NodeFilterRef?.SHOW_TEXT ?? 4,
    )
    const ranges: Range[] = []
    let current = walker.nextNode()
    while (current) {
      const raw = current.nodeValue ?? ''
      const normalized = normalizeText(raw)
      const parent = current.parentElement
      const excluded =
        parent?.closest('[data-collect-i18n-overlay]') ||
        parent?.closest('script,style,noscript,template')
      const matches = exactOnly
        ? normalized === text
        : normalized === text || Boolean(normalized?.includes(text))
      if (!excluded && matches) {
        const start = raw.indexOf(text)
        const range = this.#document.createRange()
        if (start >= 0) range.setStart(current, start)
        else range.setStart(current, 0)
        range.setEnd(current, start >= 0 ? start + text.length : raw.length)
        ranges.push(range)
      }
      current = walker.nextNode()
    }
    return ranges
  }

  #checkTarget(entry: StoredOccurrence): void {
    if (!this.#target || !targetMatches(this.#target, entry.descriptor)) return
    const snapshot = this.#snapshot(entry)
    if (!snapshot.visible || this.#lastTargetFound === snapshot.occurrenceId) return
    this.#lastTargetFound = snapshot.occurrenceId
    this.#emit('target-found', snapshot, undefined, this.#target)
    this.#refreshOverlay()
  }

  #createOverlay(): { overlay: HTMLDivElement; label: HTMLDivElement } {
    const overlay = this.#document.createElement('div')
    overlay.dataset.collectI18nOverlay = 'true'
    Object.assign(overlay.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      display: 'none',
      border: '3px solid #ff4d4f',
      background: 'rgba(255, 77, 79, 0.10)',
      boxSizing: 'border-box',
      borderRadius: '3px',
    })
    const label = this.#document.createElement('div')
    Object.assign(label.style, {
      position: 'absolute',
      left: '-3px',
      bottom: '100%',
      maxWidth: '60vw',
      padding: '3px 7px',
      color: '#fff',
      background: '#ff4d4f',
      font: '12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    })
    overlay.append(label)
    ;(this.#document.body ?? this.#document.documentElement).append(overlay)
    return { overlay, label }
  }

  #refreshOverlay = (): void => {
    if (!this.#overlay || !this.#overlayLabel) return
    const target = this.#target
    const occurrence = target
      ? this.getSnapshot().find((item) => targetMatches(target, item) && item.visible)
      : undefined
    if (!occurrence?.rect) {
      this.#overlay.style.display = 'none'
      return
    }
    Object.assign(this.#overlay.style, {
      display: 'block',
      left: `${occurrence.rect.left}px`,
      top: `${occurrence.rect.top}px`,
      width: `${occurrence.rect.width}px`,
      height: `${occurrence.rect.height}px`,
    })
    const labelText = occurrence.key
      ? `${occurrence.key} · ${occurrence.occurrenceId}`
      : occurrence.occurrenceId
    // Reassigning textContent creates child-list mutations even when the text
    // is unchanged. Because the collector observes teleported DOM, that used
    // to recursively schedule overlay refreshes and starve page.evaluate().
    if (this.#overlayLabel.textContent !== labelText) this.#overlayLabel.textContent = labelText
  }
}
