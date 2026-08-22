import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { IPC_VERSION, runnerCommandSchema, type RunnerEvent, type RunnerProxy, type RunnerRecording, type RunArtifact, type RunEvent } from "@copify/shared";
import { findChromeExecutable, toPlaywrightProxy, verifyRoute } from "./network";

let context: BrowserContext | undefined;
let profileId: string | undefined;
let stopping = false;
let recording: RunnerRecording | undefined;
let startedMono: bigint | undefined;

process.on("message", async (message: unknown) => {
  const command = runnerCommandSchema.safeParse(message); if (!command.success) return;
  if (command.data.type === "START") await start(command.data.profileId, command.data.userDataDir, command.data.proxy, command.data.probeUrl, command.data.recording);
  if (command.data.type === "END_RUN") await endRun(command.data.runSessionId);
  if (command.data.type === "STOP") await stop();
});

async function start(id: string, userDataDir: string, proxy: RunnerProxy | null, probeUrl: string, runRecording: RunnerRecording | null): Promise<void> {
  if (context) return; profileId = id; recording = runRecording ?? undefined; startedMono = process.hrtime.bigint();
  try {
    const options: Parameters<typeof chromium.launchPersistentContext>[1] = {
      headless: false, executablePath: findChromeExecutable(), args: ["--no-first-run", "--no-default-browser-check"], proxy: proxy ? toPlaywrightProxy(proxy) : undefined
    };
    if (recording?.diagnosticLevel === "DEEP_DEBUG") {
      await mkdir(recording.artifactDir, { recursive: true });
      options.recordHar = { path: join(recording.artifactDir, "network.har"), mode: "minimal", content: "omit" };
      options.recordVideo = { dir: join(recording.artifactDir, "video") };
    }
    context = await chromium.launchPersistentContext(userDataDir, options);
    context.on("close", () => { context = undefined; if (!stopping) process.exit(1); });
    if (recording) await beginRecording(context, recording);
    if (context.pages().length === 0) await context.newPage();
    const route = await verifyRoute(context, proxy, probeUrl);
    emitRun("ROUTE_VERIFIED", { kind: route.kind, verification: route.verification });
    send({ type: "READY", version: IPC_VERSION, profileId: id, route });
  } catch (error) {
    if (recording) emitRun("RECORDING_OR_LAUNCH_FAILED", { message: sanitizeText(error instanceof Error ? error.message : "unknown") });
    const classified = classifyLaunchError(error); send({ type: "ERROR", version: IPC_VERSION, profileId: id, code: classified.code, message: classified.message });
    setTimeout(() => process.exit(1), 25).unref();
  }
}

async function beginRecording(activeContext: BrowserContext, value: RunnerRecording): Promise<void> {
  await mkdir(value.artifactDir, { recursive: true });
  emitRun("RECORDING_STARTED", { diagnosticLevel: value.diagnosticLevel });
  activeContext.on("page", (page) => observePage(page));
  activeContext.on("requestfailed", (request) => emitRun("NETWORK_FAILED", sanitizeRequest(request.url(), request.method(), request.resourceType(), request.failure()?.errorText ?? "NETWORK_FAILED")));
  activeContext.on("response", (response) => {
    const status = response.status(); if (status >= 400) emitRun("HTTP_STATUS", { ...sanitizeRequest(response.url(), response.request().method(), response.request().resourceType()), status });
  });
  for (const page of activeContext.pages()) observePage(page);
  if (value.diagnosticLevel !== "NORMAL") {
    await activeContext.tracing.start({ screenshots: true, snapshots: true, sources: true, title: value.runId });
  }
  if (value.diagnosticLevel === "DEEP_DEBUG") {
    emitArtifact("HAR", "network.har", true);
    emitArtifact("VIDEO", "video", true);
  }
  await screenshot("initial.png", false);
}

function observePage(page: Page): void {
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) emitRun("NAVIGATION", sanitizeRequest(frame.url(), "GET", "document")); });
  page.on("pageerror", (error) => { emitRun("PAGE_ERROR", { message: sanitizeText(error.message) }); void screenshot(`error-${Date.now()}.png`, false); });
  page.on("console", (message) => { if (recording?.diagnosticLevel !== "NORMAL") emitRun("CONSOLE", { level: message.type(), text: sanitizeText(message.text()) }); });
}

async function endRun(runSessionId: string): Promise<void> {
  if (!recording || recording.runSessionId !== runSessionId) return;
  try {
    await screenshot("final.png", false);
    if (recording.diagnosticLevel !== "NORMAL" && context) {
      await context.tracing.stop({ path: join(recording.artifactDir, "trace.zip") }); emitArtifact("TRACE", "trace.zip", true);
    }
    emitRun("RECORDING_ENDED", {});
  } catch (error) {
    emitRun("RECORDING_FAILED", { message: sanitizeText(error instanceof Error ? error.message : "unknown") });
  } finally {
    const id = profileId; const current = recording; recording = undefined;
    if (id && current) send({ type: "RUN_ENDED", version: IPC_VERSION, profileId: id, runSessionId: current.runSessionId });
  }
}

async function screenshot(name: string, sensitive: boolean): Promise<void> {
  if (!recording || !context) return;
  const page = context.pages()[0]; if (!page) return;
  try { await page.screenshot({ path: join(recording.artifactDir, name), fullPage: false }); emitArtifact("SCREENSHOT", name, sensitive); } catch { /* A transient page cannot prevent recording. */ }
}

function emitRun(type: string, payload: Record<string, unknown>): void {
  if (!recording || !profileId || !startedMono) return;
  const event: RunEvent = { id: randomUUID(), runId: recording.runId, runSessionId: recording.runSessionId, wallTimeMs: Date.now(), elapsedNs: (process.hrtime.bigint() - startedMono).toString(), type, stateBefore: null, stateAfter: null, payload: sanitizePayload(payload) };
  send({ type: "RUN_EVENT", version: IPC_VERSION, profileId, event });
}

function emitArtifact(kind: RunArtifact["kind"], localPath: string, sensitive: boolean): void {
  if (!recording || !profileId) return;
  const artifact: RunArtifact = { id: randomUUID(), runId: recording.runId, runSessionId: recording.runSessionId, kind, relativePath: localPath.replace(/\\/g, "/"), sensitive, createdAt: Date.now() };
  send({ type: "RUN_ARTIFACT", version: IPC_VERSION, profileId, artifact });
}

async function stop(): Promise<void> {
  stopping = true; const id = profileId;
  try { if (recording) await endRun(recording.runSessionId); await context?.close(); } finally { context = undefined; if (id) send({ type: "STOPPED", version: IPC_VERSION, profileId: id }); process.exit(0); }
}

function sanitizeRequest(url: string, method: string, resourceType: string, error?: string): Record<string, unknown> {
  try {
    const parsed = new URL(url); const firstSegment = parsed.pathname.split("/").filter(Boolean)[0] ?? "root";
    const pathClass = /checkout|cart|account|login/i.test(firstSegment) ? firstSegment.toLowerCase() : /api/i.test(firstSegment) ? "api" : resourceType === "document" ? "document" : "asset";
    return { method, host: parsed.host, pathClass, resourceType, ...(error ? { error: sanitizeText(error) } : {}) };
  } catch { return { method, host: "invalid-url", pathClass: "unknown", resourceType, ...(error ? { error: sanitizeText(error) } : {}) }; }
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, typeof value === "string" ? sanitizeText(value) : value])); }
export function sanitizeText(value: string): string { return value.replace(/(authorization|cookie|set-cookie|password|token|secret|proxy[-_ ]?authorization)\s*[:=]\s*(?:bearer\s+)?[^\s;,&]+/gi, "$1=[REDACTED]").replace(/([?&](?:token|code|key|password|secret|session)=[^&\s]+)/gi, "[REDACTED_QUERY]").slice(0, 2_000); }
function send(event: RunnerEvent): void { process.send?.(event); }
function classifyLaunchError(error: unknown): { code: "BROWSER_START_FAILED" | "PROXY_CONNECTION_FAILED" | "PROXY_AUTH_FAILED" | "UNKNOWN"; message: string } {
  const message = error instanceof Error ? error.message : "";
  if (/407|proxy auth/i.test(message)) return { code: "PROXY_AUTH_FAILED", message: "Chrome could not authenticate with the configured proxy." };
  if (/ERR_PROXY|ERR_TUNNEL|proxy/i.test(message)) return { code: "PROXY_CONNECTION_FAILED", message: "Chrome could not connect through the configured proxy." };
  return { code: "BROWSER_START_FAILED", message: "Chrome could not be started." };
}
