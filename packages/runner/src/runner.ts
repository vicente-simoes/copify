import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { IPC_VERSION, runnerCommandSchema, type BrowserLaunchMode, type ProductVariant, type RunnerEvent, type RunnerProxy, type RunnerRecording, type RunArtifact, type RunEvent, type RunnerShipping } from "@copify/shared";
import { findChromeExecutable, toPlaywrightProxy, verifyRoute } from "./network";

let context: BrowserContext | undefined;
let profileId: string | undefined;
let stopping = false;
let recording: RunnerRecording | undefined;
let startedMono: bigint | undefined;
let assistPage: Page | undefined;
let assistState = "OBSERVING";
type AssistCommand = Extract<import("@copify/shared").RunnerCommand, { type: "ASSIST_TARGET" }>;
type CartInspection = { state: "EMPTY" } | { state: "ITEMS"; itemCount: number | null; hasTarget: boolean } | { state: "UNKNOWN" } | { state: "BLOCKED" };
let pendingAssist: AssistCommand | undefined;
let cartResumeMode: "EMPTY_CART" | "TARGET_ONLY" | undefined;
let tracingStoppedForPrivacy = false;
let nativeChrome: ChildProcess | undefined;
let cdpBrowser: Browser | undefined;

process.on("message", async (message: unknown) => {
  const command = runnerCommandSchema.safeParse(message); if (!command.success) return;
  if (command.data.type === "START") await start(command.data.profileId, command.data.userDataDir, command.data.launchMode, command.data.proxy, command.data.probeUrl, command.data.recording);
  if (command.data.type === "END_RUN") await endRun(command.data.runSessionId);
  if (command.data.type === "ASSIST_TARGET") await assistTarget(command.data);
  if (command.data.type === "RESUME_ASSIST") await resumeAssist(command.data.runId, command.data.runSessionId);
  if (command.data.type === "CHECK_CART") await checkCart(command.data.profileId);
  if (command.data.type === "EMPTY_CART") await emptyCart(command.data.profileId);
  if (command.data.type === "STOP") await stop();
});

async function start(id: string, userDataDir: string, launchMode: BrowserLaunchMode, proxy: RunnerProxy | null, probeUrl: string, runRecording: RunnerRecording | null): Promise<void> {
  if (context) return; profileId = id; recording = runRecording ?? undefined; startedMono = process.hrtime.bigint(); assistPage = undefined; pendingAssist = undefined; cartResumeMode = undefined; assistState = "OBSERVING"; tracingStoppedForPrivacy = false;
  try {
    await disableChromeTranslation(userDataDir);
    const options: Parameters<typeof chromium.launchPersistentContext>[1] = { headless: false, executablePath: findChromeExecutable(), args: ["--no-first-run", "--no-default-browser-check", "--hide-crash-restore-bubble", "--disable-features=Translate"], ignoreDefaultArgs: ["--no-sandbox"], proxy: proxy ? toPlaywrightProxy(proxy) : undefined };
    if (recording?.diagnosticLevel === "DEEP_DEBUG" && !recording.assisted) {
      await mkdir(recording.artifactDir, { recursive: true });
      options.recordHar = { path: join(recording.artifactDir, "network.har"), mode: "minimal", content: "omit" };
      options.recordVideo = { dir: join(recording.artifactDir, "video") };
    }
    context = launchMode === "NATIVE_CDP" ? await launchNativeContext(userDataDir, proxy) : await chromium.launchPersistentContext(userDataDir, options);
    context.on("close", () => {
      context = undefined;
      if (!stopping) {
        send({ type: "ERROR", version: IPC_VERSION, profileId: id, code: "RUN_INTERRUPTED", message: "The Chrome browser context was closed before the session finished." });
        setTimeout(() => process.exit(0), 25).unref();
      }
    });
    if (recording) await beginRecording(context, recording);
    if (context.pages().length === 0) await context.newPage();
    const route = await verifyRoute(context, proxy, probeUrl);
    emitRun("ROUTE_VERIFIED", { kind: route.kind, verification: route.verification });
    send({ type: "READY", version: IPC_VERSION, profileId: id, route });
  } catch (error) {
    if (recording) emitRun("RECORDING_OR_LAUNCH_FAILED", { message: sanitizeText(error instanceof Error ? error.message : "unknown") });
    await cdpBrowser?.close().catch(() => undefined); cdpBrowser = undefined;
    if (nativeChrome?.exitCode === null) nativeChrome.kill(); nativeChrome = undefined;
    const classified = classifyLaunchError(error); send({ type: "ERROR", version: IPC_VERSION, profileId: id, code: classified.code, message: classified.message });
    setTimeout(() => process.exit(1), 25).unref();
  }
}

async function launchNativeContext(userDataDir: string, proxy: RunnerProxy | null): Promise<BrowserContext> {
  if (proxy?.username || proxy?.password) throw new Error("Native Chrome + CDP does not yet support authenticated proxy profiles. Use Playwright launch for this browser profile.");
  const executable = findChromeExecutable(); if (!executable) throw new Error("Google Chrome was not found.");
  await mkdir(userDataDir, { recursive: true });
  await rm(join(userDataDir, "DevToolsActivePort"), { force: true });
  const args = ["--no-first-run", "--no-default-browser-check", "--hide-crash-restore-bubble", "--disable-features=Translate", `--user-data-dir=${userDataDir}`, "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", ...(proxy ? [`--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`] : [])];
  const chrome = spawn(executable, args, { stdio: "ignore", windowsHide: true }); nativeChrome = chrome;
  const endpoint = await readDevToolsEndpoint(userDataDir, chrome); cdpBrowser = await chromium.connectOverCDP(endpoint, { timeout: 15_000 });
  const connected = cdpBrowser.contexts()[0]; if (!connected) throw new Error("Chrome did not expose a default CDP context.");
  chrome.once("exit", () => { nativeChrome = undefined; context = undefined; if (!stopping) process.exit(1); });
  return connected;
}

async function readDevToolsEndpoint(userDataDir: string, chrome: ChildProcess): Promise<string> {
  const file = join(userDataDir, "DevToolsActivePort"); const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null) throw new Error("Native Chrome exited before opening its local control endpoint. Close any remaining Copify window for this profile and try again.");
    try { const [port, path] = (await readFile(file, "utf8")).trim().split(/\r?\n/); if (/^\d+$/.test(port) && path?.startsWith("/devtools/browser/")) return `http://127.0.0.1:${port}`; } catch { /* Chrome has not written its local endpoint yet. */ }
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("Native Chrome did not open its local CDP endpoint.");
}

async function beginRecording(activeContext: BrowserContext, value: RunnerRecording): Promise<void> {
  await mkdir(value.artifactDir, { recursive: true });
  emitRun("RECORDING_STARTED", { diagnosticLevel: value.diagnosticLevel });
  activeContext.on("page", (page) => observePage(page));
  activeContext.on("requestfailed", (request) => emitRun("NETWORK_FAILED", sanitizeRequest(request.url(), request.method(), request.resourceType(), request.failure()?.errorText ?? "NETWORK_FAILED")));
  activeContext.on("response", (response) => {
    const status = response.status(); if (status >= 400) emitRun("HTTP_STATUS", { ...sanitizeRequest(response.url(), response.request().method(), response.request().resourceType()), status });
  });
  for (const page of activeContext.pages()) observePage(page);
  if (value.diagnosticLevel !== "NORMAL") {
    await activeContext.tracing.start({ screenshots: true, snapshots: true, sources: true, title: value.runId });
  }
  if (value.diagnosticLevel === "DEEP_DEBUG" && !value.assisted) {
    emitArtifact("HAR", "network.har", true);
    emitArtifact("VIDEO", "video", true);
  }
  await screenshot("initial.png", false);
}

function observePage(page: Page): void {
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) emitRun("NAVIGATION", sanitizeRequest(frame.url(), "GET", "document")); });
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
    emitRun("RECORDING_ENDED", {});
  } catch (error) {
    emitRun("RECORDING_FAILED", { message: sanitizeText(error instanceof Error ? error.message : "unknown") });
  } finally {
    const id = profileId; const current = recording; recording = undefined;
    if (id && current) send({ type: "RUN_ENDED", version: IPC_VERSION, profileId: id, runSessionId: current.runSessionId });
  }
}

async function assistTarget(command: Extract<import("@copify/shared").RunnerCommand, { type: "ASSIST_TARGET" }>): Promise<void> {
  if (!context || !recording || recording.runId !== command.runId || recording.runSessionId !== command.runSessionId) return;
  if (pendingAssist || assistState === "CHECKOUT_HANDOFF") return;
  pendingAssist = command;
  try {
    assistPage = await context.newPage(); await assistPage.bringToFront();
    await continueFromEmptyCart(command);
  } catch (error) {
    recordAssistFailure(error, "Assisted checkout failed.");
  }
}

async function resumeAssist(runId: string, runSessionId: string): Promise<void> {
  if (!pendingAssist || pendingAssist.runId !== runId || pendingAssist.runSessionId !== runSessionId || !assistPage) return;
  try {
    if (cartResumeMode === "EMPTY_CART") { transition("PRODUCT_OPEN", "CART_RECHECK_STARTED", {}); await continueFromEmptyCart(pendingAssist); return; }
    if (cartResumeMode === "TARGET_ONLY") { transition("CARTED", "CART_RECHECK_STARTED", {}); await continueFromTargetOnlyCart(pendingAssist); return; }
    if (await checkpoint(assistPage, false)) return;
    await stopSensitiveCapture(); await fillShipping(assistPage, pendingAssist.shipping); await acceptTerms(assistPage);
    transition("CHECKOUT_HANDOFF", "CHECKOUT_HANDOFF", { message: "Checkpoint cleared. Shipping details were filled; complete payment manually." }); await assistPage.bringToFront();
  } catch (error) { recordAssistFailure(error, "Could not resume assisted checkout."); }
}

async function continueFromEmptyCart(command: AssistCommand): Promise<void> {
  if (!assistPage) return;
  const cart = await inspectCart(assistPage, command.candidate.name, command.candidate.url);
  if (cart.state === "BLOCKED") { cartResumeMode = "EMPTY_CART"; return; }
  if (cart.state !== "EMPTY") { cartResumeMode = "EMPTY_CART"; transition("CHECKPOINT", cart.state === "ITEMS" ? "CART_NOT_EMPTY" : "CART_STATE_UNKNOWN", { reason: cart.state === "ITEMS" ? "CART_NOT_EMPTY" : "CART_STATE_UNKNOWN", itemCount: cart.state === "ITEMS" ? cart.itemCount : null, message: "Copify left the existing cart unchanged. Empty the cart manually, then resume this session." }); await assistPage.bringToFront(); return; }
  cartResumeMode = undefined;
  transition("PRODUCT_OPEN", "PRODUCT_NAVIGATION_STARTED", { product: command.candidate.name, variant: command.variant, quantity: command.quantity });
  await assistPage.goto(command.candidate.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (await checkpoint(assistPage)) return;
  await selectVariant(assistPage, command.variant);
  transition("VARIANT_SELECTED", "VARIANT_SELECTED", { color: command.variant.color, size: command.variant.size });
  transition("CARTING", "ADD_TO_CART_STARTED", {});
  const added = await addToCart(assistPage);
  if (!added) throw new AssistError("ATC_FAILED", "The storefront did not confirm that the item was added to cart.");
  transition("CARTED", "CART_CONFIRMED", { requestedQuantity: command.quantity, actualQuantity: 1 });
  if (command.quantity > 1) emitRun("QUANTITY_FALLBACK", { requestedQuantity: command.quantity, actualQuantity: 1 });
  await continueFromTargetOnlyCart(command);
}

async function continueFromTargetOnlyCart(command: AssistCommand): Promise<void> {
  if (!assistPage) return;
  const cart = await inspectCart(assistPage, command.candidate.name, command.candidate.url);
  if (cart.state === "BLOCKED") { cartResumeMode = "TARGET_ONLY"; return; }
  if (cart.state !== "ITEMS" || cart.itemCount !== 1 || !cart.hasTarget) { cartResumeMode = "TARGET_ONLY"; transition("CHECKPOINT", "CART_CONTENT_CHANGED", { reason: "CART_CONTENT_CHANGED", itemCount: cart.state === "ITEMS" ? cart.itemCount : null, message: "Copify will not continue until the cart contains exactly the detected target. Review the cart manually, then resume." }); await assistPage.bringToFront(); return; }
  cartResumeMode = undefined;
  transition("CHECKOUT", "CHECKOUT_NAVIGATION_STARTED", {});
  await goToCheckout(assistPage);
  if (await checkpoint(assistPage)) return;
  await stopSensitiveCapture(); await fillShipping(assistPage, command.shipping); await acceptTerms(assistPage);
  if (await checkpoint(assistPage)) return;
  transition("CHECKOUT_HANDOFF", "CHECKOUT_HANDOFF", { message: "Shipping details were filled. Complete payment and submission manually." }); await assistPage.bringToFront();
}

async function inspectCart(page: Page, targetName: string, productUrl: string): Promise<CartInspection> {
  const cartUrl = new URL("/cart", productUrl).toString(); await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (await checkpoint(page)) return { state: "BLOCKED" };
  const text = await page.locator("body").innerText().catch(() => ""); const normalized = normalizeVariantValue(text);
  if (/(?:your )?(?:cart|shopping bag) (?:is |currently )?empty|there are no items in your cart/i.test(text)) return { state: "EMPTY" };
  const quantityCount = await page.locator('input[type="number"], input[name="updates[]"], input[name*="quantity" i]').count().catch(() => 0);
  const removeCount = await page.getByRole("button", { name: /remove/i }).count().catch(() => 0);
  const count = text.match(/\b(\d+)\s+items?\s+in\s+cart\b/i)?.[1]; const itemCount = quantityCount || removeCount || (count ? Number(count) : null);
  if (itemCount !== null || /\bsubtotal\b|\bcheckout(?:\s+now)?\b|\bremove\b/i.test(text)) return { state: "ITEMS", itemCount, hasTarget: normalized.includes(normalizeVariantValue(targetName)) };
  return { state: "UNKNOWN" };
}

async function checkCart(id: string): Promise<void> {
  if (!context) return;
  const page = await context.newPage();
  try {
    const cart = await inspectCart(page, "", "https://eu.supreme.com/");
    const status = cart.state === "EMPTY" ? { status: "EMPTY" as const, itemCount: 0, checkedAt: Date.now(), message: null } : cart.state === "ITEMS" ? { status: "ITEMS" as const, itemCount: cart.itemCount, checkedAt: Date.now(), message: null } : { status: "UNKNOWN" as const, itemCount: null, checkedAt: Date.now(), message: cart.state === "BLOCKED" ? "A storefront checkpoint prevented cart verification." : "The cart could not be safely verified." };
    send({ type: "CART_STATUS", version: IPC_VERSION, profileId: id, status });
  } catch (error) { send({ type: "CART_STATUS", version: IPC_VERSION, profileId: id, status: { status: "ERROR", itemCount: null, checkedAt: Date.now(), message: sanitizeText(error instanceof Error ? error.message : "Cart check failed.") } }); }
  finally { await page.close().catch(() => undefined); }
}

async function emptyCart(id: string): Promise<void> {
  if (!context) return;
  const page = await context.newPage();
  try {
    const initial = await inspectCart(page, "", "https://eu.supreme.com/");
    if (initial.state === "BLOCKED") throw new AssistError("CHECKPOINT_DETECTED", "A storefront checkpoint prevented cart removal.");
    if (initial.state === "UNKNOWN") throw new AssistError("STORE_UNAVAILABLE", "The cart could not be safely verified before removal.");
    for (let attempts = 0; attempts < 20; attempts += 1) {
      const remove = await firstVisible([page.getByRole("button", { name: /remove/i }).first(), page.getByText(/^remove$/i).first()], 2_000);
      if (!remove) break;
      await remove.click({ timeout: 10_000 }); await page.waitForTimeout(250);
    }
    const cart = await inspectCart(page, "", "https://eu.supreme.com/");
    if (cart.state !== "EMPTY") throw new AssistError("STORE_UNAVAILABLE", "Copify could not confirm that every cart item was removed.");
    send({ type: "CART_STATUS", version: IPC_VERSION, profileId: id, status: { status: "EMPTY", itemCount: 0, checkedAt: Date.now(), message: "Cart emptied manually through Copify." } });
  } catch (error) { send({ type: "CART_STATUS", version: IPC_VERSION, profileId: id, status: { status: "ERROR", itemCount: null, checkedAt: Date.now(), message: sanitizeText(error instanceof Error ? error.message : "Cart removal failed.") } }); }
  finally { await page.close().catch(() => undefined); }
}

function recordAssistFailure(error: unknown, fallback: string): void { const failure = error instanceof AssistError ? error : new AssistError("UNKNOWN", sanitizeText(error instanceof Error ? error.message : fallback)); transition("FAILED", "ASSIST_FAILED", { code: failure.code, message: failure.message }); }

async function selectVariant(page: Page, variant: ProductVariant): Promise<void> {
  const selectByLabel = async (label: RegExp, value: string): Promise<boolean> => {
    const deadline = Date.now() + 7_500;
    while (Date.now() < deadline) {
      const candidates = [page.getByLabel(label).first(), page.locator("select").filter({ has: page.locator("option", { hasText: value }) }).first()];
      for (const selector of candidates) {
        if (!await selector.count()) continue;
        const option = await selector.locator("option").evaluateAll((options, wanted) => options.map((item) => ({ value: (item as HTMLOptionElement).value, text: item.textContent?.trim() ?? "", disabled: (item as HTMLOptionElement).disabled })).find((item) => !item.disabled && (item.value.trim().toLocaleLowerCase() === wanted.toLocaleLowerCase() || item.text.trim().toLocaleLowerCase() === wanted.toLocaleLowerCase())), value).catch(() => undefined);
        if (!option) continue;
        try { await selector.selectOption({ value: option.value }); return true; } catch { /* Supreme can replace its option element after a color selection; retry the current page. */ }
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
          await button.click({ timeout: 10_000 });
          await page.waitForTimeout(250);
          return true;
        }
        await page.waitForTimeout(100);
      }
      return false;
    } catch { return false; }
  };
  if (variant.color !== "Default" && !await selectByLabel(/color/i, variant.color) && !await selectColorThumbnail(variant.color)) throw new AssistError("VARIANT_NOT_AVAILABLE", `The configured color “${variant.color}” was not available.`);
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
  await button.click({ timeout: 15_000 });
  const miniCartCheckout = page.locator('[data-testid="mini-cart-checkout-link"]').first();
  const inCart = page.getByText(/^in cart$/i).first();
  return Boolean(await firstVisible([miniCartCheckout, inCart], 8_000));
}

async function goToCheckout(page: Page): Promise<void> {
  const miniCartCheckout = page.locator('[data-testid="mini-cart-checkout-link"]').first();
  const checkoutText = page.getByText(/^checkout(?:\s+now)?$/i).first();
  const checkoutLink = page.getByRole("link", { name: /checkout/i }).first();
  const checkoutButton = page.getByRole("button", { name: /checkout/i }).first();
  let control = await firstVisible([miniCartCheckout, checkoutText, checkoutLink, checkoutButton], 8_000);
  if (!control) {
    const cart = page.getByRole("link", { name: /view\/edit cart|cart/i }).first();
    if (!await cart.count()) throw new AssistError("CHECKOUT_NAV_FAILED", "The checkout control was not found after the item was added to cart.");
    await cart.click({ timeout: 15_000 });
    control = await firstVisible([miniCartCheckout, checkoutText, checkoutLink, checkoutButton], 8_000);
  }
  if (!control) throw new AssistError("CHECKOUT_NAV_FAILED", "The checkout control was not ready after the item was added to cart.");
  emitRun("CHECKOUT_CONTROL_READY", {});
  await control.click({ timeout: 15_000 });
  emitRun("CHECKOUT_CONTROL_CLICKED", {});
  try { await page.waitForURL((url) => /\/(?:checkouts?|queue)(?:\/|$)/i.test(url.pathname), { timeout: 30_000 }); }
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
  if (emit) transition("CHECKPOINT", "CHECKPOINT_DETECTED", { reason }); await page.bringToFront(); return true;
}

async function stopSensitiveCapture(): Promise<void> {
  if (tracingStoppedForPrivacy || !recording || !context) return; tracingStoppedForPrivacy = true;
  if (recording.diagnosticLevel !== "NORMAL") await context.tracing.stop().catch(() => undefined);
  emitRun("SENSITIVE_CAPTURE_STOPPED", { message: "Tracing and automatic screenshots stopped before shipping autofill." });
}

async function fillShipping(page: Page, shipping: RunnerShipping): Promise<void> {
  const fill = async (pattern: RegExp, value: string, required = true): Promise<void> => {
    const fillTextControl = async (field: Locator): Promise<boolean> => {
      if (!await field.count()) return false;
      const tag = await field.evaluate((element) => element.tagName.toLocaleLowerCase()).catch(() => "");
      if (tag !== "input" && tag !== "textarea" && tag !== "[contenteditable]") return false;
      await field.fill(value); return true;
    };
    if (await fillTextControl(page.getByLabel(pattern).first())) return;
    if (await fillTextControl(page.locator(`input[name*="${pattern.source.replace(/[^a-z]/gi, "").toLowerCase()}"]`).first())) return;
    if (required) throw new AssistError("CHECKOUT_NAV_FAILED", `The required checkout field ${pattern.source} was not found.`);
  };
  await selectShippingCountry(page, shipping.country);
  const firstName = page.getByLabel(/first.?name/i).first(); const lastName = page.getByLabel(/last.?name/i).first();
  if (await firstName.count() && await lastName.count()) { const name = splitShippingName(shipping.fullName); await firstName.fill(name.firstName); await lastName.fill(name.lastName); }
  else await fill(/full.?name|name/i, shipping.fullName);
  await fill(/email/i, shipping.email); await fill(/phone/i, shipping.phone); await fill(/address.*1|address/i, shipping.address1); if (shipping.address2) await fill(/address.*2|apartment|unit/i, shipping.address2, false); await fill(/postal|zip/i, shipping.postalCode); await fill(/city/i, shipping.city); if (shipping.region) await fill(/state|region/i, shipping.region, false);
  emitRun("SHIPPING_FILLED", { country: shipping.country });
}

async function selectShippingCountry(page: Page, country: string): Promise<void> {
  const candidates = [page.getByLabel(/country|region/i).first(), page.locator("select").first()]; const names = shippingCountryNames(country);
  for (const field of candidates) {
    if (!await field.count()) continue;
    const option = await field.locator("option").evaluateAll((options, values) => options.map((item) => ({ value: (item as HTMLOptionElement).value, text: item.textContent?.trim() ?? "" })).find((item) => values.some((value) => item.value.trim().toUpperCase() === value.toUpperCase() || item.text.trim().toLocaleLowerCase() === value.toLocaleLowerCase())), names).catch(() => undefined);
    if (!option) continue;
    try { await field.selectOption({ value: option.value }); return; } catch { /* Try the next semantic country selector. */ }
  }
  throw new AssistError("CHECKOUT_NAV_FAILED", `The shipping country ${country} was not available at checkout.`);
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
    if (!await box.isChecked()) await box.check({ timeout: 10_000 });
    if (!await box.isChecked()) continue;
    emitRun("TERMS_ACCEPTED", {});
    return;
  }
  throw new AssistError("CHECKOUT_NAV_FAILED", "The required terms and conditions acknowledgement was not found.");
}

export function splitShippingName(value: string): { firstName: string; lastName: string } { const parts = value.trim().split(/\s+/).filter(Boolean); return { firstName: parts[0] ?? value.trim(), lastName: parts.slice(1).join(" ") || parts[0] || value.trim() }; }
export function shippingCountryNames(country: string): string[] { const code = country.trim().toUpperCase(); const displayName = new Intl.DisplayNames(["en"], { type: "region" }).of(code); return [...new Set([code, displayName].filter((value): value is string => Boolean(value)))]; }

class AssistError extends Error { constructor(readonly code: string, message: string) { super(message); } }
function transition(next: string, type: string, payload: Record<string, unknown>): void { const previous = assistState; assistState = next; emitRun(type, payload, previous, next); }

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

async function stop(): Promise<void> {
  stopping = true; const id = profileId;
  try { if (recording) await endRun(recording.runSessionId); if (nativeChrome) nativeChrome.kill(); else await context?.close(); await cdpBrowser?.close().catch(() => undefined); } finally { context = undefined; cdpBrowser = undefined; nativeChrome = undefined; if (id) send({ type: "STOPPED", version: IPC_VERSION, profileId: id }); process.exit(0); }
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
function classifyLaunchError(error: unknown): { code: "BROWSER_START_FAILED" | "PROXY_CONNECTION_FAILED" | "PROXY_AUTH_FAILED" | "UNKNOWN"; message: string } {
  const message = error instanceof Error ? error.message : "";
  if (/Native Chrome \+ CDP.*authenticated proxy/i.test(message)) return { code: "PROXY_AUTH_FAILED", message: "Native Chrome + CDP cannot use this authenticated proxy. Switch this profile to Playwright launch." };
  if (/Native Chrome exited before opening/i.test(message)) return { code: "BROWSER_START_FAILED", message: "Native Chrome closed before Copify could attach. Close any remaining Copify Chrome window for this profile, then try again." };
  if (/local CDP endpoint|connectOverCDP|ECONNREFUSED/i.test(message)) return { code: "BROWSER_START_FAILED", message: "Chrome started but Copify could not attach through its local CDP endpoint. Try again, or use Playwright launch for this profile." };
  if (/407|proxy auth/i.test(message)) return { code: "PROXY_AUTH_FAILED", message: "Chrome could not authenticate with the configured proxy." };
  if (/ERR_PROXY|ERR_TUNNEL|proxy/i.test(message)) return { code: "PROXY_CONNECTION_FAILED", message: "Chrome could not connect through the configured proxy." };
  return { code: "BROWSER_START_FAILED", message: "Chrome could not be started." };
}
