import type { Locator } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { captureMarkerSpec, clickResolvedLocator, isCausalProbeSafe } from "./collector.js";

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

describe("clickResolvedLocator", () => {
  it("clicks a wrapping label for a covered semantic radio input", async () => {
    const labelClick = vi.fn(async () => undefined);
    const directClick = vi.fn(async () => undefined);
    const directCheck = vi.fn(async () => undefined);
    const locator = {
      first: () => locator,
      getAttribute: vi.fn(async () => "radio"),
      locator: vi.fn(() => ({ count: vi.fn(async () => 1), click: labelClick })),
      click: directClick,
      check: directCheck,
    } as unknown as Locator;

    await clickResolvedLocator(locator, 2_000);

    expect(labelClick).toHaveBeenCalledWith({ timeout: 2_000 });
    expect(directClick).not.toHaveBeenCalled();
    expect(directCheck).not.toHaveBeenCalled();
  });

  it("force-checks a native control when it has no wrapping label", async () => {
    const directCheck = vi.fn(async () => undefined);
    const locator = {
      first: () => locator,
      getAttribute: vi.fn(async () => "checkbox"),
      locator: vi.fn(() => ({ count: vi.fn(async () => 0) })),
      click: vi.fn(async () => undefined),
      check: directCheck,
    } as unknown as Locator;

    await clickResolvedLocator(locator, 3_000);

    expect(directCheck).toHaveBeenCalledWith({ timeout: 3_000, force: true });
  });
});
