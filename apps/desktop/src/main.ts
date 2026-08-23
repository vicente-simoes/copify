import { app, BrowserWindow, Menu, ipcMain, safeStorage } from "electron";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  IPC_VERSION, SCHEMA_VERSION, createBrowserProfileSchema, createProxyProfileSchema, createRunSchema, createRunSetupSchema, createShippingProfileSchema, createTargetSchema, defaultRoute, isKnownStore, isMonitorable, listStoreManifests, monitorEventSchema, networkProbeSettingsSchema, profileIpc, proxyIpc, runIpc, runSetupIpc, settingsIpc, sessionIpc, shippingIpc, storeIpc, supportsAssistedCheckout, targetIpc, updateBrowserProfileSchema, updateProxyProfileSchema, updateShippingProfileSchema, updateTargetSchema,
  type ApiResult, type AppInfo, type BrowserProfile, type CartStatus, type CreateProxyProfileInput, type CreateRunInput, type CreateRunSetupInput, type CreateShippingProfileInput, type CreateTargetInput, type MonitorEvent, type ProxyBenchmark, type ProxyProfile, type RunDetail, type RunEnvironment, type RunEvent, type RunSession, type RunnerEvent, type RunnerProxy, type RunnerRecording, type RunnerShipping, type SessionError, type SessionRoute, type SessionSnapshot, type ShippingProfile, type Store, type Target, type TargetCheck, type TargetSnapshot, type UpdateBrowserProfileInput, type UpdateProxyProfileInput, type UpdateShippingProfileInput, type UpdateTargetInput
} from "@copify/shared";
import { openProfileRepository, type EncryptedProxyCredentialUpdate, type EncryptedProxyCredentials, type ProfileRepository } from "@copify/persistence";
import { SessionOrchestrator, nodeRunnerFactory, type SessionLaunchSpec } from "@copify/core";
import { benchmarkRoute } from "@copify/runner";

let mainWindow: BrowserWindow | undefined;
let profiles: ProfileRepository;
let orchestrator: SessionOrchestrator;
let benchmarkRunning = false;
let runsRoot = "";
type ActiveRun = { detail: RunDetail; profileSessions: Map<string, RunSession>; assistedShipping: Map<string, string>; assistedDispatched: boolean; assistedActivated: Set<string>; pendingAssist?: TargetCheck; ending: boolean; pendingEnd: Set<string>; resolveEnd?: () => void; monitor?: ChildProcess };
let activeRun: ActiveRun | undefined;
const cartStatuses = new Map<string, CartStatus>();
const closeAfterCartCheck = new Set<string>();
const intentionallyStoppedMonitors = new WeakSet<ChildProcess>();

function result<T>(action: () => T): ApiResult<T> { try { return { ok: true, value: action() }; } catch (error) { return { ok: false, error: message(error) }; } }
async function resultAsync<T>(action: () => Promise<T>): Promise<ApiResult<T>> { try { return { ok: true, value: await action() }; } catch (error) { return { ok: false, error: message(error) }; } }
function message(error: unknown): string { return error instanceof Error ? error.message : "Unexpected application error."; }
function emitRunsChanged(): void { void profiles.listRuns().then((runs) => mainWindow?.webContents.send(runIpc.changed, { runs, activeRunId: activeRun?.detail.run.id ?? null })); }
function emitRunSetupsChanged(): void { void profiles.listRunSetups().then((setups) => mainWindow?.webContents.send(runSetupIpc.changed, setups)); }
function emitTargetsChanged(): void { void profiles.listTargets().then((targets) => mainWindow?.webContents.send(targetIpc.changed, targets)); }
function emitShippingChanged(): void { void profiles.listShippingProfiles().then((shipping) => mainWindow?.webContents.send(shippingIpc.changed, shipping)); }

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1240, height: 860, minWidth: 960, minHeight: 650, icon: windowIconPath(), show: false, backgroundColor: CHROME_BACKGROUND,
    titleBarStyle: "hidden", titleBarOverlay: { color: CHROME_BACKGROUND, symbolColor: CHROME_SYMBOL, height: TITLEBAR_HEIGHT },
    webPreferences: { preload: join(__dirname, "../preload/preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL); else await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}
// Copify draws its own titlebar; these keep the OS-drawn window controls in the app palette.
const CHROME_BACKGROUND = "#0B0B0C";
const CHROME_SYMBOL = "#8A8A93";
const TITLEBAR_HEIGHT = 40;

// Windows and Linux get no menu at all. Chromium still handles clipboard shortcuts inside
// inputs there, but macOS needs the roles to exist for them to work, so keep a minimal one.
function applyApplicationMenu(): void {
  if (process.platform !== "darwin") { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]));
}

function windowIconPath(): string { return app.isPackaged ? join(process.resourcesPath, "copify.ico") : resolve(__dirname, "../../resources/icons/copify.ico"); }

function registerIpc(): void {
  ipcMain.handle(profileIpc.list, (): Promise<ApiResult<BrowserProfile[]>> => resultAsync(() => profiles.list()));
  ipcMain.handle(profileIpc.create, (_event, input: unknown): Promise<ApiResult<BrowserProfile>> => resultAsync(() => profiles.create(createBrowserProfileSchema.parse(input))));
  ipcMain.handle(profileIpc.update, (_event, id: string, input: unknown): Promise<ApiResult<BrowserProfile>> => resultAsync(async () => {
    const update = updateBrowserProfileSchema.parse(input); if (orchestrator.isActive(id) && (update.proxyProfileId !== undefined || update.launchMode !== undefined)) throw new Error("Close this browser session before changing its route or launch method."); if (activeRun?.profileSessions.has(id)) throw new Error("End the active run before changing a selected browser profile."); return profiles.update(id, update);
  }));
  ipcMain.handle(profileIpc.remove, async (_event, id: string): Promise<ApiResult<boolean>> => { if (activeRun?.profileSessions.has(id)) return { ok: false, error: "End the active run before removing a selected browser profile." }; await orchestrator.close(id); return resultAsync(() => profiles.remove(id)); });

  ipcMain.handle(targetIpc.list, (): Promise<ApiResult<Target[]>> => resultAsync(() => profiles.listTargets()));
  ipcMain.handle(targetIpc.create, (_event, input: unknown): Promise<ApiResult<Target>> => resultAsync(async () => { const parsed = createTargetSchema.parse(input); assertKnownStore(parsed.storeId); const created = await profiles.createTarget(parsed); emitTargetsChanged(); return created; }));
  ipcMain.handle(targetIpc.update, (_event, id: string, input: unknown): Promise<ApiResult<Target>> => resultAsync(async () => { assertTargetInactive(id); const parsed = updateTargetSchema.parse(input); assertKnownStore(parsed.storeId); const updated = await profiles.updateTarget(id, parsed); emitTargetsChanged(); return updated; }));
  ipcMain.handle(targetIpc.remove, (_event, id: string): Promise<ApiResult<boolean>> => resultAsync(async () => { assertTargetInactive(id); const removed = await profiles.removeTarget(id); emitTargetsChanged(); return removed; }));
  ipcMain.handle(targetIpc.test, (_event, id: string): Promise<ApiResult<Target>> => resultAsync(async () => { const target = await requireTarget(id); if (!isMonitorable(target.storeId)) throw new Error("This target has no store adapter yet."); const check = await testTarget(target); const updated = await profiles.setTargetCheck(id, check); emitTargetsChanged(); return updated; }));

  ipcMain.handle(shippingIpc.list, (): Promise<ApiResult<ShippingProfile[]>> => resultAsync(() => profiles.listShippingProfiles()));
  ipcMain.handle(shippingIpc.create, (_event, input: unknown): Promise<ApiResult<ShippingProfile>> => resultAsync(async () => { const parsed = createShippingProfileSchema.parse(input); const created = await profiles.createShippingProfile(parsed, await encryptSecret(JSON.stringify(parsed.details))); emitShippingChanged(); return created; }));
  ipcMain.handle(shippingIpc.update, (_event, id: string, input: unknown): Promise<ApiResult<ShippingProfile>> => resultAsync(async () => { assertShippingInactive(id); const parsed = updateShippingProfileSchema.parse(input); const updated = await profiles.updateShippingProfile(id, parsed, parsed.details === undefined ? undefined : parsed.details === null ? null : await encryptSecret(JSON.stringify(parsed.details))); emitShippingChanged(); return updated; }));
  ipcMain.handle(shippingIpc.remove, (_event, id: string): Promise<ApiResult<boolean>> => resultAsync(async () => { assertShippingInactive(id); const removed = await profiles.removeShippingProfile(id); emitShippingChanged(); return removed; }));

  ipcMain.handle(proxyIpc.list, (): Promise<ApiResult<ProxyProfile[]>> => resultAsync(() => profiles.listProxies()));
  ipcMain.handle(proxyIpc.create, (_event, input: unknown): Promise<ApiResult<ProxyProfile>> => resultAsync(async () => { const parsed = createProxyProfileSchema.parse(input); return profiles.createProxy(parsed, await encryptCreateCredentials(parsed)); }));
  ipcMain.handle(proxyIpc.update, (_event, id: string, input: unknown): Promise<ApiResult<ProxyProfile>> => resultAsync(async () => { await assertProxyInactive(id); const parsed = updateProxyProfileSchema.parse(input); return profiles.updateProxy(id, parsed, await encryptUpdateCredentials(parsed)); }));
  ipcMain.handle(proxyIpc.remove, (_event, id: string): Promise<ApiResult<boolean>> => resultAsync(async () => { await assertProxyInactive(id); return profiles.removeProxy(id); }));
  ipcMain.handle(proxyIpc.benchmarks, (_event, proxyId: string | null): Promise<ApiResult<ProxyBenchmark[]>> => resultAsync(() => profiles.listBenchmarks(proxyId, 10)));
  ipcMain.handle(proxyIpc.test, (_event, proxyId: string | null): Promise<ApiResult<ProxyBenchmark>> => resultAsync(async () => { if (benchmarkRunning) throw new Error("A network benchmark is already running."); benchmarkRunning = true; try { const proxy = proxyId ? await resolveProxy(proxyId, true) : null; return profiles.addBenchmark(await benchmarkRoute(proxy, await profiles.getNetworkProbeUrl())); } finally { benchmarkRunning = false; } }));

  ipcMain.handle(storeIpc.list, (): Promise<ApiResult<Store[]>> => resultAsync(() => listStores()));
  ipcMain.handle(storeIpc.update, (_event, id: string, enabled: boolean): Promise<ApiResult<Store[]>> => resultAsync(async () => { if (!isKnownStore(id)) throw new Error("Unknown store."); await profiles.setStoreEnabled(id, Boolean(enabled)); const stores = await listStores(); mainWindow?.webContents.send(storeIpc.changed, stores); return stores; }));

  ipcMain.handle(settingsIpc.appInfo, (): ApiResult<AppInfo> => result(() => ({ version: app.getVersion(), electronVersion: process.versions.electron ?? "unknown", chromeVersion: process.versions.chrome ?? null, osVersion: `${process.platform} ${process.getSystemVersion?.() ?? ""}`.trim() })));

  ipcMain.handle(settingsIpc.getNetworkProbe, (): Promise<ApiResult<{ probeUrl: string }>> => resultAsync(async () => ({ probeUrl: await profiles.getNetworkProbeUrl() })));
  ipcMain.handle(settingsIpc.updateNetworkProbe, (_event, input: unknown): Promise<ApiResult<{ probeUrl: string }>> => resultAsync(async () => { const { probeUrl } = networkProbeSettingsSchema.parse(input); return { probeUrl: await profiles.setNetworkProbeUrl(probeUrl) }; }));

  ipcMain.handle(sessionIpc.list, (): ApiResult<SessionSnapshot[]> => result(() => orchestrator.list()));
  ipcMain.handle(sessionIpc.open, (_event, id: string): Promise<ApiResult<SessionSnapshot>> => resultAsync(() => openSession(id)));
  ipcMain.handle(sessionIpc.close, async (_event, id: string): Promise<ApiResult<SessionSnapshot>> => { await orchestrator.close(id); return { ok: true, value: orchestrator.snapshot(id) }; });
  ipcMain.handle(sessionIpc.restart, (_event, id: string): Promise<ApiResult<SessionSnapshot>> => resultAsync(() => restartSession(id)));
  ipcMain.handle(sessionIpc.openAll, (): Promise<ApiResult<SessionSnapshot[]>> => resultAsync(async () => { if (activeRun) throw new Error("End the active run before opening all profiles."); const enabled = (await profiles.list()).filter((profile) => profile.enabled); await Promise.all(enabled.map(async (profile) => { try { await orchestrator.open(await launchSpec(profile)); } catch (error) { orchestrator.fail(profile.id, sessionFailure(error)); } })); return orchestrator.list(); }));
  ipcMain.handle(sessionIpc.closeAll, async (): Promise<ApiResult<SessionSnapshot[]>> => { await orchestrator.shutdown(); return { ok: true, value: orchestrator.list() }; });
  ipcMain.handle(sessionIpc.carts, (): ApiResult<CartStatus[]> => result(() => [...cartStatuses.values()]));
  ipcMain.handle(sessionIpc.checkCart, (_event, id: string): Promise<ApiResult<CartStatus>> => resultAsync(async () => { if (activeRun) throw new Error("End the active run before checking a cart."); const profile = await requireProfile(id); if (!profile.enabled) throw new Error("Disabled profiles cannot check their cart."); const wasActive = orchestrator.isActive(id); const checking: CartStatus = { profileId: id, status: "CHECKING", itemCount: null, checkedAt: null, message: null }; cartStatuses.set(id, checking); mainWindow?.webContents.send(sessionIpc.cartChanged, checking); await openSession(id); if (!wasActive) closeAfterCartCheck.add(id); orchestrator.checkCart(id); return checking; }));
  ipcMain.handle(sessionIpc.emptyCart, (_event, id: string): Promise<ApiResult<CartStatus>> => resultAsync(() => requestCartEmpty(id)));
  ipcMain.handle(sessionIpc.emptyCarts, (): Promise<ApiResult<CartStatus[]>> => resultAsync(async () => {
    if (activeRun) throw new Error("End the active run before emptying carts.");
    const enabled = (await profiles.list()).filter((profile) => profile.enabled);
    if (!enabled.length) throw new Error("There are no enabled browser profiles.");
    return Promise.all(enabled.map((profile) => requestCartEmpty(profile.id)));
  }));

  ipcMain.handle(runIpc.list, (): Promise<ApiResult<{ runs: import("@copify/shared").Run[]; activeRunId: string | null }>> => resultAsync(async () => ({ runs: await profiles.listRuns(), activeRunId: activeRun?.detail.run.id ?? null })));
  ipcMain.handle(runIpc.get, (_event, id: string): Promise<ApiResult<RunDetail | null>> => resultAsync(async () => (await profiles.getRun(id)) ?? null));
  ipcMain.handle(runIpc.start, (_event, input: unknown): Promise<ApiResult<RunDetail>> => resultAsync(() => startRun(createRunSchema.parse(input))));
  ipcMain.handle(runIpc.end, (): Promise<ApiResult<RunDetail>> => resultAsync(() => endRun()));
  ipcMain.handle(runIpc.resume, (_event, profileId: string): Promise<ApiResult<boolean>> => resultAsync(() => resumeRunSession(profileId)));
  ipcMain.handle(runIpc.remove, (_event, id: string): Promise<ApiResult<boolean>> => resultAsync(() => removeRun(id)));
  ipcMain.handle(runSetupIpc.list, (): Promise<ApiResult<import("@copify/shared").RunSetup[]>> => resultAsync(() => profiles.listRunSetups()));
  ipcMain.handle(runSetupIpc.create, (_event, input: unknown): Promise<ApiResult<import("@copify/shared").RunSetup>> => resultAsync(async () => { const parsed = createRunSetupSchema.parse(input); await assertRunSetupReferences(parsed); const created = await profiles.createRunSetup(parsed); emitRunSetupsChanged(); return created; }));
  ipcMain.handle(runSetupIpc.remove, (_event, id: string): Promise<ApiResult<boolean>> => resultAsync(async () => { const removed = await profiles.removeRunSetup(id); emitRunSetupsChanged(); return removed; }));
}

async function startRun(input: CreateRunInput): Promise<RunDetail> {
  if (activeRun) throw new Error("Only one run can record at a time.");
  const allProfiles = await profiles.list(); const selected = input.profileIds.map((id) => allProfiles.find((profile) => profile.id === id)).filter((profile): profile is BrowserProfile => Boolean(profile));
  if (selected.length !== input.profileIds.length) throw new Error("One or more selected browser profiles no longer exist.");
  if (selected.some((profile) => !profile.enabled)) throw new Error("Only enabled browser profiles may be selected.");
  if (selected.some((profile) => orchestrator.isActive(profile.id))) throw new Error("Selected profiles must be closed before starting a run.");
  const target = input.targetId ? await requireTarget(input.targetId) : null;
  if (target && !target.enabled) throw new Error("Select an enabled target for monitoring."); if (target && !isMonitorable(target.storeId)) throw new Error("This target has no store adapter yet.");
  if (input.executionMode === "ASSISTED_CHECKOUT" && target && !supportsAssistedCheckout(target.storeId)) throw new Error("This store does not support assisted checkout.");
  const targetSnapshot = target ? snapshotTarget(target) : null;
  const specifications = await Promise.all(selected.map(async (profile) => ({ profile, proxy: profile.proxyProfileId ? await resolveProxy(profile.proxyProfileId) : null, shipping: profile.shippingProfileId ? await profiles.getShippingProfile(profile.shippingProfileId) : undefined })));
  const startedAt = Date.now(); const sessions: RunSession[] = specifications.map(({ profile, proxy, shipping }) => ({ id: randomUUID(), runId: randomUUID(), browserProfileId: profile.id, browserProfileName: profile.name, route: initialRoute(proxy), shippingProfile: { shippingProfileId: shipping?.id ?? null, name: shipping?.name ?? null, country: shipping?.country ?? null, complete: Boolean(shipping?.enabled && shipping?.complete) }, assistedEligible: input.executionMode === "ASSISTED_CHECKOUT" && Boolean(shipping?.enabled && shipping?.complete), executionState: input.executionMode === "ASSISTED_CHECKOUT" && shipping?.enabled && shipping.complete ? "WAITING_FOR_TARGET" : "OBSERVING", checkpointReason: null, status: "STARTING", startedAt, endedAt: null, finalError: null }));
  const environment = runEnvironment(); const detail = await profiles.createRun(input, environment, sessions, targetSnapshot);
  const profileSessions = new Map(detail.sessions.map((session) => [session.browserProfileId, session])); const assistedShipping = new Map(detail.sessions.filter((session) => session.assistedEligible && session.shippingProfile.shippingProfileId).map((session) => [session.browserProfileId, session.shippingProfile.shippingProfileId!])); activeRun = { detail, profileSessions, assistedShipping, assistedDispatched: false, assistedActivated: new Set(), ending: false, pendingEnd: new Set() };
  const root = runDirectory(detail.run.id); await mkdir(root, { recursive: true }); await writeFile(join(root, "run.json"), JSON.stringify(detail.run, null, 2));
  await Promise.all(specifications.map(async ({ profile, proxy }) => {
    const session = profileSessions.get(profile.id)!; const artifactDir = join(root, session.id); await mkdir(artifactDir, { recursive: true }); await writeFile(join(artifactDir, "manifest.json"), JSON.stringify({ runId: detail.run.id, runSessionId: session.id, profileId: profile.id, diagnosticLevel: input.diagnosticLevel }, null, 2));
    try { await orchestrator.open({ profile, proxy, probeUrl: await profiles.getNetworkProbeUrl(), recording: { runId: detail.run.id, runSessionId: session.id, diagnosticLevel: input.diagnosticLevel, assisted: input.executionMode === "ASSISTED_CHECKOUT", artifactDir, startedAt } }); if (input.executionMode === "ASSISTED_CHECKOUT" && !session.assistedEligible) await profiles.addRunEvent({ id: randomUUID(), runId: detail.run.id, runSessionId: session.id, wallTimeMs: Date.now(), elapsedNs: elapsedSince(activeRun!), type: "SHIPPING_PROFILE_UNAVAILABLE", stateBefore: "OBSERVING", stateAfter: "OBSERVING", payload: { message: "This session will observe because it has no enabled complete shipping profile." } }); } catch (error) { await recordSessionFailure(profile.id, session, sessionFailure(error)); }
  }));
  if (targetSnapshot) activeRun.monitor = startMonitor(detail.run.id, targetSnapshot);
  emitRunsChanged(); return (await profiles.getRun(detail.run.id))!;
}

async function assertRunSetupReferences(input: CreateRunSetupInput): Promise<void> {
  const available = await profiles.list();
  if (input.profileIds.some((id) => !available.some((profile) => profile.id === id))) throw new Error("One or more selected browser profiles no longer exist.");
  if (input.targetId) await requireTarget(input.targetId);
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
async function requestCartEmpty(id: string): Promise<CartStatus> {
  if (activeRun) throw new Error("End the active run before emptying a cart.");
  const profile = await requireProfile(id);
  if (!profile.enabled) throw new Error("Disabled profiles cannot empty their cart.");
  const wasActive = orchestrator.isActive(id);
  const checking: CartStatus = { profileId: id, status: "CHECKING", itemCount: null, checkedAt: null, message: "Removing cart items…" };
  cartStatuses.set(id, checking); mainWindow?.webContents.send(sessionIpc.cartChanged, checking);
  await openSession(id);
  if (!wasActive) closeAfterCartCheck.add(id);
  orchestrator.emptyCart(id);
  return checking;
}
async function restartSession(id: string): Promise<SessionSnapshot> { const profile = await requireProfile(id); try { await orchestrator.restart(await launchSpec(profile)); } catch (error) { orchestrator.fail(id, sessionFailure(error)); throw error; } return orchestrator.snapshot(id); }
async function requireProfile(id: string): Promise<BrowserProfile> { const profile = await profiles.get(id); if (!profile) throw new Error("Browser profile not found."); return profile; }
async function listStores(): Promise<Store[]> { const settings = await profiles.listStoreSettings(); return listStoreManifests().map((manifest) => ({ ...manifest, enabled: settings[manifest.id] ?? true })); }
function assertKnownStore(storeId: string | undefined): void { if (storeId !== undefined && !isKnownStore(storeId)) throw new Error("Unknown store."); }
async function requireTarget(id: string): Promise<Target> { const target = await profiles.getTarget(id); if (!target) throw new Error("Target not found."); return target; }
function assertTargetInactive(id: string): void { if (activeRun?.detail.run.targetSnapshot?.targetId === id) throw new Error("End the active run before changing its target."); }
function assertShippingInactive(id: string): void { if ([...(activeRun?.profileSessions.values() ?? [])].some((session) => session.shippingProfile.shippingProfileId === id)) throw new Error("End the active run before changing its captured shipping profile."); }
function snapshotTarget(target: Target): TargetSnapshot { const { id, latestCheck: _latestCheck, createdAt: _createdAt, updatedAt: _updatedAt, ...value } = target; return { ...value, targetId: id, capturedAt: Date.now() }; }
async function launchSpec(profile: BrowserProfile): Promise<SessionLaunchSpec> { return { profile, proxy: profile.proxyProfileId ? await resolveProxy(profile.proxyProfileId) : null, probeUrl: await profiles.getNetworkProbeUrl(), recording: null }; }
function initialRoute(proxy: RunnerProxy | null): SessionRoute { return proxy ? { kind: "proxy", proxyProfileId: proxy.proxyProfileId, proxyName: proxy.proxyName, protocol: proxy.protocol, verification: defaultRoute().verification } : defaultRoute(); }
async function resolveProxy(id: string, allowDisabled = false): Promise<RunnerProxy> { const stored = await profiles.getStoredProxy(id); if (!stored) throw new Error("The assigned proxy profile no longer exists."); if (!allowDisabled && !stored.enabled) throw new Error("The assigned proxy profile is disabled."); const username = stored.usernameCiphertext ? await decryptSecret(stored.usernameCiphertext) : undefined; const password = stored.passwordCiphertext ? await decryptSecret(stored.passwordCiphertext) : undefined; return { proxyProfileId: stored.id, proxyName: stored.name, protocol: stored.protocol, host: stored.host, port: stored.port, ...(username ? { username } : {}), ...(password ? { password } : {}), expectedCountry: stored.expectedCountry, expectedCity: stored.expectedCity }; }
async function resolveShipping(id: string): Promise<RunnerShipping> { const stored = await profiles.getStoredShippingProfile(id); if (!stored || !stored.enabled || !stored.complete || !stored.detailsCiphertext) throw new Error("The assigned shipping profile is unavailable."); return JSON.parse(await decryptSecret(stored.detailsCiphertext)) as RunnerShipping; }
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
  worker.on("message", (value) => { void onMonitorEvent(value); }); worker.once("exit", () => {
    if (intentionallyStoppedMonitors.delete(worker)) return;
    if (activeRun?.detail.run.id === runId && !activeRun.ending) void appendMonitorEvent(runId, "TARGET_MONITOR_FAILED", null, "The shared monitor exited unexpectedly.");
  });
  worker.send({ type: "START_MONITOR", version: IPC_VERSION, runId, target }); return worker;
}
function stopMonitor(active: ActiveRun): void {
  const worker = active.monitor;
  if (!worker) return;
  intentionallyStoppedMonitors.add(worker);
  worker.send({ type: "STOP_MONITOR", version: IPC_VERSION });
  setTimeout(() => { if (worker.exitCode === null) worker.kill(); }, 3_000).unref();
  active.monitor = undefined;
}
async function testTarget(target: Target): Promise<TargetCheck> {
  const worker = fork(join(__dirname, "monitor.js"), [], { stdio: ["ignore", "ignore", "ignore", "ipc"] }); const snapshot = snapshotTarget(target);
  return new Promise<TargetCheck>((resolve, reject) => {
    const timeout = setTimeout(() => { worker.kill(); reject(new Error("Target test timed out.")); }, 45_000);
    worker.on("message", (value) => { const event = monitorEventSchema.safeParse(value); if (event.success && event.data.type === "MONITOR_TEST_RESULT") { clearTimeout(timeout); worker.kill(); resolve(event.data.check); } });
    worker.once("exit", (code) => { if (code && code !== 0) { clearTimeout(timeout); reject(new Error("Target test monitor exited unexpectedly.")); } });
    worker.send({ type: "TEST_TARGET", version: IPC_VERSION, target: snapshot });
  });
}
async function onMonitorEvent(value: unknown): Promise<void> {
  const parsed = monitorEventSchema.safeParse(value); if (!parsed.success) return; const event: MonitorEvent = parsed.data; if (event.type !== "MONITOR_EVENT") return; const active = activeRun; if (!active || event.runId !== active.detail.run.id) return;
  await appendMonitorEvent(active.detail.run.id, event.eventType, event.check, null);
  if (active.detail.run.executionMode === "ASSISTED_CHECKOUT" && !active.assistedDispatched && event.check?.decision.kind === "VARIANT_SELECTED" && event.check.decision.candidate && event.check.decision.selectedVariant) {
    active.assistedDispatched = true;
    active.pendingAssist = event.check;
    await dispatchAssistedTarget(active, event.check);
    await appendMonitorEvent(active.detail.run.id, "TARGET_MONITOR_STOPPED", null, "A target was dispatched to the assisted sessions, so monitoring stopped.");
    stopMonitor(active);
  }
  emitRunsChanged();
}

async function dispatchAssistedTarget(active: ActiveRun, check: TargetCheck): Promise<void> {
  const candidate = check.decision.candidate; const variant = check.decision.selectedVariant; const target = active.detail.run.targetSnapshot;
  if (!candidate || !variant || !target) return;
  await Promise.all([...active.assistedShipping.entries()].map(async ([profileId, shippingId]) => {
    const runSession = active.profileSessions.get(profileId); if (!runSession || runSession.status === "FAILED" || active.assistedActivated.has(profileId) || orchestrator.snapshot(profileId).state !== "READY") return;
    try { const shipping = await resolveShipping(shippingId); orchestrator.assist(profileId, active.detail.run.id, runSession.id, candidate, variant, target.quantity, shipping); active.assistedActivated.add(profileId); await profiles.setRunSessionExecution(runSession.id, "PRODUCT_OPEN"); }
    catch (error) { await profiles.setRunSessionExecution(runSession.id, "FAILED"); await profiles.addRunEvent({ id: randomUUID(), runId: active.detail.run.id, runSessionId: runSession.id, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type: "ASSIST_FAILED", stateBefore: "WAITING_FOR_TARGET", stateAfter: "FAILED", payload: { code: "SECRET_STORAGE_UNAVAILABLE", message: "Shipping details could not be loaded for assisted checkout." } }); }
  }));
}
async function appendMonitorEvent(runId: string, type: string, check: TargetCheck | null, fallback: string | null): Promise<void> {
  const active = activeRun; if (!active || active.detail.run.id !== runId) return; const decision = check?.decision;
  await profiles.addRunEvent({ id: randomUUID(), runId, runSessionId: null, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type, stateBefore: null, stateAfter: null, payload: check ? { checkedAt: check.checkedAt, status: check.status, candidateCount: check.candidateCount, decision: decision?.kind, message: decision?.message, candidate: decision?.candidate ? { name: decision.candidate.name, url: decision.candidate.url, imageUrl: decision.candidate.imageUrl, priceMinor: decision.candidate.priceMinor, currency: decision.candidate.currency, variants: decision.candidate.variants } : null, selectedVariant: decision?.selectedVariant ?? null, errorMessage: check.errorMessage } : { message: fallback } });
}

async function onSessionChanged(snapshot: SessionSnapshot): Promise<void> {
  mainWindow?.webContents.send(sessionIpc.changed, snapshot); const active = activeRun; const runSession = active?.profileSessions.get(snapshot.profileId); if (!active || !runSession) return;
  if (snapshot.state === "READY") { runSession.status = "RECORDING"; runSession.route = snapshot.route; await profiles.setRunSession(runSession.id, "RECORDING", snapshot.route); await profiles.addRunEvent({ id: randomUUID(), runId: active.detail.run.id, runSessionId: runSession.id, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type: "SESSION_READY", stateBefore: "STARTING", stateAfter: "RECORDING", payload: { route: snapshot.route.kind, verification: snapshot.route.verification.status } }); await profiles.setRunStatus(active.detail.run.id, "RECORDING"); if (active.pendingAssist) await dispatchAssistedTarget(active, active.pendingAssist); emitRunsChanged(); }
  if (snapshot.state === "ERROR" || snapshot.state === "CRASHED") await recordSessionFailure(snapshot.profileId, runSession, snapshot.error ?? { code: "RUNNER_CRASHED", message: "The browser runner exited unexpectedly." });
}
async function recordSessionFailure(profileId: string, session: RunSession, error: SessionError): Promise<void> { const active = activeRun; if (!active) return; session.status = "FAILED"; session.finalError = error; await profiles.setRunSession(session.id, "FAILED", undefined, error); await profiles.addRunEvent({ id: randomUUID(), runId: active.detail.run.id, runSessionId: session.id, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type: "SESSION_FAILED", stateBefore: null, stateAfter: "FAILED", payload: { code: error.code, message: error.message } }); emitRunsChanged(); }
async function onRunnerEvent(event: RunnerEvent): Promise<void> {
  if (event.type === "CART_STATUS") { const status: CartStatus = { profileId: event.profileId, ...event.status }; cartStatuses.set(event.profileId, status); mainWindow?.webContents.send(sessionIpc.cartChanged, status); if (closeAfterCartCheck.delete(event.profileId)) void orchestrator.close(event.profileId); return; }
  const active = activeRun; if (!active || (event.type !== "RUN_EVENT" && event.type !== "RUN_ARTIFACT" && event.type !== "RUN_ENDED")) return;
  const session = active.profileSessions.get(event.profileId); if (!session) return;
  if (event.type === "RUN_EVENT" && event.event.runId === active.detail.run.id) { await profiles.addRunEvent(event.event); if (event.event.stateAfter) { const state = event.event.stateAfter as RunSession["executionState"]; await profiles.setRunSessionExecution(session.id, state, state === "CHECKPOINT" ? String(event.event.payload.reason ?? "CHECKPOINT") : null); session.executionState = state; session.checkpointReason = state === "CHECKPOINT" ? String(event.event.payload.reason ?? "CHECKPOINT") : null; } }
  if (event.type === "RUN_ARTIFACT" && event.artifact.runId === active.detail.run.id) await profiles.addRunArtifact(event.artifact);
  if (event.type === "RUN_ENDED" && event.runSessionId === session.id) { if (session.status !== "FAILED") session.status = "ENDED"; await profiles.setRunSession(session.id, session.status); active.pendingEnd.delete(session.id); if (active.pendingEnd.size === 0) active.resolveEnd?.(); }
  emitRunsChanged();
}

async function resumeRunSession(profileId: string): Promise<boolean> {
  const active = activeRun; if (!active || active.detail.run.executionMode !== "ASSISTED_CHECKOUT") throw new Error("There is no active assisted run."); const session = active.profileSessions.get(profileId); if (!session || session.executionState !== "CHECKPOINT") throw new Error("This session is not waiting at a resumable checkpoint."); const cartCheckpoint = /^(CART_NOT_EMPTY|CART_STATE_UNKNOWN|CART_CONTENT_CHANGED)$/.test(session.checkpointReason ?? ""); const nextState = cartCheckpoint ? (session.checkpointReason === "CART_CONTENT_CHANGED" ? "CARTED" : "PRODUCT_OPEN") : "CHECKOUT"; orchestrator.resumeAssist(profileId, active.detail.run.id, session.id); await profiles.addRunEvent({ id: randomUUID(), runId: active.detail.run.id, runSessionId: session.id, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type: "CHECKPOINT_RESUMED", stateBefore: "CHECKPOINT", stateAfter: nextState, payload: { reason: session.checkpointReason } }); await profiles.setRunSessionExecution(session.id, nextState); session.executionState = nextState; emitRunsChanged(); return true;
}

app.whenReady().then(async () => {
  const dataRoot = app.getPath("userData"); runsRoot = join(dataRoot, "runs"); profiles = openProfileRepository(join(dataRoot, "copify.sqlite"), join(dataRoot, "browser-profiles")); await profiles.recoverInterruptedRuns(); orchestrator = new SessionOrchestrator(nodeRunnerFactory(join(__dirname, "runner.js")));
  orchestrator.on("changed", (snapshot: SessionSnapshot) => { void onSessionChanged(snapshot); }); orchestrator.on("runner-event", (event: RunnerEvent) => { void onRunnerEvent(event); }); registerIpc(); applyApplicationMenu(); await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});
app.on("before-quit", (event) => { if (!orchestrator) return; event.preventDefault(); if (activeRun) stopMonitor(activeRun); void orchestrator.shutdown().finally(() => { profiles?.close(); app.exit(0); }); });
