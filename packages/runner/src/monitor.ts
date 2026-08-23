import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import { IPC_VERSION, getStoreManifest, monitorCommandSchema, type MonitorEvent, type ProductCandidate, type ProductVariant, type TargetCheck, type TargetDecision, type TargetSnapshot } from "@copify/shared";
import { findChromeExecutable } from "./network";

const SUPREME_EU_LISTING_URL = "https://eu.supreme.com/collections/all";
let timer: NodeJS.Timeout | undefined;
let running = false;
let stopping = false;
let activeRunId: string | null = null;

export interface StoreAdapter { id: string; locateProducts(target: TargetSnapshot): Promise<ProductCandidate[]>; }

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

export class SupremeEuAdapter implements StoreAdapter {
  readonly id = "supreme-eu";
  async locateProducts(target: TargetSnapshot): Promise<ProductCandidate[]> {
    const executablePath = findChromeExecutable(); if (!executablePath) throw new Error("Google Chrome was not found. Install Chrome or use the Chrome browser runner before testing a target.");
    const browser = await chromium.launch({ headless: true, executablePath });
    try {
      const page = await browser.newPage(); await page.goto(SUPREME_EU_LISTING_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.locator('a[href*="/products/"]').first().waitFor({ state: "attached", timeout: 15_000 }); await page.waitForTimeout(500);
      const links = await page.locator('a[href*="/products/"]').evaluateAll((anchors) => anchors.map((anchor, index) => {
        const element = anchor as HTMLAnchorElement; const fallback = decodeURIComponent(new URL(element.href).pathname.split("/").filter(Boolean).pop() ?? "").replace(/[-_]+/g, " ");
        const card = element.closest("article, li, [data-product], [class*='product'], [class*='Product']") ?? element.parentElement;
        return { href: element.href, name: (element.textContent ?? "").trim() || element.getAttribute("aria-label") || element.getAttribute("title") || element.querySelector("img")?.getAttribute("alt") || (card?.textContent ?? "").trim() || fallback, index };
      }).filter((value) => value.href && value.name));
      const seen = new Set<string>(); const matches = links.filter((link) => !seen.has(link.href) && (seen.add(link.href), matchesName(link.name, target))).slice(0, 5);
      const result: ProductCandidate[] = [];
      for (const link of matches) { const product = await this.readProduct(page, link.href, link.name, link.index, target); result.push(product); }
      return result;
    } finally { await browser.close(); }
  }
  private async readProduct(page: Page, href: string, fallbackName: string, listingOrder: number, target: TargetSnapshot): Promise<ProductCandidate> {
    await page.goto(href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => /[€£$]\s*\d/.test(document.body.innerText), { timeout: 15_000 }).catch(() => undefined);
    const data = await page.evaluate(() => {
      const text = (selector: string) => document.querySelector(selector)?.textContent?.trim() ?? "";
      const name = text("h1") || document.title || "Product"; const body = document.body.innerText.slice(0, 20_000);
      const selects = [...document.querySelectorAll("select")].map((select) => ({ key: `${select.getAttribute("name") ?? ""} ${select.getAttribute("id") ?? ""} ${select.getAttribute("aria-label") ?? ""}`.toLowerCase(), options: [...select.querySelectorAll("option")].map((option) => ({ text: option.textContent?.trim() ?? "", disabled: (option as HTMLOptionElement).disabled })) }));
      const colorButtons = [...document.querySelectorAll("button[title]")].map((button) => ({ title: button.getAttribute("title") ?? "", disabled: (button as HTMLButtonElement).disabled || button.getAttribute("aria-disabled") === "true" }));
      return { name, body, selects, colorButtons };
    });
    const values = (kind: "color" | "size") => data.selects.find((select) => select.key.includes(kind))?.options.filter((option) => option.text && !/select|choose/i.test(option.text)) ?? [];
    const knownColors = data.colorButtons.map((button) => ({ ...button, color: colorFromThumbnailTitle(button.title) })).filter((button): button is { title: string; disabled: boolean; color: string } => Boolean(button.color)).filter((button, index, all) => all.findIndex((item) => item.color === button.color) === index);
    const colors = knownColors.length ? (target.preferredColors.length ? knownColors.filter((button) => target.preferredColors.some((color) => normalizeMatch(color) === normalizeMatch(button.color))) : knownColors.slice(0, 1)) : [{ title: "", disabled: false, color: values("color")[0]?.text ?? "Default" }];
    const variants: ProductVariant[] = [];
    for (const color of colors) {
      if (color.title) await page.getByTitle(color.title, { exact: true }).click({ timeout: 5_000 }).catch(() => undefined);
      const sizes = await page.locator("select").evaluateAll((selects) => { const size = selects.find((select) => `${select.getAttribute("name") ?? ""} ${select.getAttribute("id") ?? ""} ${select.getAttribute("aria-label") ?? ""}`.toLowerCase().includes("size")); return size ? [...size.querySelectorAll("option")].map((option) => ({ text: option.textContent?.trim() ?? "", disabled: (option as HTMLOptionElement).disabled })).filter((option) => option.text && !/select|choose/i.test(option.text)) : []; });
      for (const size of sizes.length ? sizes : [{ text: "Default", disabled: false }]) variants.push({ color: color.color, size: size.text, available: !color.disabled && !size.disabled });
    }
    const imageColor = target.preferredColors.find((color) => variants.some((variant) => variant.available && normalizeMatch(variant.color) === normalizeMatch(color))) ?? variants.find((variant) => variant.available)?.color ?? colors[0]?.color ?? "";
    const imageButton = knownColors.find((button) => normalizeMatch(button.color) === normalizeMatch(imageColor));
    if (imageButton?.title) {
      await page.getByTitle(imageButton.title, { exact: true }).click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(250);
    }
    const imageUrl = canonicalProductImageUrl(await page.evaluate(({ productName, color }) => {
      const normalize = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const name = normalize(productName);
      const selectedColor = normalize(color);
      const images = [...document.querySelectorAll<HTMLImageElement>("img")].map((image) => {
        const source = image.currentSrc || image.getAttribute("src") || image.getAttribute("data-src") || "";
        const url = source ? new URL(source, window.location.href) : null;
        return { source: url?.href ?? "", alt: normalize(image.alt), width: image.naturalWidth, height: image.naturalHeight, shopify: url?.hostname.endsWith("shopify.com") ?? false };
      }).filter((image) => image.source);
      const primary = images.sort((left, right) => {
        const leftColorMatch = Number(Boolean(selectedColor) && left.alt.includes(selectedColor));
        const rightColorMatch = Number(Boolean(selectedColor) && right.alt.includes(selectedColor));
        const leftNameMatch = Number(Boolean(name) && left.alt.includes(name));
        const rightNameMatch = Number(Boolean(name) && right.alt.includes(name));
        return rightColorMatch - leftColorMatch || rightNameMatch - leftNameMatch || Number(right.shopify) - Number(left.shopify) || right.width * right.height - left.width * left.height;
      })[0];
      return primary?.source ?? null;
    }, { productName: data.name || fallbackName, color: imageColor }));
    const parsed = parseDisplayedPrice(data.body); const url = new URL(href); return { name: data.name || fallbackName, url: `${url.origin}${url.pathname}`, imageUrl, priceMinor: parsed?.priceMinor ?? null, currency: parsed?.currency ?? null, variants, listingOrder };
  }
}

function matchesName(name: string, target: TargetSnapshot): boolean { return matchesTarget(name, target); }
async function check(target: TargetSnapshot): Promise<TargetCheck> {
  const manifest = getStoreManifest(target.storeId);
  if (!manifest || manifest.capabilities.monitor === null) return { id: randomUUID(), targetId: target.targetId, checkedAt: Date.now(), status: "ERROR", decision: { kind: "ERROR", message: "NO_ADAPTER", candidate: null, selectedVariant: null }, candidateCount: 0, errorMessage: null };
  try { const candidates = await new SupremeEuAdapter().locateProducts(target); const decision = decideTarget(target, candidates); return { id: randomUUID(), targetId: target.targetId, checkedAt: Date.now(), status: decision.kind === "ERROR" ? "ERROR" : "SUCCESS", decision, candidateCount: candidates.length, errorMessage: decision.kind === "ERROR" ? decision.message : null }; }
  catch (error) { const errorMessage = sanitizeMonitorError(error instanceof Error ? error.message : "The Supreme monitor failed."); return { id: randomUUID(), targetId: target.targetId, checkedAt: Date.now(), status: "ERROR", decision: { kind: "ERROR", message: "The Supreme EU listing could not be checked.", candidate: null, selectedVariant: null }, candidateCount: 0, errorMessage }; }
}
function sanitizeMonitorError(value: string): string { return value.replace(/https?:\/\/[^\s?]+\?[^\s]+/gi, "[URL query redacted]").replace(/(authorization|cookie|password|token|secret)\s*[:=]\s*[^\s;,&]+/gi, "$1=[REDACTED]").slice(0, 500); }
function send(value: MonitorEvent): void { process.send?.(value); }
async function poll(runId: string, target: TargetSnapshot): Promise<void> { if (running || stopping) return; running = true; try { const value = await check(target); send({ type: "MONITOR_EVENT", version: IPC_VERSION, runId, eventType: value.status === "ERROR" ? "TARGET_MONITOR_FAILED" : value.decision.kind === "VARIANT_SELECTED" ? "TARGET_VARIANT_SELECTED" : value.decision.kind === "PRICE_LIMIT_EXCEEDED" ? "PRICE_LIMIT_EXCEEDED" : value.decision.kind === "CURRENCY_MISMATCH" ? "CURRENCY_MISMATCH" : "TARGET_POLLED", check: value }); } finally { running = false; } }

process.on("message", async (message: unknown) => {
  const parsed = monitorCommandSchema.safeParse(message); if (!parsed.success) return; const command = parsed.data;
  if (command.type === "TEST_TARGET") { const value = await check(command.target); send({ type: "MONITOR_TEST_RESULT", version: IPC_VERSION, check: value }); return; }
  if (command.type === "START_MONITOR") { if (timer) return; activeRunId = command.runId; stopping = false; send({ type: "MONITOR_EVENT", version: IPC_VERSION, runId: command.runId, eventType: "TARGET_MONITOR_STARTED", check: null }); await poll(command.runId, command.target); timer = setInterval(() => { void poll(command.runId, command.target); }, 15_000); return; }
  if (command.type === "STOP_MONITOR") { stopping = true; if (timer) clearInterval(timer); timer = undefined; send({ type: "MONITOR_STOPPED", version: IPC_VERSION, runId: activeRunId }); activeRunId = null; }
});
