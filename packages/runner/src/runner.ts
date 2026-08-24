import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, CDPSession, Locator, Page } from "rebrowser-playwright";
import { IPC_VERSION, runnerCommandSchema, type BrowserDriverMetadata, type ProductVariant, type ProfileCoherenceSummary, type RunnerBrowserDriver, type RunnerEvent, type RunnerProxy, type RunnerRecording, type RunArtifact, type RunEvent, type RunnerShipping } from "@copify/shared";
import { routeFromIdentity, verifyRoute } from "./network";
import { BrowserDriverError, createBrowserDriver, type DriverSession } from "./drivers";
import { externalCoherence, resolveNetworkCoherence } from "./coherence";
import { HumanInput, type ClipboardPasteClient, type HumanInputTelemetry } from "./human-input";

let context: BrowserContext | undefined;
let profileId: string | undefined;
let profileUserDataDir: string | undefined;
let stopping = false;
let recording: RunnerRecording | undefined;
let startedMono: bigint | undefined;
let assistPage: Page | undefined;
let assistState = "OBSERVING";
type AssistCommand = Extract<import("@copify/shared").RunnerCommand, { type: "ASSIST_TARGET" }>;
type CartInspection = { state: "EMPTY" } | { state: "ITEMS"; itemCount: number | null; hasTarget: boolean; hasVariant: boolean; currency: string | null; priceMinor: number | null } | { state: "UNKNOWN" } | { state: "BLOCKED" };
let pendingAssist: AssistCommand | undefined;
let cartResumeMode: "EMPTY_CART" | "TARGET_ONLY" | undefined;
let tracingStoppedForPrivacy = false;
let driverSession: DriverSession | undefined;
let driverMetadata: BrowserDriverMetadata | undefined;
let coherence: ProfileCoherenceSummary | undefined;
let automationPausedUntil: number | null = null;
let humanInputs = new WeakMap<Page, HumanInput>();
const pendingClipboardLeases = new Map<string, (granted: boolean) => void>();
let heldClipboardLeaseId: string | undefined;
let requestCount = 0; let navigationCount = 0; let atcAttempts = 0; let forbiddenCount = 0; let rateLimitedCount = 0; let challengeCount = 0; let checkoutFailures = 0; let pageLoads: number[] = [];
let trafficReceivedBytes = 0; let trafficSentBytes = 0; let trafficCdpAttached = 0; let trafficFallbackSeen = false; let observedPages = new WeakSet<Page>(); let trafficSessions: CDPSession[] = [];
let paymentHandoffLatch: PaymentHandoffLatch | undefined;

process.on("message", async (message: unknown) => {
  const command = runnerCommandSchema.safeParse(message); if (!command.success) return;
  if (command.data.type === "START") await start(command.data.profileId, command.data.userDataDir, command.data.driver, command.data.proxy, command.data.probeUrl, command.data.recording);
  if (command.data.type === "END_RUN") await endRun(command.data.runSessionId);
  if (command.data.type === "ASSIST_TARGET") await assistTarget(command.data);
  if (command.data.type === "RESUME_ASSIST") await resumeAssist(command.data.runId, command.data.runSessionId);
  if (command.data.type === "CHECK_CART") await checkCart(command.data.profileId);
  if (command.data.type === "EMPTY_CART") await emptyCart(command.data.profileId);
  if (command.data.type === "OPEN_WARM_DESTINATION") await openWarmDestination(command.data.url);
  if (command.data.type === "PAUSE_AUTOMATION") pauseAutomation(command.data.until);
  if (command.data.type === "RESUME_AUTOMATION") automationPausedUntil = null;
  if (command.data.type === "CLIPBOARD_LEASE_GRANTED") resolveClipboardLease(command.data.requestId, true);
  if (command.data.type === "CLIPBOARD_LEASE_DENIED") resolveClipboardLease(command.data.requestId, false);
  if (command.data.type === "STOP") await stop();
});

async function start(id: string, userDataDir: string, driver: RunnerBrowserDriver, proxy: RunnerProxy | null, probeUrl: string, runRecording: RunnerRecording | null): Promise<void> {
  if (context) return; profileId = id; profileUserDataDir = userDataDir; recording = runRecording ?? undefined; startedMono = process.hrtime.bigint(); assistPage = undefined; pendingAssist = undefined; cartResumeMode = undefined; assistState = "OBSERVING"; tracingStoppedForPrivacy = false; automationPausedUntil = null; coherence = undefined; paymentHandoffLatch?.stop(); paymentHandoffLatch = new PaymentHandoffLatch(); humanInputs = new WeakMap(); heldClipboardLeaseId = undefined; for (const resolve of pendingClipboardLeases.values()) resolve(false); pendingClipboardLeases.clear(); requestCount = navigationCount = atcAttempts = forbiddenCount = rateLimitedCount = challengeCount = checkoutFailures = 0; pageLoads = []; trafficReceivedBytes = trafficSentBytes = trafficCdpAttached = 0; trafficFallbackSeen = false; observedPages = new WeakSet(); trafficSessions = [];
  try {
    await disableChromeTranslation(userDataDir);
    const persistentOptions: NonNullable<import("./drivers").DriverLaunchInput["persistentOptions"]> = {};
    if (recording?.diagnosticLevel === "DEEP_DEBUG" && !recording.assisted) {
      await mkdir(recording.artifactDir, { recursive: true });
      if (driver.kind === "NATIVE_STEALTH") {
        persistentOptions.recordHar = { path: join(recording.artifactDir, "network.har"), mode: "minimal", content: "omit" };
        persistentOptions.recordVideo = { dir: join(recording.artifactDir, "video") };
      }
    }
    const resolved = driver.kind === "NATIVE_STEALTH" ? await resolveNetworkCoherence(proxy, probeUrl) : undefined;
    driverSession = await createBrowserDriver(driver).launch({ driver, userDataDir, proxy, persistentOptions, coherence: resolved?.launch });
    context = driverSession.context; driverMetadata = driverSession.metadata;
    if (resolved) coherence = resolved.summary;
    else {
      const page = context.pages()[0] ?? await context.newPage();
      const values = await page.evaluate(() => ({ locale: navigator.language || null, timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || null })).catch(() => ({ locale: null, timezoneId: null }));
      coherence = externalCoherence(values.locale, values.timezoneId);
    }
    context.on("close", () => {
      context = undefined;
      if (!stopping) {
        send({ type: "ERROR", version: IPC_VERSION, profileId: id, code: "RUN_INTERRUPTED", message: "The Chrome browser context was closed before the session finished." });
        setTimeout(() => process.exit(0), 25).unref();
      }
    });
    if (recording) {
      await beginRecording(context, recording);
      if (recording.diagnosticLevel === "DEEP_DEBUG" && driver.kind === "EXTERNAL_CDP") emitRun("DRIVER_CAPABILITY_UNAVAILABLE", { capability: "launchHarVideo", message: "External CDP attachment cannot add launch-time HAR or video recording." });
    }
    if (context.pages().length === 0) await context.newPage();
    const route = resolved?.identity.publicIp
      ? routeFromIdentity(proxy, resolved.identity, resolved.summary)
      : await verifyRoute(context, proxy, probeUrl);
    emitRun("ROUTE_VERIFIED", { kind: route.kind, verification: route.verification });
    emitRun("PROFILE_COHERENCE_APPLIED", { status: coherence.status, country: coherence.country, city: coherence.city, locale: coherence.locale, timezoneId: coherence.timezoneId, geolocationApplied: coherence.geolocationApplied, webRtcPolicy: coherence.webRtcPolicy, source: coherence.source, message: coherence.message });
    // Do not leave the visible browser on an unused blank tab while the target
    // monitor performs its first check. This is a normal storefront warm-up,
    // not an artificial delay or stealth behavior.
    if (recording?.assisted) await warmStorefront(context).catch(() => undefined);
    send({ type: "READY", version: IPC_VERSION, profileId: id, route, coherence, driver: driverSession.metadata });
  } catch (error) {
    if (recording) emitRun("RECORDING_OR_LAUNCH_FAILED", { message: sanitizeText(error instanceof Error ? error.message : "unknown") });
    await driverSession?.stop().catch(() => undefined); driverSession = undefined;
    const classified = classifyLaunchError(error); send({ type: "ERROR", version: IPC_VERSION, profileId: id, code: classified.code, message: classified.message });
    setTimeout(() => process.exit(1), 25).unref();
  }
}

async function beginRecording(activeContext: BrowserContext, value: RunnerRecording): Promise<void> {
  await mkdir(value.artifactDir, { recursive: true });
  emitRun("RECORDING_STARTED", { diagnosticLevel: value.diagnosticLevel });
  activeContext.on("page", (page) => observePage(page));
  activeContext.on("request", (request) => { requestCount += 1; const body = request.postDataBuffer(); if (body) trafficSentBytes += body.length; });
  activeContext.on("requestfailed", (request) => emitRun("NETWORK_FAILED", sanitizeRequest(request.url(), request.method(), request.resourceType(), request.failure()?.errorText ?? "NETWORK_FAILED")));
  activeContext.on("response", (response) => {
    const status = response.status(); if (status === 403) forbiddenCount += 1; if (status === 429) rateLimitedCount += 1; if (status >= 400) emitRun("HTTP_STATUS", { ...sanitizeRequest(response.url(), response.request().method(), response.request().resourceType()), status });
    if (trafficCdpAttached === 0) { const length = Number(response.headers()["content-length"]); if (Number.isFinite(length) && length >= 0) { trafficReceivedBytes += length; trafficFallbackSeen = true; } }
  });
  for (const page of activeContext.pages()) observePage(page);
  if (value.diagnosticLevel !== "NORMAL") {
    await activeContext.tracing.start({ screenshots: true, snapshots: true, sources: true, title: value.runId });
  }
  if (value.diagnosticLevel === "DEEP_DEBUG" && !value.assisted && driverMetadata?.capabilities.launchHarVideo) {
    emitArtifact("HAR", "network.har", true);
    emitArtifact("VIDEO", "video", true);
  }
  await screenshot("initial.png", false);
}

function observePage(page: Page): void {
  if (observedPages.has(page)) return; observedPages.add(page); void attachTrafficSession(page);
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) { navigationCount += 1; emitRun("NAVIGATION", sanitizeRequest(frame.url(), "GET", "document")); void page.evaluate(() => performance.getEntriesByType("navigation").at(-1)?.duration ?? null).then((value) => { if (typeof value === "number" && value >= 0) pageLoads.push(value); }).catch(() => undefined); } void inspectPaymentHandoff(page, frame.url()); });
  page.on("domcontentloaded", () => void inspectPaymentHandoff(page, page.url()));
  page.on("pageerror", (error) => { emitRun("PAGE_ERROR", { message: sanitizeText(error.message) }); void screenshot(`error-${Date.now()}.png`, false); });
  page.on("console", (message) => { if (recording?.diagnosticLevel !== "NORMAL") emitRun("CONSOLE", { level: message.type(), text: sanitizeText(message.text()) }); });
}

async function endRun(runSessionId: string): Promise<void> {
  if (!recording || recording.runSessionId !== runSessionId) return;
  try {
    await screenshot("final.png", false);
    if (recording.diagnosticLevel !== "NORMAL" && context && !tracingStoppedForPrivacy) {
      await context.tracing.stop({ path: join(recording.artifactDir, "trace.zip") }); emitArtifact("TRACE", "trace.zip", true);
    }
    emitRun("RECORDING_ENDED", {}); await emitHealth(); emitNetworkUsage();
  } catch (error) {
    emitRun("RECORDING_FAILED", { message: sanitizeText(error instanceof Error ? error.message : "unknown") });
  } finally {
    const id = profileId; const current = recording; recording = undefined;
    if (id && current) send({ type: "RUN_ENDED", version: IPC_VERSION, profileId: id, runSessionId: current.runSessionId });
  }
}

async function assistTarget(command: Extract<import("@copify/shared").RunnerCommand, { type: "ASSIST_TARGET" }>): Promise<void> {
  if (!context || !recording || recording.runId !== command.runId || recording.runSessionId !== command.runSessionId) return;
  if (automationBlocked()) { checkpointForCircuit(); return; }
  if (pendingAssist || assistState === "READY_TO_CONFIRM") return;
  pendingAssist = command;
  try {
    assistPage = context.pages().find((page) => !page.isClosed()) ?? await context.newPage(); await assistPage.bringToFront();
    await continueFromEmptyCart(command);
  } catch (error) {
    recordAssistFailure(error, "Assisted checkout failed.");
  }
}

async function resumeAssist(runId: string, runSessionId: string): Promise<void> {
  if (!pendingAssist || pendingAssist.runId !== runId || pendingAssist.runSessionId !== runSessionId || !assistPage) return;
  if (automationBlocked()) { checkpointForCircuit(); return; }
  try {
    if (cartResumeMode === "EMPTY_CART") { transition("PRODUCT_OPEN", "CART_RECHECK_STARTED", {}); await continueFromEmptyCart(pendingAssist); return; }
    if (cartResumeMode === "TARGET_ONLY") { transition("CARTED", "CART_RECHECK_STARTED", {}); await continueFromTargetOnlyCart(pendingAssist); return; }
    if (await checkpoint(assistPage, false)) return;
    await stopSensitiveCapture(); await fillShipping(assistPage, pendingAssist.shipping); await acceptTerms(assistPage);
    transition("READY_TO_CONFIRM", "READY_TO_CONFIRM", { message: "Checkpoint cleared. Shipping details were filled; review payment and confirm manually." }); await assistPage.bringToFront();
  } catch (error) { recordAssistFailure(error, "Could not resume assisted checkout."); }
}

async function continueFromEmptyCart(command: AssistCommand): Promise<void> {
  if (!assistPage) return;
  if (automationBlocked()) { checkpointForCircuit(); return; }
  const cart = await inspectCart(assistPage, command.candidate.name, command.candidate.url);
  if (cart.state === "BLOCKED") { cartResumeMode = "EMPTY_CART"; return; }
  if (cart.state !== "EMPTY") { cartResumeMode = "EMPTY_CART"; await showCartForReview(assistPage, command.candidate.url); transition("CHECKPOINT", cart.state === "ITEMS" ? "CART_NOT_EMPTY" : "CART_STATE_UNKNOWN", { reason: cart.state === "ITEMS" ? "CART_NOT_EMPTY" : "CART_STATE_UNKNOWN", itemCount: cart.state === "ITEMS" ? cart.itemCount : null, message: "Copify left the existing cart unchanged. Empty the cart manually, then resume this session." }); await assistPage.bringToFront(); return; }
  cartResumeMode = undefined;
  const directCartStartedAt = Date.now();
  transition("VARIANT_SELECTED", "VARIANT_SELECTED", { color: command.variant.color, size: command.variant.size }); transition("CARTING", "DIRECT_CART_STARTED", { method: "cart/add.js" }); atcAttempts += 1;
  const direct = await directCart(assistPage, command); emitRun("DIRECT_CART_RESPONSE", { outcome: direct.outcome, responseVariantConfirmed: direct.responseVariantConfirmed });
  if (direct.outcome === "PROTECTION") { transition("CHECKPOINT", "CHECKPOINT_DETECTED", { reason: "STOREFRONT_PROTECTION", message: "The storefront rejected the cart request. Copify did not try another route or fallback." }); return; }
  if (direct.outcome === "UNAVAILABLE") throw new AssistError("VARIANT_NOT_AVAILABLE", "The selected variant is no longer available.");
  let verified = await waitForExactVisibleCart(assistPage, command.candidate.name, command.variant.id);
  if (verified.state === "EMPTY" && direct.outcome === "UNSUPPORTED") {
    emitRun("DIRECT_CART_FALLBACK", { method: "cart-permalink" }); await assistPage.goto(new URL(`/cart/${command.variant.id}:1`, command.candidate.url).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 }); verified = await inspectVisibleCart(assistPage, command.candidate.name, command.variant.id);
  }
  if (verified.state === "EMPTY" && direct.outcome === "UNSUPPORTED") { emitRun("DIRECT_CART_FALLBACK", { method: "product-ui" }); await assistPage.goto(command.candidate.url, { waitUntil: "domcontentloaded", timeout: 30_000 }); if (await checkpoint(assistPage)) return; await selectVariant(assistPage, command.variant); if (!await addToCart(assistPage)) throw new AssistError("ATC_FAILED", "The storefront did not confirm that the item was added to cart."); verified = await waitForExactVisibleCart(assistPage, command.candidate.name, command.variant.id); }
  if (verified.state !== "ITEMS" || verified.itemCount !== 1 || !verified.hasVariant) throw new AssistError("ATC_FAILED", "Copify could not verify the exact selected variant in the cart.");
  if (verified.currency && verified.currency !== command.priceConstraint.currency) throw new AssistError("ATC_FAILED", "The cart currency changed after detection.");
  if (verified.priceMinor !== null && verified.priceMinor > command.priceConstraint.maxRetailMinor) { transition("CHECKPOINT", "PRICE_LIMIT_EXCEEDED", { reason: "PRICE_LIMIT_EXCEEDED", detectedPriceMinor: verified.priceMinor, maximumPriceMinor: command.priceConstraint.maxRetailMinor }); return; }
  emitRun("DIRECT_CART_VERIFIED", { method: direct.outcome === "ADDED" ? "cart/add.js" : "fallback", responseVariantConfirmed: direct.responseVariantConfirmed, elapsedMs: Date.now() - directCartStartedAt });
  transition("CARTED", "CART_CONFIRMED", { requestedQuantity: command.quantity, actualQuantity: 1 });
  if (command.quantity > 1) emitRun("QUANTITY_FALLBACK", { requestedQuantity: command.quantity, actualQuantity: 1 });
  await continueFromTargetOnlyCart(command);
}

async function continueFromTargetOnlyCart(command: AssistCommand): Promise<void> {
  if (!assistPage) return;
  if (automationBlocked()) { checkpointForCircuit(); return; }
  const cart = await inspectVisibleCart(assistPage, command.candidate.name, command.variant.id);
  if (cart.state === "BLOCKED") { cartResumeMode = "TARGET_ONLY"; return; }
  if (cart.state !== "ITEMS" || cart.itemCount !== 1 || !cart.hasTarget) { cartResumeMode = "TARGET_ONLY"; await showCartForReview(assistPage, command.candidate.url); transition("CHECKPOINT", "CART_CONTENT_CHANGED", { reason: "CART_CONTENT_CHANGED", itemCount: cart.state === "ITEMS" ? cart.itemCount : null, message: "Copify will not continue until the cart contains exactly the detected target. Review the cart manually, then resume." }); await assistPage.bringToFront(); return; }
  cartResumeMode = undefined;
  transition("CHECKOUT", "CHECKOUT_NAVIGATION_STARTED", {});
  await goToCheckout(assistPage, command.candidate.url);
  if (await checkpoint(assistPage)) return;
  await stopSensitiveCapture(); await fillShipping(assistPage, command.shipping); await acceptTerms(assistPage);
  if (await checkpoint(assistPage)) return;
  transition("READY_TO_CONFIRM", "READY_TO_CONFIRM", { message: "Shipping details were filled. Review payment and confirm manually." }); await assistPage.bringToFront();
}

async function inspectCart(page: Page, targetName: string, productUrl: string, variantId?: string): Promise<CartInspection> {
  try {
    // Supreme currently redirects a browser navigation to /cart to /pages/shop
    // when the cart is empty. Read Shopify's public cart state through this
    // browser context instead, which preserves its cookies without taking the
    // assisted tab away from its current step.
    const response = await page.context().request.get(new URL("/cart.js", productUrl).toString(), { timeout: 30_000 });
    if (!response.ok()) return { state: "UNKNOWN" };
    return parseShopifyCart(await response.json(), targetName, variantId) ?? { state: "UNKNOWN" };
  } catch {
    return { state: "UNKNOWN" };
  }
}

async function attachTrafficSession(page: Page): Promise<void> {
  if (!context) return;
  try {
    const session = await context.newCDPSession(page); await session.send("Network.enable"); trafficSessions.push(session); trafficCdpAttached += 1;
    session.on("Network.dataReceived", (event: { encodedDataLength?: number; dataLength?: number }) => { const bytes = event.encodedDataLength ?? event.dataLength ?? 0; if (Number.isFinite(bytes) && bytes > 0) trafficReceivedBytes += bytes; });
  } catch { trafficFallbackSeen = true; }
}

async function warmStorefront(activeContext: BrowserContext): Promise<void> {
  const page = activeContext.pages().find((item) => !item.isClosed()) ?? await activeContext.newPage();
  await page.goto("https://eu.supreme.com/pages/shop", { waitUntil: "domcontentloaded", timeout: 15_000 });
}

async function inspectVisibleCart(page: Page, targetName: string, variantId?: string): Promise<CartInspection> {
  try {
    // Keep this request in the page itself. Shopify can associate cart changes
    // with browser-only session state that is not immediately reflected in the
    // separate Playwright request context.
    const response = await page.evaluate(async () => {
      const value = await fetch("/cart.js", { credentials: "same-origin", headers: { Accept: "application/json" } });
      return { ok: value.ok, body: await value.text() };
    });
    if (!response.ok) return { state: "UNKNOWN" };
    return parseShopifyCart(JSON.parse(response.body), targetName, variantId) ?? { state: "UNKNOWN" };
  } catch {
    return { state: "UNKNOWN" };
  }
}

export async function waitForExactVisibleCart(page: Page, targetName: string, variantId: string, timeoutMs = 3_000): Promise<CartInspection> {
  const deadline = Date.now() + timeoutMs; let latest: CartInspection = { state: "UNKNOWN" };
  do {
    latest = await inspectVisibleCart(page, targetName, variantId);
    if (latest.state === "ITEMS") return latest;
    if (Date.now() >= deadline) return latest;
    await page.waitForTimeout(250);
  } while (true);
}

async function showCartForReview(page: Page, productUrl: string): Promise<void> {
  try {
    await page.goto(new URL("/cart", productUrl).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch {
    // A storefront outage should still leave the user at a meaningful page,
    // never at the blank page that the runner creates for its assisted flow.
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  }
}

export function parseShopifyCart(value: unknown, targetName: string, expectedVariantId?: string): CartInspection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const cart = value as Record<string, unknown>; const itemCount = cart.item_count;
  if (!Number.isInteger(itemCount) || typeof itemCount !== "number" || itemCount < 0 || !Array.isArray(cart.items)) return null;
  if (itemCount === 0) return { state: "EMPTY" };
  const target = normalizeVariantValue(targetName);
  const hasTarget = cart.items.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const product = item as Record<string, unknown>;
    return [product.product_title, product.title, product.handle, product.url].some((candidate) => typeof candidate === "string" && normalizeVariantValue(candidate).includes(target));
  });
  const expected = expectedVariantId ?? ""; const selected = cart.items.find((item) => item && typeof item === "object" && !Array.isArray(item) && String((item as Record<string, unknown>).variant_id ?? (item as Record<string, unknown>).id ?? "") === expected) as Record<string, unknown> | undefined;
  const currency = typeof cart.currency === "string" ? cart.currency : null; const price = selected?.final_line_price ?? selected?.line_price ?? selected?.final_price ?? selected?.price;
  return { state: "ITEMS", itemCount, hasTarget, hasVariant: expected ? Boolean(selected) : hasTarget, currency, priceMinor: typeof price === "number" && Number.isSafeInteger(price) && price >= 0 ? price : null };
}

type DirectCartOutcome = "ADDED" | "UNSUPPORTED" | "UNAVAILABLE" | "PROTECTION" | "UNCERTAIN";
type DirectCartAttempt = { outcome: DirectCartOutcome; responseVariantConfirmed: boolean };
async function directCart(page: Page, command: AssistCommand): Promise<DirectCartAttempt> {
  return submitDirectCartAttempt(page, command.variant.id);
}
export function parseShopifyAddResponse(value: unknown, variantId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>; const items = Array.isArray(record.items) ? record.items : [record];
  return items.some((item) => item && typeof item === "object" && !Array.isArray(item) && String((item as Record<string, unknown>).variant_id ?? (item as Record<string, unknown>).id ?? "") === variantId);
}
async function submitDirectCartAttempt(page: Page, variantId: string): Promise<DirectCartAttempt> {
  try {
    const result = await page.evaluate(async ({ id }) => { try { const response = await fetch("/cart/add.js", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ items: [{ id, quantity: 1 }] }) }); return { status: response.status, body: await response.text() }; } catch { return { status: 0, body: "" }; } }, { id: variantId });
    let parsed: unknown = null; try { parsed = JSON.parse(result.body); } catch { /* A status can still be classified without retaining an unexpected response body. */ }
    const responseVariantConfirmed = parseShopifyAddResponse(parsed, variantId);
    if (result.status === 403 || result.status === 429) return { outcome: "PROTECTION", responseVariantConfirmed }; if (result.status === 404 || result.status === 405) return { outcome: "UNSUPPORTED", responseVariantConfirmed }; if (result.status === 422) return { outcome: "UNAVAILABLE", responseVariantConfirmed }; if (result.status >= 200 && result.status < 300) return { outcome: "ADDED", responseVariantConfirmed }; return { outcome: "UNCERTAIN", responseVariantConfirmed };
  } catch { return { outcome: "UNCERTAIN", responseVariantConfirmed: false }; }
}
export async function submitDirectCart(page: Page, variantId: string): Promise<DirectCartOutcome> {
  return (await submitDirectCartAttempt(page, variantId)).outcome;
}

async function checkCart(id: string): Promise<void> {
  if (!context) return;
  const page = await context.newPage();
  try {
    const cart = await inspectBrowserCartDocument(page, "", "https://eu.supreme.com/");
    const status = cart.state === "EMPTY" ? { status: "EMPTY" as const, itemCount: 0, checkedAt: Date.now(), message: null } : cart.state === "ITEMS" ? { status: "ITEMS" as const, itemCount: cart.itemCount, checkedAt: Date.now(), message: null } : { status: "UNKNOWN" as const, itemCount: null, checkedAt: Date.now(), message: cart.state === "BLOCKED" ? "A storefront checkpoint prevented cart verification." : "The cart could not be safely verified." };
    send({ type: "CART_STATUS", version: IPC_VERSION, profileId: id, status });
  } catch (error) { send({ type: "CART_STATUS", version: IPC_VERSION, profileId: id, status: { status: "ERROR", itemCount: null, checkedAt: Date.now(), message: sanitizeText(error instanceof Error ? error.message : "Cart check failed.") } }); }
  finally { await page.close().catch(() => undefined); }
}

async function emptyCart(id: string): Promise<void> {
  if (!context) return;
  const page = await context.newPage();
  try {
    const initial = await inspectBrowserCartDocument(page, "", "https://eu.supreme.com/");
    if (initial.state === "BLOCKED") throw new AssistError("CHECKPOINT_DETECTED", "A storefront checkpoint prevented cart removal.");
    if (initial.state === "UNKNOWN") throw new AssistError("STORE_UNAVAILABLE", "The cart could not be safely verified before removal.");
    if (initial.state === "EMPTY") { send({ type: "CART_STATUS", version: IPC_VERSION, profileId: id, status: { status: "EMPTY", itemCount: 0, checkedAt: Date.now(), message: "Cart is already empty." } }); return; }
    // This action is explicitly confirmed by the user. The temporary tab is
    // already on /cart.js, so clearing from it uses the exact same browser
    // cookies without racing Supreme's empty-/cart redirect to /pages/shop.
    const cleared = await page.evaluate(async () => {
      const response = await fetch("/cart/clear.js", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
      return { ok: response.ok, status: response.status };
    });
    if (!cleared.ok) throw new AssistError("STORE_UNAVAILABLE", `The storefront refused to clear the cart (${cleared.status}).`);
    let cart: CartInspection = { state: "UNKNOWN" };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      cart = await inspectBrowserCartDocument(page, "", "https://eu.supreme.com/");
      if (cart.state === "EMPTY") break;
      await page.waitForTimeout(300);
    }
    if (cart.state !== "EMPTY") {
      const message = cart.state === "ITEMS"
        ? `The storefront still reports ${cart.itemCount ?? "some"} cart item${cart.itemCount === 1 ? "" : "s"} after removal.`
        : "Copify could not verify the cart after removal.";
      throw new AssistError("STORE_UNAVAILABLE", message);
    }
    send({ type: "CART_STATUS", version: IPC_VERSION, profileId: id, status: { status: "EMPTY", itemCount: 0, checkedAt: Date.now(), message: "Cart emptied." } });
  } catch (error) { send({ type: "CART_STATUS", version: IPC_VERSION, profileId: id, status: { status: "ERROR", itemCount: null, checkedAt: Date.now(), message: sanitizeText(error instanceof Error ? error.message : "Cart removal failed.") } }); }
  finally { await page.close().catch(() => undefined); }
}

async function openWarmDestination(url: string): Promise<void> {
  if (!context) return;
  // Electron main resolves this from an immutable store manifest or one of the
  // two built-in destinations. The runner still enforces HTTPS and rejects URL
  // credentials at its process boundary.
  const parsed = new URL(url); const allowed = parsed.protocol === "https:" && !parsed.username && !parsed.password;
  if (!allowed) return;
  const page = await context.newPage(); await page.goto(parsed.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined); await page.bringToFront();
}

export async function inspectBrowserCartDocument(page: Page, targetName: string, productUrl: string, variantId?: string): Promise<CartInspection> {
  try {
    // A real tab navigation shares the browser profile's precise cookie and
    // network partition. APIRequestContext can disagree with the visible cart
    // on partitioned storefront sessions, which previously produced stale
    // item counts in the Browsers page.
    const response = await page.goto(new URL("/cart.js", productUrl).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response) return { state: "UNKNOWN" };
    if (response.status() === 403 || response.status() === 429) return { state: "BLOCKED" };
    if (!response.ok()) return { state: "UNKNOWN" };
    return parseShopifyCart(JSON.parse(await response.text()), targetName, variantId) ?? { state: "UNKNOWN" };
  } catch {
    return { state: "UNKNOWN" };
  }
}

function recordAssistFailure(error: unknown, fallback: string): void { checkoutFailures += 1; const failure = error instanceof AssistError ? error : new AssistError("UNKNOWN", sanitizeText(error instanceof Error ? error.message : fallback)); transition("FAILED", "ASSIST_FAILED", { code: failure.code, message: failure.message }); }

async function selectVariant(page: Page, variant: ProductVariant): Promise<void> {
  const selectByLabel = async (label: RegExp, value: string): Promise<boolean> => {
    const deadline = Date.now() + 7_500;
    while (Date.now() < deadline) {
      const candidates = [page.getByLabel(label).first(), page.locator("select").filter({ has: page.locator("option", { hasText: value }) }).first()];
      for (const selector of candidates) {
        if (!await selector.count()) continue;
        const option = await selector.locator("option").evaluateAll((options, wanted) => options.map((item) => ({ value: (item as HTMLOptionElement).value, text: item.textContent?.trim() ?? "", disabled: (item as HTMLOptionElement).disabled })).find((item) => !item.disabled && (item.value.trim().toLocaleLowerCase() === wanted.toLocaleLowerCase() || item.text.trim().toLocaleLowerCase() === wanted.toLocaleLowerCase())), value).catch(() => undefined);
        if (!option) continue;
        try { await humanInputFor(page).selectOption(selector, [option.value]); return true; } catch { /* Supreme can replace its option element after a color selection; retry the current page. */ }
      }
      await page.waitForTimeout(100);
    }
    return false;
  };
  const selectColorThumbnail = async (color: string): Promise<boolean> => {
    try {
      const buttons = page.locator("button[title]"); const deadline = Date.now() + 7_500;
      while (Date.now() < deadline) {
        const count = await buttons.count();
        for (let index = 0; index < count; index += 1) {
          const button = buttons.nth(index); const title = await button.getAttribute("title");
          if (!title || !isColorThumbnailTitle(title, color) || await button.isDisabled()) continue;
          await humanInputFor(page).click(button);
          return true;
        }
        await page.waitForTimeout(100);
      }
      return false;
    } catch { return false; }
  };
  if (variant.color !== "Default" && !await selectColorThumbnail(variant.color) && !await selectByLabel(/color/i, variant.color)) throw new AssistError("VARIANT_NOT_AVAILABLE", `The configured color “${variant.color}” was not available.`);
  if (variant.size !== "Default" && !await selectByLabel(/size/i, variant.size)) throw new AssistError("VARIANT_NOT_AVAILABLE", `The configured size “${variant.size}” was not available.`);
}

export function isColorThumbnailTitle(title: string, color: string): boolean {
  const match = title.match(/^view\s+.+\s+-\s+(.+?)\s+\(image\s+1\s+of\s+\d+\)$/i);
  const detectedColor = match?.[1];
  if (!detectedColor) return false;
  return normalizeVariantValue(detectedColor) === normalizeVariantValue(color);
}
function normalizeVariantValue(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " "); }

export function withChromeTranslationDisabled(value: Record<string, unknown>): Record<string, unknown> {
  const translate = typeof value.translate === "object" && value.translate !== null && !Array.isArray(value.translate) ? value.translate as Record<string, unknown> : {};
  return { ...value, translate: { ...translate, enabled: false } };
}

async function disableChromeTranslation(userDataDir: string): Promise<void> {
  const profileDir = join(userDataDir, "Default"); const preferencesPath = join(profileDir, "Preferences");
  try {
    const existing = JSON.parse(await readFile(preferencesPath, "utf8")) as unknown;
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) return;
    await writeFile(preferencesPath, JSON.stringify(withChromeTranslationDisabled(existing as Record<string, unknown>)), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
    await mkdir(profileDir, { recursive: true });
    await writeFile(preferencesPath, JSON.stringify(withChromeTranslationDisabled({})), "utf8");
  }
}

async function addToCart(page: Page): Promise<boolean> {
  const button = page.getByRole("button", { name: /add to cart/i }).first(); if (!await button.count()) throw new AssistError("ATC_FAILED", "The add-to-cart control was not found.");
  await humanInputFor(page).click(button);
  const miniCartCheckout = page.locator('[data-testid="mini-cart-checkout-link"]').first();
  const inCart = page.getByText(/^in cart$/i).first();
  return Boolean(await firstVisible([miniCartCheckout, inCart], 8_000));
}

function isCheckoutUrl(url: URL): boolean { return /\/(?:checkouts?|queue)(?:\/|$)|\/cart\/c\//i.test(url.pathname); }

async function submitCartCheckout(page: Page): Promise<boolean> {
  const navigation = page.waitForURL((url) => isCheckoutUrl(url), { timeout: 30_000 }).then(() => true).catch(() => false);
  const submitted = await page.evaluate(() => {
    try {
      const form = document.createElement("form"); form.method = "post"; form.action = "/cart";
      const checkout = document.createElement("input"); checkout.type = "hidden"; checkout.name = "checkout"; checkout.value = "Checkout";
      form.append(checkout); document.body.append(form); form.submit(); return true;
    } catch { return false; }
  }).catch(() => false);
  return submitted && await navigation;
}

export async function goToCheckout(page: Page, productUrl: string): Promise<void> {
  // Shopify's supported theme checkout mechanism is a POST to the cart route
  // with a named checkout submit value. Supreme's shop landing page does not
  // render a visible cart control after a direct Ajax add, so use that mechanism
  // before looking for theme-specific controls.
  emitRun("CHECKOUT_FORM_SUBMITTED", { method: "cart-form" });
  if (await submitCartCheckout(page)) { emitRun("CHECKOUT_CONTROL_CLICKED", { method: "cart-form" }); await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined); return; }
  await page.goto(new URL("/cart", productUrl).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  const miniCartCheckout = page.locator('[data-testid="mini-cart-checkout-link"]').first();
  const checkoutText = page.getByText(/^checkout(?:\s+now)?$/i).first();
  const checkoutLink = page.getByRole("link", { name: /checkout/i }).first();
  const checkoutButton = page.getByRole("button", { name: /checkout/i }).first();
  let control = await firstVisible([miniCartCheckout, checkoutText, checkoutLink, checkoutButton], 8_000);
  if (!control) {
    const cart = page.getByRole("link", { name: /view\/edit cart|cart/i }).first();
    if (!await cart.count()) throw new AssistError("CHECKOUT_NAV_FAILED", "The checkout control was not found after the item was added to cart.");
    await humanInputFor(page).click(cart);
    control = await firstVisible([miniCartCheckout, checkoutText, checkoutLink, checkoutButton], 8_000);
  }
  if (!control) throw new AssistError("CHECKOUT_NAV_FAILED", "The checkout control was not ready after the item was added to cart.");
  emitRun("CHECKOUT_CONTROL_READY", {});
  await humanInputFor(page).click(control);
  emitRun("CHECKOUT_CONTROL_CLICKED", {});
  try { await page.waitForURL((url) => isCheckoutUrl(url), { timeout: 30_000 }); }
  catch { throw new AssistError("CHECKOUT_NAV_FAILED", "The storefront did not navigate to checkout after the checkout control was selected."); }
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
}

async function firstVisible(candidates: Locator[], timeout: number): Promise<Locator | undefined> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const candidate of candidates) if (await candidate.isVisible().catch(() => false)) return candidate;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}

async function checkpoint(page: Page, emit = true): Promise<boolean> {
  const text = (await page.locator("body").innerText().catch(() => "")).slice(0, 20_000).toLowerCase();
  const reason = /captcha|recaptcha|hcaptcha/.test(text) ? "CAPTCHA" : /queue|waiting room|security check|verify you are human/.test(text) ? "SECURITY_OR_QUEUE" : null;
  if (!reason) return false;
  challengeCount += 1;
  if (emit) transition("CHECKPOINT", "CHECKPOINT_DETECTED", { reason }); await page.bringToFront(); return true;
}

async function stopSensitiveCapture(): Promise<void> {
  if (tracingStoppedForPrivacy || !recording || !context) return; tracingStoppedForPrivacy = true;
  if (recording.diagnosticLevel !== "NORMAL") await context.tracing.stop().catch(() => undefined);
  emitRun("SENSITIVE_CAPTURE_STOPPED", { message: "Tracing and automatic screenshots stopped before shipping autofill." });
}

export async function fillShipping(page: Page, shipping: RunnerShipping): Promise<void> {
  await selectShippingCountry(page, shipping.country);
  await selectShippingRegion(page, shipping.region);
  const fill = async (label: string, value: string, labels: RegExp, names: string[], autocomplete: string[], required = true): Promise<boolean> => {
    // Shopify may prefix standard autocomplete tokens with a section name, such
    // as `shipping address-line1`. Prefer those machine-readable tokens over
    // visible labels: checkout layouts can place wording such as "delivery
    // address" next to the City field and make a broad label lookup ambiguous.
    const candidates: Locator[] = [];
    for (const hint of autocomplete) candidates.push(page.locator(`input[autocomplete~="${hint}" i], textarea[autocomplete~="${hint}" i]`).first());
    for (const name of names) candidates.push(page.locator(`input[name*="${name}" i], textarea[name*="${name}" i]`).first());
    candidates.push(page.getByLabel(labels).first());
    for (const field of candidates) {
      try {
        if (!await field.count() || !await field.isVisible()) continue;
        const tag = await field.evaluate((element) => element.tagName.toLocaleLowerCase());
        if (tag !== "input" && tag !== "textarea") continue;
        const current = await field.inputValue().catch(() => "");
        if (checkoutValuesEquivalent(label, current, value)) { emitRun("SHIPPING_FIELD_REUSED", { field: label }); return true; }
        try {
          if (/address/i.test(label) || /[^\x20-\x7e]/.test(value)) await humanInputFor(page).paste(field, value);
          else await humanInputFor(page).type(field, value);
        } catch (error) {
          // Shopify formats some inputs (notably telephone numbers) while they
          // are typed. HumanInput's exact-string verification can reject that
          // formatting even though the checkout retained the correct value.
          const retained = await field.inputValue().catch(() => "");
          if (!checkoutValuesEquivalent(label, retained, value)) throw error;
        }
        return true;
      } catch { /* A country/region update can replace a field; try the next semantic match. */ }
    }
    if (required) throw new AssistError("CHECKOUT_NAV_FAILED", `The required checkout field ${label} was not found.`);
    return false;
  };
  const name = splitShippingName(shipping.fullName);
  const firstName = await fill("first name", name.firstName, /first.?name/i, ["first_name", "firstname", "given_name"], ["given-name"], false);
  const lastName = await fill("last name", name.lastName, /last.?name/i, ["last_name", "lastname", "family_name"], ["family-name"], false);
  if (!firstName && !lastName) await fill("full name", shipping.fullName, /full.?name/i, ["full_name", "fullname"], ["name"]);
  else if (!firstName || !lastName) throw new AssistError("CHECKOUT_NAV_FAILED", "The checkout did not expose both first and last name fields.");
  await fill("email", shipping.email, /email/i, ["email"], ["email"]);
  await fill("phone", shipping.phone, /phone|mobile/i, ["phone", "mobile"], ["tel"]);
  await fill("address", shipping.address1, /address(?:\s|\b).*1|street/i, ["address1", "address_1", "street"], ["address-line1"]);
  if (shipping.address2) await fill("address line 2", shipping.address2, /address(?:\s|\b).*2|apartment|unit/i, ["address2", "address_2", "apartment", "unit"], ["address-line2"], false);
  await fill("postal code", shipping.postalCode, /postal|zip/i, ["postal", "zip"], ["postal-code"]);
  await fill("city", shipping.city, /city|town/i, ["city", "town"], ["address-level2"]);
  emitRun("SHIPPING_FILLED", { country: shipping.country });
}

export function checkoutValuesEquivalent(label: string, current: string, expected: string): boolean {
  const compact = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  if (/phone|mobile/i.test(label)) {
    const present = current.replace(/\D/g, ""); const wanted = expected.replace(/\D/g, "");
    return present.length >= 7 && wanted.length >= 7 && (present === wanted || present.endsWith(wanted) || wanted.endsWith(present));
  }
  return Boolean(current.trim()) && compact(current) === compact(expected);
}

async function selectShippingCountry(page: Page, country: string): Promise<void> {
  const candidates = [page.locator('select[autocomplete~="country" i], select[name*="country" i]').first(), page.getByLabel(/country(?:\/region)?/i).first(), page.locator("select").first()]; const names = shippingCountryNames(country);
  for (const field of candidates) {
    if (!await field.count()) continue;
    const option = await field.locator("option").evaluateAll((options, values) => options.map((item) => ({ value: (item as HTMLOptionElement).value, text: item.textContent?.trim() ?? "" })).find((item) => values.some((value) => item.value.trim().toUpperCase() === value.toUpperCase() || item.text.trim().toLocaleLowerCase() === value.toLocaleLowerCase())), names).catch(() => undefined);
    if (!option) continue;
    try { await humanInputFor(page).selectOption(field, [option.value]); return; } catch { /* Try the next semantic country selector. */ }
  }
  throw new AssistError("CHECKOUT_NAV_FAILED", `The shipping country ${country} was not available at checkout.`);
}

async function selectShippingRegion(page: Page, region: string | undefined): Promise<void> {
  if (!region) return;
  const deadline = Date.now() + 7_500;
  while (Date.now() < deadline) {
    // Supreme's checkout region control is not consistently associated with a
    // label or a stable name. Include every native select and identify the
    // correct one by the region option it exposes.
    const selects = page.locator("select");
    const candidates = [page.locator('select[name*="region" i], select[name*="state" i], select[name*="province" i]').first(), page.getByLabel(/^(?:region|state|province)/i).first(), ...Array.from({ length: await selects.count() }, (_, index) => selects.nth(index))];
    for (const field of candidates) {
      if (!await field.count()) continue;
      const option = await field.locator("option").evaluateAll((options, value) => options.map((item) => ({ value: (item as HTMLOptionElement).value, text: item.textContent?.trim() ?? "" })).find((item) => item.value.trim().toLocaleLowerCase() === value.toLocaleLowerCase() || item.text.trim().toLocaleLowerCase() === value.toLocaleLowerCase()), region).catch(() => undefined);
      if (!option) continue;
      try { await humanInputFor(page).selectOption(field, [option.value]); return; } catch { /* The checkout can replace this selector after a country change. */ }
    }
    await page.waitForTimeout(100);
  }
  throw new AssistError("CHECKOUT_NAV_FAILED", `The shipping region ${region} was not available at checkout.`);
}

async function acceptTerms(page: Page): Promise<void> {
  const boxes = page.locator('input[type="checkbox"]');
  const semantic = page.getByRole("checkbox", { name: /terms|conditions|return policy/i }).first();
  const candidates: Locator[] = [];
  if (await semantic.count()) candidates.push(semantic);
  for (let index = 0; index < await boxes.count(); index += 1) {
    const box = boxes.nth(index); const text = await box.evaluate((input) => {
      const checkbox = input as HTMLInputElement; let ancestor: Element | null = checkbox; let surrounding = "";
      for (let depth = 0; ancestor && depth < 5; depth += 1, ancestor = ancestor.parentElement) surrounding += ` ${ancestor.textContent ?? ""}`;
      const linked = checkbox.id ? document.querySelector(`label[for="${CSS.escape(checkbox.id)}"]`)?.textContent ?? "" : "";
      return `${[...(checkbox.labels ?? [])].map((label) => label.textContent ?? "").join(" ")} ${linked} ${surrounding}`;
    }).catch(() => "");
    if (/terms|conditions|return policy/i.test(text)) candidates.push(box);
  }
  for (const box of candidates) {
    if (!await box.isVisible().catch(() => false)) continue;
    if (!await box.isChecked()) await humanInputFor(page).check(box);
    if (!await box.isChecked()) continue;
    emitRun("TERMS_ACCEPTED", {});
    return;
  }
  throw new AssistError("CHECKOUT_NAV_FAILED", "The required terms and conditions acknowledgement was not found.");
}

function humanInputFor(page: Page): HumanInput {
  const existing = humanInputs.get(page); if (existing) return existing;
  const input = new HumanInput(page, { clipboard: runnerClipboard, telemetry: emitHumanInputTelemetry }); humanInputs.set(page, input); return input;
}

const runnerClipboard: ClipboardPasteClient = {
  acquire: async (value) => {
    if (!profileId || heldClipboardLeaseId) return false;
    const requestId = randomUUID();
    const granted = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (!pendingClipboardLeases.delete(requestId)) return;
        if (profileId) send({ type: "CLIPBOARD_LEASE_RELEASE", version: IPC_VERSION, profileId, requestId });
        resolve(false);
      }, 10_250); timer.unref();
      pendingClipboardLeases.set(requestId, (value) => { clearTimeout(timer); resolve(value); });
      send({ type: "CLIPBOARD_LEASE_REQUEST", version: IPC_VERSION, profileId: profileId!, requestId, value });
    });
    if (granted) heldClipboardLeaseId = requestId;
    return granted;
  },
  release: async () => {
    const requestId = heldClipboardLeaseId; heldClipboardLeaseId = undefined;
    if (requestId && profileId) send({ type: "CLIPBOARD_LEASE_RELEASE", version: IPC_VERSION, profileId, requestId });
  },
};

function resolveClipboardLease(requestId: string, granted: boolean): void {
  const resolve = pendingClipboardLeases.get(requestId);
  if (!resolve) {
    if (granted && profileId) send({ type: "CLIPBOARD_LEASE_RELEASE", version: IPC_VERSION, profileId, requestId });
    return;
  }
  pendingClipboardLeases.delete(requestId); resolve(granted);
}

function emitHumanInputTelemetry(event: HumanInputTelemetry): void {
  emitRun(event.fallback ? "HUMAN_INPUT_FALLBACK" : "HUMAN_INPUT_ACTION", {
    action: event.action,
    method: event.method,
    durationMs: Math.round(event.durationMs),
    ...(event.movementMs === undefined ? {} : { movementMs: Math.round(event.movementMs) }),
    ...(event.dwellMs === undefined ? {} : { dwellMs: event.dwellMs }),
    ...(event.pointCount === undefined ? {} : { pointCount: event.pointCount }),
  });
}

export function splitShippingName(value: string): { firstName: string; lastName: string } { const parts = value.trim().split(/\s+/).filter(Boolean); return { firstName: parts[0] ?? value.trim(), lastName: parts.slice(1).join(" ") || parts[0] || value.trim() }; }
export function shippingCountryNames(country: string): string[] { const code = country.trim().toUpperCase(); const displayName = new Intl.DisplayNames(["en"], { type: "region" }).of(code); return [...new Set([code, displayName].filter((value): value is string => Boolean(value)))]; }

class AssistError extends Error { constructor(readonly code: string, message: string) { super(message); } }
function transition(next: string, type: string, payload: Record<string, unknown>): void { const previous = assistState; assistState = next; emitRun(type, payload, previous, next); void emitHealth(); }

async function screenshot(name: string, sensitive: boolean): Promise<void> {
  if (tracingStoppedForPrivacy) return;
  if (!recording || !context) return;
  const page = context.pages()[0]; if (!page) return;
  try { await page.screenshot({ path: join(recording.artifactDir, name), fullPage: false }); emitArtifact("SCREENSHOT", name, sensitive); } catch { /* A transient page cannot prevent recording. */ }
}

function emitRun(type: string, payload: Record<string, unknown>, stateBefore: string | null = null, stateAfter: string | null = null): void {
  if (!recording || !profileId || !startedMono) return;
  const event: RunEvent = { id: randomUUID(), runId: recording.runId, runSessionId: recording.runSessionId, wallTimeMs: Date.now(), elapsedNs: (process.hrtime.bigint() - startedMono).toString(), type, stateBefore, stateAfter, payload: sanitizePayload(payload) };
  send({ type: "RUN_EVENT", version: IPC_VERSION, profileId, event });
}

function emitArtifact(kind: RunArtifact["kind"], localPath: string, sensitive: boolean): void {
  if (!recording || !profileId) return;
  const artifact: RunArtifact = { id: randomUUID(), runId: recording.runId, runSessionId: recording.runSessionId, kind, relativePath: localPath.replace(/\\/g, "/"), sensitive, createdAt: Date.now() };
  send({ type: "RUN_ARTIFACT", version: IPC_VERSION, profileId, artifact });
}

function automationBlocked(): boolean { return automationPausedUntil !== null && Date.now() < automationPausedUntil; }
function pauseAutomation(until: number): void { automationPausedUntil = until; checkpointForCircuit(); }
function checkpointForCircuit(): void {
  if (!recording || assistState === "READY_TO_CONFIRM") return;
  transition("CHECKPOINT", "AUTOMATION_PAUSED", { reason: "STOREFRONT_PROTECTION", until: automationPausedUntil });
  void assistPage?.bringToFront();
}
async function emitHealth(): Promise<void> {
  if (!profileId || !recording || !startedMono || !context) return;
  const profileAgeMs = profileUserDataDir ? await stat(profileUserDataDir).then((value) => Math.max(0, Date.now() - value.birthtimeMs)).catch(() => null) : null;
  const cookieCount = await context.cookies().then((value) => value.length).catch(() => null);
  const minutes = Math.max(Number(process.hrtime.bigint() - startedMono) / 60_000_000_000, 1 / 60);
  send({ type: "HEALTH", version: IPC_VERSION, profileId, health: { capturedAt: Date.now(), navigatorWebdriver: await (context.pages()[0]?.evaluate(() => navigator.webdriver).catch(() => null) ?? null), browserVersion: driverMetadata?.browserVersion ?? context.browser()?.version() ?? null, driverKind: driverMetadata?.kind ?? null, stealthStatus: driverMetadata?.stealthStatus ?? null, profileAgeMs, cookieCount, requestCount, requestsPerMinute: requestCount / minutes, navigationCount, navigationsPerMinute: navigationCount / minutes, atcAttempts, forbiddenCount, rateLimitedCount, challengeCount, checkoutFailures, averagePageLoadMs: pageLoads.length ? pageLoads.reduce((sum, value) => sum + value, 0) / pageLoads.length : null, coherence: coherence ?? null, circuit: null } });
  emitNetworkUsage();
}

function emitNetworkUsage(): void {
  if (!profileId || !recording) return;
  send({ type: "NETWORK_USAGE", version: IPC_VERSION, profileId, runId: recording.runId, runSessionId: recording.runSessionId, usage: { receivedBytes: trafficReceivedBytes, sentBytes: trafficSentBytes, requestCount, completeness: trafficCdpAttached > 0 || trafficFallbackSeen ? "PARTIAL" : "UNSUPPORTED" } });
}

async function stop(): Promise<void> {
  stopping = true; const id = profileId;
  try {
    await runnerClipboard.release();
    for (const resolve of pendingClipboardLeases.values()) resolve(false); pendingClipboardLeases.clear();
    paymentHandoffLatch?.stop(); if (recording) await endRun(recording.runSessionId); for (const session of trafficSessions) await session.detach().catch(() => undefined); trafficSessions = []; await driverSession?.stop();
  } finally { context = undefined; driverSession = undefined; driverMetadata = undefined; coherence = undefined; if (id) send({ type: "STOPPED", version: IPC_VERSION, profileId: id }); process.exit(0); }
}

export function paymentHandoffSignal(url: string, bodyText = ""): boolean {
  let safeUrl = ""; try { const parsed = new URL(url); safeUrl = `${parsed.hostname}${parsed.pathname}`.toLowerCase(); } catch { safeUrl = url.toLowerCase(); }
  return /(?:^|[./_-])(3ds2?|three.?d.?secure|acs|cardinalcommerce|secure.?auth(?:entication)?)(?:[./_-]|$)/i.test(safeUrl) || /3d secure|strong customer authentication|authenticate (?:this|your) payment|verify (?:this|your) payment|approve (?:it|the payment) in your (?:bank|banking) app/i.test(bodyText);
}

export class PaymentHandoffLatch {
  private active = false;
  private returnTimer: NodeJS.Timeout | undefined;
  constructor(private readonly returnDelayMs = 1_500) {}
  observe(detected: boolean, onDetected: () => void, onReturned: () => void): void {
    if (detected) {
      if (this.returnTimer) clearTimeout(this.returnTimer); this.returnTimer = undefined;
      if (this.active) return;
      this.active = true; onDetected(); return;
    }
    if (!this.active || this.returnTimer) return;
    this.returnTimer = setTimeout(() => { this.returnTimer = undefined; if (!this.active) return; this.active = false; onReturned(); }, this.returnDelayMs);
    this.returnTimer.unref?.();
  }
  stop(): void { if (this.returnTimer) clearTimeout(this.returnTimer); this.returnTimer = undefined; this.active = false; }
}

async function inspectPaymentHandoff(page: Page, navigatedUrl: string): Promise<void> {
  if (!recording || !profileId || !["READY_TO_CONFIRM", "CHECKOUT_HANDOFF"].includes(assistState)) return;
  const text = await page.locator("body").innerText().then((value) => value.slice(0, 12_000)).catch(() => "");
  const detected = paymentHandoffSignal(navigatedUrl, text) || page.frames().some((frame) => paymentHandoffSignal(frame.url()));
  paymentHandoffLatch?.observe(detected, () => {
    if (!recording || !profileId) return;
    transition("CHECKOUT_HANDOFF", "PAYMENT_HANDOFF_DETECTED", { category: "PSD2_3DS" });
    send({ type: "PAYMENT_HANDOFF", version: IPC_VERSION, profileId, runId: recording.runId, runSessionId: recording.runSessionId, phase: "DETECTED", category: "PSD2_3DS" });
    void page.bringToFront().catch(() => undefined);
  }, () => {
    if (!recording || !profileId) return;
    transition("READY_TO_CONFIRM", "PAYMENT_HANDOFF_RETURNED", { category: "PSD2_3DS" });
    send({ type: "PAYMENT_HANDOFF", version: IPC_VERSION, profileId, runId: recording.runId, runSessionId: recording.runSessionId, phase: "RETURNED", category: "PSD2_3DS" });
  });
}

function sanitizeRequest(url: string, method: string, resourceType: string, error?: string): Record<string, unknown> {
  try {
    const parsed = new URL(url); const firstSegment = parsed.pathname.split("/").filter(Boolean)[0] ?? "root";
    const pathClass = /checkout|cart|account|login/i.test(firstSegment) ? firstSegment.toLowerCase() : /api/i.test(firstSegment) ? "api" : resourceType === "document" ? "document" : "asset";
    return { method, host: parsed.host, pathClass, resourceType, ...(error ? { error: sanitizeText(error) } : {}) };
  } catch { return { method, host: "invalid-url", pathClass: "unknown", resourceType, ...(error ? { error: sanitizeText(error) } : {}) }; }
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, typeof value === "string" ? sanitizeText(value) : value])); }
export function sanitizeText(value: string): string { return value.replace(/(authorization|cookie|set-cookie|password|token|secret|proxy[-_ ]?authorization)\s*[:=]\s*(?:bearer\s+)?[^\s;,&]+/gi, "$1=[REDACTED]").replace(/([?&](?:token|code|key|password|secret|session)=[^&\s]+)/gi, "[REDACTED_QUERY]").slice(0, 2_000); }
function send(event: RunnerEvent): void { process.send?.(event); }
function classifyLaunchError(error: unknown): { code: Extract<RunnerEvent, { type: "ERROR" }>["code"]; message: string } {
  if (error instanceof BrowserDriverError) return { code: error.code, message: error.message };
  const message = error instanceof Error ? error.message : "";
  if (/407|proxy auth/i.test(message)) return { code: "PROXY_AUTH_FAILED", message: "Chrome could not authenticate with the configured proxy." };
  if (/ERR_PROXY|ERR_TUNNEL|proxy/i.test(message)) return { code: "PROXY_CONNECTION_FAILED", message: "Chrome could not connect through the configured proxy." };
  return { code: "BROWSER_START_FAILED", message: "Chrome could not be started." };
}
