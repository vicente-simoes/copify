import { chromium, type BrowserContext } from "playwright";
import { IPC_VERSION, runnerCommandSchema, type RunnerEvent, type RunnerProxy } from "@copify/shared";
import { findChromeExecutable, toPlaywrightProxy, verifyRoute } from "./network";

let context: BrowserContext | undefined;
let profileId: string | undefined;
let stopping = false;

process.on("message", async (message: unknown) => {
  const command = runnerCommandSchema.safeParse(message);
  if (!command.success) return;
  if (command.data.type === "START") await start(command.data.profileId, command.data.userDataDir, command.data.proxy, command.data.probeUrl);
  if (command.data.type === "STOP") await stop();
});

async function start(id: string, userDataDir: string, proxy: RunnerProxy | null, probeUrl: string): Promise<void> {
  if (context) return;
  profileId = id;
  try {
    context = await chromium.launchPersistentContext(userDataDir, { headless: false, executablePath: findChromeExecutable(), args: ["--no-first-run", "--no-default-browser-check"], proxy: proxy ? toPlaywrightProxy(proxy) : undefined });
    context.on("close", () => { context = undefined; if (!stopping) process.exit(1); });
    if (context.pages().length === 0) await context.newPage();
    const route = await verifyRoute(context, proxy, probeUrl);
    send({ type: "READY", version: IPC_VERSION, profileId: id, route });
  } catch (error) {
    const classified = classifyLaunchError(error);
    send({ type: "ERROR", version: IPC_VERSION, profileId: id, code: classified.code, message: classified.message });
    setTimeout(() => process.exit(1), 25).unref();
  }
}

async function stop(): Promise<void> {
  stopping = true; const id = profileId;
  try { await context?.close(); } finally { context = undefined; if (id) send({ type: "STOPPED", version: IPC_VERSION, profileId: id }); process.exit(0); }
}

function send(event: RunnerEvent): void { process.send?.(event); }
function classifyLaunchError(error: unknown): { code: "BROWSER_START_FAILED" | "PROXY_CONNECTION_FAILED" | "PROXY_AUTH_FAILED" | "UNKNOWN"; message: string } {
  const message = error instanceof Error ? error.message : "";
  if (/407|proxy auth/i.test(message)) return { code: "PROXY_AUTH_FAILED", message: "Chrome could not authenticate with the configured proxy." };
  if (/ERR_PROXY|ERR_TUNNEL|proxy/i.test(message)) return { code: "PROXY_CONNECTION_FAILED", message: "Chrome could not connect through the configured proxy." };
  return { code: "BROWSER_START_FAILED", message: "Chrome could not be started." };
}
