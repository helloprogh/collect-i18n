import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrowserContext, Locator, Page, Route } from "playwright-core";
import { parseTriggerPlan, mockRuleSchema, type MockRule, type ParsedTriggerPlan, type PlanLocator, type TriggerPlan } from "./plan.js";

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
    throw new Error(`TriggerPlan cannot navigate outside project origin: ${target.origin}`);
  }
  return target.toString();
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
 * DOM selectors that identify visible loading/skeleton overlays from common
 * Vue component libraries. A matching element only counts as "loading" when
 * it is actually painted (has client rects); apps can also opt in with the
 * data-collect-i18n-loading attribute.
 */
export const LOADING_INDICATOR_SELECTORS = [
  ".el-loading-mask",
  ".el-loading-spinner",
  ".el-skeleton",
  ".el-skeleton__item",
  ".el-icon.is-loading",
  ".ant-spin-spinning",
  "[data-collect-i18n-loading]",
].join(",");

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

  constructor(private readonly options: BrowserCollectorOptions) {}

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
      throw new Error(`TriggerPlan left the project origin: ${actual.origin}`);
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
      if (plan.route) await this.open(plan.route);

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
            reject(new Error(`TriggerPlan exceeded its ${deadlineMs}ms execution deadline`));
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
    throw new Error(`Collector runtime did not become ready after navigation: ${this.activePage.url()}`);
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
        }, LOADING_INDICATOR_SELECTORS),
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
   * Best-effort wait until no visible loading/skeleton overlay remains.
   * Returns when the page is clean or the deadline passes.
   */
  private async waitForLoadingCleared(timeoutMs = 8_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const loadingCount = await bounded(
        this.activePage.evaluate((loadingSelectors) => {
          let count = 0;
          for (const element of document.querySelectorAll<HTMLElement>(loadingSelectors)) {
            if (element.getClientRects().length > 0) count += 1;
          }
          return count;
        }, LOADING_INDICATOR_SELECTORS),
        1_500,
        "Page became unresponsive while waiting for loading to clear",
      ).catch(() => 0);
      if (loadingCount === 0) return;
      await new Promise((done) => setTimeout(done, 150));
    }
  }

  /**
   * True when the center of a target rectangle is currently covered by a
   * loading/skeleton overlay. Used to avoid screenshots that show a spinner
   * instead of the translated UI.
   */
  private async targetBlockedByLoading(rect: { x: number; y: number; width: number; height: number }): Promise<boolean> {
    return bounded(
      this.activePage.evaluate(({ rect, loadingSelectors }) => {
        // Mirror of the exported isLoadingElement() helper. Module functions
        // are not in scope inside page.evaluate and functions nested in
        // argument objects cannot be serialized, so the check is inlined here
        // and kept in sync with isLoadingElement().
        const isLoadingElement = (element: {
          classList?: { contains(name: string): boolean };
          dataset?: Record<string, string | undefined>;
        } | null | undefined): boolean => {
          if (!element) return false;
          const classes = element.classList;
          if (classes) {
            if (classes.contains("el-loading-mask") || classes.contains("el-loading-spinner")) return true;
            if (classes.contains("el-skeleton") || classes.contains("el-skeleton__item")) return true;
            if (classes.contains("ant-spin-spinning")) return true;
            if (classes.contains("el-icon") && classes.contains("is-loading")) return true;
          }
          return element.dataset?.collectI18nLoading !== undefined;
        };
        const top = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        ) as (HTMLElement & { closest?: (selector: string) => HTMLElement | null }) | null;
        if (!top) return false;
        if (isLoadingElement(top)) return true;
        const overlay = top.closest?.(loadingSelectors);
        return Boolean(overlay && overlay.getClientRects().length > 0);
      }, { rect, loadingSelectors: LOADING_INDICATOR_SELECTORS }),
      2_000,
      "Page became unresponsive while checking for a loading overlay",
    );
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
      if (snapshot) return snapshot;
      first = false;
      lastUrl = currentUrl;
      await new Promise((done) => setTimeout(done, 125));
    }
    throw new Error(`Timed out waiting for i18n key: ${key}`);
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
      throw new Error(
        `Deterministic B evidence for ${resolvedTarget.key} did not pass the isolated causal canary`,
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
    if (!viewport || !inViewport) throw new Error("Target key does not intersect the capture viewport");
    // Never persist a spinner screenshot as evidence: wait a short bounded
    // window for a covering overlay to clear, then skip the key entirely if
    // it is still loading so the task can be retried or handed to manual.
    const loadingDeadline = Date.now() + 5_000;
    while (Date.now() < loadingDeadline) {
      if (!(await this.targetBlockedByLoading(resolvedTarget.rect))) break;
      await page.waitForTimeout(150);
    }
    if (await this.targetBlockedByLoading(resolvedTarget.rect)) {
      throw new Error(
        `Loading overlay still covers target ${resolvedTarget.key}; skipping to avoid a spinner screenshot`,
      );
    }
    const marker = captureMarkerSpec(resolvedTarget.rect);
    await bounded(page.evaluate(({ id, style }) => {
      const runtimeWindow = window as RuntimeWindow;
      const collector = runtimeWindow.__COLLECT_I18N__ ?? runtimeWindow.__I18N_COLLECTOR__;
      collector?.setTarget?.(null);
      const markerElement = document.createElement("div");
      markerElement.id = id;
      markerElement.dataset.collectI18nCaptureMarker = "true";
      markerElement.setAttribute("aria-hidden", "true");
      markerElement.style.cssText = style;
      document.documentElement.append(markerElement);
    }, marker), 3_000, `Timed out highlighting i18n key: ${resolvedTarget.key}`);

    await page.waitForTimeout(50);

    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const screenshotPath = resolve(this.options.artifactDir, `${safeFilePart(resolvedTarget.key)}-${timestamp}.png`);
    try {
      await bounded(
        page.screenshot({ path: screenshotPath, fullPage: false }),
        30_000,
        `Timed out capturing screenshot for i18n key: ${resolvedTarget.key}`,
      );
    } finally {
      await bounded(
        page.evaluate((id) => document.getElementById(id)?.remove(), marker.id),
        2_000,
        "Timed out removing the screenshot marker",
      ).catch(() => undefined);
    }
    const screenshotSha256 = createHash("sha256")
      .update(await readFile(screenshotPath))
      .digest("hex");
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

  async listenAndCapture(key: string, timeoutMs = 30 * 60_000): Promise<CollectedEvidence> {
    const target = await this.waitForKey(key, timeoutMs, "C");
    return this.capture(target, "manual");
  }
}
