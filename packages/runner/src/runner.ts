import { existsSync } from "node:fs";
import { chromium, type BrowserContext } from "playwright";
import { IPC_VERSION, runnerCommandSchema, type RunnerEvent } from "@copify/shared";

let context: BrowserContext | undefined;
let profileId: string | undefined;
let stopping = false;

process.on("message", async (message: unknown) => {
  const command = runnerCommandSchema.safeParse(message);
  if (!command.success) return;
  if (command.data.type === "START") await start(command.data.profileId, command.data.userDataDir);
  if (command.data.type === "STOP") await stop();
});

async function start(id: string, userDataDir: string): Promise<void> {
  if (context) return;
  profileId = id;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      executablePath: findChromeExecutable(),
      args: ["--no-first-run", "--no-default-browser-check"]
    });
    context.on("close", () => {
      context = undefined;
      if (!stopping) process.exit(1);
    });
    if (context.pages().length === 0) await context.newPage();
    send({ type: "READY", version: IPC_VERSION, profileId: id });
  } catch (error) {
    send({ type: "ERROR", version: IPC_VERSION, profileId: id, code: "BROWSER_START_FAILED", message: error instanceof Error ? error.message : "Chrome could not be started." });
    setTimeout(() => process.exit(1), 25).unref();
  }
}

async function stop(): Promise<void> {
  stopping = true;
  const id = profileId;
  try { await context?.close(); }
  finally {
    context = undefined;
    if (id) send({ type: "STOPPED", version: IPC_VERSION, profileId: id });
    process.exit(0);
  }
}

function send(event: RunnerEvent): void { process.send?.(event); }

function findChromeExecutable(): string | undefined {
  if (process.platform !== "win32") return undefined;
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [
    `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
    localAppData && `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find(existsSync);
}
