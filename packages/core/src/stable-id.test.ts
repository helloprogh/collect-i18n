import { describe, expect, it } from 'vitest'

import {
  JsonCommandResultSchema,
  TriggerPlanSchema,
  commandSuccess,
  createStableId,
  stableHash,
  stableStringify,
} from './index.js'

describe('stable identity helpers', () => {
  it('canonicalizes object property order', () => {
    expect(stableStringify({ beta: 2, alpha: 1 })).toBe(
      stableStringify({ alpha: 1, beta: 2 }),
    )
    expect(stableHash({ beta: 2, alpha: 1 })).toBe(
      stableHash({ alpha: 1, beta: 2 }),
    )
    expect(createStableId('Occurrence', { key: 'users.save' })).toMatch(
      /^occurrence_[0-9a-f]{16}$/,
    )
  })
})

describe('boundary contracts', () => {
  it('rejects an incomplete click action in an agent trigger plan', () => {
    const parsed = TriggerPlanSchema.safeParse({
      version: 1,
      targetKey: 'users.validation.required',
      route: '/users/create',
      steps: [{ type: 'click' }],
    })

    expect(parsed.success).toBe(false)
  })

  it('builds a valid machine-readable success envelope', () => {
    const result = commandSuccess('status', { sessionId: 'session-1' })
    expect(JsonCommandResultSchema.parse(result)).toEqual(result)
  })
})
