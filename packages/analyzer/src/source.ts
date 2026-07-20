import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse as parseBabel } from '@babel/parser'
import {
  createOccurrenceId,
  type ActionHint,
  type Occurrence,
  type RouteHint,
  type SourceLocation,
} from '@collect-i18n/core'
import { baseParse, NodeTypes } from '@vue/compiler-dom'
import { parse as parseSfc } from '@vue/compiler-sfc'
import fg from 'fast-glob'

import type {
  AnalysisDiagnostic,
  SourceScanResult,
} from './types.js'

type OccurrenceKind = Occurrence['kind']

interface AstNode extends Record<string, unknown> {
  type: string
  start?: number | null
  end?: number | null
}

interface TemplateLocation {
  start: { offset: number }
  end: { offset: number }
  source: string
}

interface TemplateNode {
  type: number
  loc: TemplateLocation
  tag?: string
  children?: TemplateNode[]
  props?: TemplateProperty[]
  content?: TemplateNode | string
}

interface TemplateProperty {
  type: number
  name: string
  loc: TemplateLocation
  value?: { content: string; loc: TemplateLocation }
  arg?: { content?: string; loc: TemplateLocation }
  exp?: { content?: string; loc: TemplateLocation }
}

interface TranslationMatch {
  keyPath?: string
  expression: string
  offset: number
  dynamic: boolean
  confidence: number
}

const nativeTags = new Set(
  `html body base head link meta style title address article aside footer header h1 h2 h3 h4 h5 h6 nav section div dd dl dt figcaption figure picture hr img li main ol p pre ul a b abbr bdi bdo br cite code data dfn em i kbd mark q rp rt ruby s samp small span strong sub sup time u var wbr area audio map track video embed object param source canvas script noscript del ins caption col colgroup table thead tbody td th tr button datalist fieldset form input label legend meter optgroup option output progress select textarea details dialog menu summary template blockquote iframe tfoot svg path circle rect line polygon polyline g defs use symbol text`.split(
    ' ',
  ),
)

function portable(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

function sourceLocation(
  file: string,
  source: string,
  start: number,
  end?: number,
): SourceLocation {
  const position = (offset: number): { line: number; column: number } => {
    const before = source.slice(0, Math.max(0, offset))
    const lines = before.split(/\r?\n/)
    return { line: lines.length, column: lines.at(-1)?.length ?? 0 }
  }
  const from = position(start)
  const to = end === undefined ? undefined : position(end)
  return {
    file,
    line: from.line,
    column: from.column,
    endLine: to?.line,
    endColumn: to?.column,
  }
}

function staticString(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined
  const record = node as AstNode
  if (record.type === 'StringLiteral' || record.type === 'Literal') {
    return typeof record.value === 'string' ? record.value : undefined
  }
  if (record.type === 'TemplateLiteral') {
    const expressions = Array.isArray(record.expressions)
      ? record.expressions
      : []
    if (expressions.length) return undefined
    const quasi = Array.isArray(record.quasis) ? record.quasis[0] : undefined
    if (!quasi || typeof quasi !== 'object') return undefined
    const value = (quasi as Record<string, unknown>).value
    if (!value || typeof value !== 'object') return undefined
    const cooked = (value as Record<string, unknown>).cooked
    return typeof cooked === 'string' ? cooked : undefined
  }
  if (
    ['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression'].includes(
      record.type,
    )
  ) {
    return staticString(record.expression)
  }
  return undefined
}

function propertyName(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined
  const record = node as AstNode
  if (record.type === 'Identifier' || record.type === 'JSXIdentifier') {
    return typeof record.name === 'string' ? record.name : undefined
  }
  return staticString(record)
}

function calleeName(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined
  const record = node as AstNode
  if (record.type === 'Identifier' || record.type === 'JSXIdentifier') {
    return typeof record.name === 'string' ? record.name : undefined
  }
  if (record.type === 'ThisExpression') return 'this'
  if (
    record.type === 'MemberExpression' ||
    record.type === 'OptionalMemberExpression' ||
    record.type === 'JSXMemberExpression'
  ) {
    const object = calleeName(record.object)
    const property = propertyName(record.property)
    return object && property ? `${object}.${property}` : property
  }
  if (
    record.type === 'CallExpression' ||
    record.type === 'OptionalCallExpression'
  ) {
    return calleeName(record.callee)
  }
  return undefined
}

function isTranslationCallee(name: string | undefined): boolean {
  if (!name) return false
  if (name === 't' || name === '$t' || name.endsWith('.$t')) return true
  if (!name.endsWith('.t')) return false
  return /(?:^|\.)(?:\$?i18n|locale|translator)(?:\.|$)/i.test(name)
}

function serviceDescriptor(name: string | undefined):
  | { service: string; method?: string }
  | undefined {
  if (!name) return undefined
  const parts = name.split('.')
  const serviceIndex = parts.findIndex((part) =>
    [
      'ElMessage',
      'ElNotification',
      'ElMessageBox',
      '$message',
      '$notify',
      '$confirm',
      '$alert',
      '$prompt',
    ].includes(part),
  )
  if (serviceIndex < 0) return undefined
  return {
    service: parts[serviceIndex],
    method: parts[serviceIndex + 1],
  }
}

function walkAst(
  node: unknown,
  ancestors: AstNode[],
  visitor: (node: AstNode, ancestors: AstNode[]) => void,
): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, ancestors, visitor)
    return
  }
  const record = node as Record<string, unknown>
  if (typeof record.type !== 'string') return
  const astNode = record as AstNode
  visitor(astNode, ancestors)

  for (const [key, child] of Object.entries(record)) {
    if (['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments'].includes(key)) {
      continue
    }
    if (child && typeof child === 'object') {
      walkAst(child, [...ancestors, astNode], visitor)
    }
  }
}

function translationMatches(expression: string): TranslationMatch[] {
  const matches: TranslationMatch[] = []
  const staticCall = /(?:^|[^\w$])((?:(?:[$A-Za-z_][\w$]*)\.)*\$?t)\s*\(\s*(['"`])([^'"`]*?)\2/g
  let match: RegExpExecArray | null
  while ((match = staticCall.exec(expression))) {
    const callOffset = match.index + match[0].indexOf(match[1])
    if (!isTranslationCallee(match[1])) continue
    matches.push({
      keyPath: match[3],
      expression: match[0].slice(match[0].indexOf(match[1])).trim(),
      offset: callOffset,
      dynamic: false,
      confidence: match[1].includes('.') ? 0.98 : 0.92,
    })
  }

  const anyCall = /(?:^|[^\w$])((?:(?:[$A-Za-z_][\w$]*)\.)*\$?t)\s*\(/g
  while ((match = anyCall.exec(expression))) {
    const callOffset = match.index + match[0].indexOf(match[1])
    if (!isTranslationCallee(match[1])) continue
    if (matches.some((candidate) => candidate.offset === callOffset)) continue
    matches.push({
      expression: match[1],
      offset: callOffset,
      dynamic: true,
      confidence: 0.55,
    })
  }

  return matches
}

function inferFilenameRoute(projectRoot: string, file: string): RouteHint | undefined {
  const relative = portable(path.relative(projectRoot, file))
  const match = relative.match(/(?:^|\/)src\/(?:views|pages)\/(.+)\.(?:vue|tsx?|jsx?)$/i)
  if (!match) return undefined
  const segments = match[1]
    .split('/')
    .filter((segment) => segment.toLowerCase() !== 'index')
    .map((segment) => segment.replace(/^\[(.+)]$/, ':$1'))
  return {
    path: `/${segments.join('/')}`.replace(/\/+$/, '') || '/',
    source: 'filename',
    confidence: 0.35,
  }
}

function makeOccurrence(
  input: Omit<Occurrence, 'id' | 'routeHints' | 'actionHints'> & {
    routeHints?: RouteHint[]
    actionHints?: ActionHint[]
  },
): Occurrence {
  return {
    ...input,
    id: createOccurrenceId({
      key: input.keyPath,
      kind: input.kind,
      file: input.location.file,
      line: input.location.line,
      column: input.location.column,
      property: input.property,
      service: input.service,
    }),
    routeHints: input.routeHints ?? [],
    actionHints: input.actionHints ?? [],
  }
}

function templateSelector(node: TemplateNode): string | undefined {
  for (const property of node.props ?? []) {
    if (property.type !== NodeTypes.ATTRIBUTE || !property.value) continue
    if (property.name === 'id') return `#${property.value.content}`
    if (['data-testid', 'data-test', 'aria-label', 'name'].includes(property.name)) {
      return `[${property.name}=${JSON.stringify(property.value.content)}]`
    }
  }
  return undefined
}

function templateActionHints(
  node: TemplateNode,
  file: string,
  source: string,
  templateOffset: number,
): ActionHint[] {
  const hints: ActionHint[] = []
  const selector = templateSelector(node)
  for (const property of node.props ?? []) {
    if (property.type !== NodeTypes.DIRECTIVE || property.name !== 'on') continue
    const event = property.arg?.content
    if (!event) continue
    const kind: ActionHint['kind'] =
      event === 'click'
        ? 'click'
        : event === 'submit'
          ? 'submit'
          : event === 'focus'
            ? 'focus'
            : event === 'blur'
              ? 'blur'
              : ['mouseenter', 'mouseover'].includes(event)
                ? 'hover'
                : event === 'change'
                  ? node.tag === 'select' || node.tag?.includes('select')
                    ? 'select'
                    : 'fill'
                  : 'custom'
    hints.push({
      kind,
      selector,
      event,
      label: `${node.tag ?? 'element'} @${event}`,
      source: 'template',
      confidence: selector ? 0.85 : 0.55,
      location: sourceLocation(
        file,
        source,
        templateOffset + property.loc.start.offset,
        templateOffset + property.loc.end.offset,
      ),
    })
  }
  return hints
}

interface TemplateScanContext {
  file: string
  source: string
  templateOffset: number
  routeHints: RouteHint[]
  occurrences: Occurrence[]
  actionHints: ActionHint[]
  diagnostics: AnalysisDiagnostic[]
}

function templateService(expression: string):
  | { service: string; method?: string }
  | undefined {
  const match = expression.match(
    /(ElMessageBox|ElMessage|ElNotification|\$message|\$notify|\$confirm|\$alert|\$prompt)(?:\.([A-Za-z_$][\w$]*))?/,
  )
  return match ? { service: match[1], method: match[2] } : undefined
}

function scanTemplateExpression(
  expression: string,
  expressionOffset: number,
  kind: OccurrenceKind,
  context: TemplateScanContext,
  inheritedActions: ActionHint[],
  descriptor: { component?: string; property?: string } = {},
): void {
  const service = templateService(expression)
  for (const match of translationMatches(expression)) {
    const location = sourceLocation(
      context.file,
      context.source,
      context.templateOffset + expressionOffset + match.offset,
      context.templateOffset + expressionOffset + match.offset + match.expression.length,
    )
    if (!match.keyPath) {
      context.diagnostics.push({
        code: 'dynamic_translation_key',
        severity: 'warning',
        message: '动态 i18n key 无法由静态扫描确定',
        location,
        details: { expression: match.expression },
      })
      continue
    }
    context.occurrences.push(
      makeOccurrence({
        keyPath: match.keyPath,
        kind: service ? 'imperative_service' : kind,
        location,
        expression: match.expression,
        component: descriptor.component,
        property: descriptor.property,
        service: service?.service,
        serviceMethod: service?.method,
        teleported: Boolean(service),
        dynamic: false,
        confidence: match.confidence,
        routeHints: context.routeHints,
        actionHints: inheritedActions,
      }),
    )
  }
}

function scanTemplateNode(
  node: TemplateNode,
  context: TemplateScanContext,
  inheritedActions: ActionHint[] = [],
): void {
  if (node.type === NodeTypes.ROOT) {
    for (const child of node.children ?? []) {
      scanTemplateNode(child, context, inheritedActions)
    }
    return
  }

  if (node.type === NodeTypes.INTERPOLATION) {
    const content = node.content
    if (content && typeof content === 'object') {
      const expression =
        typeof content.content === 'string' ? content.content : content.loc.source
      scanTemplateExpression(
        expression,
        content.loc.start.offset,
        'text_range',
        context,
        inheritedActions,
      )
    }
    return
  }

  if (node.type !== NodeTypes.ELEMENT) return
  const ownActions = templateActionHints(
    node,
    context.file,
    context.source,
    context.templateOffset,
  )
  context.actionHints.push(...ownActions)
  const actions = [...inheritedActions, ...ownActions]
  const component = node.tag && !nativeTags.has(node.tag.toLowerCase())
  const defaultKind: OccurrenceKind = component ? 'component_prop' : 'native_dom'

  for (const property of node.props ?? []) {
    if (
      property.type === NodeTypes.ATTRIBUTE &&
      property.name === 'data-i18n-key' &&
      property.value?.content
    ) {
      context.occurrences.push(
        makeOccurrence({
          keyPath: property.value.content,
          kind: defaultKind,
          location: sourceLocation(
            context.file,
            context.source,
            context.templateOffset + property.loc.start.offset,
            context.templateOffset + property.loc.end.offset,
          ),
          expression: property.loc.source,
          component: component ? node.tag : undefined,
          property: 'data-i18n-key',
          teleported: false,
          dynamic: false,
          confidence: 1,
          routeHints: context.routeHints,
          actionHints: actions,
        }),
      )
      continue
    }
    if (property.type !== NodeTypes.DIRECTIVE || !property.exp?.content) continue

    if (property.name === 't') {
      const keyPath =
        staticStringFromExpression(property.exp.content) ??
        property.exp.content.match(
          /(?:path|key)\s*:\s*(['"`])([^'"`]+)\1/,
        )?.[2]
      const location = sourceLocation(
        context.file,
        context.source,
        context.templateOffset + property.exp.loc.start.offset,
        context.templateOffset + property.exp.loc.end.offset,
      )
      if (keyPath) {
        context.occurrences.push(
          makeOccurrence({
            keyPath,
            kind: defaultKind,
            location,
            expression: property.loc.source,
            component: component ? node.tag : undefined,
            property: 'v-t',
            teleported: false,
            dynamic: false,
            confidence: 0.99,
            routeHints: context.routeHints,
            actionHints: actions,
          }),
        )
      } else {
        context.diagnostics.push({
          code: 'dynamic_translation_key',
          severity: 'warning',
          message: '动态 v-t key 无法由静态扫描确定',
          location,
          details: { expression: property.exp.content },
        })
      }
      continue
    }

    scanTemplateExpression(
      property.exp.content,
      property.exp.loc.start.offset,
      defaultKind,
      context,
      actions,
      {
        component: component ? node.tag : undefined,
        property: property.arg?.content,
      },
    )
  }

  for (const child of node.children ?? []) {
    scanTemplateNode(child, context, actions)
  }
}

function staticStringFromExpression(expression: string): string | undefined {
  const trimmed = expression.trim()
  const quote = trimmed[0]
  return quote && ['\'', '"', '`'].includes(quote) && trimmed.at(-1) === quote
    ? trimmed.slice(1, -1)
    : undefined
}

function objectProperties(node: AstNode): AstNode[] {
  return Array.isArray(node.properties)
    ? node.properties.filter(
        (property): property is AstNode =>
          Boolean(property) &&
          typeof property === 'object' &&
          typeof (property as AstNode).type === 'string',
      )
    : []
}

function findObjectProperty(node: AstNode, name: string): AstNode | undefined {
  return objectProperties(node).find(
    (property) => propertyName(property.key) === name,
  )
}

function jsxElementName(ancestors: AstNode[]): string | undefined {
  const opening = [...ancestors]
    .reverse()
    .find((ancestor) => ancestor.type === 'JSXOpeningElement')
  return opening ? calleeName(opening.name) : undefined
}

function jsxPropertyName(ancestors: AstNode[]): string | undefined {
  const attribute = [...ancestors]
    .reverse()
    .find((ancestor) => ancestor.type === 'JSXAttribute')
  return attribute ? propertyName(attribute.name) : undefined
}

interface ScriptScanContext {
  projectRoot: string
  absoluteFile: string
  file: string
  source: string
  baseOffset: number
  routeHints: RouteHint[]
  componentRouteLinks: ComponentRouteLink[]
  actionHints: ActionHint[]
  diagnostics: AnalysisDiagnostic[]
  occurrences: Occurrence[]
}

interface ComponentRouteLink {
  componentCandidates: string[]
  routeHint: RouteHint
}

function routePath(parentPath: string, childPath: string): string {
  if (childPath.startsWith('/')) return childPath.replace(/\/{2,}/g, '/') || '/'
  const parent = parentPath === '/' ? '' : parentPath.replace(/\/+$/, '')
  const child = childPath.replace(/^\/+/, '')
  const joined = `${parent}/${child}`.replace(/\/{2,}/g, '/')
  return joined.replace(/\/+$/, '') || '/'
}

function componentFileCandidates(
  specifier: string,
  context: ScriptScanContext,
): string[] {
  const cleanSpecifier = specifier.replace(/[?#].*$/, '')
  let resolved: string
  if (cleanSpecifier.startsWith('@/') || cleanSpecifier.startsWith('~/')) {
    resolved = path.resolve(context.projectRoot, 'src', cleanSpecifier.slice(2))
  } else if (cleanSpecifier.startsWith('/src/')) {
    resolved = path.resolve(context.projectRoot, cleanSpecifier.slice(1))
  } else if (cleanSpecifier.startsWith('.')) {
    resolved = path.resolve(path.dirname(context.absoluteFile), cleanSpecifier)
  } else {
    return []
  }

  const candidates = path.extname(resolved)
    ? [resolved]
    : [
        resolved,
        ...['.vue', '.tsx', '.jsx', '.ts', '.js'].map(
          (extension) => `${resolved}${extension}`,
        ),
        ...['.vue', '.tsx', '.jsx', '.ts', '.js'].map((extension) =>
          path.join(resolved, `index${extension}`),
        ),
      ]
  return candidates.map((candidate) =>
    portable(path.relative(context.projectRoot, candidate)),
  )
}

function dynamicImportSpecifier(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = dynamicImportSpecifier(child)
      if (found) return found
    }
    return undefined
  }

  const record = node as AstNode
  if (record.type === 'ImportExpression') {
    return staticString(record.source)
  }
  if (
    (record.type === 'CallExpression' || record.type === 'OptionalCallExpression') &&
    record.callee &&
    typeof record.callee === 'object' &&
    (record.callee as AstNode).type === 'Import'
  ) {
    const firstArgument = Array.isArray(record.arguments)
      ? record.arguments[0]
      : undefined
    return staticString(firstArgument)
  }

  for (const [key, child] of Object.entries(record)) {
    if (['loc', 'start', 'end', 'extra'].includes(key)) continue
    const found = dynamicImportSpecifier(child)
    if (found) return found
  }
  return undefined
}

function importedComponentBindings(
  ast: unknown,
  context: ScriptScanContext,
): Map<string, string[]> {
  const bindings = new Map<string, string[]>()
  walkAst(ast, [], (node) => {
    if (node.type === 'ImportDeclaration') {
      const specifier = staticString(node.source)
      if (!specifier) return
      const candidates = componentFileCandidates(specifier, context)
      if (!candidates.length || !Array.isArray(node.specifiers)) return
      for (const importSpecifier of node.specifiers) {
        if (!importSpecifier || typeof importSpecifier !== 'object') continue
        const localName = propertyName((importSpecifier as AstNode).local)
        if (localName) bindings.set(localName, candidates)
      }
      return
    }

    if (node.type === 'VariableDeclarator') {
      const localName = propertyName(node.id)
      const specifier = dynamicImportSpecifier(node.init)
      if (localName && specifier) {
        bindings.set(localName, componentFileCandidates(specifier, context))
      }
    }
  })
  return bindings
}

function isRouteObject(node: AstNode): boolean {
  return (
    node.type === 'ObjectExpression' &&
    Boolean(findObjectProperty(node, 'path')) &&
    ['component', 'redirect', 'children'].some((name) =>
      Boolean(findObjectProperty(node, name)),
    )
  )
}

function parentRouteObjects(ancestors: AstNode[]): AstNode[] {
  const parents: AstNode[] = []
  for (let index = 0; index < ancestors.length - 1; index += 1) {
    const candidate = ancestors[index]
    const next = ancestors[index + 1]
    if (
      isRouteObject(candidate) &&
      next.type === 'ObjectProperty' &&
      propertyName(next.key) === 'children'
    ) {
      parents.push(candidate)
    }
  }
  return parents
}

function extractComponentRouteLinks(
  ast: unknown,
  context: ScriptScanContext,
): void {
  const bindings = importedComponentBindings(ast, context)
  walkAst(ast, [], (node, ancestors) => {
    if (!isRouteObject(node)) return
    const pathProperty = findObjectProperty(node, 'path')
    const localPath = pathProperty ? staticString(pathProperty.value) : undefined
    if (localPath === undefined) return

    let fullPath = ''
    for (const parent of parentRouteObjects(ancestors)) {
      const parentPathProperty = findObjectProperty(parent, 'path')
      const parentPath = parentPathProperty
        ? staticString(parentPathProperty.value)
        : undefined
      if (parentPath !== undefined) fullPath = routePath(fullPath, parentPath)
    }
    fullPath = routePath(fullPath, localPath)

    const start = context.baseOffset + (pathProperty?.start ?? node.start ?? 0)
    const routeHint: RouteHint = {
      path: fullPath,
      source: 'router_config',
      confidence: 0.99,
      location: sourceLocation(context.file, context.source, start),
    }
    context.routeHints.push(routeHint)

    const componentProperty = findObjectProperty(node, 'component')
    if (!componentProperty) return
    const componentValue = componentProperty.value
    const importedBinding = propertyName(componentValue)
    const lazySpecifier = dynamicImportSpecifier(componentValue)
    const componentCandidates = lazySpecifier
      ? componentFileCandidates(lazySpecifier, context)
      : importedBinding
        ? (bindings.get(importedBinding) ?? [])
        : []
    if (componentCandidates.length) {
      context.componentRouteLinks.push({ componentCandidates, routeHint })
    }
  })
}

function routeHintFromNode(
  node: AstNode,
  context: ScriptScanContext,
): RouteHint | undefined {
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    const callee = calleeName(node.callee)
    if (
      (callee?.endsWith('.push') || callee?.endsWith('.replace')) &&
      /router/i.test(callee)
    ) {
      const firstArgument = Array.isArray(node.arguments) ? node.arguments[0] : undefined
      const route = staticString(firstArgument)
      if (route?.startsWith('/')) {
        const start = context.baseOffset + (node.start ?? 0)
        return {
          path: route,
          source: 'navigation_call',
          confidence: 0.8,
          location: sourceLocation(context.file, context.source, start),
        }
      }
    }
  }
  return undefined
}

function validationActionHint(
  ancestors: AstNode[],
  context: ScriptScanContext,
): ActionHint | undefined {
  const validationObject = [...ancestors]
    .reverse()
    .find(
      (ancestor) =>
        ancestor.type === 'ObjectExpression' &&
        (findObjectProperty(ancestor, 'required') ||
          findObjectProperty(ancestor, 'validator')),
    )
  if (!validationObject) return undefined
  const triggerProperty = findObjectProperty(validationObject, 'trigger')
  const trigger = triggerProperty
    ? staticString(triggerProperty.value)
    : undefined
  const kind: ActionHint['kind'] =
    trigger === 'blur' ? 'blur' : trigger === 'change' ? 'fill' : 'submit'
  return {
    kind,
    event: trigger,
    label: trigger ? `触发 ${trigger} 校验` : '提交表单触发校验',
    source: 'validation_rule',
    confidence: trigger ? 0.8 : 0.65,
    location: sourceLocation(
      context.file,
      context.source,
      context.baseOffset + (validationObject.start ?? 0),
    ),
  }
}

function scanScript(
  script: string,
  context: ScriptScanContext,
  parserPlugins: Array<
    | 'typescript'
    | 'jsx'
    | 'decorators-legacy'
    | 'importAttributes'
    | 'topLevelAwait'
  >,
): void {
  let ast: unknown
  try {
    ast = parseBabel(script, {
      sourceType: 'unambiguous',
      errorRecovery: false,
      plugins: parserPlugins,
    })
  } catch (error) {
    const parserError = error as Error & { loc?: { line: number; column: number } }
    const localLine = parserError.loc?.line ?? 1
    const localColumn = parserError.loc?.column ?? 0
    const localOffset = script
      .split(/\r?\n/)
      .slice(0, localLine - 1)
      .reduce((total, line) => total + line.length + 1, localColumn)
    context.diagnostics.push({
      code: 'source_parse_error',
      severity: 'error',
      message: `无法解析源文件 ${context.file}: ${parserError.message}`,
      location: sourceLocation(
        context.file,
        context.source,
        context.baseOffset + localOffset,
      ),
    })
    return
  }

  extractComponentRouteLinks(ast, context)

  walkAst(ast, [], (node, ancestors) => {
    const route = routeHintFromNode(node, context)
    if (route) context.routeHints.push(route)

    if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') {
      return
    }

    const currentCallee = calleeName(node.callee)
    const currentService = serviceDescriptor(currentCallee)
    if (currentService) {
      const argumentsList = Array.isArray(node.arguments) ? node.arguments : []
      const literals = argumentsList.flatMap((argument) => {
        const direct = staticString(argument)
        if (direct) return [direct]
        if (
          argument &&
          typeof argument === 'object' &&
          (argument as AstNode).type === 'ObjectExpression'
        ) {
          return ['message', 'title']
            .map((name) => findObjectProperty(argument as AstNode, name))
            .map((property) => staticString(property?.value))
            .filter((value): value is string => value !== undefined)
        }
        return []
      })
      for (const literal of literals.filter((value) =>
        /[\u3400-\u9fff]/u.test(value),
      )) {
        context.diagnostics.push({
          code: 'untranslated_ui_literal',
          severity: 'warning',
          message: `${currentService.service} 中存在未使用 i18n key 的中文文本`,
          location: sourceLocation(
            context.file,
            context.source,
            context.baseOffset + (node.start ?? 0),
            context.baseOffset + (node.end ?? node.start ?? 0),
          ),
          details: { service: currentService.service, text: literal },
        })
      }
    }

    if (!isTranslationCallee(currentCallee)) return
    const firstArgument = Array.isArray(node.arguments) ? node.arguments[0] : undefined
    const keyPath = staticString(firstArgument)
    const start = context.baseOffset + (node.start ?? 0)
    const end = context.baseOffset + (node.end ?? node.start ?? 0)
    const location = sourceLocation(context.file, context.source, start, end)
    if (!keyPath) {
      context.diagnostics.push({
        code: 'dynamic_translation_key',
        severity: 'warning',
        message: '动态 i18n key 无法由静态扫描确定',
        location,
        details: { callee: currentCallee },
      })
      return
    }

    const imperativeCall = [...ancestors]
      .reverse()
      .find(
        (ancestor) =>
          (ancestor.type === 'CallExpression' ||
            ancestor.type === 'OptionalCallExpression') &&
          serviceDescriptor(calleeName(ancestor.callee)),
      )
    const service = imperativeCall
      ? serviceDescriptor(calleeName(imperativeCall.callee))
      : undefined
    const jsxComponent = jsxElementName(ancestors)
    const jsxProperty = jsxPropertyName(ancestors)
    const isJsxComponent = Boolean(
      jsxComponent &&
        (!nativeTags.has(jsxComponent.toLowerCase()) || /^[A-Z]/.test(jsxComponent)),
    )
    const insideJsxAttribute = ancestors.some(
      (ancestor) => ancestor.type === 'JSXAttribute',
    )
    const kind: OccurrenceKind = service
      ? 'imperative_service'
      : insideJsxAttribute
        ? isJsxComponent
          ? 'component_prop'
          : 'native_dom'
        : jsxComponent
          ? 'text_range'
          : 'text_range'

    const validationHint = validationActionHint(ancestors, context)
    const actionHints = validationHint ? [validationHint] : []
    if (validationHint) context.actionHints.push(validationHint)
    if (service) {
      const serviceAction: ActionHint = {
        kind: 'custom',
        label: `执行 ${service.service}${service.method ? `.${service.method}` : ''} 所在代码路径`,
        source: 'script',
        confidence: 0.35,
        location,
      }
      actionHints.push(serviceAction)
      context.actionHints.push(serviceAction)
    }

    context.occurrences.push(
      makeOccurrence({
        keyPath,
        kind,
        location,
        expression: context.source.slice(start, end),
        component: isJsxComponent ? jsxComponent : undefined,
        property: insideJsxAttribute ? jsxProperty : undefined,
        service: service?.service,
        serviceMethod: service?.method,
        teleported: Boolean(service),
        dynamic: false,
        confidence:
          currentCallee === 't' || currentCallee === '$t'
            ? 0.92
            : currentCallee?.includes('i18n')
              ? 0.99
              : 0.78,
        routeHints: context.routeHints,
        actionHints,
      }),
    )
  })
}

interface FileScanResult {
  occurrences: Occurrence[]
  routeHints: RouteHint[]
  componentRouteLinks: ComponentRouteLink[]
  actionHints: ActionHint[]
  diagnostics: AnalysisDiagnostic[]
}

async function scanSourceFile(
  projectRoot: string,
  absoluteFile: string,
): Promise<FileScanResult> {
  const source = await readFile(absoluteFile, 'utf8')
  const file = portable(path.relative(projectRoot, absoluteFile))
  const occurrences: Occurrence[] = []
  const routeHints: RouteHint[] = []
  const componentRouteLinks: ComponentRouteLink[] = []
  const actionHints: ActionHint[] = []
  const diagnostics: AnalysisDiagnostic[] = []
  const filenameRoute = inferFilenameRoute(projectRoot, absoluteFile)
  if (filenameRoute) routeHints.push(filenameRoute)

  if (absoluteFile.toLowerCase().endsWith('.vue')) {
    const parsed = parseSfc(source, { filename: file, sourceMap: false })
    for (const error of parsed.errors) {
      diagnostics.push({
        code: 'source_parse_error',
        severity: 'error',
        message: `无法解析 Vue SFC ${file}: ${typeof error === 'string' ? error : error.message}`,
      })
    }

    for (const scriptBlock of [parsed.descriptor.script, parsed.descriptor.scriptSetup]) {
      if (!scriptBlock) continue
      const baseOffset = scriptBlock.loc.start.offset
      scanScript(
        scriptBlock.content,
        {
          projectRoot,
          absoluteFile,
          file,
          source,
          baseOffset,
          routeHints,
          componentRouteLinks,
          actionHints,
          diagnostics,
          occurrences,
        },
        [
          ...(scriptBlock.lang === 'ts' || scriptBlock.lang === 'tsx'
            ? (['typescript'] as const)
            : []),
          ...(scriptBlock.lang === 'jsx' || scriptBlock.lang === 'tsx'
            ? (['jsx'] as const)
            : []),
          'decorators-legacy',
          'importAttributes',
          'topLevelAwait',
        ],
      )
    }

    if (parsed.descriptor.template) {
      const template = parsed.descriptor.template
      const templateOffset = template.loc.start.offset
      try {
        const root = baseParse(template.content, {
          comments: false,
        }) as unknown as TemplateNode
        scanTemplateNode(root, {
          file,
          source,
          templateOffset,
          routeHints,
          occurrences,
          actionHints,
          diagnostics,
        })
      } catch (error) {
        diagnostics.push({
          code: 'source_parse_error',
          severity: 'error',
          message: `无法解析 Vue 模板 ${file}: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }
  } else {
    const extension = path.extname(absoluteFile).toLowerCase()
    scanScript(
      source,
      {
        projectRoot,
        absoluteFile,
        file,
        source,
        baseOffset: 0,
        routeHints,
        componentRouteLinks,
        actionHints,
        diagnostics,
        occurrences,
      },
      [
        ...(['.ts', '.tsx'].includes(extension)
          ? (['typescript'] as const)
          : []),
        ...(['.jsx', '.tsx'].includes(extension) ? (['jsx'] as const) : []),
        'decorators-legacy',
        'importAttributes',
        'topLevelAwait',
      ],
    )
  }

  const dedupedRoutes = Array.from(
    new Map(routeHints.map((hint) => [`${hint.source}:${hint.path}`, hint])).values(),
  )
  const dedupedActions = Array.from(
    new Map(
      actionHints.map((hint) => [
        `${hint.kind}:${hint.selector ?? ''}:${hint.event ?? ''}:${hint.location?.line ?? ''}`,
        hint,
      ]),
    ).values(),
  )
  const normalizedOccurrences = occurrences.map((occurrence) => ({
    ...occurrence,
    routeHints: dedupedRoutes,
  }))

  return {
    occurrences: Array.from(
      new Map(normalizedOccurrences.map((item) => [item.id, item])).values(),
    ),
    routeHints: dedupedRoutes,
    componentRouteLinks,
    actionHints: dedupedActions,
    diagnostics,
  }
}

export interface ScanProjectSourcesOptions {
  projectRoot: string
  include?: string[]
  exclude?: string[]
}

export async function scanProjectSources(
  options: ScanProjectSourcesOptions,
): Promise<SourceScanResult> {
  const projectRoot = path.resolve(options.projectRoot)
  const files = await fg(
    options.include?.length
      ? options.include
      : ['src/**/*.{vue,ts,tsx,js,jsx}'],
    {
      cwd: projectRoot,
      absolute: true,
      onlyFiles: true,
      unique: true,
      ignore: options.exclude ?? [
        '**/node_modules/**',
        '**/dist/**',
        '**/coverage/**',
        '**/.git/**',
        '**/.collect-i18n/**',
        '**/*.d.ts',
      ],
    },
  )

  const results = await Promise.all(
    files.sort().map((file) => scanSourceFile(projectRoot, path.resolve(file))),
  )
  const actualFileByCandidate = new Map(
    files.map((file) => [
      portable(path.relative(projectRoot, path.resolve(file))).toLowerCase(),
      portable(path.relative(projectRoot, path.resolve(file))),
    ]),
  )
  const routesByComponentFile = new Map<string, RouteHint[]>()
  for (const link of results.flatMap((result) => result.componentRouteLinks)) {
    const actualFile = link.componentCandidates
      .map((candidate) => actualFileByCandidate.get(candidate.toLowerCase()))
      .find((candidate): candidate is string => candidate !== undefined)
    if (!actualFile) continue
    const key = actualFile.toLowerCase()
    const current = routesByComponentFile.get(key) ?? []
    current.push(link.routeHint)
    routesByComponentFile.set(key, current)
  }

  const occurrences = results.flatMap((result) => result.occurrences).map(
    (occurrence) => {
      const linkedRoutes =
        routesByComponentFile.get(occurrence.location.file.toLowerCase()) ?? []
      const routeHints = Array.from(
        new Map(
          [...linkedRoutes, ...occurrence.routeHints].map((hint) => [
            `${hint.source}:${hint.path}`,
            hint,
          ]),
        ).values(),
      ).sort(
        (left, right) =>
          right.confidence - left.confidence || left.path.localeCompare(right.path),
      )
      return { ...occurrence, routeHints }
    },
  )
  return {
    occurrences,
    routeHints: Array.from(
      new Map(
        results
          .flatMap((result) => result.routeHints)
          .map((hint) => [`${hint.source}:${hint.path}`, hint]),
      ).values(),
    ),
    actionHints: results.flatMap((result) => result.actionHints),
    diagnostics: results.flatMap((result) => result.diagnostics),
    scannedFiles: files.map((file) => portable(path.relative(projectRoot, file))),
  }
}
