/** Return canonical JSON so semantically equal records have the same hash. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (typeof value === 'bigint') return `${value.toString()}n`
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? String(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))

  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(',')}}`
}

/**
 * A small deterministic 64-bit FNV-1a hash. It is not a security primitive;
 * it is deliberately pure JavaScript so the same IDs can be created in Node
 * and in the browser instrumentation runtime.
 */
export function stableHash(value: unknown): string {
  const input = stableStringify(value)
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n

  for (let index = 0; index < input.length; index += 1) {
    const codePoint = input.codePointAt(index) ?? 0
    hash ^= BigInt(codePoint)
    hash = BigInt.asUintN(64, hash * prime)

    if (codePoint > 0xffff) index += 1
  }

  return hash.toString(16).padStart(16, '0')
}

export function createStableId(prefix: string, value: unknown): string {
  const normalizedPrefix = prefix.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()
  return `${normalizedPrefix}_${stableHash(value)}`
}

export interface OccurrenceIdentityInput {
  key?: string
  file: string
  line: number
  column: number
  kind: string
  property?: string
  service?: string
}

/** Canonical identity shared by static analysis and Vue instrumentation. */
export function createOccurrenceId(input: OccurrenceIdentityInput): string {
  const kindAliases: Record<string, string> = {
    native: 'native_dom',
    native_dom: 'native_dom',
    text: 'text_range',
    text_range: 'text_range',
    virtual: 'text_range',
    'component-prop': 'component_prop',
    component_prop: 'component_prop',
    'imperative-service': 'imperative_service',
    imperative_service: 'imperative_service',
  }
  return createStableId('occ', {
    keyPath: input.key,
    file: input.file.replaceAll('\\', '/').replace(/^\.\//, ''),
    line: input.line,
    column: input.column,
    kind: kindAliases[input.kind] ?? input.kind,
    property: input.property,
    service: input.service,
  })
}
