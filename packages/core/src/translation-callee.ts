/**
 * Shared translation-call recognition. Static analysis (analyzer) and the
 * Vite instrumentation (vite-vue) must agree on which callee counts as a
 * translation call: otherwise a configured wrapper (config
 * `source.translationCallees`) is scanned as a static occurrence but never
 * instrumented, so the runtime can never produce evidence for it. Keep this
 * module pure and dependency-free so the same decision runs in Node bundles
 * and in the page-side instrumentation runtime.
 */

interface AstLikeNode {
  type: string
  name?: unknown
  object?: unknown
  property?: unknown
  callee?: unknown
  expressions?: unknown
  quasis?: unknown
  value?: unknown
}

function staticStringLike(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined
  const record = node as AstLikeNode
  if (record.type === 'StringLiteral' || record.type === 'Literal') {
    return typeof record.value === 'string' ? record.value : undefined
  }
  if (record.type === 'TemplateLiteral') {
    if (Array.isArray(record.expressions) && record.expressions.length > 0) return undefined
    const quasi = Array.isArray(record.quasis) ? record.quasis[0] : undefined
    if (!quasi || typeof quasi !== 'object') return undefined
    const value = (quasi as { value?: { cooked?: unknown } }).value
    return typeof value?.cooked === 'string' ? value.cooked : undefined
  }
  return undefined
}

function identifierLikeName(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined
  const record = node as AstLikeNode
  if (record.type === 'Identifier' || record.type === 'JSXIdentifier') {
    return typeof record.name === 'string' ? record.name : undefined
  }
  if (record.type === 'ThisExpression') return 'this'
  return undefined
}

function memberPropertyName(node: unknown): string | undefined {
  return identifierLikeName(node) ?? staticStringLike(node)
}

/**
 * Build the dotted callee name (`t`, `this.$t`, `i18n.global.t`, ...) from a
 * Babel-like AST node. Mirrors the analyzer's historical `calleeName` so both
 * sides derive the same name from the same syntax.
 */
export function dottedCalleeName(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined
  const record = node as AstLikeNode
  if (record.type === 'CallExpression' || record.type === 'OptionalCallExpression') {
    return dottedCalleeName(record.callee)
  }
  const direct = identifierLikeName(node)
  if (direct !== undefined) return direct
  if (
    record.type === 'MemberExpression' ||
    record.type === 'OptionalMemberExpression' ||
    record.type === 'JSXMemberExpression'
  ) {
    const object = dottedCalleeName(record.object)
    const property = memberPropertyName(record.property)
    return object && property ? `${object}.${property}` : undefined
  }
  return undefined
}

/**
 * Decide whether a dotted callee name is a translation call. Configured
 * wrappers always match; bare `t`/`$t` and any `obj.$t` match; `obj.t` only
 * matches when an i18n-ish segment (`i18n`/`locale`/`translator`) is present,
 * so ordinary helpers such as `myLocale.t()` are not misread.
 */
export function isTranslationCalleeName(
  name: string | undefined,
  configured?: ReadonlySet<string>,
): boolean {
  if (!name) return false
  if (configured?.has(name)) return true
  if (name === 't' || name === '$t' || name.endsWith('.$t')) return true
  if (!name.endsWith('.t')) return false
  return /(?:^|\.)(?:\$?i18n|locale|translator)(?:\.|$)/i.test(name)
}

/** Node-based variant used by the Vite instrumentation. */
export function isTranslationCalleeNode(
  node: unknown,
  configured?: ReadonlySet<string>,
): boolean {
  return isTranslationCalleeName(dottedCalleeName(node), configured)
}

/** `undefined` when the project configures no wrappers (default fast path). */
export function translationCalleeSet(
  callees?: readonly string[],
): ReadonlySet<string> | undefined {
  if (!callees?.length) return undefined
  return new Set(callees)
}
