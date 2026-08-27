import type { Frame, Page } from "rebrowser-playwright";
import type { CaptchaChallenge, CaptchaKind } from "@copify/shared";

export async function installCaptchaCallbackBridge(pageOrContext: { addInitScript(script: { content: string }): Promise<void> }): Promise<void> {
  await pageOrContext.addInitScript({ content: `(() => {
    const state = { callbacks: [], completed: false, funcaptcha: null, geetestV3: null, geetestV4: null, geetestInstances: [], geetestHandlers: [] };
    Object.defineProperty(window, "__copifyCaptchaBridge", { value: state, configurable: false });
    const wrap = (name) => { const api = window[name]; if (!api || api.__copifyWrapped) return; let wrapped = false; if (typeof api.render === "function") { const original = api.render.bind(api); api.render = (container, options = {}) => { if (typeof options.callback === "function") { const callback = options.callback; options = { ...options, callback: (token) => { state.completed = Boolean(token); return callback(token); } }; state.callbacks.push(callback); } return original(container, options); }; wrapped = true; } if (typeof api.execute === "function") { const execute = api.execute.bind(api); api.execute = (...args) => { const result = execute(...args); if (result && typeof result.then === "function") result.then((token) => { state.completed = Boolean(token); }); return result; }; wrapped = true; } if (wrapped) api.__copifyWrapped = true; };
    const makeGeeTest = (original, version) => { if (typeof original !== "function" || original.__copifyWrapped) return original; const wrapped = (options, callback) => { state[version] = { ...(options || {}) }; return original(options, (instance) => { if (instance) state.geetestInstances.push(instance); if (instance && typeof instance.onSuccess === "function") { const success = instance.onSuccess.bind(instance); instance.onSuccess = (handler) => { state.geetestHandlers.push({ instance, handler }); return success((...args) => { state.completed = true; return handler?.(...args); }); }; } return callback?.(instance); }); }; Object.assign(wrapped, original); wrapped.__copifyWrapped = true; return wrapped; };
    const wrapGeeTest = (name, version) => { const wrapped = makeGeeTest(window[name], version); if (wrapped && wrapped !== window[name]) window[name] = wrapped; };
    const hookGeeTest = (name, version) => { let current = makeGeeTest(window[name], version); try { Object.defineProperty(window, name, { configurable: true, get: () => current, set: (value) => { current = makeGeeTest(value, version); } }); } catch {} };
    const wrapFunCaptcha = () => { const original = window.FunCaptcha; if (typeof original !== "function" || original.__copifyWrapped) return; const wrapped = function(options) { state.funcaptcha = { ...(options || {}) }; if (typeof options?.callback === "function") state.callbacks.push(options.callback); return Reflect.construct(original, [options], new.target || original); }; Object.assign(wrapped, original); wrapped.__copifyWrapped = true; window.FunCaptcha = wrapped; };
    hookGeeTest("initGeetest", "geetestV3"); hookGeeTest("initGeetest4", "geetestV4");
    setInterval(() => { wrap("turnstile"); wrap("grecaptcha"); wrap("hcaptcha"); wrapFunCaptcha(); wrapGeeTest("initGeetest", "geetestV3"); wrapGeeTest("initGeetest4", "geetestV4"); }, 100);
  })();` });
}

export async function extractCaptchaChallenge(page: Page): Promise<{ challenge: CaptchaChallenge; frame: Frame } | null> {
  for (const frame of page.frames()) {
    const found = await frame.evaluate(() => {
      const query = (selector: string): HTMLElement | null => document.querySelector(selector);
      const turnstile = query("[data-sitekey].cf-turnstile, .cf-turnstile[data-sitekey], iframe[src*='challenges.cloudflare.com']");
      const hcaptcha = query("[data-sitekey].h-captcha, .h-captcha[data-sitekey], iframe[src*='hcaptcha.com']");
      const recaptcha = query("[data-sitekey].g-recaptcha, .g-recaptcha[data-sitekey], iframe[src*='recaptcha']");
      const datadome = query("iframe[src*='captcha-delivery.com/captcha']");
      const funcaptcha = query("[data-pkey],input[name='fc-token'],iframe[src*='arkoselabs.com'],iframe[src*='funcaptcha.com']");
      const scripts = Array.from(document.scripts).map((script) => script.src).filter(Boolean);
      const bridge = (window as any).__copifyCaptchaBridge;
      const goku = (window as any).gokuProps as Record<string, unknown> | undefined;
      const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
      const awsScript = [...scripts, ...resources].find((src) => /awswaf\.com\/.+(challenge|jsapi)\.js/i.test(src));
      const awsProblem = resources.find((src) => /awswaf\.com\/.+\/problem\?/i.test(src));
      let element = turnstile ?? hcaptcha ?? recaptcha ?? datadome ?? funcaptcha;
      let kind: CaptchaKind | null = turnstile ? "TURNSTILE" : hcaptcha ? "HCAPTCHA" : recaptcha ? "RECAPTCHA_V2" : datadome ? "DATADOME" : funcaptcha || bridge?.funcaptcha ? "FUNCAPTCHA" : goku || awsScript ? "AWS_WAF" : bridge?.geetestV4 ? "GEETEST_V4" : bridge?.geetestV3 ? "GEETEST_V3" : null;
      if (!kind && scripts.some((src) => src.includes("challenges.cloudflare.com/turnstile"))) kind = "TURNSTILE";
      if (!kind && scripts.some((src) => src.includes("hcaptcha.com/1/api.js"))) kind = "HCAPTCHA";
      const recaptchaScript = scripts.find((src) => src.includes("recaptcha") && src.includes("render="));
      if (!kind && recaptchaScript) kind = "RECAPTCHA_V3";
      if (!kind && /captcha-delivery\.com\/captcha/i.test(location.href)) { kind = "DATADOME"; element = document.documentElement; }
      if (!kind) return null;
      const data = element?.dataset ?? {};
      let siteKey = data.sitekey ?? "";
      if (!siteKey && recaptchaScript) { try { siteKey = new URL(recaptchaScript).searchParams.get("render") ?? ""; } catch {} }
      if (!siteKey && element?.tagName === "IFRAME") { try { const url = new URL((element as HTMLIFrameElement).src); siteKey = url.searchParams.get("k") ?? url.searchParams.get("sitekey") ?? ""; } catch {} }
      if (kind === "FUNCAPTCHA" && !siteKey) {
        siteKey = data.pkey ?? bridge?.funcaptcha?.public_key ?? bridge?.funcaptcha?.pkey ?? "";
        if (!siteKey && element?.tagName === "IFRAME") { try { const url = new URL((element as HTMLIFrameElement).src); siteKey = url.searchParams.get("pk") ?? url.searchParams.get("public_key") ?? ""; } catch {} }
      }
      const geetest = kind === "GEETEST_V4" ? bridge?.geetestV4 : kind === "GEETEST_V3" ? bridge?.geetestV3 : null;
      if (kind === "GEETEST_V4") siteKey = String(geetest?.captchaId ?? geetest?.captcha_id ?? "");
      if (kind === "GEETEST_V3") siteKey = String(geetest?.gt ?? "");
      if (!siteKey && !["DATADOME", "AWS_WAF"].includes(kind)) return null;
      const captchaUrl = kind === "DATADOME" ? (element?.tagName === "IFRAME" ? (element as HTMLIFrameElement).src : location.href) : null;
      const arkoseUrl = kind === "FUNCAPTCHA" && element?.tagName === "IFRAME" ? (element as HTMLIFrameElement).src : null;
      let subdomain: string | null = null;
      try { if (arkoseUrl) subdomain = new URL(arkoseUrl).hostname; } catch {}
      return {
        kind, siteKey, action: data.action ?? null, cData: data.cdata ?? null, chlPageData: data.chlPageData ?? null,
        invisible: kind === "RECAPTCHA_V3" || data.size === "invisible", captchaUrl, userAgent: navigator.userAgent,
        subdomain: subdomain ?? bridge?.funcaptcha?.surl ?? bridge?.funcaptcha?.apiUrl ?? geetest?.api_server ?? geetest?.apiServer ?? null, blob: data.blob ?? bridge?.funcaptcha?.data?.blob ?? null,
        gt: geetest?.gt ?? null, geetestChallenge: geetest?.challenge ?? null, captchaId: geetest?.captchaId ?? geetest?.captcha_id ?? null,
        riskType: geetest?.riskType ?? geetest?.risk_type ?? null, awsKey: typeof goku?.key === "string" ? goku.key : null,
        awsIv: typeof goku?.iv === "string" ? goku.iv : null, awsContext: typeof goku?.context === "string" ? goku.context : null,
        awsChallengeJs: awsScript?.includes("challenge.js") ? awsScript : null, awsApiJs: awsScript?.includes("jsapi.js") ? awsScript : null,
        awsProblemUrl: awsProblem ?? null, awsApiKey: (() => { try { return awsProblem ? new URL(awsProblem).searchParams.get("api_key") : null; } catch { return null; } })(),
        awsExistingToken: (() => { try { return document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("aws-waf-token="))?.slice("aws-waf-token=".length) ?? null; } catch { return null; } })(),
      };
    }).catch(() => null);
    if (found) {
      let websiteUrl = page.url();
      if (found.kind === "DATADOME" && found.captchaUrl) { try { const referer = new URL(found.captchaUrl).searchParams.get("referer"); if (referer && /^https?:\/\//i.test(referer)) websiteUrl = referer; } catch {} }
      return { challenge: { ...found, websiteUrl }, frame };
    }
  }
  return null;
}

export async function hasCaptchaResponse(page: Page): Promise<boolean> {
  for (const frame of page.frames()) if (await frame.evaluate(() => {
    const bridge = (window as any).__copifyCaptchaBridge;
    if (bridge?.completed) return true;
    return Array.from(document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>("textarea[name='cf-turnstile-response'],textarea[name='g-recaptcha-response'],textarea[name='h-captcha-response'],input[name='cf-turnstile-response'],input[name='g-recaptcha-response'],input[name='h-captcha-response'],input[name='fc-token'],input[name='geetest_validate'],input[name='lot_number']")).some((field) => Boolean(field.value.trim()));
  }).catch(() => false)) return true;
  return false;
}

export async function waitForLocalCaptcha(page: Page, timeoutMs = 15 * 60_000, signal?: AbortSignal): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs && !page.isClosed() && !signal?.aborted) {
    if (await hasCaptchaResponse(page)) return true;
    if (Date.now() - started >= 500 && !await extractCaptchaChallenge(page)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

export async function injectCaptchaToken(page: Page, kind: CaptchaKind, token: string): Promise<boolean> {
  return injectCaptchaSolution(page, kind, { token, gRecaptchaResponse: token });
}

export async function injectCaptchaSolution(page: Page, kind: CaptchaKind, solution: Record<string, string>): Promise<boolean> {
  if (kind === "DATADOME" || kind === "AWS_WAF") {
    const raw = solution.cookie ?? solution.token;
    if (!raw) return false;
    const separator = raw.indexOf("=");
    const name = separator > 0 ? raw.slice(0, separator) : kind === "DATADOME" ? "datadome" : "aws-waf-token";
    const value = separator > 0 ? raw.slice(separator + 1).split(";")[0] : raw;
    let destination = page.url();
    if (kind === "DATADOME") { try { const referer = new URL(destination).searchParams.get("referer"); if (referer && /^https?:\/\//i.test(referer)) destination = referer; } catch {} }
    const url = new URL(destination);
    await page.context().addCookies([{ name, value, domain: url.hostname, path: "/", secure: url.protocol === "https:", httpOnly: false, sameSite: "Lax" }]);
    if (destination === page.url()) await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    else await page.goto(destination, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    return !(await extractCaptchaChallenge(page));
  }
  if (kind === "GEETEST_V3" || kind === "GEETEST_V4") {
    const deadline = Date.now() + 10_000;
    let ready = false;
    while (!ready && Date.now() < deadline && !page.isClosed()) {
      for (const frame of page.frames()) if (await frame.evaluate(() => ((window as any).__copifyCaptchaBridge?.geetestInstances?.length ?? 0) > 0).catch(() => false)) { ready = true; break; }
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) return false;
  }
  const beforeUrl = page.url();
  for (const frame of page.frames()) await frame.evaluate(({ captchaKind, values }) => {
    const token = values.token ?? values.gRecaptchaResponse ?? "";
    const names: Record<string, string[]> = { TURNSTILE: ["cf-turnstile-response"], RECAPTCHA_V2: ["g-recaptcha-response"], RECAPTCHA_V3: ["g-recaptcha-response"], HCAPTCHA: ["h-captcha-response", "g-recaptcha-response"], FUNCAPTCHA: ["fc-token"] };
    const write = (name: string, value: string) => { for (const field of document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(`textarea[name='${name}'],input[name='${name}']`)) {
      const setter = Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set;
      setter?.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new Event("change", { bubbles: true }));
    } };
    for (const name of names[captchaKind] ?? []) write(name, token);
    if (captchaKind === "GEETEST_V3") { write("geetest_challenge", values.challenge ?? ""); write("geetest_validate", values.validate ?? ""); write("geetest_seccode", values.seccode ?? ""); }
    if (captchaKind === "GEETEST_V4") for (const name of ["captcha_id", "captcha_output", "gen_time", "lot_number", "pass_token"]) write(name, values[name] ?? "");
    const bridge = (window as any).__copifyCaptchaBridge;
    let appliedGeeTest = false;
    if (bridge && (captchaKind === "GEETEST_V3" || captchaKind === "GEETEST_V4")) {
      for (const instance of bridge.geetestInstances ?? []) { try { instance.getValidate = () => ({ ...values }); appliedGeeTest = true; } catch {} }
      for (const entry of bridge.geetestHandlers ?? []) { try { entry.handler?.(); } catch {} }
    }
    if (bridge) { bridge.completed = captchaKind === "GEETEST_V3" || captchaKind === "GEETEST_V4" ? appliedGeeTest : true; for (const callback of bridge.callbacks ?? []) { try { callback(token); } catch {} } }
    for (const element of document.querySelectorAll<HTMLElement>("[data-callback]")) { const callback = element.dataset.callback && (window as any)[element.dataset.callback]; if (typeof callback === "function") { try { callback(token); } catch {} } }
  }, { captchaKind: kind, values: solution }).catch(() => undefined);
  const started = Date.now();
  while (Date.now() - started < 8_000 && !page.isClosed()) {
    if (page.url() !== beforeUrl) return true;
    if (await hasCaptchaResponse(page)) return true;
    const cleared = await page.locator(".cf-turnstile,.g-recaptcha,.h-captcha,iframe[src*='recaptcha'],iframe[src*='hcaptcha'],iframe[src*='challenges.cloudflare.com'],iframe[src*='arkoselabs.com'],iframe[src*='funcaptcha.com']").evaluateAll((elements) => elements.length === 0 || elements.every((element) => { const style = getComputedStyle(element); return style.display === "none" || style.visibility === "hidden" || (element as HTMLElement).offsetParent === null; })).catch(() => false);
    if (cleared) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}
