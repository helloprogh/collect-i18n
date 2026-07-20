import {
  MockRuleSchema,
  PlanLocatorSchema,
  PlanStepSchema,
  TriggerPlanSchema,
  type MockRuleInput,
  type ParsedTriggerPlan,
  type PlanLocator,
  type TriggerPlan,
} from "@collect-i18n/core";

export const locatorSchema = PlanLocatorSchema;
export const mockRuleSchema = MockRuleSchema;
export const planStepSchema = PlanStepSchema;
export const triggerPlanSchema = TriggerPlanSchema;

export type { ParsedTriggerPlan, PlanLocator, TriggerPlan };
export type MockRule = MockRuleInput;

export function parseTriggerPlan(value: unknown): ParsedTriggerPlan {
  return triggerPlanSchema.parse(value);
}
