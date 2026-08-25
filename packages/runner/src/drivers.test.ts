import { describe, expect, it } from "vitest";
import type { Browser, BrowserContext, CDPSession, Page } from "rebrowser-playwright";
import { BrowserDriverError, buildNativeStealthArgs, createBrowserDriver, nativeStealthLaunchOptions, ExternalCdpDriver, installProxyAuthenticationFallback, NativeStealthDriver } from "./drivers";

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

  it("applies one immutable route identity at native context creation", () => {
    const options = nativeStealthLaunchOptions({
      proxyProfileId: "00000000-0000-4000-8000-000000000001", proxyName: "PT sticky", protocol: "http",
      host: "proxy.invalid", port: 8080, username: "user", password: "secret", expectedCountry: "PT", expectedCity: null,
    }, {}, {
      locale: "pt-PT", timezoneId: "Europe/Lisbon", acceptLanguage: "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      geolocation: { latitude: 38.7223, longitude: -9.1393 }, webRtcPolicy: "disable_non_proxied_udp",
    });
    expect(options.args).toEqual(expect.arrayContaining([
      "--lang=pt-PT", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ]));
    expect(options).toMatchObject({
      locale: "pt-PT", timezoneId: "Europe/Lisbon", geolocation: { latitude: 38.7223, longitude: -9.1393 },
      extraHTTPHeaders: { "Accept-Language": "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7" },
      proxy: { server: "http://proxy.invalid:8080", username: "user", password: "secret" },
    });
  });

  it("uses the direct-session WebRTC policy without inventing identity fields", () => {
    const options = nativeStealthLaunchOptions(null);
    expect(options.args).toContain("--force-webrtc-ip-handling-policy=default_public_interface_only");
    expect(options).not.toHaveProperty("locale");
    expect(options).not.toHaveProperty("timezoneId");
    expect(options).not.toHaveProperty("geolocation");
  });

  it("answers only proxy authentication challenges with the configured proxy credentials", async () => {
    const calls: Array<{ method: string; params?: unknown }> = [];
    let authRequired: ((event: { requestId: string; authChallenge: { source: string } }) => void) | undefined;
    const page = { isClosed: () => false, once: () => undefined } as unknown as Page;
    const session = {
      send: async (method: string, params?: unknown) => { calls.push({ method, params }); },
      on: (event: string, listener: typeof authRequired) => { if (event === "Fetch.authRequired") authRequired = listener; },
      detach: async () => undefined,
    } as unknown as CDPSession;
    const context = {
      pages: () => [page], on: () => undefined, newCDPSession: async () => session,
    } as unknown as Pick<BrowserContext, "pages" | "on" | "newCDPSession">;
    const proxy = {
      proxyProfileId: "00000000-0000-4000-8000-000000000001", proxyName: "PT sticky", protocol: "http" as const,
      host: "proxy.invalid", port: 8080, username: "private-user", password: "private-pass", expectedCountry: "PT", expectedCity: null,
    };

    await installProxyAuthenticationFallback(context, proxy);
    expect(calls).toContainEqual({ method: "Fetch.enable", params: { handleAuthRequests: true, patterns: [] } });

    authRequired?.({ requestId: "proxy-request", authChallenge: { source: "Proxy" } });
    authRequired?.({ requestId: "storefront-request", authChallenge: { source: "Server" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toContainEqual({ method: "Fetch.continueWithAuth", params: { requestId: "proxy-request", authChallengeResponse: { response: "ProvideCredentials", username: "private-user", password: "private-pass" } } });
    expect(calls).toContainEqual({ method: "Fetch.continueWithAuth", params: { requestId: "storefront-request", authChallengeResponse: { response: "Default" } } });
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
