import { describe, expect, it } from "vitest";
import type { Browser, BrowserContext } from "rebrowser-playwright";
import { BrowserDriverError, buildNativeStealthArgs, createBrowserDriver, nativeStealthLaunchOptions, ExternalCdpDriver, NativeStealthDriver } from "./drivers";

describe("browser drivers", () => {
  it("builds a hardened deterministic Chrome argument list", () => {
    const args = buildNativeStealthArgs();
    expect(args).toContain("--disable-blink-features=AutomationControlled");
    expect(args).toContain("--no-first-run");
    expect(args.some((arg) => arg.startsWith("--enable-automation"))).toBe(false);
    expect(nativeStealthLaunchOptions(null).ignoreDefaultArgs).toEqual(expect.arrayContaining(["--enable-automation", "--no-sandbox"]));
  });

  it("rejects forbidden and duplicate launch flags", () => {
    expect(() => buildNativeStealthArgs(["--enable-automation"])).toThrow(BrowserDriverError);
    expect(() => buildNativeStealthArgs(["--no-sandbox"])).toThrow(/sandbox-disabling/i);
    expect(() => buildNativeStealthArgs(["--no-first-run"])).toThrow(/duplicate/i);
    expect(() => buildNativeStealthArgs(["--disable-blink-features=SomethingElse"])).toThrow(/contradictory/i);
  });

  it("selects the configured driver without a standard Playwright fallback", () => {
    expect(createBrowserDriver({ kind: "NATIVE_STEALTH" })).toBeInstanceOf(NativeStealthDriver);
    expect(createBrowserDriver({ kind: "EXTERNAL_CDP", endpoint: "http://127.0.0.1:9222" })).toBeInstanceOf(ExternalCdpDriver);
  });

  it("detaches from an externally owned browser without closing it", async () => {
    let closed = false; const context = {} as BrowserContext;
    const browser = { contexts: () => [context], version: () => "Chrome/140", close: async () => { closed = true; } } as unknown as Browser;
    const driver = new ExternalCdpDriver(async () => browser);
    const session = await driver.launch({ driver: { kind: "EXTERNAL_CDP", endpoint: "http://127.0.0.1:9222" }, userDataDir: "unused", proxy: null });
    expect(session.metadata).toMatchObject({ kind: "EXTERNAL_CDP", ownsBrowser: false, stealthStatus: "EXTERNAL" });
    await session.stop(); expect(closed).toBe(false);
  });

  it("redacts connector failures behind a stable external-CDP error", async () => {
    const driver = new ExternalCdpDriver(async () => { throw new Error("connect ECONNREFUSED http://127.0.0.1:9222/devtools/browser/private-token"); });
    await expect(driver.launch({ driver: { kind: "EXTERNAL_CDP", endpoint: "http://127.0.0.1:9222/devtools/browser/private-token" }, userDataDir: "unused", proxy: null })).rejects.toMatchObject({ code: "EXTERNAL_CDP_CONNECTION_FAILED", message: expect.not.stringContaining("private-token") });
  });
});
