import type { Locator } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { LOADING_INDICATOR_SELECTORS, LOADING_INDICATOR_SELECTOR_LIST, CollectorError, captureMarkerSpec, clickResolvedLocator, collectorErrorCode, computeTargetBlocked, cropClipForTarget, isBrowserGoneError, isCausalProbeSafe, isLoadingElement, loadingSamplePoints, markerTolerantRegExp, mergedLoadingSelectors, resolveProjectUrl, stripInlineMarkers } from "./collector.js";

describe("isBrowserGoneError", () => {
  it("detects crashed-browser Playwright errors", () => {
    expect(isBrowserGoneError(new Error("browser has been closed"))).toBe(true);
    expect(isBrowserGoneError(new Error("Target page, context or browser has been closed"))).toBe(true);
    expect(isBrowserGoneError(new Error("Browser has been closed"))).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isBrowserGoneError(new Error("Timed out waiting for i18n key: dashboard.title"))).toBe(false);
    expect(isBrowserGoneError(undefined)).toBe(false);
    expect(isBrowserGoneError("browser has been closed")).toBe(false);
  });
});

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

describe("resolveProjectUrl", () => {
  const baseUrl = "http://127.0.0.1:5173/";

  it("resolves a plain router path against the dev server root", () => {
    expect(resolveProjectUrl("/users", { baseUrl })).toBe("http://127.0.0.1:5173/users");
  });

  it("prefixes the resolved Vite base", () => {
    expect(resolveProjectUrl("/users", { baseUrl, viteBase: "/admin/" })).toBe(
      "http://127.0.0.1:5173/admin/users",
    );
    expect(resolveProjectUrl("/", { baseUrl, viteBase: "/admin/" })).toBe(
      "http://127.0.0.1:5173/admin/",
    );
  });

  it("keeps hash-history routes behind a fragment", () => {
    expect(resolveProjectUrl("/users", { baseUrl, hashRouter: true })).toBe(
      "http://127.0.0.1:5173/#/users",
    );
    expect(resolveProjectUrl("/users", { baseUrl, viteBase: "/admin/", hashRouter: true })).toBe(
      "http://127.0.0.1:5173/admin/#/users",
    );
  });

  it("accepts absolute same-origin URLs such as the current page on reload", () => {
    const current = "http://127.0.0.1:5173/admin/#/users";
    expect(resolveProjectUrl(current, { baseUrl, viteBase: "/admin/", hashRouter: true })).toBe(current);
  });

  it("uses only the pathname of an absolute URL base such as a CDN", () => {
    expect(resolveProjectUrl("/users", { baseUrl, viteBase: "https://cdn.example.com/foo/" })).toBe(
      "http://127.0.0.1:5173/foo/users",
    );
    expect(resolveProjectUrl("/users", { baseUrl, viteBase: "https://cdn.example.com/" })).toBe(
      "http://127.0.0.1:5173/users",
    );
  });

  it("keeps hash-history routes behind a fragment with an absolute URL base", () => {
    expect(resolveProjectUrl("/users", { baseUrl, viteBase: "https://cdn.example.com/foo/", hashRouter: true })).toBe(
      "http://127.0.0.1:5173/foo/#/users",
    );
  });

  it("rejects cross-origin navigation", () => {
    expect(() => resolveProjectUrl("https://evil.example/x", { baseUrl })).toThrow(
      /outside project origin/,
    );
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

describe("runtime marker tolerance", () => {
  it("strips invisible provenance markers from translated text", () => {
    expect(stripInlineMarkers("新建\u2063\u2060\u2061\u2063")).toBe("新建");
    expect(stripInlineMarkers("打开抽屉\u2063\u2061\u2062\u2063\u2063")).toBe("打开抽屉");
    expect(stripInlineMarkers("plain text")).toBe("plain text");
  });

  it("builds a full-match pattern that tolerates markers and whitespace", () => {
    expect(markerTolerantRegExp("新建").test("新建\u2063\u2060\u2061\u2063")).toBe(true);
    expect(markerTolerantRegExp("打开抽屉").test("打开抽屉\u2063\u2061\u2062\u2063")).toBe(true);
    expect(markerTolerantRegExp("Save").test("Save\u2063\u2060\u2063")).toBe(true);
    expect(markerTolerantRegExp("打开抽屉").test("打开\u2063\u2060\u2063抽屉")).toBe(true);
    expect(markerTolerantRegExp("打开抽屉").test("打开别的抽屉")).toBe(false);
  });
});

describe("clickResolvedLocator generic path", () => {
  it("waits for visibility before clicking a plain control", async () => {
    const waitFor = vi.fn(async () => undefined);
    const directClick = vi.fn(async () => undefined);
    const locator = {
      first: () => locator,
      getAttribute: vi.fn(async () => null),
      locator: vi.fn(),
      waitFor,
      click: directClick,
      check: vi.fn(),
    } as unknown as Locator;

    await clickResolvedLocator(locator, 1_000);

    expect(waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 1_000 });
    expect(directClick).toHaveBeenCalledWith({ timeout: 1_000 });
  });

  it("force-clicks as a fallback when actionability keeps timing out", async () => {
    const waitFor = vi.fn(async () => undefined);
    const directClick = vi.fn()
      .mockRejectedValueOnce(new Error("locator.click: Timeout"))
      .mockResolvedValueOnce(undefined);
    const locator = {
      first: () => locator,
      getAttribute: vi.fn(async () => null),
      locator: vi.fn(),
      waitFor,
      click: directClick,
      check: vi.fn(),
    } as unknown as Locator;

    await clickResolvedLocator(locator, 2_000);

    expect(directClick).toHaveBeenNthCalledWith(1, { timeout: 2_000 });
    expect(directClick).toHaveBeenNthCalledWith(2, { timeout: 2_000, force: true });
  });
});


describe("loading indicator detection", () => {
  it("recognizes Element Plus and Ant Design loading overlays", () => {
    expect(isLoadingElement({ classList: { contains: (name: string) => name === "el-loading-mask" } })).toBe(true);
    expect(isLoadingElement({ classList: { contains: (name: string) => name === "el-loading-spinner" } })).toBe(true);
    expect(isLoadingElement({ classList: { contains: (name: string) => name === "el-skeleton" } })).toBe(true);
    expect(isLoadingElement({ classList: { contains: (name: string) => name === "ant-spin-spinning" } })).toBe(true);
    expect(isLoadingElement({
      classList: { contains: (name: string) => name === "el-icon" || name === "is-loading" },
    })).toBe(true);
  });

  it("honors the opt-in data-collect-i18n-loading hook", () => {
    expect(isLoadingElement({ dataset: { collectI18nLoading: "" } })).toBe(true);
  });

  it("ignores ordinary elements and null", () => {
    expect(isLoadingElement(null)).toBe(false);
    expect(isLoadingElement({ classList: { contains: () => false }, dataset: {} })).toBe(false);
    expect(isLoadingElement({ classList: { contains: (name: string) => name === "el-loading-mask" } })).toBe(true);
  });

  it("exposes the shared selector list used by the collector", () => {
    expect(LOADING_INDICATOR_SELECTORS).toContain(".el-loading-mask");
    expect(LOADING_INDICATOR_SELECTORS).toContain(".el-skeleton");
    expect(LOADING_INDICATOR_SELECTORS).toContain(".n-spin-body");
    expect(LOADING_INDICATOR_SELECTORS).toContain(".arco-spin-mask");
    expect(LOADING_INDICATOR_SELECTORS).toContain("#nprogress");
    expect(LOADING_INDICATOR_SELECTORS).toContain("[data-collect-i18n-loading]");
  });
});
describe("F1: configurable loading selectors", () => {
  it("keeps the built-in list as the default", () => {
    expect(mergedLoadingSelectors()).toEqual(LOADING_INDICATOR_SELECTOR_LIST);
  });

  it("appends project selectors without losing built-ins", () => {
    expect(mergedLoadingSelectors([".custom-spinner", " .table-loading "])).toEqual([
      ...LOADING_INDICATOR_SELECTOR_LIST,
      ".custom-spinner",
      ".table-loading",
    ]);
    expect(mergedLoadingSelectors([""])).toEqual(LOADING_INDICATOR_SELECTOR_LIST);
  });
});

describe("F3: multi-point sampling geometry", () => {
  const viewport = { width: 1440, height: 900 };

  it("samples the center plus the four corner pixels of the target", () => {
    const points = loadingSamplePoints({ x: 100, y: 50, width: 200, height: 100 }, viewport);
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ x: 200, y: 100 });
    const corners = points.slice(1).sort((a, b) => a.x - b.x || a.y - b.y);
    expect(corners).toEqual([
      { x: 100, y: 50 },
      { x: 100, y: 149 },
      { x: 299, y: 50 },
      { x: 299, y: 149 },
    ]);
  });

  it("clamps viewport-edge rectangles and falls back to the center", () => {
    const points = loadingSamplePoints({ x: -20, y: -10, width: 10, height: 10 }, viewport);
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
    }
    expect(loadingSamplePoints({ x: 0, y: 0, width: 1, height: 1 }, viewport)).toEqual([{ x: 0, y: 0 }]);
  });
});

describe("F3: target blocked any-hit rule", () => {
  it("blocks as soon as a single sampled point is covered", () => {
    expect(computeTargetBlocked(0, 5)).toBe(false);
    expect(computeTargetBlocked(1, 5)).toBe(true);
    expect(computeTargetBlocked(3, 5)).toBe(true);
  });

  it("never blocks an unsampled target", () => {
    expect(computeTargetBlocked(1, 0)).toBe(false);
  });
});

describe("F2: crop fallback geometry", () => {
  const viewport = { width: 1440, height: 900 };

  it("inflates the target rect by the 48px default margin", () => {
    expect(cropClipForTarget({ x: 100, y: 50, width: 200, height: 100 }, viewport)).toEqual({
      x: 52,
      y: 2,
      width: 296,
      height: 196,
    });
    expect(cropClipForTarget({ x: 100, y: 50, width: 200, height: 100 }, viewport, 0)).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 100,
    });
  });

  it("clamps to the viewport and keeps a minimum size", () => {
    const clip = cropClipForTarget({ x: 1400, y: 850, width: 200, height: 100 }, viewport);
    expect(clip.x + clip.width).toBeLessThanOrEqual(1440);
    expect(clip.y + clip.height).toBeLessThanOrEqual(900);
    expect(clip.width).toBeGreaterThanOrEqual(1);
    expect(clip.height).toBeGreaterThanOrEqual(1);
  });
});

describe("F5: structured collector errors", () => {
  it("carries a machine-readable code and details", () => {
    const error = new CollectorError(
      "loading_overlay_timeout",
      "Loading overlay still covers target dashboard.title; skipping to avoid a spinner screenshot",
      { key: "dashboard.title" },
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CollectorError");
    expect(error.code).toBe("loading_overlay_timeout");
    expect(error.details).toEqual({ key: "dashboard.title" });
    expect(error.message).toContain("Loading overlay still covers target");
  });

  it("classifies only CollectorError instances", () => {
    expect(collectorErrorCode(new CollectorError("key_not_found", "Timed out waiting for i18n key: x", { key: "x" })))
      .toBe("key_not_found");
    expect(collectorErrorCode(new Error("Timed out waiting for i18n key: x"))).toBeUndefined();
    expect(collectorErrorCode("loading_overlay_timeout")).toBeUndefined();
  });

  it("keeps origin-navigation failures code-tagged without breaking the message contract", () => {
    try {
      resolveProjectUrl("https://evil.example/x", { baseUrl: "http://127.0.0.1:5173/" });
      expect.unreachable("cross-origin navigation should throw");
    } catch (error) {
      expect((error as Error).message).toMatch(/outside project origin/);
      expect(collectorErrorCode(error)).toBe("navigation_out_of_origin");
    }
  });
});

