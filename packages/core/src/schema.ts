import { z } from 'zod'

/**
 * Shared, versioned contracts used at every process boundary. Keep these
 * schemas transport-safe: paths and timestamps are strings and no class
 * instances cross the CLI/service/runtime boundary.
 */

export const LocaleCodeSchema = z.enum(['zh-cn', 'en-us'])
export type LocaleCode = z.infer<typeof LocaleCodeSchema>

export const ProjectConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    projectRoot: z.string().min(1),
    stateDirectory: z.string().min(1).default('.collect-i18n'),
    source: z
      .object({
        include: z
          .array(z.string().min(1))
          .default(['src/**/*.{vue,ts,tsx,js,jsx}']),
        exclude: z
          .array(z.string().min(1))
          .default(['**/node_modules/**', '**/dist/**', '**/.git/**']),
      })
      .default({
        include: ['src/**/*.{vue,ts,tsx,js,jsx}'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      }),
    locales: z
      .object({
        source: LocaleCodeSchema.default('zh-cn'),
        target: LocaleCodeSchema.default('en-us'),
        roots: z.array(z.string().min(1)).default(['src']),
      })
      .default({ source: 'zh-cn', target: 'en-us', roots: ['src'] }),
    app: z
      .object({
        baseUrl: z.string().url().default('http://127.0.0.1:5173'),
        devCommand: z.string().min(1).default('pnpm dev'),
        workingDirectory: z.string().min(1).optional(),
        healthPath: z.string().default('/'),
      })
      .default({
        baseUrl: 'http://127.0.0.1:5173',
        devCommand: 'pnpm dev',
        healthPath: '/',
      }),
    browser: z
      .object({
        headless: z.boolean().default(true),
        viewport: z
          .object({
            width: z.number().int().positive().default(1440),
            height: z.number().int().positive().default(900),
          })
          .default({ width: 1440, height: 900 }),
        locale: z.string().min(1).default('zh-CN'),
        cookies: z
          .array(
            z
              .object({
                name: z.string().min(1).max(200),
                value: z.string().max(4_000),
              })
              .strict(),
          )
          .max(20)
          .default([]),
        timeoutMs: z.number().int().positive().default(15_000),
      })
      .default({
        headless: true,
        viewport: { width: 1440, height: 900 },
        locale: 'zh-CN',
        cookies: [],
        timeoutMs: 15_000,
      }),
    instrumentation: z
      .object({
        enabled: z.boolean().default(true),
        devOnly: z.boolean().default(true),
      })
      .default({ enabled: true, devOnly: true }),
  })
  .strict()

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>

export const SourceLocationSchema = z
  .object({
    file: z.string().min(1),
    line: z.number().int().positive(),
    column: z.number().int().nonnegative(),
    endLine: z.number().int().positive().optional(),
    endColumn: z.number().int().nonnegative().optional(),
  })
  .strict()

export type SourceLocation = z.infer<typeof SourceLocationSchema>

export const LocaleKeySchema = z
  .object({
    id: z.string().min(1),
    keyPath: z.string().min(1),
    namespace: z.string(),
    relativeFile: z.string().min(1),
    jsonPath: z.array(z.string().min(1)).min(1),
    sourceText: z.string(),
    targetText: z.string().optional(),
    sourceLocale: LocaleCodeSchema.default('zh-cn'),
    targetLocale: LocaleCodeSchema.default('en-us'),
  })
  .strict()

export type LocaleKey = z.infer<typeof LocaleKeySchema>

export const RouteHintSchema = z
  .object({
    path: z.string().min(1),
    source: z.enum(['router_config', 'navigation_call', 'filename', 'agent']),
    confidence: z.number().min(0).max(1),
    params: z.record(z.string(), z.string()).optional(),
    location: SourceLocationSchema.optional(),
  })
  .strict()

export type RouteHint = z.infer<typeof RouteHintSchema>

export const ActionKindSchema = z.enum([
  'navigate',
  'click',
  'fill',
  'focus',
  'blur',
  'hover',
  'submit',
  'select',
  'wait',
  'custom',
])

export const ActionHintSchema = z
  .object({
    kind: ActionKindSchema,
    selector: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    value: z.string().optional(),
    event: z.string().min(1).optional(),
    source: z.enum(['template', 'script', 'validation_rule', 'agent']),
    confidence: z.number().min(0).max(1),
    location: SourceLocationSchema.optional(),
  })
  .strict()

export type ActionHint = z.infer<typeof ActionHintSchema>

export const MockRuleSchema = z
  .object({
    id: z.string().min(1).max(100),
    url: z.string().min(1).max(1_000),
    method: z.string().max(20).transform((value) => value.toUpperCase()).optional(),
    status: z.number().int().min(100).max(599).default(200),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.unknown().optional(),
    delayMs: z.number().int().min(0).max(10_000).optional(),
    once: z.boolean().optional(),
  })
  .strict()

export type MockRule = z.infer<typeof MockRuleSchema>
export type MockRuleInput = z.input<typeof MockRuleSchema>

export const OccurrenceKindSchema = z.enum([
  'native_dom',
  'text_range',
  'component_prop',
  'imperative_service',
])

export const OccurrenceSchema = z
  .object({
    id: z.string().min(1),
    keyPath: z.string().min(1),
    kind: OccurrenceKindSchema,
    location: SourceLocationSchema,
    expression: z.string().min(1),
    component: z.string().min(1).optional(),
    property: z.string().min(1).optional(),
    service: z.string().min(1).optional(),
    serviceMethod: z.string().min(1).optional(),
    teleported: z.boolean().default(false),
    dynamic: z.boolean().default(false),
    confidence: z.number().min(0).max(1),
    routeHints: z.array(RouteHintSchema).default([]),
    actionHints: z.array(ActionHintSchema).default([]),
  })
  .strict()

export type Occurrence = z.infer<typeof OccurrenceSchema>

export const BoundingBoxSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  })
  .strict()

export const TriggerActionSchema = z
  .object({
    kind: ActionKindSchema,
    selector: z.string().min(1).optional(),
    value: z.string().optional(),
    url: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
    description: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((action, context) => {
    if (action.kind === 'navigate' && !action.url) {
      context.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'navigate actions require url',
      })
    }
    if (
      ['click', 'fill', 'focus', 'blur', 'hover', 'submit', 'select'].includes(
        action.kind,
      ) &&
      !action.selector
    ) {
      context.addIssue({
        code: 'custom',
        path: ['selector'],
        message: `${action.kind} actions require selector`,
      })
    }
  })

export type TriggerAction = z.infer<typeof TriggerActionSchema>

export const PlanLocatorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('css'), value: z.string().min(1).max(500) }).strict(),
  z.object({ kind: z.literal('role'), value: z.string().min(1).max(100), name: z.string().max(200).optional() }).strict(),
  z.object({ kind: z.literal('text'), value: z.string().min(1).max(300), exact: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('label'), value: z.string().min(1).max(300), exact: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('testId'), value: z.string().min(1).max(200) }).strict(),
])

export type PlanLocator = z.infer<typeof PlanLocatorSchema>

const PlanTargetStepSchema = z.object({
  locator: PlanLocatorSchema,
  timeoutMs: z.number().int().min(100).max(30_000).optional(),
})

export const PlanStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('goto'), path: z.string().min(1).max(1_000) }).strict(),
  z.object({ type: z.literal('click'), ...PlanTargetStepSchema.shape }).strict(),
  z.object({ type: z.literal('fill'), ...PlanTargetStepSchema.shape, value: z.string().max(10_000) }).strict(),
  z.object({ type: z.literal('press'), ...PlanTargetStepSchema.shape, key: z.string().min(1).max(50) }).strict(),
  z.object({ type: z.literal('select'), ...PlanTargetStepSchema.shape, value: z.string().max(1_000) }).strict(),
  z.object({ type: z.literal('hover'), ...PlanTargetStepSchema.shape }).strict(),
  z.object({ type: z.literal('wait'), milliseconds: z.number().int().min(0).max(5_000) }).strict(),
  z.object({ type: z.literal('waitForKey'), key: z.string().min(1).max(500), timeoutMs: z.number().int().min(100).max(60_000).optional() }).strict(),
  z.object({ type: z.literal('waitForText'), text: z.string().min(1).max(500), timeoutMs: z.number().int().min(100).max(30_000).optional() }).strict(),
  z.object({ type: z.literal('reload') }).strict(),
])

export const TriggerPlanSchema = z.object({
  version: z.literal(1),
  targetKey: z.string().min(1).max(500),
  route: z.string().min(1).max(1_000).optional(),
  mocks: z.array(MockRuleSchema).max(30).default([]),
  steps: z.array(PlanStepSchema).min(1).max(40),
  rationale: z.string().max(1_000).optional(),
}).strict()

export type TriggerPlan = z.input<typeof TriggerPlanSchema>
export type ParsedTriggerPlan = z.output<typeof TriggerPlanSchema>

export const EvidenceSchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    taskId: z.string().min(1),
    keyPath: z.string().min(1),
    occurrenceId: z.string().min(1).optional(),
    screenshotPath: z.string().min(1),
    route: z.string().min(1),
    capturedAt: z.string().datetime({ offset: true }),
    viewport: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
    boundingBox: BoundingBoxSchema.optional(),
    triggerPlanId: z.string().min(1).optional(),
    method: z.enum(['static', 'agent', 'manual']),
    confidence: z.number().min(0).max(1),
    actionTrace: z.array(z.string()).default([]),
  })
  .strict()

export type Evidence = z.infer<typeof EvidenceSchema>

export const SessionStatusSchema = z.enum([
  'initialized',
  'running',
  'waiting_agent',
  'waiting_manual',
  'export_ready',
  'completed',
  'failed',
  'stopped',
])

export const TaskStatusSchema = z.enum([
  'pending',
  'running',
  'captured',
  'needs_agent',
  'needs_manual',
  'failed',
  'skipped',
])

export type SessionStatus = z.infer<typeof SessionStatusSchema>
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const SessionSummarySchema = z
  .object({
    id: z.string().min(1),
    projectRoot: z.string().min(1),
    status: SessionStatusSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    counts: z
      .object({
        total: z.number().int().nonnegative(),
        pending: z.number().int().nonnegative(),
        captured: z.number().int().nonnegative(),
        needsAgent: z.number().int().nonnegative(),
        needsManual: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()

export type SessionSummary = z.infer<typeof SessionSummarySchema>

export const AgentTaskSchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    key: LocaleKeySchema,
    status: TaskStatusSchema,
    occurrences: z.array(OccurrenceSchema),
    routeHints: z.array(RouteHintSchema).default([]),
    actionHints: z.array(ActionHintSchema).default([]),
    attempts: z.number().int().nonnegative().default(0),
    lastError: z.string().optional(),
  })
  .strict()

export type AgentTask = z.infer<typeof AgentTaskSchema>

export const JsonCommandErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
    retryable: z.boolean().default(false),
  })
  .strict()

export const JsonCommandResultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      command: z.string().min(1),
      timestamp: z.string().datetime({ offset: true }),
      data: z.unknown(),
      warnings: z.array(z.string()).default([]),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      command: z.string().min(1),
      timestamp: z.string().datetime({ offset: true }),
      error: JsonCommandErrorSchema,
      warnings: z.array(z.string()).default([]),
    })
    .strict(),
])

export type JsonCommandResult = z.infer<typeof JsonCommandResultSchema>

export function commandSuccess<T>(
  command: string,
  data: T,
  warnings: string[] = [],
): JsonCommandResult & { ok: true; data: T } {
  return {
    ok: true,
    command,
    timestamp: new Date().toISOString(),
    data,
    warnings,
  }
}

export function commandFailure(
  command: string,
  error: z.input<typeof JsonCommandErrorSchema>,
  warnings: string[] = [],
): JsonCommandResult & { ok: false } {
  return {
    ok: false,
    command,
    timestamp: new Date().toISOString(),
    error: JsonCommandErrorSchema.parse(error),
    warnings,
  }
}
