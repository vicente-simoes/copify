import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "rebrowser-playwright";
import { extractCaptchaChallenge, installCaptchaCallbackBridge } from "./captcha-page";
import { findChromeExecutable } from "./network";

const enabled = process.env.COPIFY_CAPTCHA_LIVE === "1";

describe.skipIf(!enabled)("official public CAPTCHA fixtures", () => {
  let browser: Browser; let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true, executablePath: findChromeExecutable() });
    page = await browser.newPage();
    await installCaptchaCallbackBridge(page);
  });
  afterAll(async () => { await browser?.close(); });

  it("detects the official GeeTest v4 slide demo", async () => {
    await page.goto("https://gt4.geetest.com/demov4/slide-float-en.html", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const deadline = Date.now() + 20_000;
    let detected: Awaited<ReturnType<typeof extractCaptchaChallenge>> = null;
    while (!detected && Date.now() < deadline) {
      detected = await extractCaptchaChallenge(page);
      if (!detected) await page.waitForTimeout(250);
    }
    expect(detected?.challenge.kind).toBe("GEETEST_V4");
    expect(detected?.challenge.captchaId).toBeTruthy();
    const instanceDeadline = Date.now() + 15_000;
    let instanceReady = false;
    while (!instanceReady && Date.now() < instanceDeadline) {
      instanceReady = await page.evaluate(() => ((window as any).__copifyCaptchaBridge?.geetestInstances?.length ?? 0) > 0);
      if (!instanceReady) await page.waitForTimeout(250);
    }
    expect(instanceReady).toBe(true);
  }, 70_000);
});
