import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "rebrowser-playwright";
import { extractCaptchaChallenge, hasCaptchaResponse, injectCaptchaSolution, injectCaptchaToken, installCaptchaCallbackBridge } from "./captcha-page";
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

  it("detects DataDome, AWS WAF, and Arkose Labs parameters", async () => {
    await page.goto(`data:text/html,${encodeURIComponent(`<iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x&t=fe"></iframe>`)}`);
    await expect(extractCaptchaChallenge(page)).resolves.toMatchObject({ challenge: { kind: "DATADOME", captchaUrl: "https://geo.captcha-delivery.com/captcha/?initialCid=x&t=fe" } });

    await page.goto(`data:text/html,${encodeURIComponent(`<script>window.gokuProps={key:'key',iv:'iv',context:'context'}</script>`)}`);
    await expect(extractCaptchaChallenge(page)).resolves.toMatchObject({ challenge: { kind: "AWS_WAF", awsKey: "key", awsIv: "iv", awsContext: "context" } });

    await page.goto(`data:text/html,${encodeURIComponent(`<div data-pkey="arkose-key"></div><input name="fc-token">`)}`);
    const arkose = await extractCaptchaChallenge(page); expect(arkose?.challenge).toMatchObject({ kind: "FUNCAPTCHA", siteKey: "arkose-key" });
    expect(await injectCaptchaSolution(page, "FUNCAPTCHA", { token: "arkose-token" })).toBe(true);
  }, 15_000);

  it("captures and injects GeeTest v3 and v4 structured solutions", async () => {
    await page.goto(`data:text/html,${encodeURIComponent(`<script>window.initGeetest=(options,callback)=>callback({onSuccess:(handler)=>handler});setTimeout(()=>initGeetest({gt:'gt-key',challenge:'challenge-value'},()=>{}),250)</script><input name="geetest_challenge"><input name="geetest_validate"><input name="geetest_seccode">`)}`);
    await page.waitForTimeout(500);
    await expect(extractCaptchaChallenge(page)).resolves.toMatchObject({ challenge: { kind: "GEETEST_V3", gt: "gt-key", geetestChallenge: "challenge-value" } });
    expect(await injectCaptchaSolution(page, "GEETEST_V3", { challenge: "new", validate: "valid", seccode: "secure" })).toBe(true);

    await page.goto(`data:text/html,${encodeURIComponent(`<script>window.initGeetest4=(options,callback)=>callback({onSuccess:(handler)=>handler});setTimeout(()=>initGeetest4({captchaId:'captcha-id',riskType:'slide'},()=>{}),250)</script><input name="captcha_id"><input name="captcha_output"><input name="gen_time"><input name="lot_number"><input name="pass_token">`)}`);
    await page.waitForTimeout(500);
    await expect(extractCaptchaChallenge(page)).resolves.toMatchObject({ challenge: { kind: "GEETEST_V4", captchaId: "captcha-id", riskType: "slide" } });
    expect(await injectCaptchaSolution(page, "GEETEST_V4", { captcha_id: "captcha-id", captcha_output: "output", gen_time: "time", lot_number: "lot", pass_token: "pass" })).toBe(true);
  }, 15_000);
});
