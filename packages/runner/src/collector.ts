import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrowserContext, Locator, Page, Route } from "playwright-core";
import { parseTriggerPlan, mockRuleSchema, type MockRule, type ParsedTriggerPlan, type PlanLocator, type TriggerPlan } from "./plan.js";
import { pickExactTextMatch } from "./textMatch.js";

export type RuntimeEvidenceGrade = "A" | "B" | "C";

export interface BrowserCollectorOptions {
  baseUrl: string;
  /** Resolved Vite `base` from the project dev server (for example `/admin/`). */
  viteBase?: string;
  /** True when the app uses vue-router hash history (createWebHashHistory). */
  hashRouter?: boolean;
  artifactDir: string;
  userDataDir: string;
  headless?: boolean;
  channel?: "chrome" | "msedge" | "chromium";
  defaultTimeoutMs?: number;
  viewport?: { width: number; height: number };
  locale?: string;
  cookies?: Array<{ name: string; value: string }>;
  /**
   * Locale cookie injected on every page open (for example
   * x-gde-locale=zh_CN). Some apps select their rendered language from this
   * cookie; injecting it guarantees the source locale renders regardless of
   * the persisted browser profile.
   */
  localeCookie?: { name: string; value: string };
  planTimeoutMs?: number;
  /**
   * Additional CSS selectors that identify loading/skeleton overlays from the
   * project's own component libraries (naive-ui, Arco, NProgress, custom
   * skeleton screens, ...). They are appended to the built-in Element Plus /
   * Ant Design / opt-in list so existing detection can never regress; pass []
   * to keep only the built-ins.
   */
  extraLoadingSelectors?: string[];
  /** Pixels of padding added around the target rectangle in the crop fallback
   * capture. Default 48, clamped to the viewport. */
  loadingCropMarginPx?: number;
  /** Bounded window (ms) to wait for a covering overlay to clear before a
   * capture is skipped with loading_overlay_timeout. Default 5_000 (matches
   * the pre-F2 hard-coded settle wait so default behavior is unchanged). */
  loadingClearWaitMs?: number;
}

export interface RuntimeTargetSnapshot {
  key: string;
  occurrenceId?: string;
  binding?: string;
  evidenceGrade?: RuntimeEvidenceGrade;
  evidenceProof?: string;
  text: string;
  route: string;
  rect: { x: number; y: number; width: number; height: number };
}

export interface CollectedEvidence extends RuntimeTargetSnapshot {
  screenshotPath: string;
  screenshotSha256: string;
  capturedAt: string;
  source: "deterministic" | "agent" | "manual";
  plan?: ParsedTriggerPlan;
  causalProbe?: {
    verified: true;
    originalGrade: "B";
    originalProof?: string;
  };
}

/**
 * Build a same-origin dev-server URL for a router path. Router paths are plain
 * paths (`/users`), so they must be prefixed with the resolved Vite `base` and,
 * for hash-history routers, placed behind a `#` fragment. Absolute URLs are
 * returned unchanged after an origin check (used when reloading the current
 * page, whose `location.href` already contains the base and hash).
 */
export function resolveProjectUrl(
  path: string,
  options: Pick<BrowserCollectorOptions, "baseUrl" | "viteBase" | "hashRouter">,
): string {
  const base = new URL(options.baseUrl);
  const absolute = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path) || path.startsWith("//");
  const target = absolute
    ? new URL(path)
    : buildProjectUrl(base.origin, path, options.viteBase ?? "/", options.hashRouter === true);
  if (target.origin !== base.origin) {
    throw new CollectorError(
      "navigation_out_of_origin",
      `TriggerPlan cannot navigate outside project origin: ${target.origin}`,
      { target: target.toString() },
    );
  }
  return target.toString();
}

/**
 * True when the active page already shows the route a TriggerPlan would open,
 * so executePlan can skip the redundant full navigation (Vite rebuild + route
 * settle, several seconds per plan) and reuse the current page. Same-origin
 * URLs are compared exactly; blank pages or anything that fails to resolve
 * behave as "not the same" so navigation still happens.
 */
export function sameRouteUrl(
  currentUrl: string,
  planRoute: string,
  options: Pick<BrowserCollectorOptions, "baseUrl" | "viteBase" | "hashRouter">,
): boolean {
  try {
    if (!currentUrl || currentUrl === "about:blank") return false;
    return new URL(resolveProjectUrl(planRoute, options)).href === new URL(currentUrl).href;
  } catch {
    return false;
  }
}

function basePathFromViteBase(viteBase: string): string {
  // Vite allows base to be a full URL (for example a CDN origin). Only its
  // pathname is meaningful for a same-origin dev-server navigation; the
  // collector origin is fixed by the project's own app base URL.
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(viteBase) || viteBase.startsWith("//")) {
    try {
      const parsed = new URL(viteBase);
      return parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    } catch {
      // Fall through to the relative-path interpretation.
    }
  }
  const normalizedBase = viteBase.startsWith("/") ? viteBase : `/${viteBase}`;
  return normalizedBase === "/" ? "" : normalizedBase.replace(/\/+$/, "");
}

function buildProjectUrl(
  origin: string,
  path: string,
  viteBase: string,
  hashRouter: boolean,
): URL {
  const basePath = basePathFromViteBase(viteBase);
  const routePath = path.startsWith("/") ? path : `/${path}`;
  const url = hashRouter
    ? `${origin}${basePath}/#${routePath}`
    : `${origin}${basePath}${routePath}`;
  return new URL(url);
}

export interface RuntimeInspection {
  url: string;
  collectorInstalled: boolean;
  markedElements: number;
  pendingDescriptors: number;
  snapshots: Array<{
    key?: string;
    occurrenceId?: string;
    kind?: string;
    evidenceGrade?: RuntimeEvidenceGrade;
    evidenceProof?: string;
    connected?: boolean;
    visible?: boolean;
    anchorType?: string;
    text?: string;
    rect?: { x: number; y: number; width: number; height: number };
  }>;
}

export interface CaptureMarkerSpec {
  id: string;
  style: string;
}

export function captureMarkerSpec(
  rect: { x: number; y: number; width: number; height: number },
  id = `collect-i18n-marker-${Date.now()}`,
): CaptureMarkerSpec {
  return {
    id,
    style: `position:fixed;z-index:2147483647;pointer-events:none;left:${rect.x - 4}px;top:${rect.y - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px;border:4px solid #ef4444;border-radius:6px;box-sizing:border-box;box-shadow:0 0 0 9999px rgba(15,23,42,.12)`,
  };
}

type RuntimeWindow = Window & {
  __COLLECT_I18N__?: {
    targets?: (key?: string) => RuntimeTargetSnapshot[];
    getVisibleOccurrences?: (key?: string) => RuntimeTargetSnapshot[];
    getSnapshot?: () => Array<{
      key?: string;
      occurrenceId?: string;
      kind?: string;
      evidenceGrade?: RuntimeEvidenceGrade;
      evidenceProof?: string;
      text?: string;
      visible?: boolean;
      rect?: { x: number; y: number; width: number; height: number };
    }>;
    focus?: (target: string | { key?: string; occurrenceId?: string }) => {
      key?: string;
      occurrenceId?: string;
      kind?: string;
      evidenceGrade?: RuntimeEvidenceGrade;
      evidenceProof?: string;
      text?: string;
      visible?: boolean;
      rect?: { x: number; y: number; width: number; height: number };
    } | undefined;
    waitForKey?: (key: string, timeoutMs?: number) => Promise<RuntimeTargetSnapshot>;
    setTarget?: (target: { key: string } | null) => void;
    rescan?: (root?: ParentNode) => void;
    waitForTarget?: (
      target: { key: string },
      options?: { timeoutMs?: number; requireVisible?: boolean },
    ) => Promise<{
      key?: string;
      occurrenceId?: string;
      kind?: string;
      evidenceGrade?: RuntimeEvidenceGrade;
      evidenceProof?: string;
      text?: string;
      visible?: boolean;
      rect?: { x: number; y: number; width: number; height: number };
    }>;
  };
  __I18N_COLLECTOR__?: RuntimeWindow["__COLLECT_I18N__"];
};

const CAUSAL_PROBE_STORAGE_KEY = "__collect_i18n_causal_probe_v1";
const SAFE_CAUSAL_PROBE_STEPS = new Set([
  "goto",
  "hover",
  "wait",
  "waitForKey",
  "waitForText",
  "reload",
]);

export function isCausalProbeSafe(plan?: ParsedTriggerPlan): boolean {
  return !plan || plan.steps.every((step) => SAFE_CAUSAL_PROBE_STEPS.has(step.type));
}

/**
 * Runtime-invisible provenance markers (U+2060-U+2063) appended after
 * translated text pollute accessible names and exact text matches.
 */
const RUNTIME_MARKER_CHAR_RANGE = "\u2060-\u2063";
const RUNTIME_MARKER_PATTERN = /\u2063[\u2060-\u2062]+\u2063/gu;
const RUNTIME_MARKER_CHARS = /[\u2060-\u2063]/gu;

export function stripInlineMarkers(value: string): string {
  return value.replace(RUNTIME_MARKER_PATTERN, "").replace(RUNTIME_MARKER_CHARS, "");
}

/**
 * Full-match regular expression that tolerates invisible runtime markers
 * and whitespace between every character, matching how the runtime appends
 * provenance tokens to rendered text (e.g. "新建" vs "新建\u2063\u2060\u2061\u2063").
 */
export function markerTolerantRegExp(value: string): RegExp {
  const clean = stripInlineMarkers(value).trim();
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const gap = `[\\s${RUNTIME_MARKER_CHAR_RANGE}]*`;
  return new RegExp(`^${escaped.split("").join(gap)}${gap}$`, "i");
}

/**
 * Built-in DOM selectors that identify visible loading/skeleton overlays from
 * common Vue component libraries. A matching element only counts as "loading"
 * when it is actually painted (has client rects); apps can also opt in with
 * the data-collect-i18n-loading attribute.
 */
export const LOADING_INDICATOR_SELECTOR_LIST = [
  ".el-loading-mask",
  ".el-loading-spinner",
  ".el-skeleton",
  ".el-skeleton__item",
  ".el-icon.is-loading",
  ".ant-spin-spinning",
  // naive-ui mounts .n-spin-body only while its Spin is loading.
  ".n-spin-body",
  // Arco Design renders the mask and the loading label only while loading.
  ".arco-spin-mask",
  ".arco-spin-loading",
  // NProgress mounts #nprogress only while a top progress bar is active.
  "#nprogress",
  "[data-collect-i18n-loading]",
];

/** Backwards-compatible joined selector string used by tests and callers. */
export const LOADING_INDICATOR_SELECTORS = LOADING_INDICATOR_SELECTOR_LIST.join(",");

/**
 * Merge project-supplied loading selectors (F1: configurable selectors) with
 * the built-in list. Custom selectors are appended so built-in detection can
 * never regress while apps can still mark their own spinners.
 */
export function mergedLoadingSelectors(custom?: string[]): string[] {
  const extra = (custom ?? []).map((selector) => selector.trim()).filter((selector) => selector.length > 0);
  return [...LOADING_INDICATOR_SELECTOR_LIST, ...extra];
}

/**
 * Multi-point sampling geometry (F3): the center plus the four corner pixels
 * of the target rectangle (5 points), clamped into the viewport. Points that
 * fall outside the rectangle after clamping are skipped; a degenerate rect
 * falls back to its center point.
 */
export function loadingSamplePoints(
  rect: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
): Array<{ x: number; y: number }> {
  const candidates = rect.width > 0 && rect.height > 0
    ? [
        { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width - 1, y: rect.y },
        { x: rect.x, y: rect.y + rect.height - 1 },
        { x: rect.x + rect.width - 1, y: rect.y + rect.height - 1 },
      ]
    : [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }];
  const points: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const x = Math.max(0, Math.min(viewport.width - 1, Math.round(candidate.x)));
    const y = Math.max(0, Math.min(viewport.height - 1, Math.round(candidate.y)));
    if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) {
      const key = x + ":" + y;
      if (!seen.has(key)) {
        seen.add(key);
        points.push({ x, y });
      }
    }
  }
  if (points.length === 0) {
    points.push({
      x: Math.max(0, Math.min(viewport.width - 1, Math.round(rect.x + rect.width / 2))),
      y: Math.max(0, Math.min(viewport.height - 1, Math.round(rect.y + rect.height / 2))),
    });
  }
  return points;
}

/**
 * Any-hit rule for the multi-point loading check (F3): the target counts as
 * blocked as soon as a single sampled point resolves to a loading overlay.
 */
export function computeTargetBlocked(blockedPoints: number, sampledPoints: number): boolean {
  return sampledPoints > 0 && blockedPoints >= 1;
}

/**
 * Crop fallback geometry (F2): inflate the target rect by marginPx and clamp
 * it to the viewport so a page with a loading overlay anywhere else can still
 * produce a clean cropped screenshot of the translated target.
 */
export function cropClipForTarget(
  rect: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  marginPx = 48,
): { x: number; y: number; width: number; height: number } {
  const margin = Math.max(0, Math.floor(marginPx));
  const x = Math.max(0, Math.round(rect.x - margin));
  const y = Math.max(0, Math.round(rect.y - margin));
  const width = Math.max(1, Math.min(viewport.width - x, Math.round(rect.width + margin * 2)));
  const height = Math.max(1, Math.min(viewport.height - y, Math.round(rect.height + margin * 2)));
  return { x, y, width, height };
}

/** Machine-readable failure categories (F5) for the collector. */
export type CollectorErrorCode =
  | "navigation_out_of_origin"
  | "collector_not_ready"
  | "key_not_found"
  | "target_out_of_viewport"
  | "loading_overlay_timeout"
  | "loading_overlay_persists"
  | "loading_overlay_race"
  | "capture_timeout"
  | "plan_deadline"
  | "deterministic_b_rejected"
  | "login_timeout";

/**
 * Structured collector error. The message stays human-readable (unchanged
 * from previous releases), while code lets callers branch programmatically:
 * a task blocked by a persistent loading overlay can be retried or handed to
 * manual without string-matching the message.
 */
export class CollectorError extends Error {
  readonly code: CollectorErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: CollectorErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "CollectorError";
    this.code = code;
    this.details = details;
  }
}

export function collectorErrorCode(error: unknown): CollectorErrorCode | undefined {
  return error instanceof CollectorError ? error.code : undefined;
}

/**
 * One snapshot of the loading-overlay state around a capture (F2/F3/F4):
 * - frameBlocked: any visible loading overlay is painted anywhere in the
 *   viewport (full-frame gate). When true, the capture falls back to a crop.
 * - targetBlocked: any of the sampled points inside the target rectangle
 *   (center plus the four corners, any-hit rule) resolves to a loading overlay.
 * - overlayRects: visible overlay rectangles clipped to the viewport, used to
 *   detect overlays that appear mid-capture.
 */
export interface FrameLoadingSample {
  frameBlocked: boolean;
  targetBlocked: boolean;
  targetBlockedPoints: number;
  targetSampledPoints: number;
  overlayRects: Array<{ x: number; y: number; width: number; height: number }>;
}

function sameRectIn(
  candidate: { x: number; y: number; width: number; height: number },
  list: Array<{ x: number; y: number; width: number; height: number }>,
): boolean {
  return list.some((other) =>
    Math.abs(candidate.x - other.x) <= 1 &&
    Math.abs(candidate.y - other.y) <= 1 &&
    Math.abs(candidate.width - other.width) <= 1 &&
    Math.abs(candidate.height - other.height) <= 1,
  );
}

function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * True when an element (or the topmost element at a point) is a loading
 * indicator. Kept dependency-free so it can run inside page.evaluate.
 */
export function isLoadingElement(
  element: {
    classList?: { contains(name: string): boolean };
    dataset?: Record<string, string | undefined>;
  } | null | undefined,
): boolean {
  if (!element) return false;
  const classes = element.classList;
  if (classes) {
    if (classes.contains("el-loading-mask") || classes.contains("el-loading-spinner")) return true;
    if (classes.contains("el-skeleton") || classes.contains("el-skeleton__item")) return true;
    if (classes.contains("ant-spin-spinning")) return true;
    if (classes.contains("el-icon") && classes.contains("is-loading")) return true;
  }
  return element.dataset?.collectI18nLoading !== undefined;
}

/**
 * Click a resolved control by its semantic wrapper when the accessible role
 * points at a covered native radio/checkbox input. Component libraries often
 * render the visible control as a label around that input; clicking the label
 * preserves normal application events without framework-specific selectors.
 */
export async function clickResolvedLocator(locator: Locator, timeoutMs: number): Promise<void> {
  const target = locator.first();
  const inputType = await target.getAttribute("type", { timeout: Math.min(timeoutMs, 5_000) }).catch(() => null);
  if (inputType === "radio" || inputType === "checkbox") {
    const wrappingLabel = target.locator("xpath=ancestor::label[1]");
    if ((await wrappingLabel.count().catch(() => 0)) > 0) {
      await wrappingLabel.click({ timeout: timeoutMs });
      return;
    }
    await target.check({ timeout: timeoutMs, force: true });
    return;
  }
  // Element Plus overlays/Teleports animate in: the confirm button can be
  // briefly "not visible" after the overlay mounts. Wait for visibility, then
  // click; force-click as a last resort for animation edge cases.
  await target.waitFor({ state: "visible", timeout: timeoutMs }).catch(() => undefined);
  try {
    await target.click({ timeout: timeoutMs });
  } catch (error) {
    await target.click({ timeout: Math.min(timeoutMs, 5_000), force: true });
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("**", "§§").replaceAll("*", "[^?]*").replaceAll("§§", ".*");
  return new RegExp(`^${escaped}$`);
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * True when a Playwright operation failed because the browser process or its
 * persistent context died (crash, forced quit, resource exhaustion). These
 * errors are fatal to the current BrowserContext but recoverable by relaunching
 * the persistent profile.
 */
export function isBrowserGoneError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /browser has been closed|Target page, context or browser has been closed|Browser has been closed|browser context has been disposed/i.test(
    error.message,
  );
}

export class BrowserCollector {
  private context?: BrowserContext;
  private page?: Page;
  private readonly rules = new Map<string, ReturnType<typeof mockRuleSchema.parse>>();
  private detectedGone = false;
  private restarting = false;
  /** Resolved loading-overlay selectors (F1): built-ins plus project extras. */
  private readonly loadingSelectorList: string[];
  private readonly loadingSelectors: string;
  private readonly loadingCropMarginPx: number;
  private readonly loadingClearWaitMs: number;

  constructor(private readonly options: BrowserCollectorOptions) {
    this.loadingSelectorList = mergedLoadingSelectors(options.extraLoadingSelectors);
    this.loadingSelectors = this.loadingSelectorList.join(",");
    this.loadingCropMarginPx = options.loadingCropMarginPx ?? 48;
    this.loadingClearWaitMs = options.loadingClearWaitMs ?? 5_000;
  }

  private async createFreshPage(restoredPages: Page[] = []): Promise<Page> {
    if (!this.context) throw new Error("Browser collector context is not running");
    try {
      const page = await this.context.newPage();
      await page.route("**/*", (route) => this.routeRequest(route));
      this.page = page;
      await Promise.all(restoredPages.filter((candidate) => candidate !== page).map((candidate) => candidate.close().catch(() => undefined)));
      return page;
    } catch (error) {
      if (!isBrowserGoneError(error)) throw error;
      // The browser process died underneath us (heavy plan execution, forced
      // quit, resource exhaustion). Relaunch the persistent profile once and
      // reuse the freshly created page instead of poisoning the whole session.
      this.detectedGone = true;
      await this.restart();
      if (!this.page || this.page.isClosed()) throw error;
      return this.page;
    }
  }

  async start(): Promise<void> {
    if (this.context && !this.detectedGone) return;
    await this.restart();
  }

  /**
   * Verify the browser and the collection page are usable before an
   * operation, relaunching the persistent profile after a crash. The service
   * calls this before every cached-collector use so a dead browser cannot
   * wedge the session.
   */
  async ensureHealthy(): Promise<void> {
    if (!this.context || this.detectedGone) {
      await this.restart();
      return;
    }
    try {
      await this.context.pages();
    } catch (error) {
      if (!isBrowserGoneError(error)) throw error;
      await this.restart();
      return;
    }
    if (!this.page || this.page.isClosed()) await this.createFreshPage();
  }

  /** Relaunch the persistent browser profile after a process crash. */
  async restart(): Promise<void> {
    if (this.restarting) throw new Error("Browser collector is already restarting");
    this.restarting = true;
    try {
      await this.context?.close().catch(() => undefined);
      this.context = undefined;
      this.page = undefined;
      // Give a freshly crashed Chrome process time to release its profile
      // lock before relaunching into the same userDataDir.
      await new Promise((done) => setTimeout(done, 250));
      const playwrightModule = process.env.COLLECT_I18N_PLAYWRIGHT_MODULE || "playwright-core";
      const { chromium } = await import(playwrightModule) as typeof import("playwright-core");
      await mkdir(this.options.userDataDir, { recursive: true });
      await mkdir(this.options.artifactDir, { recursive: true });
      const context = await chromium.launchPersistentContext(this.options.userDataDir, {
        channel: this.options.channel === "chromium" ? undefined : (this.options.channel ?? "chrome"),
        headless: this.options.headless ?? false,
        viewport: this.options.viewport ?? { width: 1440, height: 960 },
        locale: this.options.locale,
      });
      context.setDefaultTimeout(this.options.defaultTimeoutMs ?? 15_000);
      // Locale guard: run before any application script on every navigation.
      // Many Vue I18n apps seed their locale from localStorage; seeding the
      // well-known keys with the source locale guarantees the UI renders
      // Chinese regardless of a stale profile or an English navigator
      // language, so screenshots always show the source text.
      context.addInitScript((sourceLocale) => {
        try {
          const variants = Array.from(new Set([
            sourceLocale,
            sourceLocale.replace("-", "_"),
            sourceLocale.split("-")[0] ?? sourceLocale,
          ]));
          const primary = variants[0] ?? sourceLocale;
          const keys = [
            "locale", "lang", "language", "LOCALE", "LANG", "LANGUAGE",
            "appLang", "appLocale", "i18nLocale", "i18n_locale",
            "vue-i18n-locale", "VUE_I18N_LOCALE", "useLocale", "LOCALES_KEY",
          ];
          for (const key of keys) {
            try { window.localStorage.setItem(key, primary); } catch { /* ignore */ }
          }
        } catch { /* Storage unavailable: the app default then applies. */ }
      }, this.options.locale ?? "zh-CN");
      this.context = context;
      // A persistent profile may restore a tab whose previous Vite navigation
      // was interrupted by a crashed service. Reusing that tab can leave a new
      // navigation permanently pending. Preserve cookies/storage, but always
      // collect in a fresh page and discard restored tabs.
      if (this.options.cookies?.length) {
        await context.addCookies(this.options.cookies.map((cookie) => ({
          ...cookie,
          url: this.options.baseUrl,
        })));
      }
      if (this.options.localeCookie) {
        await context.addCookies([{
          name: this.options.localeCookie.name,
          value: this.options.localeCookie.value,
          url: this.options.baseUrl,
        }]);
      }
      this.detectedGone = false;
      await this.createFreshPage(context.pages());
    } finally {
      this.restarting = false;
    }
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
    this.detectedGone = false;
  }

  get activePage(): Page {
    if (!this.page) throw new Error("Browser collector is not running");
    return this.page;
  }

  setMockRules(rules: MockRule[]): void {
    this.rules.clear();
    for (const raw of rules) {
      const rule = mockRuleSchema.parse(raw);
      this.rules.set(rule.id, rule);
    }
  }

  private async routeRequest(route: Route): Promise<void> {
    const request = route.request();
    for (const [id, rule] of this.rules) {
      const matchesUrl = rule.url.startsWith("/")
        ? new URL(request.url()).pathname === rule.url
        : globToRegExp(rule.url).test(request.url());
      if (!matchesUrl || (rule.method && request.method() !== rule.method)) continue;
      if (rule.delayMs) await new Promise((done) => setTimeout(done, rule.delayMs));
      await route.fulfill({
        status: rule.status,
        headers: { "content-type": "application/json; charset=utf-8", ...rule.headers },
        body: typeof rule.body === "string" ? rule.body : JSON.stringify(rule.body ?? {}),
      });
      if (rule.once) this.rules.delete(id);
      return;
    }
    await route.continue();
  }

  private locator(value: PlanLocator): Locator {
    return this.buildLocator(this.activePage, value);
  }

  private scopedLocator(scope: Locator, value: PlanLocator): Locator {
    return this.buildLocator(scope, value);
  }

  private buildLocator(root: Page | Locator, value: PlanLocator): Locator {
    const locator = (() => {
      switch (value.kind) {
        case "css": return root.locator(value.value);
        case "role": return root.getByRole(value.value as never, { name: value.name ? markerTolerantRegExp(value.name) : undefined });
        case "text": return value.exact
          ? root.getByText(markerTolerantRegExp(value.value), { exact: true })
          : root.getByText(stripInlineMarkers(value.value), { exact: false });
        case "label": return value.exact
          ? root.getByLabel(markerTolerantRegExp(value.value), { exact: true })
          : root.getByLabel(stripInlineMarkers(value.value), { exact: false });
        case "testId": return root.getByTestId(value.value);
      }
    })();
    return value.index === undefined ? locator : locator.nth(value.index);
  }

  /**
   * Click a plan control. When several controls share the same name and a
   * modal dialog is open (Element Plus message boxes are teleported to
   * <body>), the confirm/action button inside the dialog is almost always the
   * intended target -- sibling row-level buttons that also match are not, and
   * clicking the first of them silently derails the plan.
   */
  private async clickControl(spec: PlanLocator, timeoutMs: number): Promise<void> {
    const page = this.activePage;
    const primary = this.locator(spec);
    if (spec.index !== undefined) {
      await clickResolvedLocator(primary, timeoutMs);
      return;
    }
    const matchCount = await primary.count().catch(() => 0);
    if (matchCount > 1) {
      const dialog = page.locator('.el-message-box:visible, [role="dialog"]:visible').last();
      if ((await dialog.count().catch(() => 0)) > 0) {
        const scoped = this.scopedLocator(dialog, spec);
        if ((await scoped.count().catch(() => 0)) > 0) {
          await clickResolvedLocator(scoped, timeoutMs);
          return;
        }
      }
    }
    await clickResolvedLocator(primary, timeoutMs);
  }

  private stepTimeout(timeoutMs?: number): number {
    return timeoutMs ?? this.options.defaultTimeoutMs ?? 15_000;
  }

  // Component libraries (Element Plus, Ant Design, ...) wrap the native control
  // in a container such as .el-input and attach data-testid to the wrapper.
  // fill/press only operate on the editable control, so resolve to the inner
  // input/textarea when the locator is not itself editable.
  private async resolveEditable(locator: Locator, timeoutMs: number): Promise<Locator> {
    const scope = locator.first();
    await scope.waitFor({ state: "attached", timeout: timeoutMs }).catch(() => undefined);
    const inner = scope.locator('input, textarea, select, [contenteditable="true"]').first();
    if ((await inner.count().catch(() => 0)) > 0) {
      await inner.waitFor({ state: "visible", timeout: timeoutMs }).catch(() => undefined);
      return inner;
    }
    return scope;
  }

  private async fillInput(locator: Locator, value: string, timeoutMs?: number): Promise<void> {
    const timeout = this.stepTimeout(timeoutMs);
    await (await this.resolveEditable(locator, timeout)).fill(value, { timeout });
  }

  // Custom selects are not native SELECT elements, so selectOption cannot target
  // them. Open the dropdown and click the option whose visible label matches the
  // value (exact first, then substring). Native selects still use selectOption.
  private async selectOption(locator: Locator, value: string, timeoutMs?: number): Promise<void> {
    const timeout = this.stepTimeout(timeoutMs);
    const scope = locator.first();
    const tagName = await scope.evaluate((el) => el.tagName).catch(() => "");
    if (tagName === "SELECT") {
      await scope.selectOption(value, { timeout });
      return;
    }
    await this.chooseCustomOption(scope, value, timeout);
  }

  private async chooseCustomOption(locator: Locator, value: string, timeoutMs: number): Promise<void> {
    const page = this.activePage;
    await clickResolvedLocator(locator, timeoutMs);
    const options = page.locator('.el-select-dropdown:visible .el-select-dropdown__item, [role="option"]:visible');
    let match = options.getByText(markerTolerantRegExp(value), { exact: true });
    if ((await match.count().catch(() => 0)) === 0) match = options.filter({ hasText: stripInlineMarkers(value) });
    await match.first().click({ timeout: timeoutMs });
  }

  private sameOriginUrl(path: string): string {
    return resolveProjectUrl(path, this.options);
  }

  private assertSameOrigin(): void {
    const current = this.activePage.url();
    if (current === "about:blank") return;
    const actual = new URL(current);
    const expected = new URL(this.options.baseUrl);
    if (actual.origin !== expected.origin) {
      throw new CollectorError(
        "navigation_out_of_origin",
        `TriggerPlan left the project origin: ${actual.origin}`,
        { actual: actual.origin, expected: expected.origin },
      );
    }
  }

  private async replaySafeProbePlan(plan: ParsedTriggerPlan | undefined, fallbackRoute: string): Promise<void> {
    if (plan?.route) await this.open(plan.route);
    else await this.open(fallbackRoute);
    for (const step of plan?.steps ?? []) {
      switch (step.type) {
        case "goto": await this.open(step.path); break;
        case "hover": await this.locator(step.locator).hover({ timeout: step.timeoutMs }); break;
        case "wait": await this.activePage.waitForTimeout(step.milliseconds); break;
        case "waitForKey": await this.waitForKey(step.key, step.timeoutMs); break;
        case "waitForText": await this.activePage.getByText(stripInlineMarkers(step.text)).first().waitFor({ state: "visible", timeout: step.timeoutMs }); break;
        case "reload": await this.open(this.activePage.url()); break;
        default: throw new Error(`Unsafe causal probe step: ${step.type}`);
      }
      this.assertSameOrigin();
    }
  }

  private async verifyCausalBinding(
    target: RuntimeTargetSnapshot,
    plan?: ParsedTriggerPlan,
  ): Promise<boolean> {
    if (
      target.evidenceGrade !== "B" ||
      !target.occurrenceId ||
      !isCausalProbeSafe(plan) ||
      !this.context
    ) {
      return false;
    }

    const originalPage = this.activePage;
    const probePage = await this.context.newPage();
    await probePage.route("**/*", (route) => this.routeRequest(route));
    const token = `__COLLECT_CANARY_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    const origin = new URL(this.options.baseUrl).origin;
    await probePage.addInitScript(
      ({ expectedOrigin, storageKey, value }) => {
        if (location.origin === expectedOrigin) {
          sessionStorage.setItem(storageKey, JSON.stringify(value));
        }
      },
      {
        expectedOrigin: origin,
        storageKey: CAUSAL_PROBE_STORAGE_KEY,
        value: { occurrenceId: target.occurrenceId, token },
      },
    );

    this.page = probePage;
    try {
      this.setMockRules(plan?.mocks ?? []);
      await this.replaySafeProbePlan(plan, target.route);
      const probed = await this.waitForKey(target.key, 15_000, "B");
      return probed.occurrenceId === target.occurrenceId && probed.text === token;
    } catch {
      return false;
    } finally {
      this.page = originalPage;
      await probePage.close().catch(() => undefined);
      await originalPage.bringToFront().catch(() => undefined);
    }
  }

  /**
   * Isolated causal canary for many B-grade targets on the same route at
   * once: a single probe page navigation carries one token per occurrence, so
   * the per-key newPage+replay cost collapses into one replay. Per-key
   * semantics are unchanged from verifyCausalBinding: a key is verified only
   * when its probed occurrence id matches the original target and its
   * rendered text equals its token.
   */
  private async verifyCausalBindings(targets: RuntimeTargetSnapshot[]): Promise<Map<string, boolean>> {
    const verified = new Map<string, boolean>();
    for (const target of targets) verified.set(target.key, false);
    const probeable = targets.filter((target) =>
      target.evidenceGrade === "B" &&
      Boolean(target.occurrenceId) &&
      isCausalProbeSafe(undefined) &&
      Boolean(this.context),
    );
    if (probeable.length === 0 || !this.context) return verified;

    const originalPage = this.activePage;
    const probePage = await this.context.newPage();
    await probePage.route("**/*", (route) => this.routeRequest(route));
    const tokens = new Map<string, string>();
    for (const target of probeable) {
      const occurrenceId = target.occurrenceId!;
      if (!tokens.has(occurrenceId)) {
        tokens.set(occurrenceId, "__COLLECT_CANARY_" + Date.now() + "_" + Math.random().toString(36).slice(2) + "__");
      }
    }
    const origin = new URL(this.options.baseUrl).origin;
    await probePage.addInitScript(
      ({ expectedOrigin, storageKey, entries }) => {
        if (location.origin === expectedOrigin) {
          sessionStorage.setItem(storageKey, JSON.stringify({ tokens: Object.fromEntries(entries) }));
        }
      },
      {
        expectedOrigin: origin,
        storageKey: CAUSAL_PROBE_STORAGE_KEY,
        entries: [...tokens.entries()],
      },
    );

    this.page = probePage;
    try {
      this.setMockRules([]);
      await this.replaySafeProbePlan(undefined, probeable[0]!.route);
      const probed = await this.captureVisibleTargets(probeable.map((target) => target.key), "B");
      for (const probe of probed) {
        const target = probeable.find((candidate) => candidate.key === probe.key);
        if (!target) continue;
        const token = target.occurrenceId ? tokens.get(target.occurrenceId) : undefined;
        if (token && probe.occurrenceId === target.occurrenceId && probe.text === token) {
          verified.set(probe.key, true);
        }
      }
      return verified;
    } catch {
      return verified;
    } finally {
      this.page = originalPage;
      await probePage.close().catch(() => undefined);
      await originalPage.bringToFront().catch(() => undefined);
    }
  }

  async executePlan(
    rawPlan: TriggerPlan,
    source: CollectedEvidence["source"] = "agent",
    onCheckpoint?: () => Promise<void>,
  ): Promise<CollectedEvidence> {
    const plan = parseTriggerPlan(rawPlan);
    const executingPage = this.activePage;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadlineMs = this.options.planTimeoutMs ?? 90_000;
    const execution = (async () => {
      this.setMockRules(plan.mocks);
      // R5: reuse the current page when it already shows the plan route; a
      // full re-navigation costs a Vite rebuild + settle (seconds per plan)
      // and consecutive anchors on the same route were the largest Agent
      // throughput waste measured in the research.
      if (plan.route && !sameRouteUrl(this.activePage.url(), plan.route, this.options)) {
        await this.open(plan.route);
      }

      for (const step of plan.steps) {
        this.assertSameOrigin();
        switch (step.type) {
          case "goto": await this.open(step.path); break;
          case "click": await this.clickControl(step.locator, this.stepTimeout(step.timeoutMs)); break;
          case "fill": await this.fillInput(this.locator(step.locator), step.value, step.timeoutMs); break;
          case "press": await (await this.resolveEditable(this.locator(step.locator), this.stepTimeout(step.timeoutMs))).press(step.key, { timeout: step.timeoutMs }); break;
          case "select": await this.selectOption(this.locator(step.locator), step.value, step.timeoutMs); break;
          case "hover": await this.locator(step.locator).hover({ timeout: step.timeoutMs }); break;
          case "wait": await this.activePage.waitForTimeout(step.milliseconds); break;
          case "waitForKey": await this.waitForKey(step.key, step.timeoutMs); break;
          case "waitForText": await this.activePage.getByText(stripInlineMarkers(step.text)).first().waitFor({ state: "visible", timeout: step.timeoutMs }); break;
          case "capture": await onCheckpoint?.(); break;
          case "reload": await this.open(this.activePage.url()); break;
        }
        this.assertSameOrigin();
      }

      const target = await this.waitForKey(plan.targetKey, 10_000, "B");
      return this.capture(target, source, plan);
    })();
    try {
      return await Promise.race([
        execution,
        new Promise<CollectedEvidence>((_resolve, reject) => {
          timer = setTimeout(() => {
            void executingPage.close().catch(() => undefined);
            reject(new CollectorError(
              "plan_deadline",
              `TriggerPlan exceeded its ${deadlineMs}ms execution deadline`,
              { key: plan.targetKey, deadlineMs },
            ));
          }, deadlineMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      if (this.context && (!this.page || this.page.isClosed())) {
        try { await this.createFreshPage(); }
        catch { /* browser died while recovering; the next operation heals via ensureHealthy */ }
      }
    }
  }

  /**
   * One-shot deterministic login for gated apps (R-login). Runs only when
   * the caller passes credentials; resolves selectors with sane defaults,
   * skips entirely when the app did not redirect to the login path (already
   * authenticated), and waits for the redirect back out of the login route.
   * Credentials come from the service config or the
   * COLLECT_I18N_LOGIN_USERNAME / COLLECT_I18N_LOGIN_PASSWORD environment
   * variables.
   */
  async performLogin(login: {
    path?: string;
    usernameSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
    username?: string;
    password?: string;
  }): Promise<boolean> {
    const username = process.env.COLLECT_I18N_LOGIN_USERNAME || login.username;
    const password = process.env.COLLECT_I18N_LOGIN_PASSWORD || login.password;
    if (!username || !password) return false;
    this.assertSameOrigin();
    const loginPath = login.path ?? "/login";
    await this.open(loginPath);
    if (!this.activePage.url().toLowerCase().includes(loginPath.toLowerCase())) {
      return false; // Already authenticated: no redirect to the login route.
    }
    const timeout = 10_000;
    // The first fill runs inside the retry loop below so an app that
    // auto-authenticates (or bounces the route) mid-fill lands in the
    // graceful "loginFormPresent=false && !onLoginRoute" path instead of throwing.

    // Cold Vite dev servers re-optimize dependencies on the first submit and
    // hard-reload the page, which can swallow the login redirect. Retry the
    // bounded form flow before declaring the login stuck. Success means the
    // login FORM disappeared or the URL left the login route — some apps
    // keep a login-ish URL or hash while the dashboard already mounts.
    const passwordLocator = this.activePage.locator(login.passwordSelector ?? 'input[type="password"]').first();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const userLocator = this.activePage.locator(login.usernameSelector ?? 'input[type="text"], input[name*="user" i]').first();
      try {
        await userLocator.fill(username, { timeout });
        await passwordLocator.fill(password, { timeout });
      } catch (error) {
        // The app may have left the login route on its own (auto-login,
        // bounced session, guard redirect): that means we ARE authenticated
        // and the form flow is moot. Diagnostics still land in the log for
        // genuinely stuck forms.
        const state = await this.activePage.evaluate(() => ({
          url: location.href,
          loginFormPresent: !!document.querySelector('.login-form, form[action*="login"], input[type="password"]'),
          inputs: [...document.querySelectorAll("input")].slice(0, 8).map((el) => ({
            id: el.id, disabled: el.disabled, type: el.type,
            placeholder: el.placeholder, form: el.closest("form")?.className ?? null,
          })),
          messages: document.querySelectorAll(".el-message").length,
        })).catch(() => ({ url: this.activePage.url(), loginFormPresent: true, inputs: [], messages: -1 }));
        console.error("[collect-i18n] login fill failed", JSON.stringify(state));
        const rawUrl = typeof state.url === "string" ? state.url : this.activePage.url();
        const hashIndex = rawUrl.indexOf("#");
        const routePart = hashIndex >= 0 ? rawUrl.slice(hashIndex + 1) : new URL(rawUrl).pathname;
        const onLoginRoute = routePart.toLowerCase().includes(loginPath.toLowerCase());
        if (state.loginFormPresent === false && !onLoginRoute) {
          await this.waitForLoadingCleared();
          return true;
        }
        throw error;
      }
      await this.activePage.locator(login.submitSelector ?? 'button[type="submit"], .el-button--primary').first().click({ timeout });
      // Bounded wait for the app to leave the login form.
      const startedAt = Date.now();
      while (Date.now() - startedAt < 15_000) {
        const formStillVisible = await passwordLocator.isVisible().catch(() => false);
        // Hash-router apps keep the document path (often the login path
        // itself) and change the fragment on navigation: compare the
        // fragment when present, the pathname otherwise.
        const rawUrl = this.activePage.url();
        const hashIndex = rawUrl.indexOf("#");
        const routePart = hashIndex >= 0
          ? rawUrl.slice(hashIndex + 1)
          : new URL(rawUrl).pathname;
        const onLoginRoute = routePart.toLowerCase().includes(loginPath.toLowerCase());
        if (!formStillVisible || !onLoginRoute) {
          await this.waitForLoadingCleared();
          return true;
        }
        await new Promise((done) => setTimeout(done, 200));
      }
    }
    throw new CollectorError("login_timeout", `Login form still visible after the retry budget`, { url: this.activePage.url() });
  }

  async open(path = "/"): Promise<void> {
    // Some apps decide the rendered language from a cookie on every load.
    // Re-apply it on each navigation so a cleared/stale profile cannot switch
    // the UI away from the source locale mid-run.
    await this.applyLocaleCookie();
    const navigationTimeout = Math.max(90_000, (this.options.defaultTimeoutMs ?? 15_000) * 6);
    await this.activePage.goto(this.sameOriginUrl(path), {
      // `domcontentloaded` is allowed to remain pending when a transformed
      // module stalls. Commit first, then perform our own bounded readiness
      // probe so failures are actionable and cannot wedge the service.
      waitUntil: "commit",
      // Vite's first transform on a real project is often materially slower
      // than subsequent locator operations. Keep navigation bounded, but do
      // not reuse the short per-action timeout for the initial compilation.
      timeout: navigationTimeout,
    });
    const startedAt = Date.now();
    const readinessTimeout = navigationTimeout;
    while (Date.now() - startedAt < readinessTimeout) {
      const ready = await bounded(this.activePage.evaluate(() => {
        const view = window as RuntimeWindow;
        return document.readyState !== "loading" && Boolean(view.__COLLECT_I18N__ ?? view.__I18N_COLLECTOR__);
      }), 2_000, "Page became unresponsive during collector readiness check").catch(() => false);
      if (ready) {
        // Route components are frequently lazy-loaded (component: () =>
        // import(...)). The collector runtime installs at startup while the
        // route chunk is still fetching; give the chunk time to mount and any
        // v-loading/skeleton overlay to clear before the first inspection.
        await this.settleNavigation();
        return;
      }
      await new Promise((done) => setTimeout(done, 125));
    }
    throw new CollectorError(
      "collector_not_ready",
      `Collector runtime did not become ready after navigation: ${this.activePage.url()}`,
      { url: this.activePage.url() },
    );
  }

  /**
   * Best-effort locale cookie injection before a navigation. Never throws:
   * a cookie that fails to set must not block collection of an app that does
   * not use cookies for locale selection.
   */
  private async applyLocaleCookie(): Promise<void> {
    const cookie = this.options.localeCookie;
    if (!cookie || !this.context) return;
    try {
      await this.context.addCookies([{ ...cookie, url: this.options.baseUrl }]);
    } catch { /* non-fatal */ }
  }

  /**
   * Wait for a navigation to fully settle before taking a snapshot or
   * screenshot. A page is settled when all three hold:
   * - document.readyState is past "loading";
   * - no pending runtime descriptors remain (async service invocations);
   * - no visible loading/skeleton overlay is painted, and no new JS/CSS
   *   resources have been fetched for a short quiet window (covers lazy route
   *   chunk imports that the runtime cannot see).
   * Bounded: a permanently animated page yields after the timeout instead of
   * wedging the collector.
   */
  private async settleNavigation(timeoutMs = 6_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let previousResourceCount = -1;
    let resourceChangedAt = Date.now();
    let cleanSince = -1;
    while (Date.now() < deadline) {
      const state = await bounded(
        this.activePage.evaluate((loadingSelectors) => {
          const runtimeWindow = window as RuntimeWindow & { __COLLECT_I18N_PENDING__?: unknown[] };
          let loadingCount = 0;
          for (const element of document.querySelectorAll<HTMLElement>(loadingSelectors)) {
            if (element.getClientRects().length > 0) loadingCount += 1;
          }
          return {
            ready: document.readyState,
            pending: runtimeWindow.__COLLECT_I18N_PENDING__?.length ?? 0,
            loadingCount,
            resourceCount: performance.getEntriesByType("resource").length,
          };
        }, this.loadingSelectors),
        1_500,
        "Page became unresponsive during inspection settle",
      ).catch(() => undefined);
      if (!state) {
        cleanSince = -1;
        await new Promise((done) => setTimeout(done, 150));
        continue;
      }
      if (state.resourceCount !== previousResourceCount) {
        previousResourceCount = state.resourceCount;
        resourceChangedAt = Date.now();
      }
      const clean =
        state.ready !== "loading" &&
        state.pending === 0 &&
        state.loadingCount === 0;
      if (!clean) {
        cleanSince = -1;
      } else if (cleanSince < 0) {
        cleanSince = Date.now();
      }
      if (cleanSince >= 0) {
        const cleanFor = Date.now() - cleanSince;
        const resourcesQuiet = Date.now() - resourceChangedAt >= 300;
        // Two consecutive clean samples (>=300ms) settle immediately when the
        // resource stream is quiet; a polling page that keeps fetching must
        // not stall the collector, so settle after a bounded 1s grace.
        if (cleanFor >= 300 && (resourcesQuiet || cleanFor >= 1_000)) return;
      }
      await new Promise((done) => setTimeout(done, 150));
    }
  }

  /**
   * Best-effort wait until no visible loading/skeleton overlay remains (F3).
   * Returns true when the page is clean; returns false when the bounded
   * deadline passes while overlays are still painted or the page is
   * unresponsive, and reports that deadline with console.warn instead of
   * silently treating it as clean.
   */
  private async waitForLoadingCleared(timeoutMs = this.loadingClearWaitMs * 2): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const loadingCount = await bounded(
        this.activePage.evaluate((loadingSelectors) => {
          let count = 0;
          for (const element of document.querySelectorAll<HTMLElement>(loadingSelectors)) {
            if (element.getClientRects().length > 0) count += 1;
          }
          return count;
        }, this.loadingSelectors),
        1_500,
        "Page became unresponsive while waiting for loading to clear",
      ).catch(() => -1);
      if (loadingCount === 0) return true;
      // An evaluate failure must never be read as "no loading": keep polling
      // and report an unresponsive deadline below instead of passing silently.
      if (loadingCount < 0) {
        console.warn("[collect-i18n] page did not respond while waiting for loading overlays to clear");
      }
      await new Promise((done) => setTimeout(done, 150));
    }
    console.warn("[collect-i18n] loading overlay did not clear within the bounded wait");
    return false;
  }

  /**
   * True when the target rectangle is currently covered by a loading overlay:
   * the F3 any-hit rule marks it blocked when any of the sampled points
   * (center plus the four corners) resolves to a loading overlay. Used to
   * avoid screenshots that show a spinner instead of the translated UI.
   */
  private async targetBlockedByLoading(rect: { x: number; y: number; width: number; height: number }): Promise<boolean> {
    const sample = await this.sampleTargetAndFrame(rect);
    return sample.targetBlocked;
  }

  /**
   * Full-frame gate + multi-point target sampling in one page evaluation
   * (F2/F3): reports whether any visible loading overlay exists anywhere in the
   * viewport (frame gate) and how many sampled points inside the target
   * rectangle resolve to a loading overlay.
   */
  private async sampleTargetAndFrame(rect: { x: number; y: number; width: number; height: number }): Promise<FrameLoadingSample> {
    const viewport = this.activePage.viewportSize();
    const points = viewport
      ? loadingSamplePoints(rect, viewport)
      : [{ x: Math.max(0, Math.round(rect.x + rect.width / 2)), y: Math.max(0, Math.round(rect.y + rect.height / 2)) }];
    const { loadingSelectorList, loadingSelectors } = this;
    const sample = await bounded(
      this.activePage.evaluate(({ selectorsList, selectorsJoined, points }) => {
        const isLoadingAt = (element: Element | null): boolean => {
          if (!element) return false;
          const hit = element.matches(selectorsJoined)
            ? element
            : element.closest?.(selectorsJoined) ?? null;
          return Boolean(hit && hit.getClientRects().length > 0);
        };
        let targetBlockedPoints = 0;
        for (const point of points) {
          if (point.x < 0 || point.y < 0 || point.x >= innerWidth || point.y >= innerHeight) continue;
          const top = document.elementFromPoint(point.x, point.y);
          if (isLoadingAt(top)) targetBlockedPoints += 1;
        }
        const overlayRects: Array<{ x: number; y: number; width: number; height: number }> = [];
        for (const selector of selectorsList) {
          for (const element of document.querySelectorAll<HTMLElement>(selector)) {
            const box = element.getBoundingClientRect();
            const clippedX = Math.max(0, box.x);
            const clippedY = Math.max(0, box.y);
            const clippedWidth = Math.min(innerWidth, box.x + box.width) - clippedX;
            const clippedHeight = Math.min(innerHeight, box.y + box.height) - clippedY;
            if (clippedWidth > 0 && clippedHeight > 0) {
              overlayRects.push({ x: clippedX, y: clippedY, width: clippedWidth, height: clippedHeight });
            }
          }
        }
        return {
          targetBlockedPoints,
          targetSampledPoints: points.length,
          frameBlocked: overlayRects.length > 0,
          overlayRects: overlayRects.slice(0, 64),
        };
      }, { selectorsList: loadingSelectorList, selectorsJoined: loadingSelectors, points }),
      2_000,
      "Page became unresponsive while checking for a loading overlay",
    );
    return {
      ...sample,
      targetBlocked: computeTargetBlocked(sample.targetBlockedPoints, sample.targetSampledPoints),
    };
  }

  /**
   * Atomic gate + marker painting (F4): draws the capture marker and samples
   * the frame in the same page evaluation, so the state the screenshot will
   * capture is the state that was gated -- no await can let a loading overlay
   * slip in between the check and the painted frame. The sample runs after a
   * double requestAnimationFrame so it observes the exact frame the screenshot
   * will capture.
   */
  private async drawMarkerAndSample(
    rect: { x: number; y: number; width: number; height: number },
    marker: CaptureMarkerSpec,
  ): Promise<FrameLoadingSample> {
    const viewport = this.activePage.viewportSize();
    const points = viewport
      ? loadingSamplePoints(rect, viewport)
      : [{ x: Math.max(0, Math.round(rect.x + rect.width / 2)), y: Math.max(0, Math.round(rect.y + rect.height / 2)) }];
    const { loadingSelectorList, loadingSelectors } = this;
    const sample = await bounded(
      this.activePage.evaluate(async ({ selectorsList, selectorsJoined, points, marker }) => {
        const runtimeWindow = window as RuntimeWindow;
        const collector = runtimeWindow.__COLLECT_I18N__ ?? runtimeWindow.__I18N_COLLECTOR__;
        collector?.setTarget?.(null);
        const markerElement = document.createElement("div");
        markerElement.id = marker.id;
        markerElement.dataset.collectI18nCaptureMarker = "true";
        markerElement.setAttribute("aria-hidden", "true");
        markerElement.style.cssText = marker.style;
        document.documentElement.append(markerElement);
        // F4: double requestAnimationFrame -- after the marker is painted and
        // any in-flight layout work settles, the gate below observes the same
        // frame the screenshot will capture.
        await new Promise<void>((resolveFrame) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
        });
        const isLoadingAt = (element: Element | null): boolean => {
          if (!element) return false;
          const hit = element.matches(selectorsJoined)
            ? element
            : element.closest?.(selectorsJoined) ?? null;
          return Boolean(hit && hit.getClientRects().length > 0);
        };
        let targetBlockedPoints = 0;
        for (const point of points) {
          if (point.x < 0 || point.y < 0 || point.x >= innerWidth || point.y >= innerHeight) continue;
          const top = document.elementFromPoint(point.x, point.y);
          if (isLoadingAt(top)) targetBlockedPoints += 1;
        }
        const overlayRects: Array<{ x: number; y: number; width: number; height: number }> = [];
        for (const selector of selectorsList) {
          for (const element of document.querySelectorAll<HTMLElement>(selector)) {
            const box = element.getBoundingClientRect();
            const clippedX = Math.max(0, box.x);
            const clippedY = Math.max(0, box.y);
            const clippedWidth = Math.min(innerWidth, box.x + box.width) - clippedX;
            const clippedHeight = Math.min(innerHeight, box.y + box.height) - clippedY;
            if (clippedWidth > 0 && clippedHeight > 0) {
              overlayRects.push({ x: clippedX, y: clippedY, width: clippedWidth, height: clippedHeight });
            }
          }
        }
        return {
          targetBlockedPoints,
          targetSampledPoints: points.length,
          frameBlocked: overlayRects.length > 0,
          overlayRects: overlayRects.slice(0, 64),
        };
      }, { selectorsList: loadingSelectorList, selectorsJoined: loadingSelectors, points, marker }),
      3_000,
      "Page became unresponsive while highlighting the capture marker",
    );
    return {
      ...sample,
      targetBlocked: computeTargetBlocked(sample.targetBlockedPoints, sample.targetSampledPoints),
    };
  }

  async inspectRuntime(limit = 200): Promise<RuntimeInspection> {
    // A lazy route chunk or a late Teleport can keep the page navigating while
    // the service asks for a snapshot. Wait for the navigation to settle first
    // so the snapshot is not aborted by the evaluation timeout.
    await this.settleNavigation();
    return bounded(this.activePage.evaluate((maximum) => {
      const runtimeWindow = window as RuntimeWindow & { __COLLECT_I18N_PENDING__?: unknown[] };
      const collector = runtimeWindow.__COLLECT_I18N__ ?? runtimeWindow.__I18N_COLLECTOR__;
      const snapshots = collector?.getSnapshot?.().slice(0, maximum).map((item) => ({
        key: item.key,
        occurrenceId: item.occurrenceId,
        kind: item.kind,
        evidenceGrade: item.evidenceGrade,
        evidenceProof: item.evidenceProof,
        connected: "connected" in item ? Boolean(item.connected) : undefined,
        visible: item.visible,
        anchorType: "anchorType" in item ? String(item.anchorType) : undefined,
        text: item.text,
        rect: item.rect ? { x: item.rect.x, y: item.rect.y, width: item.rect.width, height: item.rect.height } : undefined,
      })) ?? [];
      return {
        url: location.href,
        collectorInstalled: Boolean(collector),
        markedElements: document.querySelectorAll("[data-collect-i18n-sink],[data-i18n-key],[data-collect-i18n-bindings]").length,
        pendingDescriptors: runtimeWindow.__COLLECT_I18N_PENDING__?.length ?? 0,
        snapshots,
      };
    }, Math.max(1, Math.min(limit, 2_000))), 8_000, "Runtime inspection timed out while the page was navigating");
  }

  async inspectRuntimeSettled(
    limit = 2_000,
    timeoutMs = 5_000,
    quietMs = 900,
  ): Promise<RuntimeInspection> {
    const deadline = Date.now() + Math.max(quietMs, timeoutMs);
    let latest = await this.inspectRuntime(limit);
    let previousSignature = "";
    let stableSince = Date.now();

    while (Date.now() < deadline) {
      const signature = latest.snapshots
        .filter((snapshot) =>
          snapshot.key &&
          snapshot.connected !== false &&
          Boolean(snapshot.rect && snapshot.rect.width > 0 && snapshot.rect.height > 0),
        )
        .map((snapshot) =>
          `${snapshot.occurrenceId ?? ""}:${snapshot.key}:${snapshot.evidenceGrade ?? ""}:${snapshot.visible ? 1 : 0}`,
        )
        .sort()
        .join("|");

      if (signature && signature === previousSignature) {
        if (Date.now() - stableSince >= quietMs) return latest;
      } else {
        previousSignature = signature;
        stableSince = Date.now();
      }

      await this.activePage.waitForTimeout(100);
      latest = await this.inspectRuntime(limit);
    }

    return latest;
  }

  async waitForKey(
    key: string,
    timeoutMs = 60_000,
    minimumGrade: RuntimeEvidenceGrade = "C",
  ): Promise<RuntimeTargetSnapshot> {
    const startedAt = Date.now();
    let first = true;
    let lastUrl = "";
    while (Date.now() - startedAt < timeoutMs) {
      this.assertSameOrigin();
      const currentUrl = this.activePage.url();
      if (currentUrl !== lastUrl) first = true;
      const evaluation = this.activePage.evaluate(({ targetKey, initialize, minGrade }) => {
        const runtimeWindow = window as RuntimeWindow;
        const collector = runtimeWindow.__COLLECT_I18N__ ?? runtimeWindow.__I18N_COLLECTOR__;
        if (initialize) {
          collector?.rescan?.(document);
          collector?.setTarget?.({ key: targetKey });
          collector?.focus?.(targetKey);
        }
        const intersectsViewport = (rect: { x: number; y: number; width: number; height: number }): boolean =>
          rect.width > 0 && rect.height > 0 && rect.x < innerWidth && rect.y < innerHeight &&
          rect.x + rect.width > 0 && rect.y + rect.height > 0;
        const gradeRank = (grade: RuntimeEvidenceGrade | undefined): number =>
          grade === "A" ? 3 : grade === "B" ? 2 : 1;
        const normalizeRuntimeTarget = (candidate: {
          key?: string;
          occurrenceId?: string;
          kind?: string;
          evidenceGrade?: RuntimeEvidenceGrade;
          evidenceProof?: string;
          text?: string;
          rect?: { x: number; y: number; width: number; height: number };
        }): RuntimeTargetSnapshot | undefined => {
          if (!candidate.rect || !intersectsViewport(candidate.rect)) return undefined;
          if (gradeRank(candidate.evidenceGrade) < gradeRank(minGrade)) {
            return undefined;
          }
          return {
            key: candidate.key ?? targetKey,
            occurrenceId: candidate.occurrenceId,
            binding: candidate.kind,
            evidenceGrade: candidate.evidenceGrade,
            evidenceProof: candidate.evidenceProof,
            text: candidate.text ?? "",
            route: location.href,
            rect: {
              x: candidate.rect.x,
              y: candidate.rect.y,
              width: candidate.rect.width,
              height: candidate.rect.height,
            },
          };
        };
        const runtimeTargets = collector?.targets?.(targetKey) ?? collector?.getVisibleOccurrences?.(targetKey) ?? [];
        const valid = runtimeTargets
          .filter((candidate) => candidate.rect && intersectsViewport(candidate.rect))
          .sort((left, right) =>
            gradeRank(right.evidenceGrade) - gradeRank(left.evidenceGrade))
          .find((candidate) =>
            gradeRank(candidate.evidenceGrade) >= gradeRank(minGrade));
        if (valid) return normalizeRuntimeTarget(valid);
        const registryTarget = collector?.getSnapshot?.().find((candidate) => candidate.key === targetKey && candidate.visible);
        if (registryTarget) {
          const normalized = normalizeRuntimeTarget(registryTarget);
          if (normalized) return normalized;
        }
        const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(targetKey) : targetKey.replace(/["\\]/g, "\\$&");
        const element = document.querySelector<HTMLElement>(`[data-i18n-key~="${escaped}"]`);
        if (!element) return undefined;
        if (initialize) element.scrollIntoView({ block: "center", inline: "nearest" });
        const rect = element.getBoundingClientRect();
        if (!intersectsViewport(rect)) return undefined;
        return {
          key: targetKey,
          occurrenceId: element.dataset.i18nOccurrence ?? element.dataset.i18nOcc,
          binding: "native_dom",
          evidenceGrade: "A" as const,
          evidenceProof: "compiler-native-sink",
          text: element.innerText || element.getAttribute("placeholder") || element.getAttribute("aria-label") || "",
          route: location.href,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }, { targetKey: key, initialize: first, minGrade: minimumGrade });
      let snapshot: RuntimeTargetSnapshot | undefined;
      try {
        snapshot = await bounded(evaluation, 2_000, `Page became unresponsive while locating i18n key: ${key}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/execution context|context.*destroyed|navigation|most likely because of a navigation/i.test(message)) {
          first = true;
          await new Promise((done) => setTimeout(done, 125));
          continue;
        }
        throw error;
      }
      if (!snapshot) {
        // Transient imperative toasts (ElMessage/ElNotification/ElMessageBox)
        // carry key+text in the runtime registry but no attributed DOM rect.
        // The exact-text decision runs on the Node side via textMatch — the
        // playwright evaluate boundary serializes callbacks, so bundled
        // module identifiers are unavailable in the page.
        snapshot = await this.resolveExactTextFallback(key, minimumGrade);
      }
      if (snapshot) return snapshot;
      first = false;
      lastUrl = currentUrl;
      await new Promise((done) => setTimeout(done, 125));
    }
    throw new CollectorError("key_not_found", `Timed out waiting for i18n key: ${key}`, { key });
  }

  /**
   * Exact-text fallback for transient imperative anchors (R-toast): read the
   * runtime registry texts and harvest candidate leaf geometry in the page,
   * then decide the match on the Node side with the same isExactTextMatch /
   * pickExactTextRows helpers the unit tests exercise. Harvesting prefers
   * leaves inside imperative hosts (toasts teleport there) so a same-text
   * static element cannot shadow the real anchor, and reads textContent
   * before attribute fallbacks (textContent does not force a reflow).
   */
  private async resolveExactTextFallback(
    key: string,
    minimumGrade: RuntimeEvidenceGrade,
  ): Promise<RuntimeTargetSnapshot | undefined> {
    const page = this.activePage;
    const registeredTexts = await bounded(
      page.evaluate((targetKey) => {
        const runtimeWindow = window as RuntimeWindow;
        const collector = runtimeWindow.__COLLECT_I18N__ ?? runtimeWindow.__I18N_COLLECTOR__;
        return (collector?.getSnapshot?.() ?? [])
          .filter((entry) => entry.key === targetKey && typeof entry.text === "string" && entry.text.trim().length > 0)
          .map((entry) => ({ text: entry.text as string, grade: entry.evidenceGrade, proof: entry.evidenceProof, binding: entry.kind }));
      }, key),
      2_000,
      "Page became unresponsive while reading the i18n registry",
    );
    if (registeredTexts.length === 0) return undefined;
    const leafHits = await bounded(
      page.evaluate(() => {
        const intersectsViewport = (rect: { x: number; y: number; width: number; height: number }): boolean =>
          rect.width > 0 && rect.height > 0 && rect.x < innerWidth && rect.y < innerHeight &&
          rect.x + rect.width > 0 && rect.y + rect.height > 0;
        const hosts = new Set<HTMLElement>();
        for (const host of document.querySelectorAll<HTMLElement>(
          ".el-message,.el-message-box,.el-notification,[role=\"alert\"],[role=\"dialog\"],.el-popconfirm",
        )) {
          let current: HTMLElement | null = host;
          while (current) {
            hosts.add(current);
            current = current.parentElement;
          }
        }
        const leaves = Array.from(document.querySelectorAll<HTMLElement>("p,span,div,li,td,dt,dd,button,a,h1,h2,h3,h4,label"));
        leaves.sort((left, right) => Number(hosts.has(right)) - Number(hosts.has(left)));
        const hits: Array<{ needle: string; x: number; y: number; width: number; height: number }> = [];
        for (const element of leaves) {
          if (hits.length >= 300) break;
          if (element.childElementCount > 0) continue;
          const raw = element.textContent && element.textContent.trim().length > 0
            ? element.textContent
            : element.getAttribute("placeholder") || element.getAttribute("aria-label") || "";
          const needle = (raw ?? "").trim();
          if (!needle) continue;
          const rect = element.getBoundingClientRect();
          if (!intersectsViewport(rect)) continue;
          hits.push({ needle, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
        return hits;
      }),
      2_000,
      "Page became unresponsive while scanning exact-text leaves",
    );
    const gradeRank = (grade: RuntimeEvidenceGrade | undefined): number =>
      grade === "A" ? 3 : grade === "B" ? 2 : 1;
    const decision = pickExactTextMatch(registeredTexts, leafHits);
    if (!decision) return undefined;
    const { row: matched, hit } = decision;
    if (gradeRank(matched.grade) < gradeRank(minimumGrade)) return undefined;
    return {
      key,
      occurrenceId: undefined,
      binding: matched.binding ?? "imperative-service",
      evidenceGrade: matched.grade ?? "B",
      evidenceProof: matched.proof ?? "imperative-text-scan",
      text: hit.needle,
      route: page.url(),
      rect: { x: hit.x, y: hit.y, width: hit.width, height: hit.height },
    };
  }

  async capture(
    target: RuntimeTargetSnapshot,
    source: CollectedEvidence["source"],
    plan?: ParsedTriggerPlan,
  ): Promise<CollectedEvidence> {
    const page = this.activePage;
    const minimumGrade = target.evidenceGrade ?? "C";
    let resolvedTarget = await this.waitForKey(target.key, 5_000, minimumGrade);
    // A slow mock or lazy chunk can leave a v-loading/skeleton overlay on the
    // page. Wait for it to clear so the screenshot shows the translated UI
    // instead of a spinner.
    await this.waitForLoadingCleared();
    // Validation messages, dialogs and Teleports often animate into place.
    // Require two near-identical layout samples before drawing the marker.
    for (let sample = 0; sample < 6; sample += 1) {
      await page.waitForTimeout(100);
      const next = await this.waitForKey(target.key, 2_000, minimumGrade);
      if (await this.targetBlockedByLoading(next.rect)) {
        resolvedTarget = next;
        continue;
      }
      const delta = Math.max(
        Math.abs(next.rect.x - resolvedTarget.rect.x),
        Math.abs(next.rect.y - resolvedTarget.rect.y),
        Math.abs(next.rect.width - resolvedTarget.rect.width),
        Math.abs(next.rect.height - resolvedTarget.rect.height),
      );
      resolvedTarget = next;
      if (delta < 0.5) break;
    }
    const shouldProbe =
      resolvedTarget.evidenceGrade === "B" &&
      (source === "deterministic" || (source === "agent" && Boolean(plan)));
    const causalVerified = shouldProbe
      ? await this.verifyCausalBinding(resolvedTarget, plan)
      : false;
    if (
      source === "deterministic" &&
      resolvedTarget.evidenceGrade === "B" &&
      !causalVerified
    ) {
      throw new CollectorError(
        "deterministic_b_rejected",
        `Deterministic B evidence for ${resolvedTarget.key} did not pass the isolated causal canary`,
        { key: resolvedTarget.key },
      );
    }
    if (causalVerified) {
      resolvedTarget = await this.waitForKey(target.key, 5_000, "B");
    }
    return this.screenshotEvidence(resolvedTarget, source, plan, causalVerified);
  }

  /**
   * Resolve many visible i18n keys in a single page evaluation. Mirrors the
   * per-key waitForKey fallbacks (runtime targets, snapshot registry, native
   * DOM) without scrolling or focusing, which would perturb a batch capture.
   */
  async captureVisibleTargets(
    keys: readonly string[],
    minimumGrade: RuntimeEvidenceGrade = "B",
  ): Promise<RuntimeTargetSnapshot[]> {
    this.assertSameOrigin();
    const targetKeys = [...new Set(keys)].slice(0, 500);
    if (targetKeys.length === 0) return [];
    const evaluation = this.activePage.evaluate(({ targetKeys, minGrade }) => {
      const runtimeWindow = window as RuntimeWindow;
      const collector = runtimeWindow.__COLLECT_I18N__ ?? runtimeWindow.__I18N_COLLECTOR__;
      const intersectsViewport = (rect: { x: number; y: number; width: number; height: number }): boolean =>
        rect.width > 0 && rect.height > 0 && rect.x < innerWidth && rect.y < innerHeight &&
        rect.x + rect.width > 0 && rect.y + rect.height > 0;
      const gradeRank = (grade: RuntimeEvidenceGrade | undefined): number =>
        grade === "A" ? 3 : grade === "B" ? 2 : 1;
      const normalizeRuntimeTarget = (candidate: {
        key?: string;
        occurrenceId?: string;
        kind?: string;
        evidenceGrade?: RuntimeEvidenceGrade;
        evidenceProof?: string;
        text?: string;
        rect?: { x: number; y: number; width: number; height: number };
      }, fallbackKey: string): RuntimeTargetSnapshot | undefined => {
        if (!candidate.rect || !intersectsViewport(candidate.rect)) return undefined;
        if (gradeRank(candidate.evidenceGrade) < gradeRank(minGrade)) return undefined;
        return {
          key: candidate.key ?? fallbackKey,
          occurrenceId: candidate.occurrenceId,
          binding: candidate.kind,
          evidenceGrade: candidate.evidenceGrade,
          evidenceProof: candidate.evidenceProof,
          text: candidate.text ?? "",
          route: location.href,
          rect: {
            x: candidate.rect.x,
            y: candidate.rect.y,
            width: candidate.rect.width,
            height: candidate.rect.height,
          },
        };
      };
      const collected: RuntimeTargetSnapshot[] = [];
      for (const targetKey of targetKeys) {
        const runtimeTargets = collector?.targets?.(targetKey) ?? collector?.getVisibleOccurrences?.(targetKey) ?? [];
        const valid = runtimeTargets
          .filter((candidate) => candidate.rect && intersectsViewport(candidate.rect))
          .sort((left, right) =>
            gradeRank(right.evidenceGrade) - gradeRank(left.evidenceGrade))
          .find((candidate) => gradeRank(candidate.evidenceGrade) >= gradeRank(minGrade));
        if (valid) {
          const normalized = normalizeRuntimeTarget(valid, targetKey);
          if (normalized) { collected.push(normalized); continue; }
        }
        const registryTarget = collector?.getSnapshot?.().find((candidate) => candidate.key === targetKey && candidate.visible);
        if (registryTarget) {
          const normalized = normalizeRuntimeTarget(registryTarget, targetKey);
          if (normalized) { collected.push(normalized); continue; }
        }
        const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(targetKey) : targetKey.replace(/["\\]/g, "\\$&");
        const element = document.querySelector<HTMLElement>(`[data-i18n-key~="${escaped}"]`);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (!intersectsViewport(rect)) continue;
        collected.push({
          key: targetKey,
          occurrenceId: element.dataset.i18nOccurrence ?? element.dataset.i18nOcc,
          binding: "native_dom",
          evidenceGrade: "A" as const,
          evidenceProof: "compiler-native-sink",
          text: element.innerText || element.getAttribute("placeholder") || element.getAttribute("aria-label") || "",
          route: location.href,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        });
      }
      return collected;
    }, { targetKeys, minGrade: minimumGrade });
    return bounded(evaluation, 4_000, "Page became unresponsive while locating i18n keys in batch");
  }

  /**
   * Capture a set of already-visible keys with a single batched visibility
   * confirmation instead of one polling round-trip per key. Each surviving
   * key is re-checked once after a short settle delay, then screenshotted;
   * keys that animate away mid-batch are skipped without failing the rest.
   */
  async captureBatch(
    keys: readonly string[],
    source: CollectedEvidence["source"],
  ): Promise<Array<{ key: string; evidence: CollectedEvidence }>> {
    const targets = [...new Set(keys)].slice(0, 250);
    if (targets.length === 0) return [];
    const initial = await this.captureVisibleTargets(targets, "B");
    if (initial.length === 0) return [];
    await this.waitForLoadingCleared();
    await this.activePage.waitForTimeout(100);
    const settledByKey = new Map(
      (await this.captureVisibleTargets(initial.map((target) => target.key), "B"))
        .map((target) => [target.key, target] as const),
    );
    const results: Array<{ key: string; evidence: CollectedEvidence }> = [];
    for (const target of initial) {
      const latest = settledByKey.get(target.key) ?? target;
      try {
        const evidence = await this.screenshotEvidence(latest, source);
        results.push({ key: target.key, evidence });
      } catch {
        // A single key may animate away mid-batch; keep the rest.
      }
    }
    return results;
  }

  /**
   * Deterministic batch capture for the route queue: resolves a set of
   * already-mounted keys in one page evaluation, verifies B-grade Vue
   * evidence through a single batched causal canary probe page, and
   * screenshots each accepted key with one marker pass. This replaces the
   * per-key double waitForKey + 6-sample stability loop: the caller already
   * confirmed mounting via a settled inspection, so stable keys skip every
   * redundant re-verification. Keys that cannot be resolved or verified are
   * reported per key so the caller keeps the rest of the batch.
   */
  async captureDeterministicBatch(
    keys: readonly string[],
  ): Promise<Array<{ key: string; evidence?: CollectedEvidence; rejected?: string }>> {
    const targetKeys = [...new Set(keys)].slice(0, 250);
    if (targetKeys.length === 0) return [];
    // Virtual lists register rows lazily; mirror waitForKey's first-poll
    // rescan so one batch evaluation sees freshly mounted rows instead of
    // missing them and falling back to per-key polling.
    await bounded(
      this.activePage.evaluate(() => {
        const runtimeWindow = window as RuntimeWindow;
        const installed = runtimeWindow.__COLLECT_I18N__ ?? runtimeWindow.__I18N_COLLECTOR__;
        installed?.rescan?.(document);
      }),
      2_000,
      "Page became unresponsive while rescanning for batch capture",
    ).catch(() => undefined);
    const initial = await this.captureVisibleTargets(targetKeys, "B");
    if (initial.length === 0) return [];
    await this.waitForLoadingCleared();
    await this.activePage.waitForTimeout(100);
    const settledByKey = new Map(
      (await this.captureVisibleTargets(initial.map((target) => target.key), "B"))
        .map((target) => [target.key, target] as const),
    );
    const bTargets = [...settledByKey.values()].filter((target) => target.evidenceGrade === "B");
    const verified = bTargets.length > 0
      ? await this.verifyCausalBindings(bTargets)
      : new Map<string, boolean>();
    const results: Array<{ key: string; evidence?: CollectedEvidence; rejected?: string }> = [];
    for (const target of initial) {
      const latest = settledByKey.get(target.key) ?? target;
      if (latest.evidenceGrade === "B" && verified.get(latest.key) !== true) {
        results.push({
          key: latest.key,
          rejected: "[deterministic_b_rejected] Deterministic B evidence for " + latest.key
            + " did not pass the isolated causal canary",
        });
        continue;
      }
      try {
        const evidence = await this.screenshotEvidence(
          latest,
          "deterministic",
          undefined,
          latest.evidenceGrade === "B",
        );
        results.push({ key: latest.key, evidence });
      } catch (error) {
        results.push({
          key: latest.key,
          rejected: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  /**
   * Deterministic widget sweep step (R7): clicks bounded, client-side-only
   * widgets that keep more translated content mounted — Element Plus tree
   * expand icons and pagination "next" buttons. Never touches forms or
   * action buttons, so the sweep cannot mutate project data. The caller
   * re-inspects and batch-captures between rounds; the returned outcome
   * tells it whether another round can surface anything new.
   */
  async widgetSweepForCapture(maxClicks: number): Promise<"advanced" | "exhausted"> {
    this.assertSameOrigin();
    const outcome = await bounded(
      this.activePage.evaluate((budget) => {
        const visible = (el: Element): el is HTMLElement =>
          el instanceof HTMLElement && el.offsetParent !== null;
        // A panel opened by the previous round would block interactions with
        // the widgets under it: close it before advancing.
        for (const panel of document.querySelectorAll<HTMLElement>(
          ".el-select__popper,.el-cascader__dropdown,.el-picker__popper,.el-popover,.el-tooltip__popper",
        )) {
          if (visible(panel)) {
            document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            break;
          }
        }
        let clicks = 0;
        // 1) Collapsed Element Plus tree nodes: expanding is pure client
        // state and reveals child node labels.
        for (const icon of document.querySelectorAll<HTMLElement>(".el-tree-node__expand-icon:not(.is-leaf)")) {
          if (clicks >= budget) return "advanced";
          if (!visible(icon) || icon.getAttribute("aria-expanded") === "true") continue;
          icon.click();
          clicks += 1;
        }
        // 2) One pagination step per round: linear forward walk of paginated
        // tables. Disabled/absent buttons end the walk.
        for (const next of document.querySelectorAll<HTMLElement>(
          ".el-pagination .btn-next",
        )) {
          if (clicks >= budget) return "advanced";
          if (!visible(next) || next.hasAttribute("disabled") || next.getAttribute("aria-disabled") === "true") continue;
          next.click();
          clicks += 1;
          break;
        }
        // 3) One deep widget per round: cascader/select/date pickers keep
        // their option texts in teleported panels that only mount while the
        // widget is open. Mark swept widgets so later rounds advance.
        for (const trigger of document.querySelectorAll<HTMLElement>(
          ".el-cascader,.el-select,.el-select__wrapper,.el-date-editor",
        )) {
          if (!visible(trigger)) continue;
          if (trigger.dataset.collectI18nSwept) continue;
          trigger.dataset.collectI18nSwept = "1";
          trigger.click();
          clicks += 1;
          break;
        }
        return clicks > 0 ? "advanced" : "exhausted";
      }, maxClicks),
      5_000,
      "Page became unresponsive during the widget sweep",
    );
    await this.waitForLoadingCleared();
    await this.activePage.waitForTimeout(150);
    return outcome;
  }

  /**
   * Deterministic scroll step for a visited route (R3): intermediate steps
   * push the viewport down by about 80% of its height and the final step
   * jumps to the bottom, bringing lazily rendered and virtualized rows into
   * view so the follow-up inspection can batch-capture them. Bounded by
   * design; the caller decides the step count and re-inspects after each.
   */
  /**
   * R8 interaction sweep, one target per call: the service clicks, waits for
   * the transient content (toast/dialog/tab panel), batch-captures, then
   * dismisses overlays before asking for the next target. Tabs (ARIA role)
   * come before plain buttons so tab panels are walked first; swept targets
   * are marked so later rounds advance instead of re-clicking.
   * Generic by construction: ARIA roles and native buttons, no selectors
   * tied to any component library.
   */
  async interactionSweepStep(): Promise<boolean> {
    return this.activePage.evaluate(() => {
      const visible = (el: Element): el is HTMLElement =>
        el instanceof HTMLElement &&
        el.offsetParent !== null &&
        el.getClientRects().length > 0;
      const clickable = [
        ...document.querySelectorAll<HTMLElement>('[role="tab"]'),
        ...document.querySelectorAll<HTMLElement>('button, [role="button"]'),
      ].filter((el) =>
        visible(el) &&
        !el.hasAttribute("data-ci18n-ix-swept") &&
        !el.hasAttribute("disabled") &&
        el.getAttribute("aria-disabled") !== "true");
      const next = clickable[0];
      if (!next) return false;
      next.setAttribute("data-ci18n-ix-swept", "1");
      next.click();
      return true;
    });
  }

  /** Close transient overlays (dialogs, popups) opened by the sweep. */
  async dismissOverlays(): Promise<void> {
    await this.activePage.keyboard.press("Escape").catch(() => undefined);
    await this.activePage.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }).catch(() => undefined);
  }

  /** Entries of the runtime evidence mirror (key -> rendered text). */
  async mirrorEntries(): Promise<Array<{ key: string; text: string }>> {
    return this.activePage.evaluate(() => {
      const mirror = document.getElementById("__collect_i18n_evidence_mirror");
      if (!mirror) return [];
      return [...mirror.querySelectorAll<HTMLElement>("[data-collect-i18n-mirror-key]")]
        .map((entry) => ({
          key: entry.getAttribute("data-collect-i18n-mirror-key") ?? "",
          text: entry.textContent ?? "",
        }))
        .filter((entry) => entry.key && entry.text);
    });
  }

  /**
   * Screenshot one mirror entry as B-grade evidence. The strip is brought
   * on-screen only for the capture and restored afterwards, so regular
   * widget evidence never shows it.
   */
  async captureMirrorEvidence(key: string): Promise<CollectedEvidence | undefined> {
    this.assertSameOrigin();
    const page = this.activePage;
    const locate = await page.evaluate((k) => {
      const mirror = document.getElementById("__collect_i18n_evidence_mirror");
      if (!mirror) return undefined;
      const entry = mirror.querySelector('[data-collect-i18n-mirror-key="' + CSS.escape(k) + '"]');
      if (!entry) return undefined;
      mirror.style.left = "12px";
      mirror.style.top = "12px";
      mirror.style.maxWidth = "720px";
      mirror.style.whiteSpace = "normal";
      mirror.style.boxShadow = "0 0 0 2px #ddd";
      return { text: entry.textContent ?? "" };
    }, key);
    if (!locate) return undefined;
    let screenshot: Buffer | undefined;
    try {
      const handle = await page.evaluateHandle((k) => {
        const mirror = document.getElementById("__collect_i18n_evidence_mirror");
        if (!mirror) return null;
        return mirror.querySelector('[data-collect-i18n-mirror-key="' + CSS.escape(k) + '"]');
      }, key);
      const entry = handle.asElement();
      if (entry) screenshot = await entry.screenshot({ timeout: 15_000 });
      await handle.dispose().catch(() => undefined);
    } finally {
      await page.evaluate(() => {
        const mirror = document.getElementById("__collect_i18n_evidence_mirror");
        if (mirror) {
          mirror.style.left = "-99999px";
          mirror.style.top = "0";
          mirror.style.maxWidth = "";
          mirror.style.whiteSpace = "nowrap";
          mirror.style.boxShadow = "";
        }
      }).catch(() => undefined);
    }
    if (!screenshot) return undefined;
    const screenshotSha256 = createHash("sha256").update(screenshot).digest("hex");
    const screenshotPath = resolve(this.options.artifactDir, `${safeFilePart(key)}-${screenshotSha256}.png`);
    await writeFile(screenshotPath, screenshot);
    const rawUrl = page.url();
    const hashIndex = rawUrl.indexOf("#");
    const route = hashIndex >= 0 ? rawUrl.slice(hashIndex + 1) : new URL(rawUrl).pathname;
    return {
      key,
      text: locate.text,
      route,
      rect: { x: 0, y: 0, width: 0, height: 0 },
      evidenceGrade: "B",
      evidenceProof: "runtime-mirror",
      screenshotPath,
      screenshotSha256,
      capturedAt: new Date().toISOString(),
      source: "agent",
    };
  }

  async scrollForCapture(step: number, totalSteps: number): Promise<void> {
    this.assertSameOrigin();
    await bounded(
      this.activePage.evaluate(({ toBottom }) => {
        const winSurplus = (document.documentElement.scrollHeight || 0) - window.innerHeight;
        if (winSurplus > 10) {
          if (toBottom) {
            window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight);
          } else {
            window.scrollBy(0, Math.max(1, Math.round(window.innerHeight * 0.8)));
          }
        }
        // Virtualized tables/lists and custom scroll panels scroll their own
        // overflow container, not the window: scroll the largest few so rows
        // beyond the initial viewport mount during the deterministic pass.
        const containers = Array.from(document.querySelectorAll<HTMLElement>("*"))
          .filter((el) => {
            if (el === document.body || el === document.documentElement) return false;
            const overflowY = el instanceof HTMLElement ? getComputedStyle(el).overflowY : "";
            if (!/(auto|scroll)/.test(overflowY)) return false;
            return (el.scrollHeight || 0) - (el.clientHeight || 0) > 10;
          })
          .sort((left, right) =>
            (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight))
          .slice(0, 3);
        for (const el of containers) {
          if (toBottom) {
            el.scrollTop = el.scrollHeight;
          } else {
            el.scrollTop += Math.max(1, Math.round(el.clientHeight * 0.8));
          }
        }
      }, { toBottom: step >= totalSteps }),
      2_000,
      "Page became unresponsive while scrolling for capture",
    );
    await this.activePage.waitForTimeout(100);
  }

  private async screenshotEvidence(
    resolvedTarget: RuntimeTargetSnapshot,
    source: CollectedEvidence["source"],
    plan?: ParsedTriggerPlan,
    causalVerified = false,
  ): Promise<CollectedEvidence> {
    const page = this.activePage;
    const viewport = page.viewportSize();
    const { rect } = resolvedTarget;
    const inViewport = Boolean(
      viewport && rect.width > 0 && rect.height > 0 && rect.x < viewport.width && rect.y < viewport.height &&
      rect.x + rect.width > 0 && rect.y + rect.height > 0,
    );
    if (!viewport || !inViewport) {
      throw new CollectorError(
        "target_out_of_viewport",
        "Target key does not intersect the capture viewport",
        { key: resolvedTarget.key, rect },
      );
    }
    // Never persist a spinner screenshot as evidence: wait a bounded window for
    // a covering overlay to clear, then skip the key entirely if it is still
    // loading so the task can be retried or handed to manual.
    const loadingDeadline = Date.now() + this.loadingClearWaitMs;
    while (Date.now() < loadingDeadline) {
      if (!(await this.targetBlockedByLoading(rect))) break;
      await page.waitForTimeout(150);
    }
    if (await this.targetBlockedByLoading(rect)) {
      throw new CollectorError(
        "loading_overlay_timeout",
        `Loading overlay still covers target ${resolvedTarget.key}; skipping to avoid a spinner screenshot`,
        { key: resolvedTarget.key },
      );
    }

    const removeMarker = async (id: string): Promise<void> => {
      await bounded(
        page.evaluate((markerId) => document.getElementById(markerId)?.remove(), id),
        2_000,
        "Timed out removing the screenshot marker",
      ).catch(() => undefined);
    };

    // Up to two attempts: the first captures, the post-capture frame check
    // (F4) validates that no loading overlay appeared mid-capture; a detected
    // race discards the evidence and retries once before giving up.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const marker = captureMarkerSpec(rect);
      let gate: FrameLoadingSample;
      try {
        // F4: marker painting and the frame gate happen in one evaluation, so
        // the screenshot cannot slip past a check that predates the marker.
        gate = await this.drawMarkerAndSample(rect, marker);
      } catch (error) {
        await removeMarker(marker.id);
        if (error instanceof CollectorError) throw error;
        throw new CollectorError(
          "capture_timeout",
          error instanceof Error ? error.message : String(error),
          { key: resolvedTarget.key },
        );
      }
      if (gate.targetBlocked) {
        await removeMarker(marker.id);
        throw new CollectorError(
          "loading_overlay_persists",
          `Loading overlay still covers target ${resolvedTarget.key} at paint time; skipping to avoid a spinner screenshot`,
          { key: resolvedTarget.key },
        );
      }
      // F2: full-frame gate passes -> full viewport screenshot; the frame is
      // dirty but the target itself is clean -> crop fallback around the
      // target so the rest of the page cannot pollute the evidence.
      const clip = gate.frameBlocked
        ? cropClipForTarget(rect, viewport, this.loadingCropMarginPx)
        : undefined;
      await page.waitForTimeout(50);

      const timestamp = new Date().toISOString().replaceAll(":", "-");
      const temporaryScreenshotPath = resolve(
        this.options.artifactDir,
        `${safeFilePart(resolvedTarget.key)}-${timestamp}-${randomUUID()}.tmp.png`,
      );
      try {
        await bounded(
          page.screenshot(clip
            ? { path: temporaryScreenshotPath, fullPage: false, clip }
            : { path: temporaryScreenshotPath, fullPage: false }),
          30_000,
          `Timed out capturing screenshot for i18n key: ${resolvedTarget.key}`,
        );
      } catch (error) {
        await removeMarker(marker.id);
        await rm(temporaryScreenshotPath, { force: true }).catch(() => undefined);
        if (error instanceof CollectorError) throw error;
        throw new CollectorError(
          "capture_timeout",
          error instanceof Error ? error.message : String(error),
          { key: resolvedTarget.key },
        );
      }
      await removeMarker(marker.id);

      // F4 race closure: re-sample the frame immediately after the capture.
      // A loading overlay that was absent at gate time and now intersects the
      // captured region means the evidence may show a spinner: discard it and
      // retry once; two consecutive races abort with loading_overlay_race.
      const after = await this.sampleTargetAndFrame(rect);
      const newOverlayInClip = after.frameBlocked && after.overlayRects.some((overlay) =>
        !sameRectIn(overlay, gate.overlayRects) && (clip ? rectsIntersect(overlay, clip) : true));
      const raced =
        newOverlayInClip ||
        (after.targetBlocked && !gate.targetBlocked) ||
        (!clip && after.frameBlocked && !gate.frameBlocked);
      if (!raced) {
        const screenshotSha256 = createHash("sha256")
          .update(await readFile(temporaryScreenshotPath))
          .digest("hex");
        const screenshotPath = resolve(
          this.options.artifactDir,
          `${safeFilePart(resolvedTarget.key)}-${screenshotSha256}.png`,
        );
        try {
          await rename(temporaryScreenshotPath, screenshotPath);
        } catch (error) {
          // On Windows rename does not replace an existing destination. Identical
          // content already has the canonical path, so discard only the temporary
          // file after verifying the destination exists.
          try {
            await access(screenshotPath);
            await rm(temporaryScreenshotPath, { force: true });
          } catch {
            throw error;
          }
        }
        return {
          ...resolvedTarget,
          evidenceGrade: causalVerified ? "A" : resolvedTarget.evidenceGrade,
          evidenceProof: causalVerified ? "causal-canary" : resolvedTarget.evidenceProof,
          screenshotPath,
          screenshotSha256,
          capturedAt: new Date().toISOString(),
          source,
          plan,
          causalProbe: causalVerified
            ? {
                verified: true,
                originalGrade: "B",
                originalProof: resolvedTarget.evidenceProof,
              }
            : undefined,
        };
      }
      await rm(temporaryScreenshotPath, { force: true }).catch(() => undefined);
    }
    throw new CollectorError(
      "loading_overlay_race",
      `Frame changed while capturing ${resolvedTarget.key}; evidence was discarded to avoid a spinner screenshot`,
      { key: resolvedTarget.key },
    );
  }

  async listenAndCapture(key: string, timeoutMs = 30 * 60_000): Promise<CollectedEvidence> {
    const target = await this.waitForKey(key, timeoutMs, "C");
    return this.capture(target, "manual");
  }
}
