import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrowserContext, Locator, Page, Route } from "playwright-core";
import { parseTriggerPlan, mockRuleSchema, type MockRule, type ParsedTriggerPlan, type PlanLocator, type TriggerPlan } from "./plan.js";

export interface BrowserCollectorOptions {
  baseUrl: string;
  artifactDir: string;
  userDataDir: string;
  headless?: boolean;
  channel?: "chrome" | "msedge" | "chromium";
  defaultTimeoutMs?: number;
  viewport?: { width: number; height: number };
  locale?: string;
  cookies?: Array<{ name: string; value: string }>;
  planTimeoutMs?: number;
}

export interface RuntimeTargetSnapshot {
  key: string;
  occurrenceId?: string;
  binding?: string;
  text: string;
  route: string;
  rect: { x: number; y: number; width: number; height: number };
}

export interface CollectedEvidence extends RuntimeTargetSnapshot {
  screenshotPath: string;
  capturedAt: string;
  source: "deterministic" | "agent" | "manual";
  plan?: ParsedTriggerPlan;
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
    visible?: boolean;
    anchorType?: string;
    text?: string;
    rect?: { x: number; y: number; width: number; height: number };
  }>;
}

export interface CaptureLabelPositionInput {
  viewport: { width: number; height: number };
  target: { x: number; y: number; width: number; height: number };
  label: { width: number; height: number };
  margin?: number;
}

export function captureLabelPosition(input: CaptureLabelPositionInput): { left: number; top: number } {
  const margin = input.margin ?? 4;
  const maxLeft = Math.max(margin, input.viewport.width - input.label.width - margin);
  const left = Math.min(Math.max(input.target.x - 4, margin), maxLeft);
  const above = input.target.y - 4 - input.label.height;
  const maxTop = Math.max(margin, input.viewport.height - input.label.height - margin);
  const below = input.target.y + input.target.height + 4;
  const top = above >= margin ? above : Math.min(Math.max(below, margin), maxTop);
  return { left, top };
}

type RuntimeWindow = Window & {
  __COLLECT_I18N__?: {
    targets?: (key?: string) => RuntimeTargetSnapshot[];
    getVisibleOccurrences?: (key?: string) => RuntimeTargetSnapshot[];
    getSnapshot?: () => Array<{
      key?: string;
      occurrenceId?: string;
      kind?: string;
      text?: string;
      visible?: boolean;
      rect?: { x: number; y: number; width: number; height: number };
    }>;
    focus?: (target: string | { key?: string; occurrenceId?: string }) => {
      key?: string;
      occurrenceId?: string;
      kind?: string;
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
      text?: string;
      visible?: boolean;
      rect?: { x: number; y: number; width: number; height: number };
    }>;
  };
  __I18N_COLLECTOR__?: RuntimeWindow["__COLLECT_I18N__"];
};

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

export class BrowserCollector {
  private context?: BrowserContext;
  private page?: Page;
  private readonly rules = new Map<string, ReturnType<typeof mockRuleSchema.parse>>();

  constructor(private readonly options: BrowserCollectorOptions) {}

  private async createFreshPage(restoredPages: Page[] = []): Promise<Page> {
    if (!this.context) throw new Error("Browser collector context is not running");
    const page = await this.context.newPage();
    await page.route("**/*", (route) => this.routeRequest(route));
    this.page = page;
    await Promise.all(restoredPages.filter((candidate) => candidate !== page).map((candidate) => candidate.close().catch(() => undefined)));
    return page;
  }

  async start(): Promise<void> {
    if (this.context) return;
    const { chromium } = await import("playwright-core");
    await mkdir(this.options.userDataDir, { recursive: true });
    await mkdir(this.options.artifactDir, { recursive: true });
    this.context = await chromium.launchPersistentContext(this.options.userDataDir, {
      channel: this.options.channel === "chromium" ? undefined : (this.options.channel ?? "chrome"),
      headless: this.options.headless ?? false,
      viewport: this.options.viewport ?? { width: 1440, height: 960 },
      locale: this.options.locale,
    });
    this.context.setDefaultTimeout(this.options.defaultTimeoutMs ?? 15_000);
    // A persistent profile may restore a tab whose previous Vite navigation
    // was interrupted by a crashed service. Reusing that tab can leave a new
    // navigation permanently pending. Preserve cookies/storage, but always
    // collect in a fresh page and discard restored tabs.
    if (this.options.cookies?.length) {
      await this.context.addCookies(this.options.cookies.map((cookie) => ({
        ...cookie,
        url: this.options.baseUrl,
      })));
    }
    await this.createFreshPage(this.context.pages());
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
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
    const page = this.activePage;
    switch (value.kind) {
      case "css": return page.locator(value.value);
      case "role": return page.getByRole(value.value as never, { name: value.name });
      case "text": return page.getByText(value.value, { exact: value.exact });
      case "label": return page.getByLabel(value.value, { exact: value.exact });
      case "testId": return page.getByTestId(value.value);
    }
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
    await locator.click({ timeout: timeoutMs });
    const options = page.locator('.el-select-dropdown:visible .el-select-dropdown__item, [role="option"]:visible');
    let match = options.getByText(value, { exact: true });
    if ((await match.count().catch(() => 0)) === 0) match = options.filter({ hasText: value });
    await match.first().click({ timeout: timeoutMs });
  }

  private sameOriginUrl(path: string): string {
    const target = new URL(path, this.options.baseUrl);
    const base = new URL(this.options.baseUrl);
    if (target.origin !== base.origin) throw new Error(`TriggerPlan cannot navigate outside project origin: ${target.origin}`);
    return target.toString();
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

  async executePlan(rawPlan: TriggerPlan, source: CollectedEvidence["source"] = "agent"): Promise<CollectedEvidence> {
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
          case "click": await this.locator(step.locator).click({ timeout: step.timeoutMs }); break;
          case "fill": await this.fillInput(this.locator(step.locator), step.value, step.timeoutMs); break;
          case "press": await (await this.resolveEditable(this.locator(step.locator), this.stepTimeout(step.timeoutMs))).press(step.key, { timeout: step.timeoutMs }); break;
          case "select": await this.selectOption(this.locator(step.locator), step.value, step.timeoutMs); break;
          case "hover": await this.locator(step.locator).hover({ timeout: step.timeoutMs }); break;
          case "wait": await this.activePage.waitForTimeout(step.milliseconds); break;
          case "waitForKey": await this.waitForKey(step.key, step.timeoutMs); break;
          case "waitForText": await this.activePage.getByText(step.text).first().waitFor({ state: "visible", timeout: step.timeoutMs }); break;
          case "reload": await this.open(this.activePage.url()); break;
        }
        this.assertSameOrigin();
      }

      const target = await this.waitForKey(plan.targetKey, 10_000);
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
      if (this.context && (!this.page || this.page.isClosed())) await this.createFreshPage();
    }
  }

  async open(path = "/"): Promise<void> {
    await this.activePage.goto(this.sameOriginUrl(path), {
      // `domcontentloaded` is allowed to remain pending when a transformed
      // module stalls. Commit first, then perform our own bounded readiness
      // probe so failures are actionable and cannot wedge the service.
      waitUntil: "commit",
      // Vite's first transform on a real project is often materially slower
      // than subsequent locator operations. Keep navigation bounded, but do
      // not reuse the short per-action timeout for the initial compilation.
      timeout: Math.max(45_000, (this.options.defaultTimeoutMs ?? 15_000) * 3),
    });
    const startedAt = Date.now();
    const readinessTimeout = Math.max(45_000, (this.options.defaultTimeoutMs ?? 15_000) * 3);
    while (Date.now() - startedAt < readinessTimeout) {
      const ready = await bounded(this.activePage.evaluate(() => {
        const view = window as RuntimeWindow;
        return document.readyState !== "loading" && Boolean(view.__COLLECT_I18N__ ?? view.__I18N_COLLECTOR__);
      }), 2_000, "Page became unresponsive during collector readiness check").catch(() => false);
      if (ready) return;
      await new Promise((done) => setTimeout(done, 125));
    }
    throw new Error(`Collector runtime did not become ready after navigation: ${this.activePage.url()}`);
  }

  async inspectRuntime(limit = 200): Promise<RuntimeInspection> {
    return bounded(this.activePage.evaluate((maximum) => {
      const runtimeWindow = window as RuntimeWindow & { __COLLECT_I18N_PENDING__?: unknown[] };
      const collector = runtimeWindow.__COLLECT_I18N__ ?? runtimeWindow.__I18N_COLLECTOR__;
      const snapshots = collector?.getSnapshot?.().slice(0, maximum).map((item) => ({
        key: item.key,
        occurrenceId: item.occurrenceId,
        kind: item.kind,
        visible: item.visible,
        anchorType: "anchorType" in item ? String(item.anchorType) : undefined,
        text: item.text,
        rect: item.rect ? { x: item.rect.x, y: item.rect.y, width: item.rect.width, height: item.rect.height } : undefined,
      })) ?? [];
      return {
        url: location.href,
        collectorInstalled: Boolean(collector),
        markedElements: document.querySelectorAll("[data-i18n-key],[data-collect-i18n-bindings]").length,
        pendingDescriptors: runtimeWindow.__COLLECT_I18N_PENDING__?.length ?? 0,
        snapshots,
      };
    }, Math.max(1, Math.min(limit, 2_000))), 3_000, "Runtime inspection timed out while the page was navigating");
  }

  async waitForKey(key: string, timeoutMs = 60_000): Promise<RuntimeTargetSnapshot> {
    const startedAt = Date.now();
    let first = true;
    let lastUrl = "";
    while (Date.now() - startedAt < timeoutMs) {
      this.assertSameOrigin();
      const currentUrl = this.activePage.url();
      if (currentUrl !== lastUrl) first = true;
      const evaluation = this.activePage.evaluate(({ targetKey, initialize }) => {
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
        const normalizeRuntimeTarget = (candidate: {
          key?: string;
          occurrenceId?: string;
          kind?: string;
          text?: string;
          rect?: { x: number; y: number; width: number; height: number };
        }): RuntimeTargetSnapshot | undefined => {
          if (!candidate.rect || !intersectsViewport(candidate.rect)) return undefined;
          return {
            key: candidate.key ?? targetKey,
            occurrenceId: candidate.occurrenceId,
            binding: candidate.kind,
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
        const valid = runtimeTargets.find((candidate) => candidate.rect && intersectsViewport(candidate.rect));
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
          text: element.innerText || element.getAttribute("placeholder") || element.getAttribute("aria-label") || "",
          route: location.href,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }, { targetKey: key, initialize: first });
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
    let resolvedTarget = await this.waitForKey(target.key, 5_000);
    // Validation messages, dialogs and Teleports often animate into place.
    // Require two near-identical layout samples before drawing the marker.
    for (let sample = 0; sample < 6; sample += 1) {
      await page.waitForTimeout(100);
      const next = await this.waitForKey(target.key, 2_000);
      const delta = Math.max(
        Math.abs(next.rect.x - resolvedTarget.rect.x),
        Math.abs(next.rect.y - resolvedTarget.rect.y),
        Math.abs(next.rect.width - resolvedTarget.rect.width),
        Math.abs(next.rect.height - resolvedTarget.rect.height),
      );
      resolvedTarget = next;
      if (delta < 0.5) break;
    }
    const viewport = page.viewportSize();
    const { rect } = resolvedTarget;
    const inViewport = Boolean(
      viewport && rect.width > 0 && rect.height > 0 && rect.x < viewport.width && rect.y < viewport.height &&
      rect.x + rect.width > 0 && rect.y + rect.height > 0,
    );
    if (!viewport || !inViewport) throw new Error("Target key does not intersect the capture viewport");
    const marker = await bounded(page.evaluate(({ key, rect }) => {
      const runtimeWindow = window as RuntimeWindow;
      const collector = runtimeWindow.__COLLECT_I18N__ ?? runtimeWindow.__I18N_COLLECTOR__;
      collector?.setTarget?.(null);
      const id = `collect-i18n-marker-${Date.now()}`;
      const marker = document.createElement("div");
      marker.id = id;
      marker.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${rect.x - 4}px;top:${rect.y - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px;border:4px solid #ef4444;border-radius:6px;box-sizing:border-box;box-shadow:0 0 0 9999px rgba(15,23,42,.12)`;
      const label = document.createElement("div");
      label.id = `${id}-label`;
      label.textContent = key;
      label.style.cssText = "position:fixed;left:0;top:0;max-width:min(520px,calc(100vw - 8px));visibility:hidden;background:#ef4444;color:white;padding:4px 8px;font:600 13px/1.3 ui-monospace,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:4px;box-sizing:border-box";
      marker.append(label);
      document.documentElement.append(marker);
      const labelRect = label.getBoundingClientRect();
      return { id, labelWidth: labelRect.width, labelHeight: labelRect.height };
    }, { key: resolvedTarget.key, rect: resolvedTarget.rect }), 3_000, `Timed out highlighting i18n key: ${resolvedTarget.key}`);

    const labelPosition = captureLabelPosition({
      viewport,
      target: resolvedTarget.rect,
      label: { width: marker.labelWidth, height: marker.labelHeight },
    });
    await bounded(page.evaluate(({ id, position }) => {
      const label = document.getElementById(`${id}-label`);
      if (!label) throw new Error("Capture label disappeared before positioning");
      label.style.left = `${position.left}px`;
      label.style.top = `${position.top}px`;
      label.style.visibility = "visible";
    }, { id: marker.id, position: labelPosition }), 2_000, `Timed out positioning i18n key label: ${resolvedTarget.key}`);

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
    return { ...resolvedTarget, screenshotPath, capturedAt: new Date().toISOString(), source, plan };
  }

  async listenAndCapture(key: string, timeoutMs = 30 * 60_000): Promise<CollectedEvidence> {
    const target = await this.waitForKey(key, timeoutMs);
    return this.capture(target, "manual");
  }
}
