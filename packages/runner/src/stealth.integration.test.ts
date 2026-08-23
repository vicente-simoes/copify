import { createServer } from "node:http";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NativeStealthDriver, buildNativeStealthArgs, type DriverSession } from "./drivers";

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
  let origin = ""; let profileDir = ""; let closeServer: (() => Promise<void>) | undefined;
  const sessions: DriverSession[] = [];

  beforeAll(async () => {
    profileDir = await mkdtemp(join(tmpdir(), "copify-stealth-"));
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html><title>Copify stealth fixture</title><iframe srcdoc="<p>frame</p>"></iframe><script>
        window.runtimeLeak = false;
        const error = new Error('copify-runtime-probe');
        Object.defineProperty(error, 'stack', { get() { window.runtimeLeak = true; return 'probe'; } });
        console.log(error);
      </script>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Local fixture did not bind.");
    origin = `http://127.0.0.1:${address.port}`;
    closeServer = () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()); });
  });

  afterAll(async () => { await Promise.all(sessions.map((session) => session.stop().catch(() => undefined))); await closeServer?.(); if (profileDir) await rm(profileDir, { recursive: true, force: true }); }, 20_000);

  it("keeps webdriver false, hides the Runtime serialization probe, and retains profile state", async () => {
    const driver = new NativeStealthDriver();
    const first = await driver.launch({ driver: { kind: "NATIVE_STEALTH" }, userDataDir: profileDir, proxy: null }); sessions.push(first);
    const commandLine = await chromeCommandLine(profileDir);
    expect(commandLine).not.toContain("--enable-automation");
    expect(commandLine).not.toContain("--no-sandbox");
    expect(commandLine).toContain("--disable-blink-features=AutomationControlled");
    const page = first.context.pages()[0] ?? await first.context.newPage(); page.on("console", () => undefined);
    await page.goto(origin); await page.waitForTimeout(100);
    expect(await page.evaluate(() => navigator.webdriver)).toBe(false);
    expect(await page.evaluate(() => (window as Window & { runtimeLeak?: boolean }).runtimeLeak)).toBe(false);
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame()); expect(frame).toBeDefined(); expect(await frame!.evaluate(() => navigator.webdriver)).toBe(false);
    const secondPage = await first.context.newPage(); await secondPage.goto(origin); expect(await secondPage.evaluate(() => navigator.webdriver)).toBe(false);
    const popupPromise = first.context.waitForEvent("page"); await page.evaluate((url) => window.open(url), origin); const popup = await popupPromise; await popup.waitForLoadState("domcontentloaded"); expect(await popup.evaluate(() => navigator.webdriver)).toBe(false);
    await first.context.addCookies([{ name: "copify_stealth_smoke", value: "retained", url: origin, expires: Math.floor(Date.now() / 1_000) + 3_600, sameSite: "Lax" }]);
    expect((await first.context.cookies(origin)).some((cookie) => cookie.name === "copify_stealth_smoke")).toBe(true);
    await first.stop();

    const second = await driver.launch({ driver: { kind: "NATIVE_STEALTH" }, userDataDir: profileDir, proxy: null }); sessions.push(second);
    const restored = second.context.pages()[0] ?? await second.context.newPage(); await restored.goto(origin);
    expect(await restored.evaluate(() => document.cookie)).toContain("copify_stealth_smoke=retained");
    expect(buildNativeStealthArgs().some((arg) => arg.startsWith("--enable-automation"))).toBe(false);
    await second.stop();
  }, 60_000);
});
