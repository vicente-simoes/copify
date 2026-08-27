import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "rebrowser-playwright";
import { extractCaptchaChallenge, hasCaptchaResponse, injectCaptchaToken, installCaptchaCallbackBridge } from "./captcha-page";
import { findChromeExecutable } from "./network";

const enabled = process.env.COPIFY_CAPTCHA_SMOKE === "1";
describe.skipIf(!enabled)("local CAPTCHA browser fixtures", () => {
  let browser: Browser; let page: Page;
  beforeAll(async () => { browser = await chromium.launch({ headless: true, executablePath: findChromeExecutable() }); page = await browser.newPage(); await installCaptchaCallbackBridge(page); });
  afterAll(async () => { await browser?.close(); });
  const fixtures = [
    ["TURNSTILE", `<div class="cf-turnstile" data-sitekey="turn-key" data-callback="done"></div><textarea name="cf-turnstile-response"></textarea>`],
    ["RECAPTCHA_V2", `<div class="g-recaptcha" data-sitekey="v2-key" data-callback="done"></div><textarea name="g-recaptcha-response"></textarea>`],
    ["RECAPTCHA_V3", `<script src="https://www.google.com/recaptcha/api.js?render=v3-key"></script><textarea name="g-recaptcha-response"></textarea>`],
    ["HCAPTCHA", `<div class="h-captcha" data-sitekey="h-key" data-callback="done"></div><textarea name="h-captcha-response"></textarea>`],
  ] as const;
  for (const [kind, fixture] of fixtures) for (const framed of [false, true]) it(`detects and injects ${kind} in ${framed ? "a child frame" : "the main page"}`, async () => {
    const phase = <T>(name: string, task: Promise<T>): Promise<T> => Promise.race([task, new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`${name} timed out`)), 3_000))]);
    const content = `<script>window.done=function(token){document.querySelector('[data-sitekey]')?.remove();window.completed=!!token}</script>${fixture}`;
    const html = framed ? `<iframe srcdoc="${content.replaceAll('"', '&quot;')}"></iframe>` : content;
    await phase("navigate", page.goto(`data:text/html,${encodeURIComponent(html)}`, { waitUntil: "domcontentloaded" }));
    const detected = await phase("extract", extractCaptchaChallenge(page)); expect(detected?.challenge.kind).toBe(kind);
    expect(await phase("inject", injectCaptchaToken(page, kind, "fixture-token"))).toBe(true); expect(await phase("response", hasCaptchaResponse(page))).toBe(true);
  }, 15_000);
});
