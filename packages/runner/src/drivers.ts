import { chromium, type Browser, type BrowserContext } from "rebrowser-playwright";
import type { BrowserDriverMetadata, RunnerBrowserDriver, RunnerProxy } from "@copify/shared";
import { findChromeExecutable, toPlaywrightProxy } from "./network";

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

export function nativeStealthLaunchOptions(proxy: RunnerProxy | null, persistentOptions: DriverLaunchInput["persistentOptions"] = {}): NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]> {
  return {
    headless: false,
    executablePath: findChromeExecutable(),
    args: buildNativeStealthArgs(),
    ignoreDefaultArgs: [...UNSAFE_OR_AUTOMATION_DEFAULT_ARGS],
    proxy: proxy ? toPlaywrightProxy(proxy) : undefined,
    ...persistentOptions,
  };
}

export class NativeStealthDriver implements BrowserDriver {
  async launch(input: DriverLaunchInput): Promise<DriverSession> {
    if (input.driver.kind !== "NATIVE_STEALTH") throw new BrowserDriverError("INVALID_DRIVER_ENDPOINT", "NativeStealthDriver received an incompatible driver configuration.");
    const context = await chromium.launchPersistentContext(input.userDataDir, nativeStealthLaunchOptions(input.proxy, input.persistentOptions));
    try {
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
