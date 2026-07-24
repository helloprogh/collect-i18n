import path from 'node:path'
import { parse as parseExpression } from '@babel/parser'
import { createOccurrenceId } from '@collect-i18n/core'
import {
  ElementTypes,
  NodeTypes,
  parse as parseTemplate,
  type DirectiveNode,
  type ElementNode,
  type InterpolationNode,
  type RootNode,
  type SimpleExpressionNode,
  type TemplateChildNode,
} from '@vue/compiler-dom'
import { parse as parseSfc, type SFCBlock } from '@vue/compiler-sfc'
import MagicStringDefault, {
  type SourceMap,
  type SourceMapOptions,
} from 'magic-string'
import type { OccurrenceDescriptor, OccurrenceKind } from '@collect-i18n/runtime'
import { resolveRuntimeImport } from './runtime-import.js'
import type { CollectI18nVuePluginOptions, InstrumentedVueSfc } from './types.js'

interface TranslationCall {
  start: number
  end: number
  key?: string
  keyExpression?: string
  service?: string
  invocationStart?: number
  invocationEnd?: number
}

interface ExpressionContext {
  content: string
  absoluteOffset: number
  kind: OccurrenceKind
  component?: string
  prop?: string
  service?: string
  owner?: ElementNode
}

interface InstrumentationState {
  source: string
  id: string
  portableId: string
  templateOffset: number
  magic: MagicStringApi
  occurrences: OccurrenceDescriptor[]
  replacements: Array<{
    start: number
    end: number
    occurrenceId: string
    service?: string
    invocationStart?: number
    invocationEnd?: number
  }>
  ownerBindings: Map<ElementNode, OccurrenceDescriptor[]>
}

type BabelNode = {
  type: string
  start?: number | null
  end?: number | null
  [key: string]: unknown
}

/** Compatibility shape for magic-string 0.30.0's CommonJS/default type mismatch in NodeNext. */
interface MagicStringApi {
  append(content: string): MagicStringApi
  appendLeft(index: number, content: string): MagicStringApi
  prepend(content: string): MagicStringApi
  overwrite(start: number, end: number, content: string): MagicStringApi
  generateMap(options?: SourceMapOptions): SourceMap
  toString(): string
}

type ValueReplacement = InstrumentationState['replacements'][number]

const MagicString = MagicStringDefault as unknown as new (source: string) => MagicStringApi

function isBabelNode(value: unknown): value is BabelNode {
  return typeof value === 'object' && value !== null && typeof (value as BabelNode).type === 'string'
}

function isTranslationCallee(node: BabelNode | undefined): boolean {
  if (!node) return false
  if (node.type === 'Identifier') return node.name === 't' || node.name === '$t'
  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return false
  const property = node.property
  return isBabelNode(property) && property.type === 'Identifier' && (property.name === 't' || property.name === '$t')
}

function imperativeServiceFromCallee(node: BabelNode | undefined): string | undefined {
  if (!node) return undefined
  if (node.type === 'Identifier') {
    if (node.name === 'ElMessageBox') return 'ElMessageBox'
    if (node.name === 'ElNotification') return 'ElNotification'
    if (node.name === 'ElMessage') return 'ElMessage'
    return undefined
  }
  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return undefined
  return imperativeServiceFromCallee(isBabelNode(node.object) ? node.object : undefined)
}

function staticArgumentValue(node: BabelNode | undefined): string | undefined {
  if (!node) return undefined
  if (node.type === 'StringLiteral') return typeof node.value === 'string' ? node.value : undefined
  if (node.type === 'TemplateLiteral') {
    const expressions = node.expressions
    const quasis = node.quasis
    if (Array.isArray(expressions) && expressions.length === 0 && Array.isArray(quasis)) {
      const first = quasis[0]
      if (isBabelNode(first) && typeof first.value === 'object' && first.value !== null) {
        const cooked = (first.value as Record<string, unknown>).cooked
        return typeof cooked === 'string' ? cooked : undefined
      }
    }
  }
  return undefined
}

export function findTranslationCalls(expression: string): TranslationCall[] {
  try {
    const ast = parseExpression(`(${expression})`, {
      sourceType: 'module',
      plugins: ['typescript'],
      errorRecovery: true,
    }) as unknown as BabelNode
    const calls: TranslationCall[] = []
    const visit = (
      node: BabelNode,
      inheritedInvocation?: { service: string; start: number; end: number },
    ): void => {
      const isCall = node.type === 'CallExpression' || node.type === 'OptionalCallExpression'
      const callee = isBabelNode(node.callee) ? node.callee : undefined
      const directService = isCall ? imperativeServiceFromCallee(callee) : undefined
      const invocation =
        directService && typeof node.start === 'number' && typeof node.end === 'number'
          ? { service: directService, start: node.start - 1, end: node.end - 1 }
          : inheritedInvocation
      if (
        isCall &&
        isTranslationCallee(callee) &&
        typeof node.start === 'number' &&
        typeof node.end === 'number'
      ) {
        const args = Array.isArray(node.arguments) ? node.arguments : []
        const firstArgument = isBabelNode(args[0]) ? args[0] : undefined
        const key = staticArgumentValue(firstArgument)
        const argumentStart = typeof firstArgument?.start === 'number' ? firstArgument.start - 1 : undefined
        const argumentEnd = typeof firstArgument?.end === 'number' ? firstArgument.end - 1 : undefined
        calls.push({
          start: node.start - 1,
          end: node.end - 1,
          key,
          keyExpression:
            key === undefined && argumentStart !== undefined && argumentEnd !== undefined
              ? expression.slice(argumentStart, argumentEnd)
              : undefined,
          service: inheritedInvocation?.service,
          invocationStart: inheritedInvocation?.start,
          invocationEnd: inheritedInvocation?.end,
        })
        return
      }
      for (const [property, value] of Object.entries(node)) {
        if (property === 'loc' || property === 'extra' || property === 'tokens' || property === 'comments') {
          continue
        }
        if (Array.isArray(value)) {
          for (const item of value) if (isBabelNode(item)) visit(item, invocation)
        } else if (isBabelNode(value)) {
          visit(value, invocation)
        }
      }
    }
    visit(ast)
    return calls.sort((left, right) => left.start - right.start)
  } catch {
    return []
  }
}

function findScriptTranslationCalls(script: string): TranslationCall[] {
  try {
    const ast = parseExpression(script, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
      errorRecovery: true,
    }) as unknown as BabelNode
    const calls: TranslationCall[] = []
    const visit = (
      node: BabelNode,
      inheritedInvocation?: { service: string; start: number; end: number },
    ): void => {
      const isCall = node.type === 'CallExpression' || node.type === 'OptionalCallExpression'
      const callee = isBabelNode(node.callee) ? node.callee : undefined
      const directService = isCall ? imperativeServiceFromCallee(callee) : undefined
      const invocation =
        directService && typeof node.start === 'number' && typeof node.end === 'number'
          ? { service: directService, start: node.start, end: node.end }
          : inheritedInvocation
      if (
        isCall &&
        isTranslationCallee(callee) &&
        typeof node.start === 'number' &&
        typeof node.end === 'number'
      ) {
        const args = Array.isArray(node.arguments) ? node.arguments : []
        const firstArgument = isBabelNode(args[0]) ? args[0] : undefined
        const key = staticArgumentValue(firstArgument)
        const argumentStart = typeof firstArgument?.start === 'number' ? firstArgument.start : undefined
        const argumentEnd = typeof firstArgument?.end === 'number' ? firstArgument.end : undefined
        calls.push({
          start: node.start,
          end: node.end,
          key,
          keyExpression:
            key === undefined && argumentStart !== undefined && argumentEnd !== undefined
              ? script.slice(argumentStart, argumentEnd)
              : undefined,
          service: inheritedInvocation?.service,
          invocationStart: inheritedInvocation?.start,
          invocationEnd: inheritedInvocation?.end,
        })
        return
      }
      for (const [property, value] of Object.entries(node)) {
        if (property === 'loc' || property === 'extra' || property === 'tokens' || property === 'comments') {
          continue
        }
        if (Array.isArray(value)) {
          for (const item of value) if (isBabelNode(item)) visit(item, invocation)
        } else if (isBabelNode(value)) {
          visit(value, invocation)
        }
      }
    }
    visit(ast)
    return calls.sort((left, right) => left.start - right.start)
  } catch {
    return []
  }
}

function portablePath(id: string, projectRoot: string): string {
  return path.relative(projectRoot, id.split('?')[0]!).split(path.sep).join('/')
}

function lineColumn(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset)
  const lines = before.split(/\r?\n/)
  return { line: lines.length, column: lines.at(-1)!.length }
}

function occurrenceId(
  portableId: string,
  source: string,
  offset: number,
  kind: OccurrenceKind,
  key?: string,
  prop?: string,
  service?: string,
): string {
  const location = lineColumn(source, offset)
  return createOccurrenceId({
    key,
    file: portableId,
    line: location.line,
    column: location.column,
    kind,
    property: prop,
    service,
  })
}

function quoteInsideVueAttribute(value: string): string {
  return `'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')}'`
}

function applyRuntimeReplacements(
  magic: MagicStringApi,
  source: string,
  replacements: ValueReplacement[],
  quote: (value: string) => string,
): void {
  const invocationGroups = new Map<
    string,
    {
      start: number
      end: number
      service: string
      replacements: ValueReplacement[]
    }
  >()
  for (const replacement of replacements) {
    if (
      !replacement.service ||
      replacement.invocationStart === undefined ||
      replacement.invocationEnd === undefined ||
      replacement.invocationStart > replacement.start ||
      replacement.invocationEnd < replacement.end
    ) {
      continue
    }
    const key = `${replacement.invocationStart}:${replacement.invocationEnd}:${replacement.service}`
    const group = invocationGroups.get(key) ?? {
      start: replacement.invocationStart,
      end: replacement.invocationEnd,
      service: replacement.service,
      replacements: [],
    }
    group.replacements.push(replacement)
    invocationGroups.set(key, group)
  }

  const claimed = new Set<ValueReplacement>()
  const groups = [...invocationGroups.values()].sort((left, right) => right.start - left.start)
  for (const group of groups) {
    if (group.replacements.some((replacement) => claimed.has(replacement))) continue
    const segmentSource = source.slice(group.start, group.end)
    const segment = new MagicString(segmentSource)
    for (const replacement of [...group.replacements].sort((left, right) => right.start - left.start)) {
      const original = source.slice(replacement.start, replacement.end)
      segment.overwrite(
        replacement.start - group.start,
        replacement.end - group.start,
        `__collectI18nValue(${original}, ${quote(replacement.occurrenceId)})`,
      )
      claimed.add(replacement)
    }
    const occurrenceIds = [...new Set(group.replacements.map((item) => item.occurrenceId))]
    magic.overwrite(
      group.start,
      group.end,
      `__collectI18nInvoke(${quote(group.service)}, [${occurrenceIds.map(quote).join(', ')}], () => (${segment.toString()}))`,
    )
  }

  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    if (claimed.has(replacement)) continue
    const original = source.slice(replacement.start, replacement.end)
    magic.overwrite(
      replacement.start,
      replacement.end,
      `__collectI18nValue(${original}, ${quote(replacement.occurrenceId)})`,
    )
  }
}

function openingTagEnd(source: string): number {
  let quote: '"' | "'" | '`' | undefined
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!
    if (quote) {
      if (character === quote && source[index - 1] !== '\\') quote = undefined
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '>') return index
  }
  return -1
}

function blockContentOffset(source: string, block: SFCBlock): number {
  const hinted = block.loc.start.offset
  const found = source.indexOf(block.content, hinted)
  return found >= 0 ? found : hinted
}

function directivePropName(node: DirectiveNode): string | undefined {
  if (!node.arg || node.arg.type !== NodeTypes.SIMPLE_EXPRESSION || !node.arg.isStatic) return undefined
  return node.arg.content
}

function nativeBindingKind(prop: DirectiveNode, propName?: string): OccurrenceKind {
  if (prop.name === 'text' || prop.name === 'html') return 'text'
  if (prop.name === 'bind' && (propName === 'placeholder' || propName === 'value')) {
    return 'native'
  }
  return 'virtual'
}

function registerExpression(state: InstrumentationState, context: ExpressionContext): void {
  const calls = findTranslationCalls(context.content)
  for (const call of calls) {
    const absoluteStart = context.absoluteOffset + call.start
    const absoluteEnd = context.absoluteOffset + call.end
    const service = call.service ?? context.service
    const kind: OccurrenceKind = service ? 'imperative-service' : context.kind
    const id = occurrenceId(
      state.portableId,
      state.source,
      absoluteStart,
      kind,
      call.key,
      context.prop,
      service,
    )
    const start = lineColumn(state.source, absoluteStart)
    const end = lineColumn(state.source, absoluteEnd)
    const descriptor: OccurrenceDescriptor = {
      occurrenceId: id,
      key: call.key,
      keyExpression: call.key === undefined ? call.keyExpression : undefined,
      kind,
      component: context.component,
      prop: context.prop,
      service,
      source: {
        file: state.portableId,
        line: start.line,
        column: start.column,
        endLine: end.line,
        endColumn: end.column,
      },
      metadata: {
        sinkId: id,
        evidenceGrade:
          kind === 'native' || (kind === 'text' && !context.component)
            ? 'A'
            : kind === 'component-prop' || kind === 'text'
              ? 'B'
              : 'C',
        evidenceProof:
          kind === 'native'
            ? 'compiler-native-sink'
            : kind === 'text' && !context.component
              ? 'compiler-text-sink'
              : kind === 'component-prop' || kind === 'text'
                ? 'compiler-component-scope'
                : 'descriptor-only',
      },
    }
    state.occurrences.push(descriptor)
    state.replacements.push({
      start: absoluteStart,
      end: absoluteEnd,
      occurrenceId: id,
      service,
      invocationStart:
        service && call.invocationStart !== undefined
          ? context.absoluteOffset + call.invocationStart
          : undefined,
      invocationEnd:
        service && call.invocationEnd !== undefined
          ? context.absoluteOffset + call.invocationEnd
          : undefined,
    })
    if (context.owner) {
      const existing = state.ownerBindings.get(context.owner) ?? []
      existing.push(descriptor)
      state.ownerBindings.set(context.owner, existing)
    }
  }
}

function inspectElement(state: InstrumentationState, element: ElementNode): void {
  const isNative = element.tagType === ElementTypes.ELEMENT
  for (const prop of element.props) {
    if (
      prop.type !== NodeTypes.DIRECTIVE ||
      !prop.exp ||
      prop.exp.type !== NodeTypes.SIMPLE_EXPRESSION
    ) {
      continue
    }
    const propName = directivePropName(prop)
    let kind: OccurrenceKind
    if (isNative) {
      kind = nativeBindingKind(prop, propName)
    } else if (prop.name === 'bind' || prop.name === 'model' || prop.name === 'text' || prop.name === 'html') {
      kind = 'component-prop'
    } else {
      kind = 'virtual'
    }
    registerExpression(state, {
      content: prop.exp.content,
      absoluteOffset: state.templateOffset + prop.exp.loc.start.offset,
      kind,
      component: isNative ? undefined : element.tag,
      prop: propName,
      owner:
        kind === 'native' || kind === 'component-prop'
          ? element
          : undefined,
    })
  }

  for (const child of element.children) {
    if (child.type !== NodeTypes.INTERPOLATION) continue
    registerInterpolation(state, child, element, isNative)
  }

  for (const child of element.children) inspectChild(state, child)
}

function registerInterpolation(
  state: InstrumentationState,
  interpolation: InterpolationNode,
  owner: ElementNode,
  isNative: boolean,
): void {
  const content = interpolation.content
  if (content.type !== NodeTypes.SIMPLE_EXPRESSION) return
  registerExpression(state, {
    content: content.content,
    absoluteOffset: state.templateOffset + content.loc.start.offset,
    kind: 'text',
    component: isNative ? undefined : owner.tag,
    owner,
  })
}

function inspectChild(state: InstrumentationState, child: TemplateChildNode): void {
  if (child.type === NodeTypes.ELEMENT) {
    inspectElement(state, child)
    return
  }
  if (child.type === NodeTypes.IF) {
    for (const branch of child.branches) for (const branchChild of branch.children) inspectChild(state, branchChild)
    return
  }
  if (child.type === NodeTypes.FOR) {
    for (const loopChild of child.children) inspectChild(state, loopChild)
  }
}

function instrumentTemplateAst(state: InstrumentationState, root: RootNode): void {
  for (const child of root.children) inspectChild(state, child)

  for (const [element, bindings] of state.ownerBindings) {
    const alreadyMarked = element.props.some(
      (prop) =>
        prop.type === NodeTypes.ATTRIBUTE &&
        prop.name === 'data-collect-i18n-sink',
    )
    if (alreadyMarked || bindings.length === 0) continue
    const source = element.loc.source
    const tagEnd = openingTagEnd(source)
    if (tagEnd < 0) continue
    const selfClosingOffset = source.slice(0, tagEnd).match(/\/\s*$/)?.index
    const insertAt =
      state.templateOffset + element.loc.start.offset + (selfClosingOffset ?? tagEnd)
    const sinkIds = [...new Set(bindings.map((binding) => binding.occurrenceId))].join(' ')
    state.magic.appendLeft(
      insertAt,
      ` data-collect-i18n-sink="${sinkIds}"`,
    )
  }
}

function instrumentScriptBlock(state: InstrumentationState, block: SFCBlock | null): void {
  if (!block || block.src) return
  const offset = blockContentOffset(state.source, block)
  for (const call of findScriptTranslationCalls(block.content)) {
    const absoluteStart = offset + call.start
    const absoluteEnd = offset + call.end
    const kind: OccurrenceKind = call.service ? 'imperative-service' : 'virtual'
    const id = occurrenceId(
      state.portableId,
      state.source,
      absoluteStart,
      kind,
      call.key,
      undefined,
      call.service,
    )
    const start = lineColumn(state.source, absoluteStart)
    const end = lineColumn(state.source, absoluteEnd)
    state.occurrences.push({
      occurrenceId: id,
      key: call.key,
      keyExpression: call.key === undefined ? call.keyExpression : undefined,
      kind,
      service: call.service,
      source: {
        file: state.portableId,
        line: start.line,
        column: start.column,
        endLine: end.line,
        endColumn: end.column,
      },
      metadata: {
        sinkId: id,
        evidenceGrade: call.service ? 'C' : 'C',
        evidenceProof: call.service ? 'imperative-text-heuristic' : 'descriptor-only',
      },
    })
    state.replacements.push({
      start: absoluteStart,
      end: absoluteEnd,
      occurrenceId: id,
      service: call.service,
      invocationStart:
        call.service && call.invocationStart !== undefined ? offset + call.invocationStart : undefined,
      invocationEnd:
        call.service && call.invocationEnd !== undefined ? offset + call.invocationEnd : undefined,
    })
  }
}

function injectRuntimeScript(
  state: InstrumentationState,
  scriptSetup: SFCBlock | null,
  regularScript: SFCBlock | null,
  runtimeImport: string,
): void {
  if (state.occurrences.length === 0) return
  const descriptorJson = JSON.stringify(state.occurrences).replaceAll('<', '\\u003c')
  const runtimeCode =
    `import { enqueueDescriptors as __collectI18nEnqueue, recordRenderedValue as __collectI18nValue, runImperativeInvocation as __collectI18nInvoke } from ${JSON.stringify(runtimeImport)};\n` +
    `__collectI18nEnqueue(${descriptorJson});\n`

  if (scriptSetup) {
    state.magic.appendLeft(blockContentOffset(state.source, scriptSetup), runtimeCode)
  } else {
    const lang = regularScript?.lang ? ` lang="${regularScript.lang}"` : ''
    state.magic.append(`\n<script setup${lang}>\n${runtimeCode}</script>\n`)
  }

  applyRuntimeReplacements(
    state.magic,
    state.source,
    state.replacements,
    quoteInsideVueAttribute,
  )
}

export function instrumentVueSfc(
  source: string,
  id: string,
  options: CollectI18nVuePluginOptions = {},
): InstrumentedVueSfc | undefined {
  const parsed = parseSfc(source, { filename: id, sourceMap: true })
  if (parsed.errors.length > 0 || !parsed.descriptor.template) return undefined

  const projectRoot = path.resolve(options.projectRoot ?? process.cwd())
  const portableId = portablePath(id, projectRoot)
  const templateBlock = parsed.descriptor.template
  const templateOffset = blockContentOffset(source, templateBlock)
  let templateAst: RootNode
  try {
    templateAst = parseTemplate(templateBlock.content, { comments: true })
  } catch {
    return undefined
  }

  const magic = new MagicString(source)
  const state: InstrumentationState = {
    source,
    id,
    portableId,
    templateOffset,
    magic,
    occurrences: [],
    replacements: [],
    ownerBindings: new Map(),
  }
  instrumentTemplateAst(state, templateAst)
  instrumentScriptBlock(state, parsed.descriptor.script)
  instrumentScriptBlock(state, parsed.descriptor.scriptSetup)
  injectRuntimeScript(
    state,
    parsed.descriptor.scriptSetup,
    parsed.descriptor.script,
    resolveRuntimeImport(options.runtimeImport),
  )

  if (state.occurrences.length === 0) return undefined
  return {
    code: magic.toString(),
    map: magic.generateMap({ source: id, includeContent: true, hires: true }),
    occurrences: state.occurrences,
  }
}

/** Instrument translations in ordinary project TS/JS modules, including
 * Element Plus command-service calls that live outside a Vue SFC. */
export function instrumentScriptModule(
  source: string,
  id: string,
  options: CollectI18nVuePluginOptions = {},
): InstrumentedVueSfc | undefined {
  if (source.includes('__collectI18nEnqueue(')) return undefined
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd())
  const portableId = portablePath(id, projectRoot)
  const calls = findScriptTranslationCalls(source)
  if (calls.length === 0) return undefined

  const occurrences: OccurrenceDescriptor[] = []
  const replacements: ValueReplacement[] = []
  for (const call of calls) {
    const kind: OccurrenceKind = call.service ? 'imperative-service' : 'virtual'
    const idValue = occurrenceId(
      portableId,
      source,
      call.start,
      kind,
      call.key,
      undefined,
      call.service,
    )
    const start = lineColumn(source, call.start)
    const end = lineColumn(source, call.end)
    occurrences.push({
      occurrenceId: idValue,
      key: call.key,
      keyExpression: call.key === undefined ? call.keyExpression : undefined,
      kind,
      service: call.service,
      source: {
        file: portableId,
        line: start.line,
        column: start.column,
        endLine: end.line,
        endColumn: end.column,
      },
      metadata: {
        sinkId: idValue,
        evidenceGrade: 'C',
        evidenceProof: call.service ? 'imperative-text-heuristic' : 'descriptor-only',
      },
    })
    replacements.push({
      start: call.start,
      end: call.end,
      occurrenceId: idValue,
      service: call.service,
      invocationStart: call.invocationStart,
      invocationEnd: call.invocationEnd,
    })
  }

  const magic = new MagicString(source)
  applyRuntimeReplacements(magic, source, replacements, JSON.stringify)
  const descriptors = JSON.stringify(occurrences).replaceAll('<', '\\u003c')
  const runtimeImport = resolveRuntimeImport(options.runtimeImport)
  magic.prepend(
    `import { enqueueDescriptors as __collectI18nEnqueue, recordRenderedValue as __collectI18nValue, runImperativeInvocation as __collectI18nInvoke } from ${JSON.stringify(runtimeImport)};\n` +
      `__collectI18nEnqueue(${descriptors});\n`,
  )
  return {
    code: magic.toString(),
    map: magic.generateMap({ source: id, includeContent: true, hires: true }),
    occurrences,
  }
}
