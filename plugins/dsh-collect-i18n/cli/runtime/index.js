import { appendInlineProvenance, CollectorRegistry, createDerivedOccurrenceId, } from './registry.js';
export * from './element-plus.js';
export * from './registry.js';
export * from './types.js';
const activeImperativeInvocations = [];
let imperativeInvocationSequence = 0;
const vnodeScopeDisposers = new WeakMap();
export const CAUSAL_PROBE_STORAGE_KEY = '__collect_i18n_causal_probe_v1';
function isRuntimeVNode(value) {
    return typeof value === 'object' && value !== null;
}
function vnodeScopeIdentity(vnode) {
    if (vnode.component && typeof vnode.component === 'object')
        return vnode.component;
    if (typeof Node !== 'undefined' && vnode.el instanceof Node)
        return vnode.el;
    return vnode;
}
function collectVNodeHostRoots(value, roots, visited) {
    if (Array.isArray(value)) {
        for (const child of value)
            collectVNodeHostRoots(child, roots, visited);
        return;
    }
    if (!isRuntimeVNode(value) || visited.has(value))
        return;
    visited.add(value);
    if (value.component?.subTree) {
        collectVNodeHostRoots(value.component.subTree, roots, visited);
        return;
    }
    if (value.suspense?.activeBranch || value.suspense?.pendingBranch) {
        collectVNodeHostRoots(value.suspense.activeBranch ?? value.suspense.pendingBranch, roots, visited);
        return;
    }
    if (typeof Element !== 'undefined' && value.el instanceof Element) {
        roots.add(value.el);
        return;
    }
    collectVNodeHostRoots(value.children, roots, visited);
}
function disposeVNodeScope(identity) {
    for (const dispose of vnodeScopeDisposers.get(identity) ?? [])
        dispose();
    vnodeScopeDisposers.delete(identity);
}
function activeCausalProbe(occurrenceId) {
    try {
        const raw = window.sessionStorage.getItem(CAUSAL_PROBE_STORAGE_KEY);
        if (!raw)
            return undefined;
        const parsed = JSON.parse(raw);
        if (parsed.occurrenceId !== occurrenceId ||
            typeof parsed.token !== 'string' ||
            parsed.token.length < 8) {
            return undefined;
        }
        return { occurrenceId: parsed.occurrenceId, token: parsed.token };
    }
    catch {
        return undefined;
    }
}
function bindVNodeScope(vnodeValue, occurrenceIds) {
    if (typeof window === 'undefined' || !isRuntimeVNode(vnodeValue))
        return;
    const registry = window.__COLLECT_I18N__;
    if (!registry)
        return;
    const identity = vnodeScopeIdentity(vnodeValue);
    disposeVNodeScope(identity);
    const roots = new Set();
    collectVNodeHostRoots(vnodeValue.component?.subTree ?? vnodeValue, roots, new Set());
    const disposers = [];
    for (const occurrenceId of new Set(occurrenceIds)) {
        const baseDescriptor = registry.getOccurrence(occurrenceId);
        const descriptors = [
            ...(baseDescriptor ? [baseDescriptor] : []),
            ...registry.getDerivedOccurrences(occurrenceId),
        ];
        for (const descriptor of descriptors) {
            for (const root of roots) {
                disposers.push(registry.registerOwner(descriptor, root, { grade: 'B', proof: 'compiler-vnode-provenance' }));
            }
        }
    }
    if (disposers.length > 0)
        vnodeScopeDisposers.set(identity, disposers);
}
/**
 * Vite-injected VNode lifecycle hooks keep compiler provenance attached to
 * component host roots even when attrs do not fall through (fragments,
 * inheritAttrs:false, Teleport, or library components).
 */
export function vnodeProvenanceMounted(vnode, occurrenceIds) {
    bindVNodeScope(vnode, occurrenceIds);
}
export function vnodeProvenanceUpdated(vnode, occurrenceIds) {
    bindVNodeScope(vnode, occurrenceIds);
}
export function vnodeProvenanceBeforeUnmount(vnode) {
    if (!isRuntimeVNode(vnode))
        return;
    disposeVNodeScope(vnodeScopeIdentity(vnode));
}
export function installGlobalCollector(options = {}) {
    const targetWindow = options.document?.defaultView ?? globalThis.window;
    if (!targetWindow)
        throw new Error('collect-i18n runtime can only be installed in a browser');
    if (targetWindow.__COLLECT_I18N__)
        return targetWindow.__COLLECT_I18N__;
    const registry = new CollectorRegistry({ ...options, document: options.document ?? targetWindow.document });
    targetWindow.__COLLECT_I18N__ = registry;
    for (const descriptor of targetWindow.__COLLECT_I18N_PENDING__ ?? []) {
        registry.registerVirtual(descriptor, 'compiled descriptor awaiting a DOM anchor');
    }
    targetWindow.__COLLECT_I18N_PENDING__ = [];
    return registry;
}
/** Stable public factory used by the Vite adapter and the CLI-injected bootstrap. */
export const installCollectorRuntime = installGlobalCollector;
export function uninstallGlobalCollector(targetWindow = globalThis.window) {
    targetWindow.__COLLECT_I18N__?.destroy();
    delete targetWindow.__COLLECT_I18N__;
}
export function enqueueDescriptors(descriptors) {
    if (typeof window === 'undefined')
        return;
    const registry = window.__COLLECT_I18N__;
    if (registry) {
        for (const descriptor of descriptors) {
            registry.registerVirtual(descriptor, 'compiled descriptor awaiting a DOM anchor');
        }
        return;
    }
    const pending = (window.__COLLECT_I18N_PENDING__ ??= []);
    const byId = new Map(pending.map((descriptor) => [descriptor.occurrenceId, descriptor]));
    for (const descriptor of descriptors)
        byId.set(descriptor.occurrenceId, descriptor);
    window.__COLLECT_I18N_PENDING__ = [...byId.values()];
}
/**
 * Preserve a rendered Vue expression while teaching the runtime its current text.
 * The Vite adapter injects this helper only in collector mode.
 */
export function recordRenderedValue(value, occurrenceId, actualKey) {
    if (typeof window === 'undefined')
        return value;
    const registry = window.__COLLECT_I18N__;
    const snapshot = registry?.getOccurrence(occurrenceId);
    const dynamicOccurrenceId = actualKey && snapshot?.keyExpression
        ? createDerivedOccurrenceId(occurrenceId, actualKey)
        : undefined;
    const probe = activeCausalProbe(dynamicOccurrenceId ?? occurrenceId);
    const canSubstitute = probe &&
        (snapshot?.metadata?.canarySafe === true || Boolean(dynamicOccurrenceId)) &&
        (typeof value === 'string' || typeof value === 'number');
    const renderedValue = canSubstitute ? probe.token : value;
    registry?.recordRenderedValue(occurrenceId, renderedValue, actualKey);
    const invocation = [...activeImperativeInvocations]
        .reverse()
        .find((candidate) => candidate.occurrenceIds.has(occurrenceId));
    const invocationOccurrenceId = dynamicOccurrenceId ?? occurrenceId;
    if (registry &&
        invocation?.occurrenceIds.has(occurrenceId) &&
        !invocation.registered.has(invocationOccurrenceId)) {
        const snapshot = registry.getOccurrence(invocationOccurrenceId);
        if (snapshot) {
            invocation.registered.add(invocationOccurrenceId);
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
                text: typeof renderedValue === 'string' || typeof renderedValue === 'number'
                    ? String(renderedValue)
                    : undefined,
                invokedAt: invocation.invokedAt,
            });
        }
    }
    if (snapshot?.metadata?.inlineTransport === true &&
        (typeof renderedValue === 'string' || typeof renderedValue === 'number')) {
        return appendInlineProvenance(String(renderedValue), invocationOccurrenceId);
    }
    return renderedValue;
}
/**
 * Establish an invocation identity before Element Plus evaluates translated
 * arguments. The wrapped call remains synchronous and receives/returns the
 * exact same values as the original expression.
 */
export function runImperativeInvocation(service, occurrenceIds, invoke) {
    if (typeof window === 'undefined')
        return invoke();
    const invocation = {
        invocationId: `invocation:${service}:${Date.now()}:${++imperativeInvocationSequence}`,
        service,
        occurrenceIds: new Set(occurrenceIds),
        registered: new Set(),
        invokedAt: Date.now(),
    };
    activeImperativeInvocations.push(invocation);
    const dispose = () => {
        const index = activeImperativeInvocations.lastIndexOf(invocation);
        if (index >= 0)
            activeImperativeInvocations.splice(index, 1);
    };
    try {
        const result = invoke();
        if (typeof result === 'object' &&
            result !== null &&
            'then' in result &&
            typeof result.then === 'function') {
            void Promise.resolve(result).then(dispose, dispose);
        }
        else {
            dispose();
        }
        return result;
    }
    catch (error) {
        dispose();
        throw error;
    }
}
export function registerTextRange(descriptor, start, end = start, evidence = { grade: 'A', proof: 'compiler-text-sink' }) {
    if (typeof window === 'undefined')
        return () => undefined;
    const registry = window.__COLLECT_I18N__ ?? installGlobalCollector();
    const range = window.document.createRange();
    if (start.nodeType === 3)
        range.setStart(start, 0);
    else
        range.setStartBefore(start);
    if (end.nodeType === 3)
        range.setEnd(end, end.nodeValue?.length ?? 0);
    else
        range.setEndAfter(end);
    return registry.registerRange({ ...descriptor, kind: 'text' }, range, evidence);
}
//# sourceMappingURL=index.js.map