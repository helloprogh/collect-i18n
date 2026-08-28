const SINK_ATTRIBUTE = 'data-collect-i18n-sink';
const NATIVE_SELECTOR = `[${SINK_ATTRIBUTE}],[data-i18n-key],[data-collect-i18n-bindings]`;
const ELEMENT_PLUS_SELECTORS = '.el-message,.el-notification,.el-message-box,.el-message-box__wrapper';
// Keep the transport payload tiny and in the BMP. Encoding the full occurrence
// id as Unicode tag characters makes text shaping disproportionately expensive
// on dense pages (hundreds of translations can stall Chromium). The marker only
// needs to live for the current page/module instance, so a compact in-memory
// token is sufficient and avoids exposing the key or occurrence id in the DOM.
const INLINE_MARKER_BOUNDARY = '\u2063';
const INLINE_MARKER_DIGITS = ['\u2060', '\u2061', '\u2062'];
const occurrenceTokenById = new Map();
const occurrenceIdByToken = new Map();
let nextOccurrenceToken = 1;
function inlineTokenForOccurrence(occurrenceId) {
    const existing = occurrenceTokenById.get(occurrenceId);
    if (existing)
        return existing;
    let value = nextOccurrenceToken++;
    let token = '';
    while (value > 0) {
        token = INLINE_MARKER_DIGITS[value % INLINE_MARKER_DIGITS.length] + token;
        value = Math.floor(value / INLINE_MARKER_DIGITS.length);
    }
    occurrenceTokenById.set(occurrenceId, token);
    occurrenceIdByToken.set(token, occurrenceId);
    return token;
}
export function appendInlineProvenance(value, occurrenceId) {
    return `${value}${INLINE_MARKER_BOUNDARY}${inlineTokenForOccurrence(occurrenceId)}${INLINE_MARKER_BOUNDARY}`;
}
function extractInlineProvenance(value) {
    const pattern = /\u2063([\u2060-\u2062]+)\u2063/gu;
    const markers = [];
    let cleanText = '';
    let cursor = 0;
    for (const match of value.matchAll(pattern)) {
        const index = match.index ?? 0;
        cleanText += value.slice(cursor, index);
        const occurrenceId = occurrenceIdByToken.get(match[1]);
        if (occurrenceId) {
            markers.push({
                occurrenceId,
                cleanOffset: cleanText.length,
                rawOffset: index,
            });
        }
        else {
            cleanText += match[0];
        }
        cursor = index + match[0].length;
    }
    cleanText += value.slice(cursor);
    return { cleanText, markers };
}
const anchorRank = {
    virtual: 0,
    owner: 1,
    range: 2,
    element: 3,
};
const DEFAULT_EVIDENCE = {
    virtual: { grade: 'C', proof: 'descriptor-only' },
    owner: { grade: 'C', proof: 'descriptor-only' },
    range: { grade: 'C', proof: 'text-heuristic' },
    element: { grade: 'C', proof: 'text-heuristic' },
};
function now() {
    return Date.now();
}
function normalizeText(value) {
    if (typeof value === 'string' || typeof value === 'number') {
        return String(value).replace(/\s+/g, ' ').trim();
    }
    return undefined;
}
export function createDerivedOccurrenceId(occurrenceId, actualKey) {
    return `${occurrenceId}::${encodeURIComponent(actualKey)}`;
}
function rectToSnapshot(rect) {
    return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
    };
}
function getRangeRect(range) {
    const primary = range.getBoundingClientRect?.();
    if (primary && (primary.width > 0 || primary.height > 0))
        return primary;
    const rects = Array.from(range.getClientRects?.() ?? []);
    if (rects.length === 0)
        return primary;
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
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
    };
}
function anchorIsConnected(anchor) {
    if (anchor.type === 'virtual')
        return false;
    if (anchor.type === 'element' || anchor.type === 'owner')
        return anchor.element.isConnected;
    return anchor.range.startContainer.isConnected && anchor.range.endContainer.isConnected;
}
function anchorElement(anchor) {
    if (anchor.type === 'element' || anchor.type === 'owner')
        return anchor.element;
    if (anchor.type === 'virtual')
        return undefined;
    const container = anchor.range.startContainer;
    return container.nodeType === 1 ? container : container.parentElement ?? undefined;
}
function rankAnchor(entry, anchor) {
    if (entry.descriptor.kind === 'text' && anchor.type === 'range')
        return 4;
    return anchorRank[anchor.type];
}
function selectAnchor(entry) {
    const anchors = [...entry.anchors.values()];
    const connected = anchors
        .filter(anchorIsConnected)
        .sort((left, right) => rankAnchor(entry, right) - rankAnchor(entry, left) ||
        gradeRank(right.evidence.grade) - gradeRank(left.evidence.grade));
    return (connected[0] ??
        anchors.sort((left, right) => rankAnchor(entry, right) - rankAnchor(entry, left) ||
            gradeRank(right.evidence.grade) - gradeRank(left.evidence.grade))[0] ?? {
        type: 'virtual',
        reason: 'descriptor-only',
        evidence: DEFAULT_EVIDENCE.virtual,
    });
}
function connectedOwnerAnchors(entry) {
    return [...entry.anchors.values()].filter((anchor) => anchor.type === 'owner' && anchorIsConnected(anchor));
}
function connectedElementOwners(entry) {
    return [...new Set(connectedOwnerAnchors(entry).map((anchor) => anchor.element))];
}
function gradeRank(grade) {
    return grade === 'A' ? 3 : grade === 'B' ? 2 : 1;
}
function rangeIsWithinElement(range, element) {
    return element.contains(range.startContainer) && element.contains(range.endContainer);
}
function targetMatches(target, descriptor) {
    if (target.occurrenceId && target.occurrenceId !== descriptor.occurrenceId)
        return false;
    if (target.key && target.key !== descriptor.key)
        return false;
    return Boolean(target.key || target.occurrenceId);
}
function parseBindings(element) {
    const encoded = element.getAttribute('data-collect-i18n-bindings');
    if (encoded) {
        try {
            const parsed = JSON.parse(encoded);
            if (Array.isArray(parsed)) {
                return parsed.filter((item) => typeof item === 'object' &&
                    item !== null &&
                    typeof item.occurrenceId === 'string' &&
                    typeof item.kind === 'string');
            }
        }
        catch {
            // A malformed development-only marker must never affect the host application.
        }
    }
    const key = element.getAttribute('data-i18n-key');
    if (!key)
        return [];
    return [
        {
            occurrenceId: element.getAttribute('data-i18n-occurrence') ??
                `native:${key}:${element.tagName.toLowerCase()}`,
            key,
            kind: 'native',
        },
    ];
}
function parseSinkIds(element) {
    return [...new Set((element.getAttribute(SINK_ATTRIBUTE) ?? '')
            .split(/\s+/)
            .map((value) => value.trim())
            .filter(Boolean))];
}
function elementPlusServiceFor(element) {
    if (element.matches('.el-message'))
        return 'ElMessage';
    if (element.matches('.el-notification'))
        return 'ElNotification';
    if (element.matches('.el-message-box,.el-message-box__wrapper'))
        return 'ElMessageBox';
    return undefined;
}
export class CollectorRegistry {
    #document;
    #options;
    #entries = new Map();
    #derivedOccurrences = new Map();
    #listeners = new Set();
    #events = [];
    #nativeDisposers = new WeakMap();
    #renderedDisposers = new Map();
    #inlineTransportBindings = new WeakMap();
    #pendingInvocations = [];
    #imperativeDisposers = new WeakMap();
    #observer;
    #overlay;
    #overlayLabel;
    #target = null;
    #lastTargetFound;
    #sequence = 0;
    #destroyed = false;
    #resolveScheduled = false;
    #resolvingRendered = false;
    constructor(options = {}) {
        const documentRef = options.document ?? globalThis.document;
        if (!documentRef)
            throw new Error('collect-i18n runtime requires a browser Document');
        this.#document = documentRef;
        this.#options = {
            overlay: options.overlay ?? true,
            scanNativeAttributes: options.scanNativeAttributes ?? true,
            observeTeleport: options.observeTeleport ?? true,
            eventBufferSize: options.eventBufferSize ?? 500,
        };
        if (this.#options.overlay) {
            const { overlay, label } = this.#createOverlay();
            this.#overlay = overlay;
            this.#overlayLabel = label;
        }
        const MutationObserverCtor = documentRef.defaultView?.MutationObserver;
        if (MutationObserverCtor) {
            this.#observer = new MutationObserverCtor((mutations) => this.#handleMutations(mutations));
            const observerRoot = this.#options.observeTeleport
                ? documentRef.documentElement
                : documentRef.body;
            if (observerRoot) {
                this.#observer.observe(observerRoot, {
                    subtree: true,
                    childList: true,
                    characterData: this.#options.observeTeleport,
                    attributes: this.#options.scanNativeAttributes,
                    attributeFilter: this.#options.scanNativeAttributes
                        ? [
                            SINK_ATTRIBUTE,
                            'data-i18n-key',
                            'data-i18n-occurrence',
                            'data-collect-i18n-bindings',
                        ]
                        : undefined,
                });
            }
        }
        if (this.#options.scanNativeAttributes)
            this.rescan(documentRef);
        this.#scanElementPlus(documentRef);
        documentRef.defaultView?.addEventListener('scroll', this.#refreshOverlay, true);
        documentRef.defaultView?.addEventListener('resize', this.#refreshOverlay);
    }
    register(registration) {
        this.#assertActive();
        const token = Symbol(registration.occurrenceId);
        const timestamp = now();
        const previous = this.#entries.get(registration.occurrenceId);
        const descriptor = previous
            ? {
                ...previous.descriptor,
                ...registration,
                source: registration.source ?? previous.descriptor.source,
                metadata: {
                    ...previous.descriptor.metadata,
                    ...registration.metadata,
                },
            }
            : { ...registration };
        delete descriptor.anchor;
        const entry = previous ?? {
            descriptor,
            anchors: new Map(),
            firstSeenAt: timestamp,
            lastSeenAt: timestamp,
        };
        entry.descriptor = descriptor;
        entry.lastSeenAt = timestamp;
        entry.anchors.set(token, registration.anchor ?? {
            type: 'virtual',
            evidence: DEFAULT_EVIDENCE.virtual,
        });
        this.#entries.set(descriptor.occurrenceId, entry);
        this.#emit(previous ? 'updated' : 'registered', this.#snapshot(entry));
        this.#checkTarget(entry);
        this.#scheduleRenderedResolution();
        let disposed = false;
        return () => {
            if (disposed || this.#destroyed)
                return;
            disposed = true;
            const current = this.#entries.get(descriptor.occurrenceId);
            if (!current)
                return;
            current.anchors.delete(token);
            current.lastSeenAt = now();
            if (current.anchors.size === 0) {
                const snapshot = this.#snapshot(current);
                this.#entries.delete(descriptor.occurrenceId);
                this.#emit('removed', snapshot);
            }
            else {
                this.#emit('updated', this.#snapshot(current));
            }
            this.#refreshOverlay();
        };
    }
    registerElement(descriptor, element, evidence = DEFAULT_EVIDENCE.element) {
        return this.register({ ...descriptor, anchor: { type: 'element', element, evidence } });
    }
    registerRange(descriptor, range, evidence = DEFAULT_EVIDENCE.range) {
        return this.register({ ...descriptor, anchor: { type: 'range', range, evidence } });
    }
    registerOwner(descriptor, element, evidence = DEFAULT_EVIDENCE.owner) {
        return this.register({ ...descriptor, anchor: { type: 'owner', element, evidence } });
    }
    registerVirtual(descriptor, reason = 'descriptor-only') {
        return this.register({
            ...descriptor,
            anchor: { type: 'virtual', reason, evidence: DEFAULT_EVIDENCE.virtual },
        });
    }
    registerComponentProp(descriptor, target) {
        const element = typeof target === 'function' ? target() : target;
        if (element) {
            return this.registerOwner({ ...descriptor, kind: 'component-prop' }, element, { grade: 'B', proof: 'compiler-component-scope' });
        }
        return this.registerVirtual({ ...descriptor, kind: 'component-prop' }, 'component root is not mounted');
    }
    registerImperativeInvocation(invocation) {
        const dispose = this.registerVirtual({ ...invocation.descriptor, kind: 'imperative-service', renderedText: invocation.text }, 'waiting for imperative service DOM');
        const pending = {
            invocation,
            dispose,
            timeout: setTimeout(() => {
                const index = this.#pendingInvocations.indexOf(pending);
                if (index >= 0)
                    this.#pendingInvocations.splice(index, 1);
                dispose();
            }, 15_000),
        };
        this.#pendingInvocations.push(pending);
        return () => {
            clearTimeout(pending.timeout);
            const index = this.#pendingInvocations.indexOf(pending);
            if (index >= 0)
                this.#pendingInvocations.splice(index, 1);
            dispose();
        };
    }
    recordRenderedValue(occurrenceId, value, actualKey) {
        const entry = this.#entries.get(occurrenceId);
        if (!entry)
            return value;
        const renderedText = normalizeText(value);
        if (actualKey && entry.descriptor.keyExpression) {
            const derivedId = createDerivedOccurrenceId(occurrenceId, actualKey);
            let derived = this.#entries.get(derivedId);
            if (!derived) {
                this.registerVirtual({
                    ...entry.descriptor,
                    occurrenceId: derivedId,
                    key: actualKey,
                    renderedText,
                    metadata: {
                        ...entry.descriptor.metadata,
                        canarySafe: true,
                        dynamicBaseOccurrenceId: occurrenceId,
                    },
                }, 'dynamic key awaiting its compiler-owned host');
                derived = this.#entries.get(derivedId);
                const derivedIds = this.#derivedOccurrences.get(occurrenceId) ?? new Set();
                derivedIds.add(derivedId);
                this.#derivedOccurrences.set(occurrenceId, derivedIds);
                if (derived) {
                    for (const anchor of connectedOwnerAnchors(entry)) {
                        this.registerOwner(derived.descriptor, anchor.element, anchor.evidence);
                    }
                }
            }
            if (derived) {
                derived.descriptor = {
                    ...derived.descriptor,
                    key: actualKey,
                    renderedText,
                };
                derived.lastSeenAt = now();
                this.#emit('rendered-value', this.#snapshot(derived), { renderedText, actualKey });
            }
            this.#scheduleRenderedResolution();
            return value;
        }
        entry.descriptor = {
            ...entry.descriptor,
            key: actualKey ?? entry.descriptor.key,
            renderedText,
        };
        entry.lastSeenAt = now();
        this.#emit('rendered-value', this.#snapshot(entry), { renderedText, actualKey });
        this.#scheduleRenderedResolution();
        return value;
    }
    setTarget(target) {
        this.#target = target && (target.key || target.occurrenceId) ? { ...target } : null;
        this.#lastTargetFound = undefined;
        this.#emit('target-changed', undefined, undefined, this.#target ?? undefined);
        if (this.#target) {
            for (const entry of this.#entries.values())
                this.#checkTarget(entry);
        }
        this.#refreshOverlay();
    }
    getTarget() {
        return this.#target ? { ...this.#target } : null;
    }
    focus(keyOrTarget) {
        const target = typeof keyOrTarget === 'string' ? { key: keyOrTarget } : keyOrTarget;
        this.setTarget(target);
        const candidates = [...this.#entries.values()]
            .filter((entry) => targetMatches(target, entry.descriptor))
            .map((entry) => ({ entry, snapshot: this.#snapshot(entry) }))
            .filter(({ snapshot }) => snapshot.connected)
            .sort((left, right) => {
            if (left.snapshot.visible !== right.snapshot.visible)
                return left.snapshot.visible ? -1 : 1;
            if (left.snapshot.evidenceGrade !== right.snapshot.evidenceGrade) {
                return gradeRank(right.snapshot.evidenceGrade) - gradeRank(left.snapshot.evidenceGrade);
            }
            return right.entry.lastSeenAt - left.entry.lastSeenAt;
        });
        const selected = candidates[0];
        if (!selected)
            return undefined;
        const anchor = selectAnchor(selected.entry);
        anchorElement(anchor)?.scrollIntoView?.({ behavior: 'auto', block: 'center', inline: 'center' });
        const snapshot = this.#snapshot(selected.entry);
        this.#checkTarget(selected.entry);
        this.#refreshOverlay();
        return snapshot;
    }
    waitForTarget(target, options = {}) {
        const requireVisible = options.requireVisible ?? true;
        const existing = this.getSnapshot().find((item) => targetMatches(target, item) && (!requireVisible || item.visible));
        if (existing)
            return Promise.resolve(existing);
        this.setTarget(target);
        return new Promise((resolve, reject) => {
            let timeout;
            const cleanup = () => {
                unsubscribe();
                if (timeout)
                    clearTimeout(timeout);
                options.signal?.removeEventListener('abort', onAbort);
            };
            const onAbort = () => {
                cleanup();
                reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
            };
            const unsubscribe = this.subscribe((event) => {
                if (event.type !== 'target-found' || !event.occurrence)
                    return;
                if (requireVisible && !event.occurrence.visible)
                    return;
                cleanup();
                resolve(event.occurrence);
            });
            if (options.timeoutMs && options.timeoutMs > 0) {
                timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error(`Timed out waiting for i18n target after ${options.timeoutMs}ms`));
                }, options.timeoutMs);
            }
            options.signal?.addEventListener('abort', onAbort, { once: true });
            if (options.signal?.aborted)
                onAbort();
        });
    }
    getOccurrence(occurrenceId) {
        const entry = this.#entries.get(occurrenceId);
        return entry ? this.#snapshot(entry) : undefined;
    }
    getDerivedOccurrences(occurrenceId) {
        return [...(this.#derivedOccurrences.get(occurrenceId) ?? [])]
            .map((derivedId) => this.#entries.get(derivedId))
            .filter((entry) => Boolean(entry))
            .map((entry) => this.#snapshot(entry));
    }
    getSnapshot() {
        return [...this.#entries.values()]
            .map((entry) => this.#snapshot(entry))
            .sort((left, right) => left.occurrenceId.localeCompare(right.occurrenceId));
    }
    eventsSince(sequence = 0) {
        return this.#events.filter((event) => event.sequence > sequence).map((event) => ({ ...event }));
    }
    subscribe(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    rescan(root = this.#document) {
        if (this.#destroyed)
            return;
        // The owning view can be null while the page is being torn down;
        // instanceof against undefined would throw.
        const view = this.#document.defaultView;
        const elements = [];
        if (view && root instanceof view.Element && root.matches(NATIVE_SELECTOR)) {
            elements.push(root);
        }
        elements.push(...Array.from(root.querySelectorAll(NATIVE_SELECTOR)));
        for (const element of elements)
            this.#registerNativeElement(element);
        this.#scanInlineProvenance(root);
        this.#scanElementPlus(root);
        this.#scheduleRenderedResolution();
    }
    destroy() {
        if (this.#destroyed)
            return;
        this.#destroyed = true;
        this.#observer?.disconnect();
        this.#document.defaultView?.removeEventListener('scroll', this.#refreshOverlay, true);
        this.#document.defaultView?.removeEventListener('resize', this.#refreshOverlay);
        this.#overlay?.remove();
        for (const dispose of this.#renderedDisposers.values())
            dispose();
        for (const pending of this.#pendingInvocations) {
            clearTimeout(pending.timeout);
            pending.dispose();
        }
        this.#renderedDisposers.clear();
        this.#pendingInvocations.length = 0;
        this.#derivedOccurrences.clear();
        this.#entries.clear();
        this.#emit('destroyed');
        this.#listeners.clear();
    }
    #assertActive() {
        if (this.#destroyed)
            throw new Error('collect-i18n runtime has been destroyed');
    }
    #snapshot(entry) {
        const anchor = selectAnchor(entry);
        let rect;
        let text;
        if (anchor.type === 'element') {
            rect = anchor.element.getBoundingClientRect();
            const boundAttribute = entry.descriptor.prop
                ? anchor.element.getAttribute(entry.descriptor.prop)
                : undefined;
            text = normalizeText(boundAttribute ||
                anchor.element.textContent ||
                anchor.element.getAttribute('placeholder') ||
                anchor.element.getAttribute('title') ||
                anchor.element.getAttribute('aria-label'));
        }
        else if (anchor.type === 'range') {
            rect = getRangeRect(anchor.range);
            text = normalizeText(anchor.range.toString());
        }
        const connected = anchorIsConnected(anchor);
        const view = this.#document.defaultView;
        const styledElement = anchorElement(anchor);
        const style = styledElement ? view?.getComputedStyle(styledElement) : undefined;
        const inputLike = styledElement?.tagName === 'INPUT' || styledElement?.tagName === 'TEXTAREA'
            ? styledElement
            : undefined;
        const visualNativeValueHidden = (entry.descriptor.prop === 'placeholder' && Boolean(inputLike?.value)) ||
            (styledElement?.tagName === 'INPUT' &&
                styledElement.type.toLowerCase() === 'hidden');
        const viewportWidth = view?.innerWidth ?? this.#document.documentElement.clientWidth;
        const viewportHeight = view?.innerHeight ?? this.#document.documentElement.clientHeight;
        const intersectsViewport = Boolean(rect &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < viewportHeight &&
            rect.left < viewportWidth);
        const visible = Boolean(connected &&
            rect &&
            rect.width > 0 &&
            rect.height > 0 &&
            intersectsViewport &&
            !visualNativeValueHidden &&
            style?.display !== 'none' &&
            style?.visibility !== 'hidden');
        return {
            ...entry.descriptor,
            anchorType: anchor.type,
            evidenceGrade: anchor.evidence.grade,
            evidenceProof: anchor.evidence.proof,
            connected,
            visible: anchor.type === 'owner' ? false : visible,
            text: text ?? entry.descriptor.renderedText,
            rect: rect ? rectToSnapshot(rect) : undefined,
            firstSeenAt: entry.firstSeenAt,
            lastSeenAt: entry.lastSeenAt,
        };
    }
    #emit(type, occurrence, details, target) {
        const event = {
            sequence: ++this.#sequence,
            type,
            timestamp: now(),
            occurrence,
            target,
            details,
        };
        this.#events.push(event);
        if (this.#events.length > this.#options.eventBufferSize)
            this.#events.shift();
        for (const listener of this.#listeners)
            listener(event);
        const view = this.#document.defaultView;
        view?.dispatchEvent(new view.CustomEvent('collect-i18n:event', { detail: event }));
    }
    #registerNativeElement(element) {
        const previous = this.#nativeDisposers.get(element);
        if (previous) {
            for (const dispose of previous)
                dispose();
        }
        const descriptors = new Map();
        for (const descriptor of parseBindings(element)) {
            descriptors.set(descriptor.occurrenceId, descriptor);
        }
        for (const occurrenceId of parseSinkIds(element)) {
            const descriptor = this.#entries.get(occurrenceId)?.descriptor;
            if (descriptor)
                descriptors.set(occurrenceId, descriptor);
            for (const derived of this.getDerivedOccurrences(occurrenceId)) {
                descriptors.set(derived.occurrenceId, derived);
            }
        }
        const disposers = [...descriptors.values()].map((descriptor) => {
            if (descriptor.kind === 'native') {
                return this.registerElement(descriptor, element, { grade: 'A', proof: 'compiler-native-sink' });
            }
            const evidence = descriptor.component || descriptor.kind === 'component-prop'
                ? { grade: 'B', proof: 'compiler-component-scope' }
                : { grade: 'A', proof: 'compiler-text-sink' };
            return this.registerOwner(descriptor, element, evidence);
        });
        this.#nativeDisposers.set(element, disposers);
    }
    #handleMutations(mutations) {
        const view = this.#document.defaultView;
        if (!view)
            return;
        const attributeTargets = new Set();
        const removedRoots = new Set();
        const scanRoots = new Set();
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.target instanceof view.Element) {
                attributeTargets.add(mutation.target);
            }
            for (const node of Array.from(mutation.removedNodes)) {
                removedRoots.add(node);
            }
            for (const node of Array.from(mutation.addedNodes)) {
                scanRoots.add(node);
            }
            if (mutation.type === 'characterData' &&
                mutation.target instanceof view.Text) {
                scanRoots.add(mutation.target);
            }
            const mutationElement = mutation.target instanceof view.Element
                ? mutation.target
                : mutation.target.parentElement;
            if (mutationElement)
                scanRoots.add(mutationElement);
        }
        // Disposals first: bindings of removed subtrees must be gone before any
        // rescan, so a node removed and re-added in one batch re-registers cleanly.
        for (const node of removedRoots) {
            this.#disposeInlineTransportTree(node);
            if (node instanceof view.Element) {
                this.#disposeNativeTree(node);
                this.#disposeImperativeTree(node);
            }
        }
        for (const element of attributeTargets) {
            this.#registerNativeElement(element);
        }
        // One scan per topmost distinct root. A busy batch that touches body and
        // dozens of descendants used to rescan the whole page once per mutation
        // record — deep-DOM pages could starve the collector's own page.evaluate
        // (a regression observed once before the budget guard existed). Scans are
        // idempotent, so collapsing overlapping roots is behavior-preserving.
        for (const root of this.#topmostRoots(scanRoots)) {
            if (root instanceof view.Element && this.#options.scanNativeAttributes) {
                this.rescan(root);
            }
            else {
                this.#scanInlineProvenance(root);
                if (root instanceof view.Element)
                    this.#scanElementPlus(root);
            }
        }
        this.#scheduleRenderedResolution();
        this.#refreshOverlay();
    }
    /** Candidates that no other candidate contains — scanning each once covers every candidate subtree exactly once. */
    #topmostRoots(candidates) {
        const roots = [];
        for (const candidate of candidates) {
            let covered = false;
            for (const other of candidates) {
                if (other !== candidate && other.contains(candidate)) {
                    covered = true;
                    break;
                }
            }
            if (!covered)
                roots.push(candidate);
        }
        return roots;
    }
    #disposeNativeTree(root) {
        const candidates = [root, ...Array.from(root.querySelectorAll(NATIVE_SELECTOR))];
        for (const element of candidates) {
            for (const dispose of this.#nativeDisposers.get(element) ?? [])
                dispose();
            this.#nativeDisposers.delete(element);
        }
    }
    #disposeImperativeTree(root) {
        const candidates = [root, ...Array.from(root.querySelectorAll(ELEMENT_PLUS_SELECTORS))];
        for (const element of candidates) {
            for (const binding of this.#imperativeDisposers.get(element)?.values() ?? []) {
                binding.dispose();
            }
            this.#imperativeDisposers.delete(element);
        }
    }
    #inlineTextNodes(root) {
        const nodes = [];
        const visit = (node) => {
            if (node instanceof this.#document.defaultView.Text) {
                nodes.push(node);
                return;
            }
            for (const child of Array.from(node.childNodes))
                visit(child);
        };
        visit(root);
        return nodes;
    }
    #disposeInlineTransportTree(root) {
        for (const node of this.#inlineTextNodes(root)) {
            const binding = this.#inlineTransportBindings.get(node);
            for (const dispose of binding?.disposers ?? [])
                dispose();
            this.#inlineTransportBindings.delete(node);
        }
    }
    #scanInlineProvenance(root) {
        for (const node of this.#inlineTextNodes(root)) {
            const rawText = node.nodeValue ?? '';
            const extracted = extractInlineProvenance(rawText);
            const previous = this.#inlineTransportBindings.get(node);
            if (extracted.markers.length === 0) {
                if (previous && previous.rawText !== rawText) {
                    for (const dispose of previous.disposers)
                        dispose();
                    this.#inlineTransportBindings.delete(node);
                }
                continue;
            }
            if (previous?.rawText === rawText)
                continue;
            for (const dispose of previous?.disposers ?? [])
                dispose();
            const disposers = [];
            for (const marker of extracted.markers) {
                const descriptor = this.getOccurrence(marker.occurrenceId);
                if (!descriptor)
                    continue;
                const renderedText = normalizeText(descriptor.renderedText);
                const rawRenderedText = typeof descriptor.renderedText === 'string' || typeof descriptor.renderedText === 'number'
                    ? String(descriptor.renderedText)
                    : undefined;
                const segmentStart = rawRenderedText && rawText.slice(0, marker.rawOffset).endsWith(rawRenderedText)
                    ? marker.rawOffset - rawRenderedText.length
                    : 0;
                const segmentEnd = marker.rawOffset;
                const range = this.#document.createRange();
                range.setStart(node, Math.max(0, segmentStart));
                range.setEnd(node, Math.max(segmentStart, segmentEnd));
                disposers.push(this.registerRange({
                    ...descriptor,
                    kind: 'text',
                    renderedText: renderedText ?? extracted.cleanText,
                    metadata: {
                        ...descriptor.metadata,
                        inlineTransport: true,
                    },
                }, range, { grade: 'A', proof: 'compiler-inline-transport' }));
            }
            if (disposers.length > 0) {
                this.#inlineTransportBindings.set(node, {
                    rawText,
                    disposers,
                });
            }
        }
    }
    #scanElementPlus(root) {
        const elements = new Set();
        if (root instanceof this.#document.defaultView.Element) {
            const container = root.closest(ELEMENT_PLUS_SELECTORS);
            if (container)
                elements.add(container);
        }
        for (const element of Array.from(root.querySelectorAll(ELEMENT_PLUS_SELECTORS))) {
            elements.add(element);
        }
        for (const element of elements)
            this.#bindElementPlusElement(element);
    }
    #bindElementPlusElement(element) {
        if (element.matches('.el-message-box__wrapper') &&
            element.querySelector('.el-message-box')) {
            return;
        }
        const service = elementPlusServiceFor(element);
        const containerText = normalizeText(element.textContent);
        const descriptors = [...this.#entries.values()]
            .filter((entry) => entry.descriptor.kind === 'imperative-service' &&
            (!service || !entry.descriptor.service || entry.descriptor.service === service) &&
            Boolean(normalizeText(entry.descriptor.renderedText)))
            .sort((left, right) => {
            const leftTarget = this.#target && targetMatches(this.#target, left.descriptor) ? 1 : 0;
            const rightTarget = this.#target && targetMatches(this.#target, right.descriptor) ? 1 : 0;
            return rightTarget - leftTarget || right.lastSeenAt - left.lastSeenAt;
        });
        const descriptorsByText = new Map();
        for (const { descriptor } of descriptors) {
            const text = normalizeText(descriptor.renderedText);
            if (!text)
                continue;
            const group = descriptorsByText.get(text) ?? [];
            group.push(descriptor);
            descriptorsByText.set(text, group);
        }
        const matches = [];
        for (const [text, group] of descriptorsByText) {
            const keys = new Set(group.map((descriptor) => descriptor.key).filter(Boolean));
            // Identical copy from different keys remains ambiguous. Repeated DOM
            // nodes for the same key (for example one MessageBox title + body) are
            // equivalent evidence and may be paired deterministically.
            if (keys.size > 1)
                continue;
            const ranges = this.#findTextRanges(text, element);
            const attributeElements = ranges.length === 0
                ? [
                    ...(element.matches('[placeholder]') ? [element] : []),
                    ...Array.from(element.querySelectorAll('[placeholder]')),
                ].filter((candidate) => normalizeText(candidate.getAttribute('placeholder')) === text)
                : [];
            const anchors = ranges.length > 0 ? ranges : attributeElements;
            if (anchors.length === 0)
                continue;
            for (const [index, descriptor] of group.entries()) {
                matches.push({
                    descriptor,
                    text,
                    anchor: anchors[Math.min(index, anchors.length - 1)],
                });
            }
        }
        const composite = matches.length > 1;
        const bindings = this.#imperativeDisposers.get(element) ?? new Map();
        const matchedIds = new Set(matches.map(({ descriptor }) => descriptor.occurrenceId));
        for (const [occurrenceId, binding] of bindings) {
            if (matchedIds.has(occurrenceId))
                continue;
            binding.dispose();
            bindings.delete(occurrenceId);
        }
        for (const { descriptor, text, anchor } of matches) {
            const anchoredElement = anchor instanceof this.#document.defaultView.Element ? anchor : undefined;
            const range = anchoredElement ? undefined : anchor;
            const useElement = Boolean(anchoredElement) || (!composite && containerText === text);
            const anchorType = useElement ? 'element' : 'range';
            const elementAnchor = anchoredElement ?? element;
            const anchorNode = useElement ? elementAnchor : range.startContainer;
            const matchingInvocations = this.#pendingInvocations.filter((pending) => pending.invocation.descriptor.occurrenceId === descriptor.occurrenceId &&
                pending.invocation.descriptor.service === descriptor.service);
            const invocationStamped = typeof descriptor.metadata?.invocationId === 'string' &&
                descriptor.metadata.invocationId.length > 0;
            const evidence = matchingInvocations.length === 1 || invocationStamped
                ? { grade: 'B', proof: 'element-plus-invocation' }
                : { grade: 'C', proof: 'imperative-text-heuristic' };
            const existing = bindings.get(descriptor.occurrenceId);
            if (existing &&
                existing.anchorType === anchorType &&
                existing.anchorNode === anchorNode &&
                (useElement ||
                    (existing.startOffset === range.startOffset && existing.endOffset === range.endOffset))) {
                this.#settlePendingInvocation(descriptor.occurrenceId);
                continue;
            }
            existing?.dispose();
            const dispose = useElement
                ? this.registerElement({ ...descriptor, renderedText: text }, elementAnchor, evidence)
                : this.registerRange({ ...descriptor, renderedText: text }, range, evidence);
            bindings.set(descriptor.occurrenceId, {
                anchorNode,
                anchorType,
                startOffset: useElement ? undefined : range.startOffset,
                endOffset: useElement ? undefined : range.endOffset,
                dispose,
            });
            this.#settlePendingInvocation(descriptor.occurrenceId);
        }
        if (bindings.size > 0)
            this.#imperativeDisposers.set(element, bindings);
        else
            this.#imperativeDisposers.delete(element);
    }
    #settlePendingInvocation(occurrenceId) {
        for (let index = this.#pendingInvocations.length - 1; index >= 0; index -= 1) {
            const pending = this.#pendingInvocations[index];
            if (pending.invocation.descriptor.occurrenceId !== occurrenceId)
                continue;
            this.#pendingInvocations.splice(index, 1);
            clearTimeout(pending.timeout);
            pending.dispose();
        }
    }
    #scheduleRenderedResolution() {
        if (this.#resolveScheduled || this.#resolvingRendered || this.#destroyed)
            return;
        this.#resolveScheduled = true;
        queueMicrotask(() => {
            this.#resolveScheduled = false;
            if (this.#destroyed)
                return;
            this.#resolvingRendered = true;
            try {
                this.#resolveRenderedOccurrences();
            }
            finally {
                this.#resolvingRendered = false;
            }
        });
    }
    #resolveRenderedOccurrences() {
        const entries = [...this.#entries.values()].sort((left, right) => {
            const leftTarget = this.#target && targetMatches(this.#target, left.descriptor) ? 1 : 0;
            const rightTarget = this.#target && targetMatches(this.#target, right.descriptor) ? 1 : 0;
            return rightTarget - leftTarget;
        });
        for (const entry of entries) {
            const descriptor = entry.descriptor;
            const text = normalizeText(descriptor.renderedText);
            if (!text || descriptor.kind === 'native' || descriptor.kind === 'imperative-service')
                continue;
            const existing = selectAnchor(entry);
            // A compiled native owner is stronger evidence than a text-identical node
            // elsewhere in the page. Inspect every registered anchor instead of only
            // `existing`: text ranges intentionally outrank elements in selectAnchor,
            // so an older global fallback may otherwise hide the real owner forever.
            const compilerOwners = connectedElementOwners(entry);
            const strongestOwnerEvidence = connectedOwnerAnchors(entry)
                .map((anchor) => anchor.evidence)
                .sort((left, right) => gradeRank(right.grade) - gradeRank(left.grade))[0];
            const textOwners = descriptor.kind === 'text' ? compilerOwners : [];
            const expectedEvidence = compilerOwners.length > 0
                ? strongestOwnerEvidence ??
                    (descriptor.component || descriptor.kind === 'component-prop'
                        ? { grade: 'B', proof: 'compiler-component-scope' }
                        : { grade: 'A', proof: 'compiler-text-sink' })
                : { grade: 'C', proof: 'text-heuristic' };
            const needsTextRange = descriptor.kind === 'text' &&
                (existing.type !== 'range' ||
                    Boolean(textOwners.length > 0 &&
                        !textOwners.some((owner) => rangeIsWithinElement(existing.range, owner))) ||
                    gradeRank(existing.evidence.grade) < gradeRank(expectedEvidence.grade));
            const needsComponentElement = descriptor.kind === 'component-prop' &&
                (compilerOwners.length > 0
                    ? existing.type === 'virtual' ||
                        existing.type === 'owner' ||
                        !anchorElement(existing) ||
                        !compilerOwners.some((owner) => owner.contains(anchorElement(existing))) ||
                        gradeRank(existing.evidence.grade) < gradeRank(expectedEvidence.grade)
                    : existing.type !== 'element');
            if (!needsTextRange &&
                !needsComponentElement &&
                existing.type !== 'virtual' &&
                anchorIsConnected(existing)) {
                continue;
            }
            const match = descriptor.kind === 'component-prop'
                ? this.#findComponentPropAnchor(descriptor, text, compilerOwners)
                : this.#findTextRange(text, textOwners);
            if (!match) {
                if (descriptor.kind === 'text' &&
                    textOwners.length > 0 &&
                    existing.type === 'range' &&
                    !textOwners.some((owner) => rangeIsWithinElement(existing.range, owner))) {
                    // The compiled owner is authoritative. If it has not rendered the
                    // expected text yet, discard a stale global fallback instead of
                    // continuing to expose an unrelated same-text node as evidence.
                    this.#renderedDisposers.get(descriptor.occurrenceId)?.();
                    this.#renderedDisposers.delete(descriptor.occurrenceId);
                }
                if (descriptor.kind === 'component-prop' && existing.type === 'range') {
                    this.#renderedDisposers.get(descriptor.occurrenceId)?.();
                    this.#renderedDisposers.delete(descriptor.occurrenceId);
                }
                continue;
            }
            if (match instanceof this.#document.defaultView.Range &&
                existing.type === 'range' &&
                anchorIsConnected(existing) &&
                existing.range.startContainer === match.startContainer &&
                existing.range.startOffset === match.startOffset &&
                existing.range.endContainer === match.endContainer &&
                existing.range.endOffset === match.endOffset &&
                gradeRank(existing.evidence.grade) >= gradeRank(expectedEvidence.grade)) {
                continue;
            }
            this.#renderedDisposers.get(descriptor.occurrenceId)?.();
            const dispose = match instanceof this.#document.defaultView.Range
                ? this.registerRange(descriptor, match, expectedEvidence)
                : this.registerElement(descriptor, match, expectedEvidence);
            this.#renderedDisposers.set(descriptor.occurrenceId, dispose);
        }
    }
    #findComponentPropAnchor(descriptor, text, roots = []) {
        // Only attributes whose value is directly painted by the browser qualify
        // as an initial-state screenshot target. `title` and `aria-label` are
        // meaningful UI copy, but they require a hover/accessibility interaction;
        // treating them as visible would frame the whole owner element.
        const attributes = descriptor.prop === 'placeholder' || descriptor.prop === 'value'
            ? [descriptor.prop]
            : [];
        const candidatesIn = (root) => {
            const matchedElements = new Set();
            for (const attribute of attributes) {
                const rootElement = root instanceof this.#document.defaultView.Element ? root : undefined;
                const elements = [
                    ...(rootElement?.matches(`[${attribute}]`) ? [rootElement] : []),
                    ...Array.from(root.querySelectorAll(`[${attribute}]`)),
                ];
                for (const element of elements) {
                    if (normalizeText(element.getAttribute(attribute)) === text) {
                        matchedElements.add(element);
                    }
                }
            }
            return matchedElements;
        };
        if (roots.length > 0) {
            for (const root of roots) {
                const exactTextRanges = this.#findTextRanges(text, root, true);
                if (exactTextRanges.length === 1)
                    return exactTextRanges[0];
                if (exactTextRanges.length > 1)
                    continue;
                const textRanges = this.#findTextRanges(text, root);
                if (textRanges.length === 1)
                    return textRanges[0];
                if (textRanges.length > 1)
                    continue;
                const matchedElements = candidatesIn(root);
                if (matchedElements.size === 1)
                    return [...matchedElements][0];
            }
            return undefined;
        }
        // Component libraries often render a prop as text instead of forwarding it
        // as a DOM attribute. Prefer one exact text node before considering
        // substring matches: e.g. the table header "运行状态" must not become
        // ambiguous merely because a page subtitle contains "…及其运行状态".
        const exactTextRanges = this.#findTextRanges(text, this.#document, true);
        if (exactTextRanges.length > 0) {
            return exactTextRanges.length === 1 ? exactTextRanges[0] : undefined;
        }
        const textRanges = this.#findTextRanges(text, this.#document);
        if (textRanges.length > 0)
            return textRanges.length === 1 ? textRanges[0] : undefined;
        const matchedElements = candidatesIn(this.#document);
        return matchedElements.size === 1 ? [...matchedElements][0] : undefined;
    }
    #findTextRange(text, roots = []) {
        if (roots.length > 0) {
            for (const root of roots) {
                const exact = this.#findTextRanges(text, root, true);
                if (exact.length === 1)
                    return exact[0];
                if (exact.length > 1)
                    continue;
                const partial = this.#findTextRanges(text, root);
                if (partial.length === 1)
                    return partial[0];
            }
            return undefined;
        }
        // Descriptor-only slot text has no compiled owner, so it must be globally
        // unique. Prefer an EXACT text match: substring matching makes a short
        // label ambiguous whenever another node merely contains it (for example a
        // dialog title "确认创建同步任务" shadowing a confirm button "确认创建", or
        // a section header "确认取消 6" shadowing a confirm button "确认取消").
        // Fall back to substring uniqueness only when no exact text node exists.
        const exact = this.#findTextRanges(text, undefined, true);
        if (exact.length === 1)
            return exact[0];
        if (exact.length === 0) {
            const partial = this.#findTextRanges(text, undefined, false);
            return partial.length === 1 ? partial[0] : undefined;
        }
        return undefined;
    }
    #findTextRanges(text, root = this.#document.body ?? this.#document.documentElement, exactOnly = false) {
        const NodeFilterRef = this.#document.defaultView?.NodeFilter;
        const walker = this.#document.createTreeWalker(root, NodeFilterRef?.SHOW_TEXT ?? 4);
        const ranges = [];
        let current = walker.nextNode();
        while (current) {
            const raw = current.nodeValue ?? '';
            const normalized = normalizeText(raw);
            const parent = current.parentElement;
            const excluded = parent?.closest('[data-collect-i18n-overlay]') ||
                parent?.closest('script,style,noscript,template');
            const matches = exactOnly
                ? normalized === text
                : normalized === text || Boolean(normalized?.includes(text));
            if (!excluded && matches) {
                const range = this.#document.createRange();
                const direct = raw.indexOf(text);
                if (direct >= 0) {
                    range.setStart(current, direct);
                    range.setEnd(current, direct + text.length);
                }
                else {
                    // The normalized text matched but the raw node contains runs of
                    // whitespace (e.g. newlines in the markup). Map the match back onto
                    // raw with a whitespace-flexible scan so the range hugs the real
                    // text instead of falling back to the whole node, which makes the
                    // capture frame far larger than the translated target.
                    const flexible = new RegExp(text
                        .trim()
                        .split(/\s+/u)
                        .filter(Boolean)
                        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                        .join('\\s+'), 'u');
                    const match = flexible.exec(raw);
                    if (match) {
                        range.setStart(current, match.index);
                        range.setEnd(current, match.index + match[0].length);
                    }
                    else {
                        range.setStart(current, 0);
                        range.setEnd(current, raw.length);
                    }
                }
                ranges.push(range);
            }
            current = walker.nextNode();
        }
        return ranges;
    }
    #checkTarget(entry) {
        if (!this.#target || !targetMatches(this.#target, entry.descriptor))
            return;
        const snapshot = this.#snapshot(entry);
        if (!snapshot.visible || this.#lastTargetFound === snapshot.occurrenceId)
            return;
        this.#lastTargetFound = snapshot.occurrenceId;
        this.#emit('target-found', snapshot, undefined, this.#target);
        this.#refreshOverlay();
    }
    #createOverlay() {
        const overlay = this.#document.createElement('div');
        overlay.dataset.collectI18nOverlay = 'true';
        Object.assign(overlay.style, {
            position: 'fixed',
            zIndex: '2147483647',
            pointerEvents: 'none',
            display: 'none',
            border: '3px solid #ff4d4f',
            background: 'rgba(255, 77, 79, 0.10)',
            boxSizing: 'border-box',
            borderRadius: '3px',
        });
        const label = this.#document.createElement('div');
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
        });
        overlay.append(label);
        (this.#document.body ?? this.#document.documentElement).append(overlay);
        return { overlay, label };
    }
    #refreshOverlay = () => {
        if (!this.#overlay || !this.#overlayLabel)
            return;
        const target = this.#target;
        const occurrence = target
            ? this.getSnapshot().find((item) => targetMatches(target, item) && item.visible)
            : undefined;
        if (!occurrence?.rect) {
            this.#overlay.style.display = 'none';
            return;
        }
        Object.assign(this.#overlay.style, {
            display: 'block',
            left: `${occurrence.rect.left}px`,
            top: `${occurrence.rect.top}px`,
            width: `${occurrence.rect.width}px`,
            height: `${occurrence.rect.height}px`,
        });
        const labelText = occurrence.key
            ? `${occurrence.key} · ${occurrence.occurrenceId}`
            : occurrence.occurrenceId;
        // Reassigning textContent creates child-list mutations even when the text
        // is unchanged. Because the collector observes teleported DOM, that used
        // to recursively schedule overlay refreshes and starve page.evaluate().
        if (this.#overlayLabel.textContent !== labelText)
            this.#overlayLabel.textContent = labelText;
    };
}
//# sourceMappingURL=registry.js.map