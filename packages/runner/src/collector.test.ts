import { describe, expect, it } from "vitest";
import { captureMarkerSpec, isCausalProbeSafe } from "./collector.js";

describe("captureMarkerSpec", () => {
  it("creates a text-free marker around the rendered target", () => {
    const marker = captureMarkerSpec(
      { x: 100, y: 60, width: 120, height: 24 },
      "capture-marker",
    );

    expect(marker).toEqual({
      id: "capture-marker",
      style: expect.stringContaining("left:96px;top:56px;width:128px;height:32px"),
    });
    expect(marker.style).toContain("border:4px solid #ef4444");
    expect(Object.keys(marker)).toEqual(["id", "style"]);
    expect(JSON.stringify(marker)).not.toContain("keyPath");
  });
});

describe("isCausalProbeSafe", () => {
  it("only replays read-only plans in an isolated canary page", () => {
    expect(isCausalProbeSafe()).toBe(true);
    expect(isCausalProbeSafe({
      version: 1,
      targetKey: "settings.title",
      mocks: [],
      steps: [
        { type: "goto", path: "/settings" },
        { type: "hover", locator: { kind: "testId", value: "advanced-help" } },
        { type: "waitForKey", key: "settings.advancedHelp" },
      ],
    })).toBe(true);
    expect(isCausalProbeSafe({
      version: 1,
      targetKey: "form.required",
      mocks: [],
      steps: [
        { type: "click", locator: { kind: "testId", value: "submit" } },
      ],
    })).toBe(false);
  });
});
