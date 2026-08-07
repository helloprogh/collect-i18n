import { describe, expect, it } from "vitest";
import { parseTriggerPlan } from "./plan.js";

describe("TriggerPlan", () => {
  it("accepts a bounded declarative plan", () => {
    const plan = parseTriggerPlan({
      version: 1,
      targetKey: "users.form.required",
      route: "/users/create",
      mocks: [{ id: "save-error", url: "/api/users", method: "post", status: 500 }],
      steps: [
        { type: "capture" },
        { type: "click", locator: { kind: "role", value: "button", name: "保存" } },
        { type: "waitForKey", key: "users.form.required" },
      ],
    });
    expect(plan.mocks[0]!.method).toBe("POST");
    expect(plan.steps[0]).toEqual({ type: "capture" });
  });

  it("accepts a bounded zero-based index for intentionally repeated locators", () => {
    const plan = parseTriggerPlan({
      version: 1,
      targetKey: "rows.delete",
      steps: [
        { type: "click", locator: { kind: "testId", value: "delete-row", index: 0 } },
      ],
    });
    expect(plan.steps[0]).toMatchObject({ locator: { index: 0 } });
  });

  it("rejects arbitrary script execution and excessive waits", () => {
    expect(() => parseTriggerPlan({ version: 1, targetKey: "a", steps: [{ type: "evaluate", script: "fetch('/secret')" }] })).toThrow();
    expect(() => parseTriggerPlan({ version: 1, targetKey: "a", steps: [{ type: "wait", milliseconds: 60_000 }] })).toThrow();
    expect(() => parseTriggerPlan({ version: 1, targetKey: "a", steps: [{ type: "fill", locator: { kind: "testId", value: "secret" }, valueFromEnv: "HOME" }] })).toThrow();
  });
});
