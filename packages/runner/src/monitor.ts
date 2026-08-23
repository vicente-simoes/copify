import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page, type Response } from "rebrowser-playwright";
import { stat } from "node:fs/promises";
import { IPC_VERSION, getStoreManifest, monitorCommandSchema, type MonitorEvent, type ProductCandidate, type ProductVariant, type TargetCheck, type TargetDecision, type TargetSnapshot } from "@copify/shared";
import { findChromeExecutable } from "./network";
import { buildNativeStealthArgs } from "./drivers";

const SUPREME_EU_LISTING_URL = "https://eu.supreme.com/collections/all";
const NORMAL_POLL_INTERVAL_MS = 15_000;
const INITIAL_PROTECTION_BACKOFF_MS = 60_000;
const MAX_PROTECTION_BACKOFF_MS = 5 * 60_000;
let timer: NodeJS.Timeout | undefined;
let running = false;
let stopping = false;
let activeRunId: string | null = null;
let activeTarget: TargetSnapshot | null = null;
let paused = false;
let context: BrowserContext | undefined;
let monitorPage: Page | undefined;
let startedAt = 0;
let requestCount = 0;
let navigationCount = 0;
let forbiddenCount = 0;
let rateLimitedCount = 0;
let challengeCount = 0;
let loads: number[] = [];
let navigatorWebdriver: boolean | null = null;
let browserVersion: string | null = null;
let monitorUserDataDir: string | null = null;

export interface StoreAdapter { id: string; locateProducts(target: TargetSnapshot): Promise<ProductCandidate[]>; }

type ListingProductLink = { href: string; name: string; color: string | null; imageUrl: string | null; priceText: string; index: number };

export function normalizeMatch(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " "); }
export function matchesTarget(name: string, target: Pick<TargetSnapshot, "productKeywords" | "negativeKeywords">): boolean {
  const normalized = normalizeMatch(name); return target.productKeywords.some((keyword) => normalized.includes(normalizeMatch(keyword))) && !target.negativeKeywords.some((keyword) => normalized.includes(normalizeMatch(keyword)));
}
export function selectPreferredVariant(candidate: ProductCandidate, target: Pick<TargetSnapshot, "preferredColors" | "sizePriority">): ProductVariant | null {
  const available = candidate.variants.filter((variant) => variant.available); if (!available.length) return null;
  const colorRank = (color: string) => target.preferredColors.length ? Math.max(0, target.preferredColors.findIndex((value) => normalizeMatch(value) === normalizeMatch(color))) : 0;
  const sizeRank = (size: string) => target.sizePriority.length ? Math.max(0, target.sizePriority.findIndex((value) => normalizeMatch(value) === normalizeMatch(size))) : 0;
  const acceptable = available.filter((variant) => (!target.preferredColors.length || target.preferredColors.some((value) => normalizeMatch(value) === normalizeMatch(variant.color))) && (!target.sizePriority.length || target.sizePriority.some((value) => normalizeMatch(value) === normalizeMatch(variant.size))));
  return acceptable.sort((a, b) => colorRank(a.color) - colorRank(b.color) || sizeRank(a.size) - sizeRank(b.size))[0] ?? null;
}
export function decideTarget(target: TargetSnapshot, candidates: ProductCandidate[]): TargetDecision {
  const matched = candidates.filter((candidate) => matchesTarget(candidate.name, target)).sort((a, b) => a.listingOrder - b.listingOrder);
  if (!matched.length) return { kind: "NO_MATCH", message: "No configured product phrase was found.", candidate: null, selectedVariant: null };
  const candidate = matched[0];
  if (!candidate.currency || candidate.priceMinor === null) return { kind: "ERROR", message: "The matching product did not expose a readable price.", candidate, selectedVariant: null };
  if (candidate.currency !== target.currency) return { kind: "CURRENCY_MISMATCH", message: `Expected ${target.currency}, found ${candidate.currency}.`, candidate, selectedVariant: null };
  if (candidate.priceMinor > target.maxRetailMinor) return { kind: "PRICE_LIMIT_EXCEEDED", message: `Detected price exceeds the configured ${target.currency} limit.`, candidate, selectedVariant: null };
  const selectedVariant = selectPreferredVariant(candidate, target);
  if (!selectedVariant) return { kind: "NO_ACCEPTABLE_VARIANT", message: "The matching product has no available preferred variant.", candidate, selectedVariant: null };
  return { kind: "VARIANT_SELECTED", message: "An acceptable product variant was found.", candidate, selectedVariant };
}
export function parseDisplayedPrice(value: string): { priceMinor: number; currency: string } | null {
  const match = value.replace(/\s/g, " ").match(/([£€$])\s*([0-9]+)(?:[.,]([0-9]{1,2}))?/); if (!match) return null;
  const currency = match[1] === "£" ? "GBP" : match[1] === "€" ? "EUR" : "USD"; return { currency, priceMinor: Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0")) };
}
export function colorFromThumbnailTitle(value: string): string | null {
  const match = value.match(/^view\s+.+\s+-\s+(.+?)\s+\(image\s+1\s+of\s+\d+\)$/i); return match?.[1]?.trim() || null;
}
export function colorFromProductImageAlt(value: string | null | undefined, productName: string): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf(" - ");
  if (separator < 1 || normalizeMatch(value.slice(0, separator)) !== normalizeMatch(productName)) return null;
  return value.slice(separator + 3).trim() || null;
}
export function preferredColorRank(color: string | null, preferredColors: string[]): number {
  if (!preferredColors.length) return 0;
  const index = preferredColors.findIndex((value) => color && normalizeMatch(value) === normalizeMatch(color));
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}
export function canonicalProductImageUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:") return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
export function storefrontProtectionBackoffMs(errorMessage: string | null, consecutiveResponses: number): number | null {
  if (!errorMessage || !/\b(?:403|429)\b|too many requests|rate limit|captcha|access (?:denied|challenge)|security[ -]check|verify you are human|just a moment/i.test(errorMessage)) return null;
  return Math.min(INITIAL_PROTECTION_BACKOFF_MS * (2 ** Math.max(0, consecutiveResponses - 1)), MAX_PROTECTION_BACKOFF_MS);
}

function assertStorefrontResponse(response: Response | null): void {
  const status = response?.status();
  if (status === 403 || status === 429) throw new Error(`Storefront returned HTTP ${status}.`);
  if (status && status >= 400) throw new Error(`Storefront returned HTTP ${status}.`);
}
async function throwIfStorefrontChallenge(page: Page, fallback: unknown): Promise<never> {
  const text = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
  if (/captcha|access denied|security[ -]check|verify you are human|just a moment/i.test(text)) throw new Error("Storefront access challenge detected.");
  throw fallback;
}

export function parseSupremeProductJson(value: unknown, fallback: ListingProductLink): ProductCandidate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const product = value as Record<string, unknown>;
  const name = typeof product.title === "string" && product.title.trim() ? product.title.trim() : fallback.name;
  const color = typeof product.color === "string" && product.color.trim() ? product.color.trim() : fallback.color ?? "Default";
  const rawVariants = Array.isArray(product.variants) ? product.variants : [];
  const variants = rawVariants.flatMap((value): ProductVariant[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const variant = value as Record<string, unknown>;
    const size = [variant.public_title, variant.option1, variant.title].find((item): item is string => typeof item === "string" && Boolean(item.trim()));
    if (!size || typeof variant.available !== "boolean") return [];
    return [{ color, size: size.trim(), available: variant.available }];
  });
  if (!variants.length) return null;
  const displayed = parseDisplayedPrice(fallback.priceText);
  const priceMinor = typeof product.price === "number" && Number.isInteger(product.price) && product.price >= 0 ? product.price : displayed?.priceMinor ?? null;
  const rawImage = typeof product.image === "string" ? product.image : null;
  let imageUrl = fallback.imageUrl;
  if (rawImage) {
    try { imageUrl = canonicalProductImageUrl(rawImage.startsWith("//") ? `https:${rawImage}` : new URL(rawImage, fallback.href).toString()); } catch { /* Keep the canonical listing image. */ }
  }
  const url = new URL(fallback.href); url.search = ""; url.hash = "";
  return { name, url: url.toString(), imageUrl, priceMinor, currency: displayed?.currency ?? null, variants, listingOrder: fallback.index };
}

export class SupremeEuAdapter implements StoreAdapter {
  readonly id = "supreme-eu";
  constructor(private readonly page: Page) {}
  async locateProducts(target: TargetSnapshot): Promise<ProductCandidate[]> {
    const listing = await this.fetchHtml(SUPREME_EU_LISTING_URL);
    const links = await this.page.evaluate((html) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      return [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/products/"]')].map((element, index) => {
        const href = new URL(element.href, "https://eu.supreme.com").toString(); const fallback = decodeURIComponent(new URL(href).pathname.split("/").filter(Boolean).pop() ?? "").replace(/[-_]+/g, " ");
        const card = element.closest("article, li, [data-product], [class*='product'], [class*='Product']") ?? element.parentElement;
        const image = element.querySelector("img"); const imageAlt = image?.getAttribute("alt")?.trim() ?? "";
        const aria = element.getAttribute("aria-label")?.replace(/\s+product\s+link$/i, "").trim() ?? "";
        return { href, name: aria || imageAlt.split(" - ")[0]?.trim() || (element.textContent ?? "").trim() || element.getAttribute("title") || fallback, imageAlt, imageUrl: image?.getAttribute("src") || null, priceText: (card?.textContent ?? element.textContent ?? "").trim(), index };
      }).filter((value) => value.href && value.name);
    }, listing);
    const seen = new Set<string>(); const matches: ListingProductLink[] = links.filter((link) => !seen.has(link.href) && (seen.add(link.href), matchesName(link.name, target))).map((link) => ({ ...link, color: colorFromProductImageAlt(link.imageAlt, link.name), imageUrl: canonicalProductImageUrl(link.imageUrl) })).sort((left, right) => preferredColorRank(left.color, target.preferredColors) - preferredColorRank(right.color, target.preferredColors) || left.index - right.index).slice(0, 5);
    const result: ProductCandidate[] = [];
    for (const link of matches) {
      const html = await this.fetchHtml(link.href);
      const embedded = await this.page.evaluate((source) => { const document = new DOMParser().parseFromString(source, "text/html"); const script = [...document.scripts].find((item) => item.id.startsWith("product-") && item.id.endsWith("-json")); try { return script ? JSON.parse(script.textContent ?? "") : null; } catch { return null; } }, html);
      const product = parseSupremeProductJson(embedded, link);
      if (!product) continue;
      if (decideTarget(target, [product]).kind === "VARIANT_SELECTED") return [product];
      result.push(product);
    }
    return result;
  }
  private async fetchHtml(url: string): Promise<string> {
    const result = await this.page.evaluate(async (resource) => { const response = await fetch(resource, { credentials: "same-origin", cache: "no-cache" }); return { status: response.status, text: await response.text() }; }, url);
    if (result.status === 403) forbiddenCount += 1; if (result.status === 429) rateLimitedCount += 1;
    if (result.status >= 400) throw new Error(`Storefront returned HTTP ${result.status}.`);
    if (/captcha|access denied|security[ -]check|verify you are human|just a moment/i.test(result.text)) { challengeCount += 1; throw new Error("Storefront access challenge detected."); }
    return result.text;
  }
}

function matchesName(name: string, target: TargetSnapshot): boolean { return matchesTarget(name, target); }
async function check(target: TargetSnapshot): Promise<TargetCheck> {
  const manifest = getStoreManifest(target.storeId);
  if (!manifest || manifest.capabilities.monitor === null) return { id: randomUUID(), targetId: target.targetId, checkedAt: Date.now(), status: "ERROR", decision: { kind: "ERROR", message: "NO_ADAPTER", candidate: null, selectedVariant: null }, candidateCount: 0, errorMessage: null };
  try { if (!monitorPage) throw new Error("The persistent monitor page is unavailable."); const candidates = await new SupremeEuAdapter(monitorPage).locateProducts(target); const decision = decideTarget(target, candidates); return { id: randomUUID(), targetId: target.targetId, checkedAt: Date.now(), status: decision.kind === "ERROR" ? "ERROR" : "SUCCESS", decision, candidateCount: candidates.length, errorMessage: decision.kind === "ERROR" ? decision.message : null }; }
  catch (error) { const errorMessage = sanitizeMonitorError(error instanceof Error ? error.message : "The Supreme monitor failed."); return { id: randomUUID(), targetId: target.targetId, checkedAt: Date.now(), status: "ERROR", decision: { kind: "ERROR", message: "The Supreme EU listing could not be checked.", candidate: null, selectedVariant: null }, candidateCount: 0, errorMessage }; }
}
function sanitizeMonitorError(value: string): string { return value.replace(/https?:\/\/[^\s?]+\?[^\s]+/gi, "[URL query redacted]").replace(/(authorization|cookie|password|token|secret)\s*[:=]\s*[^\s;,&]+/gi, "$1=[REDACTED]").slice(0, 500); }
function send(value: MonitorEvent): void { process.send?.(value); }
async function poll(runId: string, target: TargetSnapshot): Promise<TargetCheck | undefined> {
  if (running || stopping || paused) return undefined;
  running = true;
  try {
    const value = await check(target);
    send({ type: "MONITOR_EVENT", version: IPC_VERSION, runId, eventType: value.status === "ERROR" ? "TARGET_MONITOR_FAILED" : value.decision.kind === "VARIANT_SELECTED" ? "TARGET_VARIANT_SELECTED" : value.decision.kind === "PRICE_LIMIT_EXCEEDED" ? "PRICE_LIMIT_EXCEEDED" : value.decision.kind === "CURRENCY_MISMATCH" ? "CURRENCY_MISMATCH" : "TARGET_POLLED", check: value });
    await emitHealth(runId); return value;
  } finally { running = false; }
}
function schedulePoll(runId: string, target: TargetSnapshot, delay: number): void {
  if (stopping || paused) return;
  timer = setTimeout(async () => {
    timer = undefined;
    const value = await poll(runId, target);
    if (stopping) return;
    schedulePoll(runId, target, NORMAL_POLL_INTERVAL_MS);
  }, delay);
}

process.on("message", async (message: unknown) => {
  const parsed = monitorCommandSchema.safeParse(message); if (!parsed.success) return; const command = parsed.data;
  if (command.type === "TEST_TARGET") { await startContext(command.userDataDir); const value = await check(command.target); await emitHealth(null); send({ type: "MONITOR_TEST_RESULT", version: IPC_VERSION, check: value }); await closeContext(); return; }
  if (command.type === "START_MONITOR") {
    if (timer || running) return;
    activeRunId = command.runId; activeTarget = command.target; stopping = false; paused = false; await startContext(command.userDataDir);
    send({ type: "MONITOR_EVENT", version: IPC_VERSION, runId: command.runId, eventType: "TARGET_MONITOR_STARTED", check: null });
    const value = await poll(command.runId, command.target);
    if (!stopping) schedulePoll(command.runId, command.target, NORMAL_POLL_INTERVAL_MS);
    return;
  }
  if (command.type === "PAUSE_MONITOR") { paused = true; if (timer) clearTimeout(timer); timer = undefined; send({ type: "MONITOR_EVENT", version: IPC_VERSION, runId: activeRunId, eventType: "TARGET_MONITOR_PAUSED", check: null }); return; }
  if (command.type === "RESUME_MONITOR") { if (!activeRunId || !activeTarget || !paused) return; paused = false; send({ type: "MONITOR_EVENT", version: IPC_VERSION, runId: activeRunId, eventType: "TARGET_MONITOR_RESUMED", check: null }); schedulePoll(activeRunId, activeTarget, 0); return; }
  if (command.type === "STOP_MONITOR") { stopping = true; if (timer) clearTimeout(timer); timer = undefined; await emitHealth(activeRunId); await closeContext(); send({ type: "MONITOR_STOPPED", version: IPC_VERSION, runId: activeRunId }); activeRunId = null; activeTarget = null; }
});

async function startContext(userDataDir: string): Promise<void> {
  if (context && monitorPage) return;
  const executablePath = findChromeExecutable(); if (!executablePath) throw new Error("Google Chrome was not found. Install Chrome before starting a target monitor.");
  monitorUserDataDir = userDataDir; startedAt = Date.now(); requestCount = navigationCount = forbiddenCount = rateLimitedCount = challengeCount = 0; loads = [];
  context = await chromium.launchPersistentContext(userDataDir, { headless: true, executablePath, args: buildNativeStealthArgs(), ignoreDefaultArgs: ["--enable-automation", "--no-sandbox"] });
  monitorPage = context.pages()[0] ?? await context.newPage();
  context.on("request", () => { requestCount += 1; });
  monitorPage.on("framenavigated", (frame) => { if (frame === monitorPage?.mainFrame()) navigationCount += 1; });
  const started = Date.now(); const response = await monitorPage.goto(SUPREME_EU_LISTING_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }); assertStorefrontResponse(response); loads.push(Date.now() - started);
  navigatorWebdriver = await monitorPage.evaluate(() => navigator.webdriver).catch(() => null);
  browserVersion = context.browser()?.version() ?? null;
}

async function closeContext(): Promise<void> { await context?.close().catch(() => undefined); context = undefined; monitorPage = undefined; }
async function emitHealth(runId: string | null): Promise<void> {
  const age = monitorUserDataDir ? await stat(monitorUserDataDir).then((value) => Math.max(0, Date.now() - value.birthtimeMs)).catch(() => null) : null;
  const cookies = context ? await context.cookies().then((value) => value.length).catch(() => null) : null;
  const minutes = Math.max((Date.now() - startedAt) / 60_000, 1 / 60);
  send({ type: "MONITOR_HEALTH", version: IPC_VERSION, runId, health: { capturedAt: Date.now(), navigatorWebdriver, browserVersion, driverKind: null, stealthStatus: null, profileAgeMs: age, cookieCount: cookies, requestCount, requestsPerMinute: requestCount / minutes, navigationCount, navigationsPerMinute: navigationCount / minutes, atcAttempts: 0, forbiddenCount, rateLimitedCount, challengeCount, checkoutFailures: 0, averagePageLoadMs: loads.length ? loads.reduce((sum, value) => sum + value, 0) / loads.length : null, circuit: null } });
}
