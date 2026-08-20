import type { Locator } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { captureMarkerSpec, clickResolvedLocator, isBrowserGoneError, isCausalProbeSafe, markerTolerantRegExp, resolveProjectUrl, stripInlineMarkers } from "./collector.js";

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
