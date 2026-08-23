import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExternalCdpDriver, NativeStealthDriver, type DriverSession } from "./drivers";
import { HumanInput } from "./human-input";
import { findChromeExecutable } from "./network";

const enabled = process.env.COPIFY_INPUT_SMOKE === "1";
type CapturedEvent = { type: string; trusted: boolean; time: number; x: number | null; y: number | null };

describe.skipIf(!enabled)("FAST_DROP real-Chrome input smoke", () => {
  let origin = ""; let profileDir = ""; let session: DriverSession | undefined; let closeServer: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    profileDir = await mkdtemp(join(tmpdir(), "copify-input-"));
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html><meta charset="utf-8"><title>Copify input fixture</title>
        <style>body{height:2600px;margin:0}#target{margin-top:1450px;margin-left:220px;width:180px;height:48px}input{display:block;margin:80px 0 0 220px;width:320px;height:36px}</style>
        <button id="target">Continue</button><input id="typed"><input id="inserted">
        <script>window.copifyEvents=[]; for (const type of ['mousemove','mousedown','mouseup','click','wheel','keydown','keyup','paste','input']) document.addEventListener(type, event => window.copifyEvents.push({type, trusted:event.isTrusted, time:performance.now(), x:'clientX' in event?event.clientX:null, y:'clientY' in event?event.clientY:null}), true);</script>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Local input fixture did not bind.");
    origin = `http://127.0.0.1:${address.port}`;
    closeServer = () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()); });
  });

  afterAll(async () => { await session?.stop().catch(() => undefined); await closeServer?.(); if (profileDir) await rm(profileDir, { recursive: true, force: true }); }, 20_000);

  it("dispatches trusted curved mouse, wheel, keyboard, and insert-text events", async () => {
    session = await new NativeStealthDriver().launch({ driver: { kind: "NATIVE_STEALTH" }, userDataDir: profileDir, proxy: null });
    const page = session.context.pages()[0] ?? await session.context.newPage(); await page.goto(origin);
    const input = new HumanInput(page, { clipboard: { acquire: async () => false, release: async () => undefined } });
    await input.click(page.locator("#target"));
    await input.type(page.locator("#typed"), "Lisbon 1000");
    await input.paste(page.locator("#inserted"), "Rua São João 1");
    expect(await page.locator("#typed").inputValue()).toBe("Lisbon 1000");
    expect(await page.locator("#inserted").inputValue()).toBe("Rua São João 1");
    const events = await page.evaluate(() => (window as unknown as { copifyEvents: CapturedEvent[] }).copifyEvents);
    const firstDown = events.findIndex((event) => event.type === "mousedown"); const firstUp = events.findIndex((event, index) => index > firstDown && event.type === "mouseup");
    const moves = events.slice(0, firstDown).filter((event) => event.type === "mousemove");
    expect(moves.length).toBeGreaterThanOrEqual(10);
    expect(new Set(moves.map((event) => `${event.x}:${event.y}`)).size).toBeGreaterThanOrEqual(10);
    expect(moves.at(-1)!.time - moves[0].time).toBeGreaterThanOrEqual(70);
    expect(moves.at(-1)!.time - moves[0].time).toBeLessThan(300);
    expect(events[firstUp].time - events[firstDown].time).toBeGreaterThanOrEqual(35);
    expect(events[firstUp].time - events[firstDown].time).toBeLessThan(120);
    expect(events.some((event) => event.type === "wheel" && event.trusted)).toBe(true);
    expect(events.some((event) => event.type === "click" && event.trusted)).toBe(true);
    expect(events.some((event) => event.type === "keydown" && event.trusted)).toBe(true);
    expect(events.filter((event) => event.type === "input").every((event) => event.trusted)).toBe(true);
  }, 60_000);

  it("uses the same input engine over External CDP and detaches without closing its browser", async () => {
    const externalProfile = await mkdtemp(join(tmpdir(), "copify-input-cdp-"));
    const executable = findChromeExecutable(); if (!executable) throw new Error("Google Chrome is not installed.");
    const chrome: ChildProcess = spawn(executable, ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${externalProfile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
    let external: DriverSession | undefined;
    try {
      const port = await readDevToolsPort(externalProfile);
      const endpoint = `http://127.0.0.1:${port}`;
      external = await new ExternalCdpDriver().launch({ driver: { kind: "EXTERNAL_CDP", endpoint }, userDataDir: externalProfile, proxy: null });
      const page = external.context.pages()[0] ?? await external.context.newPage(); await page.goto(origin);
      await new HumanInput(page).click(page.locator("#target"));
      const trusted = await page.evaluate(() => (window as unknown as { copifyEvents: CapturedEvent[] }).copifyEvents.some((event) => event.type === "click" && event.trusted));
      expect(trusted).toBe(true);
      await external.stop();
      expect((await fetch(`${endpoint}/json/version`)).ok).toBe(true);
    } finally {
      await external?.context.browser()?.close().catch(() => undefined);
      if (chrome.exitCode === null) chrome.kill();
      await new Promise<void>((resolve) => chrome.exitCode === null ? chrome.once("exit", () => resolve()) : resolve());
      await rm(externalProfile, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 60_000);
});

async function readDevToolsPort(profileDirectory: string): Promise<number> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const [line] = (await readFile(join(profileDirectory, "DevToolsActivePort"), "utf8")).split(/\r?\n/);
      const port = Number(line); if (Number.isInteger(port) && port > 0) return port;
    } catch { /* Chrome has not published its endpoint yet. */ }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("External Chrome did not publish its local CDP endpoint.");
}
