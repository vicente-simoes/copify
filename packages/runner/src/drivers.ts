import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "rebrowser-playwright";
import type { BrowserDriverMetadata, RunnerBrowserDriver, RunnerProxy } from "@copify/shared";
import { findChromeExecutable, toPlaywrightProxy } from "./network";
import type { NativeCoherenceOptions } from "./coherence";

export type DriverSession = {
  context: BrowserContext;
  metadata: BrowserDriverMetadata;
  stop(): Promise<void>;
};

export type DriverLaunchInput = {
  driver: RunnerBrowserDriver;
  userDataDir: string;
  proxy: RunnerProxy | null;
  persistentOptions?: {
    recordHar?: { path: string; mode?: "full" | "minimal"; content?: "omit" | "embed" | "attach" };
    recordVideo?: { dir: string; size?: { width: number; height: number } };
  };
  coherence?: NativeCoherenceOptions;
};

export interface BrowserDriver {
  launch(input: DriverLaunchInput): Promise<DriverSession>;
}

const REQUIRED_CHROME_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-crash-restore-bubble",
  "--disable-features=Translate",
] as const;

const UNSAFE_OR_AUTOMATION_DEFAULT_ARGS = ["--enable-automation", "--no-sandbox"] as const;

export function buildNativeStealthArgs(extraArgs: readonly string[] = []): string[] {
  const args = [...REQUIRED_CHROME_ARGS, ...extraArgs];
  if (args.some((arg) => /^--enable-automation(?:=|$)/i.test(arg))) throw new BrowserDriverError("STEALTH_VERIFICATION_FAILED", "The Chrome launch configuration contains a forbidden automation flag.");
  if (args.some((arg) => /^--no-sandbox(?:=|$)|^--disable-setuid-sandbox(?:=|$)/i.test(arg))) throw new BrowserDriverError("STEALTH_VERIFICATION_FAILED", "The Chrome launch configuration contains a forbidden sandbox-disabling flag.");
  const keys = args.map(argumentKey);
  if (new Set(keys).size !== keys.length) throw new BrowserDriverError("STEALTH_VERIFICATION_FAILED", "The Chrome launch configuration contains duplicate or contradictory flags.");
  return args;
}

export function nativeStealthLaunchOptions(proxy: RunnerProxy | null, persistentOptions: DriverLaunchInput["persistentOptions"] = {}, coherence?: NativeCoherenceOptions): NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]> {
  return {
    headless: false,
    executablePath: findChromeExecutable(),
    args: buildNativeStealthArgs([
      `--force-webrtc-ip-handling-policy=${coherence?.webRtcPolicy ?? (proxy ? "disable_non_proxied_udp" : "default_public_interface_only")}`,
      ...(coherence?.locale ? [`--lang=${coherence.locale}`] : []),
    ]),
    ignoreDefaultArgs: [...UNSAFE_OR_AUTOMATION_DEFAULT_ARGS],
    proxy: proxy ? toPlaywrightProxy(proxy) : undefined,
    ...(coherence?.locale ? { locale: coherence.locale } : {}),
    ...(coherence?.timezoneId ? { timezoneId: coherence.timezoneId } : {}),
    ...(coherence?.geolocation ? { geolocation: coherence.geolocation } : {}),
    ...(coherence?.acceptLanguage ? { extraHTTPHeaders: { "Accept-Language": coherence.acceptLanguage } } : {}),
    ...persistentOptions,
  };
}

export class NativeStealthDriver implements BrowserDriver {
  async launch(input: DriverLaunchInput): Promise<DriverSession> {
    if (input.driver.kind !== "NATIVE_STEALTH") throw new BrowserDriverError("INVALID_DRIVER_ENDPOINT", "NativeStealthDriver received an incompatible driver configuration.");
    const context = await chromium.launchPersistentContext(input.userDataDir, nativeStealthLaunchOptions(input.proxy, input.persistentOptions, input.coherence));
    try {
      // Chromium's launch-time proxy credentials are normally sufficient. Some
      // authenticated gateways still surface a native 407 dialog, however. Handle
      // only proxy challenges through CDP, never by adding a Proxy-Authorization
      // header to storefront requests.
      await installProxyAuthenticationFallback(context, input.proxy);
      const page = context.pages()[0] ?? await context.newPage();
      const webdriver = await page.evaluate(() => navigator.webdriver);
      if (webdriver !== false) throw new BrowserDriverError("STEALTH_VERIFICATION_FAILED", "Chrome reported an automated webdriver environment. Copify refused to continue without stealth hardening.");
      return {
        context,
        metadata: metadata("NATIVE_STEALTH", true, context.browser()?.version() ?? null, "PASS", true, true),
        stop: async () => { await context.close(); },
      };
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
  }
}

type ProxyAuthChallenge = { requestId?: unknown; authChallenge?: { source?: unknown } };

/**
 * Keeps proxy credentials inside the runner and answers only CDP challenges that
 * Chromium identifies as originating from the proxy. Storefront 401 challenges
 * retain Chrome's normal behaviour and never receive proxy credentials.
 */
export async function installProxyAuthenticationFallback(
  context: Pick<BrowserContext, "pages" | "on" | "newCDPSession">,
  proxy: RunnerProxy | null,
): Promise<void> {
  if (!proxy?.username || !proxy.password) return;
  const attachedPages = new WeakSet<Page>();
  const attach = async (page: Page): Promise<void> => {
    if (attachedPages.has(page) || page.isClosed()) return;
    attachedPages.add(page);
    let session: CDPSession;
    try {
      session = await context.newCDPSession(page);
      await session.send("Fetch.enable", { handleAuthRequests: true, patterns: [] });
    } catch {
      // Launch-time proxy credentials remain the primary path. A CDP fallback
      // failure must not make an otherwise valid browser session unavailable.
      return;
    }
    session.on("Fetch.authRequired", (event: ProxyAuthChallenge) => {
      const requestId = typeof event.requestId === "string" ? event.requestId : null;
      if (!requestId) return;
      const isProxyChallenge = event.authChallenge?.source === "Proxy";
      void session.send("Fetch.continueWithAuth", {
        requestId,
        authChallengeResponse: isProxyChallenge
          ? { response: "ProvideCredentials", username: proxy.username, password: proxy.password }
          : { response: "Default" },
      }).catch(() => undefined);
    });
    page.once("close", () => { void session.detach().catch(() => undefined); });
  };
  await Promise.all(context.pages().map(attach));
  context.on("page", (page) => { void attach(page); });
}

export class ExternalCdpDriver implements BrowserDriver {
  constructor(private readonly connect: typeof chromium.connectOverCDP = chromium.connectOverCDP.bind(chromium)) {}
  async launch(input: DriverLaunchInput): Promise<DriverSession> {
    if (input.driver.kind !== "EXTERNAL_CDP") throw new BrowserDriverError("INVALID_DRIVER_ENDPOINT", "ExternalCdpDriver received an incompatible driver configuration.");
    if (input.proxy) throw new BrowserDriverError("DRIVER_CAPABILITY_UNAVAILABLE", "External CDP profiles cannot use a Copify-managed proxy. Configure the route in the external browser.");
    let browser: Browser;
    try {
      browser = await this.connect(input.driver.endpoint, { timeout: 15_000 });
    } catch {
      throw new BrowserDriverError("EXTERNAL_CDP_CONNECTION_FAILED", "Copify could not attach to the configured local CDP endpoint. Start the external browser and verify its endpoint.");
    }
    const context = browser.contexts()[0];
    if (!context) throw new BrowserDriverError("EXTERNAL_CDP_CONNECTION_FAILED", "The external browser did not expose a default CDP context.");
    return {
      context,
      metadata: metadata("EXTERNAL_CDP", false, browser.version(), "EXTERNAL", false, false),
      // The external tool owns the browser. Runner process exit drops this CDP
      // transport without asking Chrome to close.
      stop: async () => undefined,
    };
  }
}

export function createBrowserDriver(config: RunnerBrowserDriver): BrowserDriver {
  return config.kind === "NATIVE_STEALTH" ? new NativeStealthDriver() : new ExternalCdpDriver();
}

export class BrowserDriverError extends Error {
  constructor(readonly code: "INVALID_DRIVER_ENDPOINT" | "EXTERNAL_CDP_CONNECTION_FAILED" | "DRIVER_CAPABILITY_UNAVAILABLE" | "STEALTH_VERIFICATION_FAILED", message: string) { super(message); }
}

function argumentKey(value: string): string { return value.slice(0, value.indexOf("=") === -1 ? value.length : value.indexOf("=")).toLowerCase(); }
function metadata(kind: BrowserDriverMetadata["kind"], ownsBrowser: boolean, browserVersion: string | null, stealthStatus: BrowserDriverMetadata["stealthStatus"], managedProxy: boolean, launchHarVideo: boolean): BrowserDriverMetadata {
  return { kind, ownsBrowser, browserVersion, stealthStatus, capabilities: { managedProxy, launchHarVideo } };
}
