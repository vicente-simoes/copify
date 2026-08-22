import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  SCHEMA_VERSION, createBrowserProfileSchema, createProxyProfileSchema, createRunSchema, createTargetSchema, defaultRoute, monitorEventSchema, networkProbeSettingsSchema, profileIpc, proxyIpc, runIpc, settingsIpc, sessionIpc, targetIpc, updateBrowserProfileSchema, updateProxyProfileSchema, updateTargetSchema,
  type ApiResult, type BrowserProfile, type CreateProxyProfileInput, type CreateRunInput, type CreateTargetInput, type MonitorEvent, type ProxyBenchmark, type ProxyProfile, type RunDetail, type RunEnvironment, type RunEvent, type RunSession, type RunnerEvent, type RunnerProxy, type RunnerRecording, type SessionError, type SessionRoute, type SessionSnapshot, type Target, type TargetCheck, type TargetSnapshot, type UpdateProxyProfileInput, type UpdateTargetInput
} from "@copify/shared";
import { openProfileRepository, type EncryptedProxyCredentialUpdate, type EncryptedProxyCredentials, type ProfileRepository } from "@copify/persistence";
import { SessionOrchestrator, nodeRunnerFactory, type SessionLaunchSpec } from "@copify/core";
import { benchmarkRoute } from "@copify/runner";

let mainWindow: BrowserWindow | undefined;
let profiles: ProfileRepository;
let orchestrator: SessionOrchestrator;
let benchmarkRunning = false;
let runsRoot = "";
type ActiveRun = { detail: RunDetail; profileSessions: Map<string, RunSession>; ending: boolean; pendingEnd: Set<string>; resolveEnd?: () => void; monitor?: ChildProcess };
let activeRun: ActiveRun | undefined;

function result<T>(action: () => T): ApiResult<T> { try { return { ok: true, value: action() }; } catch (error) { return { ok: false, error: message(error) }; } }
async function resultAsync<T>(action: () => Promise<T>): Promise<ApiResult<T>> { try { return { ok: true, value: await action() }; } catch (error) { return { ok: false, error: message(error) }; } }
function message(error: unknown): string { return error instanceof Error ? error.message : "Unexpected application error."; }
function emitRunsChanged(): void { void profiles.listRuns().then((runs) => mainWindow?.webContents.send(runIpc.changed, { runs, activeRunId: activeRun?.detail.run.id ?? null })); }
function emitTargetsChanged(): void { void profiles.listTargets().then((targets) => mainWindow?.webContents.send(targetIpc.changed, targets)); }

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({ width: 1240, height: 860, minWidth: 960, minHeight: 650, icon: windowIconPath(), webPreferences: { preload: join(__dirname, "../preload/preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false } });
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL); else await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}
function windowIconPath(): string { return app.isPackaged ? join(process.resourcesPath, "copify.ico") : resolve(__dirname, "../../resources/icons/copify.ico"); }

function registerIpc(): void {
  ipcMain.handle(profileIpc.list, (): Promise<ApiResult<BrowserProfile[]>> => resultAsync(() => profiles.list()));
  ipcMain.handle(profileIpc.create, (_event, input: unknown): Promise<ApiResult<BrowserProfile>> => resultAsync(() => profiles.create(createBrowserProfileSchema.parse(input))));
  ipcMain.handle(profileIpc.update, (_event, id: string, input: unknown): Promise<ApiResult<BrowserProfile>> => resultAsync(async () => {
    const update = updateBrowserProfileSchema.parse(input); if (orchestrator.isActive(id) && update.proxyProfileId !== undefined) throw new Error("Close this browser session before changing its route."); if (activeRun?.profileSessions.has(id)) throw new Error("End the active run before changing a selected browser profile."); return profiles.update(id, update);
  }));
  ipcMain.handle(profileIpc.remove, async (_event, id: string): Promise<ApiResult<boolean>> => { if (activeRun?.profileSessions.has(id)) return { ok: false, error: "End the active run before removing a selected browser profile." }; await orchestrator.close(id); return resultAsync(() => profiles.remove(id)); });

  ipcMain.handle(targetIpc.list, (): Promise<ApiResult<Target[]>> => resultAsync(() => profiles.listTargets()));
  ipcMain.handle(targetIpc.create, (_event, input: unknown): Promise<ApiResult<Target>> => resultAsync(async () => { const created = await profiles.createTarget(createTargetSchema.parse(input)); emitTargetsChanged(); return created; }));
  ipcMain.handle(targetIpc.update, (_event, id: string, input: unknown): Promise<ApiResult<Target>> => resultAsync(async () => { assertTargetInactive(id); const updated = await profiles.updateTarget(id, updateTargetSchema.parse(input)); emitTargetsChanged(); return updated; }));
  ipcMain.handle(targetIpc.remove, (_event, id: string): Promise<ApiResult<boolean>> => resultAsync(async () => { assertTargetInactive(id); const removed = await profiles.removeTarget(id); emitTargetsChanged(); return removed; }));
  ipcMain.handle(targetIpc.test, (_event, id: string): Promise<ApiResult<Target>> => resultAsync(async () => { const target = await requireTarget(id); const check = await testTarget(target); const updated = await profiles.setTargetCheck(id, check); emitTargetsChanged(); return updated; }));

  ipcMain.handle(proxyIpc.list, (): Promise<ApiResult<ProxyProfile[]>> => resultAsync(() => profiles.listProxies()));
  ipcMain.handle(proxyIpc.create, (_event, input: unknown): Promise<ApiResult<ProxyProfile>> => resultAsync(async () => { const parsed = createProxyProfileSchema.parse(input); return profiles.createProxy(parsed, await encryptCreateCredentials(parsed)); }));
  ipcMain.handle(proxyIpc.update, (_event, id: string, input: unknown): Promise<ApiResult<ProxyProfile>> => resultAsync(async () => { await assertProxyInactive(id); const parsed = updateProxyProfileSchema.parse(input); return profiles.updateProxy(id, parsed, await encryptUpdateCredentials(parsed)); }));
  ipcMain.handle(proxyIpc.remove, (_event, id: string): Promise<ApiResult<boolean>> => resultAsync(async () => { await assertProxyInactive(id); return profiles.removeProxy(id); }));
  ipcMain.handle(proxyIpc.benchmarks, (_event, proxyId: string | null): Promise<ApiResult<ProxyBenchmark[]>> => resultAsync(() => profiles.listBenchmarks(proxyId, 10)));
  ipcMain.handle(proxyIpc.test, (_event, proxyId: string | null): Promise<ApiResult<ProxyBenchmark>> => resultAsync(async () => { if (benchmarkRunning) throw new Error("A network benchmark is already running."); benchmarkRunning = true; try { const proxy = proxyId ? await resolveProxy(proxyId, true) : null; return profiles.addBenchmark(await benchmarkRoute(proxy, await profiles.getNetworkProbeUrl())); } finally { benchmarkRunning = false; } }));

  ipcMain.handle(settingsIpc.getNetworkProbe, (): Promise<ApiResult<{ probeUrl: string }>> => resultAsync(async () => ({ probeUrl: await profiles.getNetworkProbeUrl() })));
  ipcMain.handle(settingsIpc.updateNetworkProbe, (_event, input: unknown): Promise<ApiResult<{ probeUrl: string }>> => resultAsync(async () => { const { probeUrl } = networkProbeSettingsSchema.parse(input); return { probeUrl: await profiles.setNetworkProbeUrl(probeUrl) }; }));

  ipcMain.handle(sessionIpc.list, (): ApiResult<SessionSnapshot[]> => result(() => orchestrator.list()));
  ipcMain.handle(sessionIpc.open, (_event, id: string): Promise<ApiResult<SessionSnapshot>> => resultAsync(() => openSession(id)));
  ipcMain.handle(sessionIpc.close, async (_event, id: string): Promise<ApiResult<SessionSnapshot>> => { await orchestrator.close(id); return { ok: true, value: orchestrator.snapshot(id) }; });
  ipcMain.handle(sessionIpc.restart, (_event, id: string): Promise<ApiResult<SessionSnapshot>> => resultAsync(() => restartSession(id)));
  ipcMain.handle(sessionIpc.openAll, (): Promise<ApiResult<SessionSnapshot[]>> => resultAsync(async () => { if (activeRun) throw new Error("End the active run before opening all profiles."); const enabled = (await profiles.list()).filter((profile) => profile.enabled); await Promise.all(enabled.map(async (profile) => { try { await orchestrator.open(await launchSpec(profile)); } catch (error) { orchestrator.fail(profile.id, sessionFailure(error)); } })); return orchestrator.list(); }));
  ipcMain.handle(sessionIpc.closeAll, async (): Promise<ApiResult<SessionSnapshot[]>> => { await orchestrator.shutdown(); return { ok: true, value: orchestrator.list() }; });

  ipcMain.handle(runIpc.list, (): Promise<ApiResult<{ runs: import("@copify/shared").Run[]; activeRunId: string | null }>> => resultAsync(async () => ({ runs: await profiles.listRuns(), activeRunId: activeRun?.detail.run.id ?? null })));
  ipcMain.handle(runIpc.get, (_event, id: string): Promise<ApiResult<RunDetail | null>> => resultAsync(async () => (await profiles.getRun(id)) ?? null));
  ipcMain.handle(runIpc.start, (_event, input: unknown): Promise<ApiResult<RunDetail>> => resultAsync(() => startRun(createRunSchema.parse(input))));
  ipcMain.handle(runIpc.end, (): Promise<ApiResult<RunDetail>> => resultAsync(() => endRun()));
  ipcMain.handle(runIpc.remove, (_event, id: string): Promise<ApiResult<boolean>> => resultAsync(() => removeRun(id)));
}

async function startRun(input: CreateRunInput): Promise<RunDetail> {
  if (activeRun) throw new Error("Only one run can record at a time.");
  const allProfiles = await profiles.list(); const selected = input.profileIds.map((id) => allProfiles.find((profile) => profile.id === id)).filter((profile): profile is BrowserProfile => Boolean(profile));
  if (selected.length !== input.profileIds.length) throw new Error("One or more selected browser profiles no longer exist.");
  if (selected.some((profile) => !profile.enabled)) throw new Error("Only enabled browser profiles may be selected.");
  if (selected.some((profile) => orchestrator.isActive(profile.id))) throw new Error("Selected profiles must be closed before starting a run.");
  const target = input.targetId ? await requireTarget(input.targetId) : null;
  if (target && !target.enabled) throw new Error("Select an enabled target for monitoring.");
  const targetSnapshot = target ? snapshotTarget(target) : null;
  const specifications = await Promise.all(selected.map(async (profile) => ({ profile, proxy: profile.proxyProfileId ? await resolveProxy(profile.proxyProfileId) : null })));
  const startedAt = Date.now(); const sessions: RunSession[] = specifications.map(({ profile, proxy }) => ({ id: randomUUID(), runId: randomUUID(), browserProfileId: profile.id, browserProfileName: profile.name, route: initialRoute(proxy), status: "STARTING", startedAt, endedAt: null, finalError: null }));
  const environment = runEnvironment(); const detail = await profiles.createRun(input, environment, sessions, targetSnapshot);
  const profileSessions = new Map(detail.sessions.map((session) => [session.browserProfileId, session])); activeRun = { detail, profileSessions, ending: false, pendingEnd: new Set() };
  const root = runDirectory(detail.run.id); await mkdir(root, { recursive: true }); await writeFile(join(root, "run.json"), JSON.stringify(detail.run, null, 2));
  await Promise.all(specifications.map(async ({ profile, proxy }) => {
    const session = profileSessions.get(profile.id)!; const artifactDir = join(root, session.id); await mkdir(artifactDir, { recursive: true }); await writeFile(join(artifactDir, "manifest.json"), JSON.stringify({ runId: detail.run.id, runSessionId: session.id, profileId: profile.id, diagnosticLevel: input.diagnosticLevel }, null, 2));
    try { await orchestrator.open({ profile, proxy, probeUrl: await profiles.getNetworkProbeUrl(), recording: { runId: detail.run.id, runSessionId: session.id, diagnosticLevel: input.diagnosticLevel, artifactDir, startedAt } }); } catch (error) { await recordSessionFailure(profile.id, session, sessionFailure(error)); }
  }));
  if (targetSnapshot) activeRun.monitor = startMonitor(detail.run.id, targetSnapshot);
  emitRunsChanged(); return (await profiles.getRun(detail.run.id))!;
}

async function endRun(): Promise<RunDetail> {
  const active = activeRun; if (!active) throw new Error("No run is currently recording."); active.ending = true;
  if (active.monitor) await appendMonitorEvent(active.detail.run.id, "TARGET_MONITOR_STOPPED", null, "The shared target monitor was stopped when the run ended.");
  stopMonitor(active);
  const activeProfiles = [...active.profileSessions.entries()].filter(([profileId]) => orchestrator.isActive(profileId)); active.pendingEnd = new Set(activeProfiles.map(([, session]) => session.id));
  const wait = new Promise<void>((resolve) => { active.resolveEnd = resolve; });
  for (const [profileId, session] of activeProfiles) orchestrator.endRun(profileId, session.id);
  if (active.pendingEnd.size === 0) active.resolveEnd?.();
  await Promise.race([wait, new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
  for (const session of active.profileSessions.values()) if (session.status !== "FAILED") { session.status = "ENDED"; await profiles.setRunSession(session.id, "ENDED"); }
  await profiles.setRunStatus(active.detail.run.id, "COMPLETED", true); const completed = (await profiles.getRun(active.detail.run.id))!; activeRun = undefined; emitRunsChanged(); return completed;
}

async function removeRun(id: string): Promise<boolean> {
  if (activeRun?.detail.run.id === id) throw new Error("End the active run before deleting it."); const removed = await profiles.removeRun(id); if (removed) { const target = runDirectory(id); await rm(target, { recursive: true, force: true }); } emitRunsChanged(); return removed;
}

async function openSession(id: string): Promise<SessionSnapshot> { const profile = await requireProfile(id); try { await orchestrator.open(await launchSpec(profile)); } catch (error) { orchestrator.fail(id, sessionFailure(error)); throw error; } return orchestrator.snapshot(id); }
async function restartSession(id: string): Promise<SessionSnapshot> { const profile = await requireProfile(id); try { await orchestrator.restart(await launchSpec(profile)); } catch (error) { orchestrator.fail(id, sessionFailure(error)); throw error; } return orchestrator.snapshot(id); }
async function requireProfile(id: string): Promise<BrowserProfile> { const profile = await profiles.get(id); if (!profile) throw new Error("Browser profile not found."); return profile; }
async function requireTarget(id: string): Promise<Target> { const target = await profiles.getTarget(id); if (!target) throw new Error("Target not found."); return target; }
function assertTargetInactive(id: string): void { if (activeRun?.detail.run.targetSnapshot?.targetId === id) throw new Error("End the active run before changing its target."); }
function snapshotTarget(target: Target): TargetSnapshot { const { id, latestCheck: _latestCheck, createdAt: _createdAt, updatedAt: _updatedAt, ...value } = target; return { ...value, targetId: id, capturedAt: Date.now() }; }
async function launchSpec(profile: BrowserProfile): Promise<SessionLaunchSpec> { return { profile, proxy: profile.proxyProfileId ? await resolveProxy(profile.proxyProfileId) : null, probeUrl: await profiles.getNetworkProbeUrl(), recording: null }; }
function initialRoute(proxy: RunnerProxy | null): SessionRoute { return proxy ? { kind: "proxy", proxyProfileId: proxy.proxyProfileId, proxyName: proxy.proxyName, protocol: proxy.protocol, verification: defaultRoute().verification } : defaultRoute(); }
async function resolveProxy(id: string, allowDisabled = false): Promise<RunnerProxy> { const stored = await profiles.getStoredProxy(id); if (!stored) throw new Error("The assigned proxy profile no longer exists."); if (!allowDisabled && !stored.enabled) throw new Error("The assigned proxy profile is disabled."); const username = stored.usernameCiphertext ? await decryptSecret(stored.usernameCiphertext) : undefined; const password = stored.passwordCiphertext ? await decryptSecret(stored.passwordCiphertext) : undefined; return { proxyProfileId: stored.id, proxyName: stored.name, protocol: stored.protocol, host: stored.host, port: stored.port, ...(username ? { username } : {}), ...(password ? { password } : {}), expectedCountry: stored.expectedCountry, expectedCity: stored.expectedCity }; }
async function assertProxyInactive(proxyId: string): Promise<void> { const active = (await profiles.list()).some((profile) => profile.proxyProfileId === proxyId && (orchestrator.isActive(profile.id) || activeRun?.profileSessions.has(profile.id))); if (active) throw new Error("Close every browser using this proxy and end any active run before changing it."); }
async function encryptCreateCredentials(input: CreateProxyProfileInput): Promise<EncryptedProxyCredentials> { return { ...(input.username ? { username: await encryptSecret(input.username) } : {}), ...(input.password ? { password: await encryptSecret(input.password) } : {}) }; }
async function encryptUpdateCredentials(input: UpdateProxyProfileInput): Promise<EncryptedProxyCredentialUpdate> { return { ...(input.username === undefined ? {} : { username: input.username === null ? null : await encryptSecret(input.username) }), ...(input.password === undefined ? {} : { password: input.password === null ? null : await encryptSecret(input.password) }) }; }
async function encryptSecret(value: string): Promise<Buffer> { if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("Secure OS credential storage is unavailable. Credentials were not saved."); return safeStorage.encryptStringAsync(value); }
async function decryptSecret(value: Buffer): Promise<string> { if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("Secure OS credential storage is unavailable."); return (await safeStorage.decryptStringAsync(value)).result; }
function sessionFailure(error: unknown): SessionError { const text = message(error); return { code: /credential storage/i.test(text) ? "SECRET_STORAGE_UNAVAILABLE" : /disabled|assigned proxy|proxy profile/i.test(text) ? "PROXY_CONNECTION_FAILED" : "UNKNOWN", message: text }; }
function runEnvironment(): RunEnvironment { return { appVersion: app.getVersion(), schemaVersion: SCHEMA_VERSION, osVersion: `${process.platform} ${process.getSystemVersion?.() ?? process.version}`, chromeVersion: process.versions.chrome ?? null, playwrightVersion: "1.56.1", capturedAt: Date.now() }; }
function runDirectory(id: string): string { const root = resolve(runsRoot); const candidate = resolve(root, id); if (!candidate.startsWith(`${root}${sep}`)) throw new Error("Invalid run artifact path."); return candidate; }
function elapsedSince(active: ActiveRun): string { return (BigInt(Date.now() - active.detail.run.startedAt) * 1_000_000n).toString(); }

function startMonitor(runId: string, target: TargetSnapshot): ChildProcess {
  const worker = fork(join(__dirname, "monitor.js"), [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  worker.on("message", (value) => { void onMonitorEvent(value); }); worker.once("exit", () => { if (activeRun?.detail.run.id === runId && !activeRun.ending) void appendMonitorEvent(runId, "TARGET_MONITOR_FAILED", null, "The shared monitor exited unexpectedly."); });
  worker.send({ type: "START_MONITOR", version: 4, runId, target }); return worker;
}
function stopMonitor(active: ActiveRun): void { if (!active.monitor) return; active.monitor.send({ type: "STOP_MONITOR", version: 4 }); setTimeout(() => active.monitor?.kill(), 3_000).unref(); active.monitor = undefined; }
async function testTarget(target: Target): Promise<TargetCheck> {
  const worker = fork(join(__dirname, "monitor.js"), [], { stdio: ["ignore", "ignore", "ignore", "ipc"] }); const snapshot = snapshotTarget(target);
  return new Promise<TargetCheck>((resolve, reject) => {
    const timeout = setTimeout(() => { worker.kill(); reject(new Error("Target test timed out.")); }, 45_000);
    worker.on("message", (value) => { const event = monitorEventSchema.safeParse(value); if (event.success && event.data.type === "MONITOR_TEST_RESULT") { clearTimeout(timeout); worker.kill(); resolve(event.data.check); } });
    worker.once("exit", (code) => { if (code && code !== 0) { clearTimeout(timeout); reject(new Error("Target test monitor exited unexpectedly.")); } });
    worker.send({ type: "TEST_TARGET", version: 4, target: snapshot });
  });
}
async function onMonitorEvent(value: unknown): Promise<void> {
  const parsed = monitorEventSchema.safeParse(value); if (!parsed.success) return; const event: MonitorEvent = parsed.data; if (event.type !== "MONITOR_EVENT") return; const active = activeRun; if (!active || event.runId !== active.detail.run.id) return;
  await appendMonitorEvent(active.detail.run.id, event.eventType, event.check, null); emitRunsChanged();
}
async function appendMonitorEvent(runId: string, type: string, check: TargetCheck | null, fallback: string | null): Promise<void> {
  const active = activeRun; if (!active || active.detail.run.id !== runId) return; const decision = check?.decision;
  await profiles.addRunEvent({ id: randomUUID(), runId, runSessionId: null, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type, stateBefore: null, stateAfter: null, payload: check ? { checkedAt: check.checkedAt, status: check.status, candidateCount: check.candidateCount, decision: decision?.kind, message: decision?.message, candidate: decision?.candidate ? { name: decision.candidate.name, url: decision.candidate.url, priceMinor: decision.candidate.priceMinor, currency: decision.candidate.currency, variants: decision.candidate.variants } : null, selectedVariant: decision?.selectedVariant ?? null, errorMessage: check.errorMessage } : { message: fallback } });
}

async function onSessionChanged(snapshot: SessionSnapshot): Promise<void> {
  mainWindow?.webContents.send(sessionIpc.changed, snapshot); const active = activeRun; const runSession = active?.profileSessions.get(snapshot.profileId); if (!active || !runSession) return;
  if (snapshot.state === "READY") { runSession.status = "RECORDING"; runSession.route = snapshot.route; await profiles.setRunSession(runSession.id, "RECORDING", snapshot.route); await profiles.addRunEvent({ id: randomUUID(), runId: active.detail.run.id, runSessionId: runSession.id, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type: "SESSION_READY", stateBefore: "STARTING", stateAfter: "RECORDING", payload: { route: snapshot.route.kind, verification: snapshot.route.verification.status } }); await profiles.setRunStatus(active.detail.run.id, "RECORDING"); emitRunsChanged(); }
  if (snapshot.state === "ERROR" || snapshot.state === "CRASHED") await recordSessionFailure(snapshot.profileId, runSession, snapshot.error ?? { code: "RUNNER_CRASHED", message: "The browser runner exited unexpectedly." });
}
async function recordSessionFailure(profileId: string, session: RunSession, error: SessionError): Promise<void> { const active = activeRun; if (!active) return; session.status = "FAILED"; session.finalError = error; await profiles.setRunSession(session.id, "FAILED", undefined, error); await profiles.addRunEvent({ id: randomUUID(), runId: active.detail.run.id, runSessionId: session.id, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type: "SESSION_FAILED", stateBefore: null, stateAfter: "FAILED", payload: { code: error.code, message: error.message } }); emitRunsChanged(); }
async function onRunnerEvent(event: RunnerEvent): Promise<void> {
  const active = activeRun; if (!active || (event.type !== "RUN_EVENT" && event.type !== "RUN_ARTIFACT" && event.type !== "RUN_ENDED")) return;
  const session = active.profileSessions.get(event.profileId); if (!session) return;
  if (event.type === "RUN_EVENT" && event.event.runId === active.detail.run.id) await profiles.addRunEvent(event.event);
  if (event.type === "RUN_ARTIFACT" && event.artifact.runId === active.detail.run.id) await profiles.addRunArtifact(event.artifact);
  if (event.type === "RUN_ENDED" && event.runSessionId === session.id) { if (session.status !== "FAILED") session.status = "ENDED"; await profiles.setRunSession(session.id, session.status); active.pendingEnd.delete(session.id); if (active.pendingEnd.size === 0) active.resolveEnd?.(); }
  emitRunsChanged();
}

app.whenReady().then(async () => {
  const dataRoot = app.getPath("userData"); runsRoot = join(dataRoot, "runs"); profiles = openProfileRepository(join(dataRoot, "copify.sqlite"), join(dataRoot, "browser-profiles")); await profiles.recoverInterruptedRuns(); orchestrator = new SessionOrchestrator(nodeRunnerFactory(join(__dirname, "runner.js")));
  orchestrator.on("changed", (snapshot: SessionSnapshot) => { void onSessionChanged(snapshot); }); orchestrator.on("runner-event", (event: RunnerEvent) => { void onRunnerEvent(event); }); registerIpc(); await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});
app.on("before-quit", (event) => { if (!orchestrator) return; event.preventDefault(); if (activeRun) stopMonitor(activeRun); void orchestrator.shutdown().finally(() => { profiles?.close(); app.exit(0); }); });
