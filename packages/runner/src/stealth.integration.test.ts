import { createServer } from "node:http";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NativeStealthDriver, buildNativeStealthArgs, type DriverSession } from "./drivers";
import { paymentHandoffSignal } from "./runner";

const enabled = process.env.COPIFY_STEALTH_SMOKE === "1";
const execFile = promisify(execFileCallback);

async function chromeCommandLine(profilePath: string): Promise<string> {
  if (process.platform !== "win32") return "";
  const quotedPath = profilePath.replace(/'/g, "''");
  const script = `Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -like '*${quotedPath}*' } | Select-Object -ExpandProperty CommandLine`;
  const { stdout } = await execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  return stdout;
}

describe.skipIf(!enabled)("Native Stealth real-Chrome smoke", () => {
  let origin = ""; let challengeOrigin = ""; let profileDir = ""; let closeServer: (() => Promise<void>) | undefined;
  const sessions: DriverSession[] = [];

  beforeAll(async () => {
    profileDir = await mkdtemp(join(tmpdir(), "copify-stealth-"));
    const challengeServer = createServer((_request, response) => { response.setHeader("content-type", "text/html; charset=utf-8"); response.end("<!doctype html><title>Issuer challenge</title><p>Bank challenge</p>"); });
    await new Promise<void>((resolve) => challengeServer.listen(0, "127.0.0.1", resolve));
    const challengeAddress = challengeServer.address(); if (!challengeAddress || typeof challengeAddress === "string") throw new Error("Challenge fixture did not bind."); challengeOrigin = `http://127.0.0.1:${challengeAddress.port}`;
    const server = createServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (request.url === "/checkout-top") { response.end("<!doctype html><title>Payment</title><p>Complete your Strong Customer Authentication challenge</p>"); return; }
      if (request.url === "/checkout-frame") { response.end(`<!doctype html><title>Payment</title><iframe src="${challengeOrigin}/acs/challenge"></iframe>`); return; }
      response.end(`<!doctype html><title>Copify stealth fixture</title><iframe srcdoc="<p>frame</p>"></iframe><script>
        window.fixtureAcceptLanguage = ${JSON.stringify(request.headers["accept-language"] ?? "")};
        window.runtimeLeak = false;
        const error = new Error('copify-runtime-probe');
        Object.defineProperty(error, 'stack', { get() { window.runtimeLeak = true; return 'probe'; } });
        console.log(error);
      </script>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Local fixture did not bind.");
    origin = `http://127.0.0.1:${address.port}`;
    closeServer = async () => { server.closeAllConnections(); challengeServer.closeAllConnections(); await Promise.all([new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())), new Promise<void>((resolve, reject) => challengeServer.close((error) => error ? reject(error) : resolve()))]); };
  });

  afterAll(async () => { await Promise.all(sessions.map((session) => session.stop().catch(() => undefined))); await closeServer?.(); if (profileDir) await rm(profileDir, { recursive: true, force: true }); }, 20_000);

  it("keeps webdriver false, hides the Runtime serialization probe, and retains profile state", async () => {
    const driver = new NativeStealthDriver();
    const coherence = { locale: "pt-PT", timezoneId: "Europe/Lisbon", acceptLanguage: "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7", geolocation: { latitude: 38.7223, longitude: -9.1393 }, webRtcPolicy: "default_public_interface_only" as const };
    const first = await driver.launch({ driver: { kind: "NATIVE_STEALTH" }, userDataDir: profileDir, proxy: null, coherence }); sessions.push(first);
    const commandLine = await chromeCommandLine(profileDir);
    expect(commandLine).not.toContain("--enable-automation");
    expect(commandLine).not.toContain("--no-sandbox");
    expect(commandLine).toContain("--disable-blink-features=AutomationControlled");
    expect(commandLine).toContain("--lang=pt-PT");
    expect(commandLine).toContain("--force-webrtc-ip-handling-policy=default_public_interface_only");
    const page = first.context.pages()[0] ?? await first.context.newPage(); page.on("console", () => undefined);
    await page.goto(origin); await page.waitForTimeout(100);
    expect(await page.evaluate(() => navigator.webdriver)).toBe(false);
    expect(await page.evaluate(() => navigator.language)).toBe("pt-PT");
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe("Europe/Lisbon");
    expect(await page.evaluate(() => (window as Window & { fixtureAcceptLanguage?: string }).fixtureAcceptLanguage)).toContain("pt-PT");
    await first.context.grantPermissions(["geolocation"], { origin });
    const position = await page.evaluate(() => new Promise<{ latitude: number; longitude: number }>((resolve, reject) => navigator.geolocation.getCurrentPosition((value) => resolve({ latitude: value.coords.latitude, longitude: value.coords.longitude }), reject)));
    expect(position).toEqual({ latitude: 38.7223, longitude: -9.1393 });
    expect(await page.evaluate(() => (window as Window & { runtimeLeak?: boolean }).runtimeLeak)).toBe(false);
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame()); expect(frame).toBeDefined(); expect(await frame!.evaluate(() => navigator.webdriver)).toBe(false);
    const secondPage = await first.context.newPage(); await secondPage.goto(origin); expect(await secondPage.evaluate(() => navigator.webdriver)).toBe(false);
    const popupPromise = first.context.waitForEvent("page"); await page.evaluate((url) => window.open(url), origin); const popup = await popupPromise; await popup.waitForLoadState("domcontentloaded"); expect(await popup.evaluate(() => navigator.webdriver)).toBe(false);
    await first.context.addCookies([{ name: "copify_stealth_smoke", value: "retained", url: origin, expires: Math.floor(Date.now() / 1_000) + 3_600, sameSite: "Lax" }]);
    expect((await first.context.cookies(origin)).some((cookie) => cookie.name === "copify_stealth_smoke")).toBe(true);
    await first.stop();

    const second = await driver.launch({ driver: { kind: "NATIVE_STEALTH" }, userDataDir: profileDir, proxy: null, coherence }); sessions.push(second);
    const restored = second.context.pages()[0] ?? await second.context.newPage(); await restored.goto(origin);
    expect(await restored.evaluate(() => document.cookie)).toContain("copify_stealth_smoke=retained");
    expect(buildNativeStealthArgs().some((arg) => arg.startsWith("--enable-automation"))).toBe(false);
    await second.stop();
  }, 60_000);

  it("recognizes top-level and cross-origin-frame payment handoff fixtures", async () => {
    const driver = new NativeStealthDriver(); const session = await driver.launch({ driver: { kind: "NATIVE_STEALTH" }, userDataDir: profileDir, proxy: null }); sessions.push(session);
    const page = session.context.pages()[0] ?? await session.context.newPage(); await page.goto(`${origin}/checkout-top`);
    expect(paymentHandoffSignal(page.url(), await page.locator("body").innerText())).toBe(true);
    await page.goto(`${origin}/checkout-frame`); await page.waitForLoadState("domcontentloaded");
    expect(page.frames().some((frame) => paymentHandoffSignal(frame.url()))).toBe(true);
    await session.stop();
  }, 30_000);
});
