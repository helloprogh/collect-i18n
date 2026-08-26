export const COLLECT_I18N_COMMAND = Symbol.for('collect-i18n.command');
let imperativeSequence = 0;
export function tagI18nCommand(descriptor, payload) {
    return {
        [COLLECT_I18N_COMMAND]: true,
        descriptor,
        payload,
    };
}
function isTaggedCommand(value) {
    return (typeof value === 'object' &&
        value !== null &&
        COLLECT_I18N_COMMAND in value &&
        value[COLLECT_I18N_COMMAND] === true);
}
function normalizeText(value) {
    if (typeof value === 'string' || typeof value === 'number')
        return String(value).trim();
    if (typeof value !== 'object' || value === null)
        return undefined;
    const record = value;
    return normalizeText(record.message ?? record.title);
}
function metadataDescriptor(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const record = value;
    const metadata = record.__collectI18n;
    if (typeof metadata === 'object' && metadata !== null) {
        return metadata;
    }
    const key = record.i18nKey;
    return typeof key === 'string' ? { key } : undefined;
}
function sanitizeArgument(value) {
    if (isTaggedCommand(value))
        return value.payload;
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return value;
    const record = value;
    if (!('__collectI18n' in record) && !('i18nKey' in record))
        return value;
    const clone = { ...record };
    delete clone.__collectI18n;
    delete clone.i18nKey;
    return clone;
}
function prepareInvocation(service, args, options) {
    const tagged = args.find(isTaggedCommand);
    const explicit = tagged?.descriptor ?? args.map(metadataDescriptor).find(Boolean);
    const rawText = args.map((argument) => normalizeText(isTaggedCommand(argument) ? argument.payload : argument)).find(Boolean);
    const key = explicit?.key ?? (rawText ? options.resolveKey?.(rawText, service) : undefined);
    const invocationId = `invocation:${service}:${++imperativeSequence}`;
    const descriptor = {
        ...explicit,
        occurrenceId: explicit?.occurrenceId ?? `imperative:${service}:${key ?? 'unknown'}:${imperativeSequence}`,
        key,
        kind: 'imperative-service',
        service,
        source: explicit?.source ?? options.source,
        renderedText: rawText,
        metadata: {
            ...explicit?.metadata,
            invocationId,
        },
    };
    return { args: args.map(sanitizeArgument), descriptor, invocationId, text: rawText };
}
function wrapCallable(original, service, options) {
    const registry = options.registry ?? globalThis.window?.__COLLECT_I18N__;
    const invoke = (target, thisArg, args) => {
        const prepared = prepareInvocation(service, args, options);
        const dispose = registry?.registerImperativeInvocation({
            invocationId: prepared.invocationId,
            descriptor: prepared.descriptor,
            text: prepared.text,
            invokedAt: Date.now(),
        });
        try {
            return Reflect.apply(target, thisArg, prepared.args);
        }
        catch (error) {
            dispose?.();
            throw error;
        }
    };
    return new Proxy(original, {
        apply(target, thisArg, args) {
            return invoke(target, thisArg, args);
        },
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof value !== 'function')
                return value;
            return (...args) => invoke(value, target, args);
        },
    });
}
export function createElementPlusCommandAdapter(service, serviceName, options = {}) {
    if ((typeof service !== 'function' && typeof service !== 'object') || service === null) {
        throw new TypeError(`${serviceName} must be a callable function or service object`);
    }
    return wrapCallable(service, serviceName, options);
}
export function installElementPlusCommandAdapters(services, options = {}) {
    const adapted = { ...services };
    for (const serviceName of ['ElMessage', 'ElNotification', 'ElMessageBox']) {
        const service = services[serviceName];
        if (service) {
            adapted[serviceName] = createElementPlusCommandAdapter(service, serviceName, options);
        }
    }
    return adapted;
}
//# sourceMappingURL=element-plus.js.map