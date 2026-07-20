import type {
  CollectorRegistryApi,
  ElementPlusServiceName,
  OccurrenceDescriptor,
} from './types.js'

export const COLLECT_I18N_COMMAND = Symbol.for('collect-i18n.command')

export interface TaggedI18nCommand<T> {
  readonly [COLLECT_I18N_COMMAND]: true
  readonly descriptor: OccurrenceDescriptor
  readonly payload: T
}

export interface CommandAdapterOptions {
  registry?: CollectorRegistryApi
  resolveKey?: (renderedText: string, service: ElementPlusServiceName) => string | undefined
  source?: OccurrenceDescriptor['source']
}

export interface ElementPlusServices {
  ElMessage?: unknown
  ElNotification?: unknown
  ElMessageBox?: unknown
}

let imperativeSequence = 0

export function tagI18nCommand<T>(
  descriptor: OccurrenceDescriptor,
  payload: T,
): TaggedI18nCommand<T> {
  return {
    [COLLECT_I18N_COMMAND]: true,
    descriptor,
    payload,
  }
}

function isTaggedCommand(value: unknown): value is TaggedI18nCommand<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    COLLECT_I18N_COMMAND in value &&
    (value as TaggedI18nCommand<unknown>)[COLLECT_I18N_COMMAND] === true
  )
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  return normalizeText(record.message ?? record.title)
}

function metadataDescriptor(value: unknown): Partial<OccurrenceDescriptor> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const metadata = record.__collectI18n
  if (typeof metadata === 'object' && metadata !== null) {
    return metadata as Partial<OccurrenceDescriptor>
  }
  const key = record.i18nKey
  return typeof key === 'string' ? { key } : undefined
}

function sanitizeArgument(value: unknown): unknown {
  if (isTaggedCommand(value)) return value.payload
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (!('__collectI18n' in record) && !('i18nKey' in record)) return value
  const clone = { ...record }
  delete clone.__collectI18n
  delete clone.i18nKey
  return clone
}

function prepareInvocation(
  service: ElementPlusServiceName,
  args: unknown[],
  options: CommandAdapterOptions,
): { args: unknown[]; descriptor: OccurrenceDescriptor; text?: string } {
  const tagged = args.find(isTaggedCommand)
  const explicit = tagged?.descriptor ?? args.map(metadataDescriptor).find(Boolean)
  const rawText = args.map((argument) => normalizeText(isTaggedCommand(argument) ? argument.payload : argument)).find(Boolean)
  const key = explicit?.key ?? (rawText ? options.resolveKey?.(rawText, service) : undefined)
  const descriptor: OccurrenceDescriptor = {
    ...explicit,
    occurrenceId:
      explicit?.occurrenceId ?? `imperative:${service}:${key ?? 'unknown'}:${++imperativeSequence}`,
    key,
    kind: 'imperative-service',
    service,
    source: explicit?.source ?? options.source,
    renderedText: rawText,
  }
  return { args: args.map(sanitizeArgument), descriptor, text: rawText }
}

function wrapCallable<T extends object>(
  original: T,
  service: ElementPlusServiceName,
  options: CommandAdapterOptions,
): T {
  const registry = options.registry ?? globalThis.window?.__COLLECT_I18N__
  const invoke = (target: Function, thisArg: unknown, args: unknown[]): unknown => {
    const prepared = prepareInvocation(service, args, options)
    const dispose = registry?.registerImperativeInvocation({
      descriptor: prepared.descriptor,
      text: prepared.text,
      invokedAt: Date.now(),
    })
    try {
      return Reflect.apply(target, thisArg, prepared.args)
    } catch (error) {
      dispose?.()
      throw error
    }
  }

  return new Proxy(original, {
    apply(target, thisArg, args) {
      return invoke(target as unknown as Function, thisArg, args)
    },
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => invoke(value, target, args)
    },
  })
}

export function createElementPlusCommandAdapter<T extends object>(
  service: T,
  serviceName: ElementPlusServiceName,
  options: CommandAdapterOptions = {},
): T {
  if ((typeof service !== 'function' && typeof service !== 'object') || service === null) {
    throw new TypeError(`${serviceName} must be a callable function or service object`)
  }
  return wrapCallable(service, serviceName, options)
}

export function installElementPlusCommandAdapters<T extends ElementPlusServices>(
  services: T,
  options: CommandAdapterOptions = {},
): T {
  const adapted: ElementPlusServices = { ...services }
  for (const serviceName of ['ElMessage', 'ElNotification', 'ElMessageBox'] as const) {
    const service = services[serviceName]
    if (service) {
      adapted[serviceName] = createElementPlusCommandAdapter(
        service as object,
        serviceName,
        options,
      )
    }
  }
  return adapted as T
}
