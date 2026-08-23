import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NativeStealthDriver, type DriverSession } from "./drivers";

const enabled = process.env.COPIFY_STEALTH_LIVE === "1";
const evidenceDir = resolve("docs", "validation", "v0.7");

describe.skipIf(!enabled)("v0.7 live stealth evidence", () => {
  let profileDir = ""; let turnstileOrigin = ""; let closeServer: (() => Promise<void>) | undefined; const sessions: DriverSession[] = [];

  beforeAll(async () => {
    await mkdir(evidenceDir, { recursive: true }); profileDir = await mkdtemp(join(tmpdir(), "copify-stealth-live-"));
    const server = createServer((_request, response) => { response.setHeader("content-type", "text/html; charset=utf-8"); response.end(`<!doctype html><title>Copify Turnstile validation</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><main><h1>Cloudflare Turnstile test widget</h1><div class="cf-turnstile" data-sitekey="1x00000000000000000000AA"></div></main>`); });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Turnstile fixture did not bind."); turnstileOrigin = `http://127.0.0.1:${address.port}`;
    closeServer = () => new Promise<void>((done, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : done()); });
  });
  afterAll(async () => { await Promise.all(sessions.map((session) => session.stop().catch(() => undefined))); await closeServer?.(); if (profileDir) await rm(profileDir, { recursive: true, force: true }); }, 20_000);

  it("records the official CreepJS deployment without a webdriver signal", async () => {
    const session = await new NativeStealthDriver().launch({ driver: { kind: "NATIVE_STEALTH" }, userDataDir: profileDir, proxy: null }); sessions.push(session); const page = session.context.pages()[0] ?? await session.context.newPage();
    await page.goto("https://abrahamjuliot.github.io/creepjs/", { waitUntil: "domcontentloaded", timeout: 45_000 }); await page.waitForTimeout(15_000);
    expect(await page.evaluate(() => navigator.webdriver)).toBe(false); const text = (await page.locator("body").innerText()).toLowerCase(); expect(text).not.toContain("webdriver: true");
    const headlessPanel = page.getByText("Headless", { exact: true }).first().locator("xpath=.."); await headlessPanel.waitFor({ state: "visible" }); await headlessPanel.screenshot({ path: join(evidenceDir, "creepjs.png") });
  }, 70_000);

  it("records successful completion of Cloudflare's official always-pass test widget", async () => {
    const session = sessions[0] ?? await new NativeStealthDriver().launch({ driver: { kind: "NATIVE_STEALTH" }, userDataDir: profileDir, proxy: null }); if (!sessions.includes(session)) sessions.push(session);
    const page = await session.context.newPage(); await page.goto(turnstileOrigin, { waitUntil: "domcontentloaded" });
    await page.locator('input[name="cf-turnstile-response"]').waitFor({ state: "attached", timeout: 30_000 }); await expect.poll(() => page.locator('input[name="cf-turnstile-response"]').inputValue(), { timeout: 30_000 }).not.toBe("");
    expect(await page.evaluate(() => navigator.webdriver)).toBe(false); await page.screenshot({ path: join(evidenceDir, "turnstile-test-widget.png"), fullPage: true });
  }, 70_000);
});
