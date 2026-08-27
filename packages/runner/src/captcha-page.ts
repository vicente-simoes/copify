import type { Frame, Page } from "rebrowser-playwright";
import type { CaptchaChallenge, CaptchaKind } from "@copify/shared";

export async function installCaptchaCallbackBridge(pageOrContext: { addInitScript(script: { content: string }): Promise<void> }): Promise<void> {
  await pageOrContext.addInitScript({ content: `(() => {
    const state = { callbacks: [], completed: false };
    Object.defineProperty(window, "__copifyCaptchaBridge", { value: state, configurable: false });
    const wrap = (name) => { const api = window[name]; if (!api || api.__copifyWrapped || typeof api.render !== "function") return; const original = api.render.bind(api); api.render = (container, options = {}) => { if (typeof options.callback === "function") { const callback = options.callback; options = { ...options, callback: (token) => { state.completed = Boolean(token); return callback(token); } }; state.callbacks.push(callback); } return original(container, options); }; api.__copifyWrapped = true; };
    setInterval(() => { wrap("turnstile"); wrap("grecaptcha"); wrap("hcaptcha"); }, 100);
  })();` });
}

export async function extractCaptchaChallenge(page: Page): Promise<{ challenge: CaptchaChallenge; frame: Frame } | null> {
  for (const frame of page.frames()) {
    const found = await frame.evaluate(() => {
      const query = (selector: string): HTMLElement | null => document.querySelector(selector);
      const turnstile = query("[data-sitekey].cf-turnstile, .cf-turnstile[data-sitekey], iframe[src*='challenges.cloudflare.com']");
      const hcaptcha = query("[data-sitekey].h-captcha, .h-captcha[data-sitekey], iframe[src*='hcaptcha.com']");
      const recaptcha = query("[data-sitekey].g-recaptcha, .g-recaptcha[data-sitekey], iframe[src*='recaptcha']");
      const scripts = Array.from(document.scripts).map((script) => script.src).filter(Boolean);
      let element = turnstile ?? hcaptcha ?? recaptcha;
      let kind: CaptchaKind | null = turnstile ? "TURNSTILE" : hcaptcha ? "HCAPTCHA" : recaptcha ? "RECAPTCHA_V2" : null;
      if (!kind && scripts.some((src) => src.includes("challenges.cloudflare.com/turnstile"))) kind = "TURNSTILE";
      if (!kind && scripts.some((src) => src.includes("hcaptcha.com/1/api.js"))) kind = "HCAPTCHA";
      const recaptchaScript = scripts.find((src) => src.includes("recaptcha") && src.includes("render="));
      if (!kind && recaptchaScript) kind = "RECAPTCHA_V3";
      if (!kind) return null;
      const data = element?.dataset ?? {};
      let siteKey = data.sitekey ?? "";
      if (!siteKey && recaptchaScript) { try { siteKey = new URL(recaptchaScript).searchParams.get("render") ?? ""; } catch {} }
      if (!siteKey && element?.tagName === "IFRAME") { try { const url = new URL((element as HTMLIFrameElement).src); siteKey = url.searchParams.get("k") ?? url.searchParams.get("sitekey") ?? ""; } catch {} }
      if (!siteKey) return null;
      return { kind, siteKey, action: data.action ?? null, cData: data.cdata ?? null, chlPageData: data.chlPageData ?? null, invisible: kind === "RECAPTCHA_V3" || data.size === "invisible" };
    }).catch(() => null);
    if (found) return { challenge: { ...found, websiteUrl: page.url() }, frame };
  }
  return null;
}

export async function hasCaptchaResponse(page: Page): Promise<boolean> {
  for (const frame of page.frames()) if (await frame.evaluate(() => {
    const bridge = (window as any).__copifyCaptchaBridge;
    if (bridge?.completed) return true;
    return Array.from(document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>("textarea[name='cf-turnstile-response'],textarea[name='g-recaptcha-response'],textarea[name='h-captcha-response'],input[name='cf-turnstile-response'],input[name='g-recaptcha-response'],input[name='h-captcha-response']")).some((field) => Boolean(field.value.trim()));
  }).catch(() => false)) return true;
  return false;
}

export async function waitForLocalCaptcha(page: Page, timeoutMs = 15 * 60_000, signal?: AbortSignal): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs && !page.isClosed() && !signal?.aborted) {
    if (await hasCaptchaResponse(page)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

export async function injectCaptchaToken(page: Page, kind: CaptchaKind, token: string): Promise<boolean> {
  const beforeUrl = page.url();
  for (const frame of page.frames()) await frame.evaluate(({ captchaKind, value }) => {
    const names: Record<string, string[]> = { TURNSTILE: ["cf-turnstile-response"], RECAPTCHA_V2: ["g-recaptcha-response"], RECAPTCHA_V3: ["g-recaptcha-response"], HCAPTCHA: ["h-captcha-response", "g-recaptcha-response"] };
    for (const name of names[captchaKind] ?? []) for (const field of document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(`textarea[name='${name}'],input[name='${name}']`)) {
      const setter = Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set;
      setter?.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const bridge = (window as any).__copifyCaptchaBridge;
    if (bridge) { bridge.completed = true; for (const callback of bridge.callbacks ?? []) { try { callback(value); } catch {} } }
    for (const element of document.querySelectorAll<HTMLElement>("[data-callback]")) { const callback = element.dataset.callback && (window as any)[element.dataset.callback]; if (typeof callback === "function") { try { callback(value); } catch {} } }
  }, { captchaKind: kind, value: token }).catch(() => undefined);
  const started = Date.now();
  while (Date.now() - started < 8_000 && !page.isClosed()) {
    if (page.url() !== beforeUrl) return true;
    const cleared = await page.locator(".cf-turnstile,.g-recaptcha,.h-captcha,iframe[src*='recaptcha'],iframe[src*='hcaptcha'],iframe[src*='challenges.cloudflare.com']").evaluateAll((elements) => elements.length === 0 || elements.every((element) => { const style = getComputedStyle(element); return style.display === "none" || style.visibility === "hidden" || (element as HTMLElement).offsetParent === null; })).catch(() => false);
    if (cleared) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}
