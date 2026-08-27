import { app, BrowserWindow, Menu, Notification, clipboard, dialog, ipcMain, net, protocol, safeStorage, screen, shell, type Rectangle } from "electron";
import { fork, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  IPC_VERSION, SCHEMA_VERSION, WINDOW_DEFAULT_HEIGHT, WINDOW_DEFAULT_WIDTH, WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH, analyticsFilterSchema, analyticsIpc, appearanceSettingsSchema, captchaIpc, captchaProviderDiagnosticSchema, chromeColorsSchema, commitProviderImportSchema, costIpc, costQuerySchema, createBrowserProfileSchema, createManualCostSnapshotSchema, createProxyProfileSchema, createRunAnnotationSchema, createRunSchema, createRunSetupSchema, createShippingProfileSchema, createTargetSchema, defaultRoute, estimateProxyCostMicrosUsd, getStoreManifest, healthIpc, isKnownStore, isMonitorable, listStoreManifests, monitorEventSchema, monitorIpc, monitorSettingsSchema, networkProbeSettingsSchema, openProviderImportSchema, previewProviderImportSchema, profileIpc, proxyIpc, proxySecretRevealSchema, resolveCaptchaStrategy, resolveMonitorBehavior, runIpc, runSetupIpc, runnerShippingSchema, secretCopyFieldSchema, settingsIpc, sessionIpc, shippingIpc, shippingSecretRevealSchema, simulatePaymentHandoffSchema, storeIpc, supportsAssistedCheckout, targetIpc, updateBrowserProfileSchema, updateCaptchaSettingsSchema, updateProfileWarmStateSchema, updateProxyProfileSchema, updateShippingProfileSchema, updateTargetSchema, upsertCaptchaProviderSchema, upsertCostBudgetSchema, usageIpc, warmingIpc, warmDestinationSchema,
  type ApiResult, type AppInfo, type AppearanceSettings, type BrowserHealthSnapshot, type CaptchaProviderDiagnostic, type CaptchaSettings, type ChromeColors, type WindowBounds, type BrowserProfile, type BudgetStatus, type CartStatus, type CostBudget, type CostSummary, type CreateProxyProfileInput, type CreateRunInput, type CreateRunSetupInput, type CreateShippingProfileInput, type CreateTargetInput, type MonitorCommand, type MonitorEvent, type MonitorPolicy, type MonitorRoute, type MonitorRuntimeStatus, type MonitorSettings, type ProfileWarmState, type ProviderImportCommitResult, type ProviderImportPreview, type ReconciliationStatus, type ProxyBenchmark, type ProxyProfile, type ProxySecretReveal, type RunDetail, type RunEnvironment, type RunEvent, type RunNetworkUsage, type RunSession, type RunnerEvent, type RunnerProxy, type RunnerRecording, type RunnerShipping, type SecretCopyField, type SessionError, type SessionRoute, type SessionSnapshot, type ShippingProfile, type ShippingSecretReveal, type SimulatePaymentHandoffInput, type Store, type Target, type TargetCheck, type TargetSnapshot, type UpdateBrowserProfileInput, type UpdateProxyProfileInput, type UpdateShippingProfileInput, type UpdateTargetInput, type WarmDestination
} from "@copify/shared";
import { openProfileRepository, type EncryptedProxyCredentialUpdate, type EncryptedProxyCredentials, type ProfileRepository } from "@copify/persistence";
import { SessionOrchestrator, nodeRunnerFactory, type SessionLaunchSpec } from "@copify/core";
import { CaptchaProviderError, benchmarkRoute, diagnoseCaptchaProvider } from "@copify/runner";
import { ClipboardCoordinator } from "./clipboard-coordinator";
import { canStartTargetMonitor } from "./run-monitor";
import { formatProxyUrl } from "./proxy-url";
import { ProviderImportCoordinator } from "./cost-import";

let mainWindow: BrowserWindow | undefined;
let profiles: ProfileRepository;
let orchestrator: SessionOrchestrator;
let clipboardCoordinator: ClipboardCoordinator;
const providerImports = new ProviderImportCoordinator();
let benchmarkRunning = false;
let budgetEvaluationTimer: NodeJS.Timeout | undefined;
let runsRoot = "";
type ActiveRun = { detail: RunDetail; profileSessions: Map<string, RunSession>; assistedShipping: Map<string, string>; assistedDispatched: boolean; assistedActivated: Set<string>; priorityProfileId: string | null; pendingAssist?: TargetCheck; ending: boolean; pendingEnd: Set<string>; resolveEnd?: () => void; monitor?: ChildProcess; monitorRouteProfiles: Map<string, ProxyProfile> };
let activeRun: ActiveRun | undefined;
let monitorStatus: MonitorRuntimeStatus = { runId: null, storeId: null, state: "STOPPED", activeIntervalMs: null, fastEndsAt: null, nextPollAt: null, configuredRouteCount: 0, healthyRouteCount: 0, lastErrorCode: null, sources: [], updatedAt: Date.now() };
const cartStatuses = new Map<string, CartStatus>();
const closeAfterCartCheck = new Set<string>();
const intentionallyStoppedMonitors = new WeakSet<ChildProcess>();
const SECRET_REVEAL_TTL_MS = 30_000;
const SENSITIVE_CLIPBOARD_TTL_MS = 60_000;
type SensitiveRevealLease = ProxySecretReveal | ShippingSecretReveal;
const sensitiveRevealLeases = new Map<string, SensitiveRevealLease>();

const APP_USER_MODEL_ID = "com.copify.app";
protocol.registerSchemesAsPrivileged([{ scheme: "copify-artifact", privileges: { secure: true, standard: true, supportFetchAPI: true } }]);

// electron-vite identifies development builds as @copify/desktop, while the
// packaged application is named copify. Preserve the established development
// data directory on the first packaged launch instead of silently starting with
// an empty database and browser-profile root.
const packagedDataRoot = app.getPath("userData");
const legacyDataRoot = join(app.getPath("appData"), "@copify", "desktop");
if (!existsSync(join(packagedDataRoot, "copify.sqlite")) && existsSync(join(legacyDataRoot, "copify.sqlite"))) app.setPath("userData", legacyDataRoot);

if (process.platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID);

function result<T>(action: () => T): ApiResult<T> { try { return { ok: true, value: action() }; } catch (error) { return { ok: false, error: message(error) }; } }
async function resultAsync<T>(action: () => Promise<T>): Promise<ApiResult<T>> { try { return { ok: true, value: await action() }; } catch (error) { return { ok: false, error: message(error) }; } }
function message(error: unknown): string { return error instanceof Error ? error.message : "Unexpected application error."; }
function emitRunsChanged(): void { void profiles.listRuns().then((runs) => mainWindow?.webContents.send(runIpc.changed, { runs, activeRunId: activeRun?.detail.run.id ?? null })); }
function emitRunSetupsChanged(): void { void profiles.listRunSetups().then((setups) => mainWindow?.webContents.send(runSetupIpc.changed, setups)); }
function emitTargetsChanged(): void { void profiles.listTargets().then((targets) => mainWindow?.webContents.send(targetIpc.changed, targets)); }
function emitShippingChanged(): void { void profiles.listShippingProfiles().then((shipping) => mainWindow?.webContents.send(shippingIpc.changed, shipping)); }
function emitHealthChanged(): void { mainWindow?.webContents.send(healthIpc.changed); }
function emitMonitorChanged(): void { mainWindow?.webContents.send(monitorIpc.changed, monitorStatus); }
function emitWarmingChanged(): void { void profiles.listProfileWarmStates().then((states) => mainWindow?.webContents.send(warmingIpc.changed, states)); }
function emitCostsChanged(): void { mainWindow?.webContents.send(costIpc.changed); }
function emitCaptchaChanged(): void { mainWindow?.webContents.send(captchaIpc.changed); }
async function evaluateCostBudgets():Promise<BudgetStatus[]> {
  const statuses=await profiles.getBudgetStatuses();
  for(const status of statuses){ for(const threshold of status.budget.thresholds.filter((value)=>status.percent>=value)){ if(await profiles.markBudgetThreshold(status.budget.id,status.periodStartAt,threshold)){ if(Notification.isSupported())new Notification({title:`${status.budget.provider} budget ${threshold}%`,body:`${status.budget.cadence.toLowerCase()} proxy spend reached ${status.percent.toFixed(1)}%.`}).show(); } } }
  const cappedProviders=new Set(statuses.filter((status)=>status.capped).map((status)=>status.budget.provider)); const active=activeRun;
  if(active?.monitor){const routeIds=[...active.monitorRouteProfiles.entries()].filter(([,proxy])=>cappedProviders.has(proxy.provider)).map(([id])=>id);const resetAt=statuses.filter((status)=>status.capped&&cappedProviders.has(status.budget.provider)).reduce<number|null>((latest,status)=>Math.max(latest??0,status.periodEndAt),null);trySendMonitorCommand(active.monitor,{type:"SET_BUDGET_BLOCKS",version:IPC_VERSION,routeIds,resetAt});}
  if(budgetEvaluationTimer)clearTimeout(budgetEvaluationTimer); const next=statuses.reduce<number|null>((earliest,status)=>Math.min(earliest??Number.MAX_SAFE_INTEGER,status.periodEndAt),null); if(next) {budgetEvaluationTimer=setTimeout(()=>{void evaluateCostBudgets().then(()=>emitCostsChanged());},Math.max(1_000,next-Date.now()+50));budgetEvaluationTimer.unref();}
  return statuses;
}

async function createWindow(): Promise<void> {
  // The frame is painted before the renderer exists, so the theme it should
  // wear comes from the cache the renderer wrote on its last change.
  const chrome = profiles.getChromeColors() ?? { backgroundColor: CHROME_BACKGROUND, symbolColor: CHROME_SYMBOL };
  const placement = restorePlacement(profiles.getWindowBounds());
  mainWindow = new BrowserWindow({
    ...placement.bounds, minWidth: WINDOW_MIN_WIDTH, minHeight: WINDOW_MIN_HEIGHT, icon: windowIconPath(), show: false,
    backgroundColor: chrome.backgroundColor,
    titleBarStyle: "hidden", titleBarOverlay: { color: chrome.backgroundColor, symbolColor: chrome.symbolColor, height: TITLEBAR_HEIGHT },
    webPreferences: { preload: join(__dirname, "../preload/preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  // The packaged executable supplies the icon itself, but in `pnpm dev` Windows
  // starts electron.exe. Set it explicitly on the window/taskbar button so the
  // development shell does not fall back to Electron's generic atom icon.
  mainWindow.setIcon(windowIconPath());
  if (process.platform === "win32") mainWindow.setAppDetails({ appId: APP_USER_MODEL_ID, appIconPath: windowIconPath() });
  if (placement.maximized) mainWindow.maximize();
  trackPlacement(mainWindow);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL); else await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

/* A saved position can name a display that is no longer attached, which would
   open the window off-screen with no way to drag it back. Size is always kept;
   only the position is dropped, which centres the window on the primary display. */
function restorePlacement(saved: WindowBounds | null): { bounds: Rectangle | { width: number; height: number }; maximized: boolean } {
  const width = Math.max(saved?.width ?? WINDOW_DEFAULT_WIDTH, WINDOW_MIN_WIDTH);
  const height = Math.max(saved?.height ?? WINDOW_DEFAULT_HEIGHT, WINDOW_MIN_HEIGHT);
  const maximized = saved?.maximized ?? false;
  if (!saved || saved.x === null || saved.y === null) return { bounds: { width, height }, maximized };
  const frame = { x: saved.x, y: saved.y, width, height };
  const onScreen = screen.getAllDisplays().some((display) => intersects(frame, display.workArea));
  return { bounds: onScreen ? frame : { width, height }, maximized };
}

function intersects(a: Rectangle, b: Rectangle): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/* Resizing fires continuously, so the write is debounced; closing flushes it,
   because the last drag before quitting is the one worth keeping. `app.exit`
   skips window close events, so before-quit calls this directly. */
let flushPlacement: () => void = () => {};

function trackPlacement(window: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = (): void => {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
    // getNormalBounds, not getBounds: a maximised frame must not overwrite the
    // size the window should return to when it is restored.
    const { x, y, width, height } = window.getNormalBounds();
    try { profiles.setWindowBounds({ x, y, width, height, maximized: window.isMaximized() }); } catch { /* placement is not worth failing a resize over */ }
  };
  const schedule = (): void => { clearTimeout(timer); timer = setTimeout(persist, 300); };
  flushPlacement = () => { clearTimeout(timer); persist(); };
  window.on("resize", schedule);
  window.on("move", schedule);
  window.on("maximize", schedule);
  window.on("unmaximize", schedule);
  window.on("close", () => flushPlacement());
}
// Copify draws its own titlebar; these keep the OS-drawn window controls in the
// app palette until the renderer reports the resolved colours of its theme.
const CHROME_BACKGROUND = "#0B0B0C";
const CHROME_SYMBOL = "#8A8A93";
const TITLEBAR_HEIGHT = 40;

function applyChromeColors(colors: ChromeColors): void {
  profiles.setChromeColors(colors);
  if (!mainWindow) return;
  if (process.platform === "win32") mainWindow.setTitleBarOverlay({ color: colors.backgroundColor, symbolColor: colors.symbolColor, height: TITLEBAR_HEIGHT });
  mainWindow.setBackgroundColor(colors.backgroundColor);
}

// Windows and Linux get no menu at all. Chromium still handles clipboard shortcuts inside
// inputs there, but macOS needs the roles to exist for them to work, so keep a minimal one.
function applyApplicationMenu(): void {
  if (process.platform !== "darwin") { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]));
}

function windowIconPath(): string { return app.isPackaged ? join(process.resourcesPath, "copify.ico") : resolve(__dirname, "../../resources/icons/copify.ico"); }

function registerIpc(): void {
  ipcMain.handle(profileIpc.list, (): Promise<ApiResult<BrowserProfile[]>> => resultAsync(() => profiles.list()));
  ipcMain.handle(profileIpc.create, (_event, input: unknown): Promise<ApiResult<BrowserProfile>> => resultAsync(async () => { const parsed = createBrowserProfileSchema.parse(input); const endpoint = parsed.driver.kind === "EXTERNAL_CDP" && parsed.driver.endpoint ? await encryptSecret(parsed.driver.endpoint) : undefined; return profiles.create(parsed, endpoint); }));
  ipcMain.handle(profileIpc.update, (_event, id: string, input: unknown): Promise<ApiResult<BrowserProfile>> => resultAsync(async () => {
    const update = updateBrowserProfileSchema.parse(input); if (orchestrator.isActive(id) && (update.proxyProfileId !== undefined || update.driver !== undefined)) throw new Error("Close this browser session before changing its route or browser driver."); if (activeRun?.profileSessions.has(id)) throw new Error("End the active run before changing a selected browser profile.");
    const endpoint = update.driver?.kind === "EXTERNAL_CDP" ? update.driver.endpoint === undefined ? undefined : update.driver.endpoint === null ? null : await encryptSecret(update.driver.endpoint) : update.driver?.kind === "NATIVE_STEALTH" ? null : undefined;
    const updated = await profiles.update(id, update, endpoint); if (update.proxyProfileId !== undefined || update.driver !== undefined) emitWarmingChanged(); return updated;
  }));
  ipcMain.handle(profileIpc.remove, async (_event, id: string): Promise<ApiResult<boolean>> => { if (activeRun?.profileSessions.has(id)) return { ok: false, error: "End the active run before removing a selected browser profile." }; await orchestrator.close(id); return resultAsync(() => profiles.remove(id)); });
  ipcMain.handle(profileIpc.reorder, (_event, ids: unknown): Promise<ApiResult<BrowserProfile[]>> => resultAsync(() => {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new Error("The new browser order is not a list of profile ids.");
    return profiles.reorder(ids as string[]);
  }));
  ipcMain.handle(healthIpc.get, (_event, subjectKind: BrowserHealthSnapshot["subjectKind"], subjectId: string): Promise<ApiResult<import("@copify/shared").BrowserHealthDetail>> => resultAsync(() => profiles.getBrowserHealth(subjectKind, subjectId)));
  ipcMain.handle(warmingIpc.list, (): Promise<ApiResult<ProfileWarmState[]>> => resultAsync(() => profiles.listProfileWarmStates()));
  ipcMain.handle(warmingIpc.start, (_event, browserProfileId: string, storeId: string): Promise<ApiResult<ProfileWarmState>> => resultAsync(async () => {
    if (activeRun) throw new Error("End the active run before warming a profile."); const profile = await requireProfile(browserProfileId); if (!profile.enabled) throw new Error("Disabled profiles cannot be warmed.");
    const manifest = getStoreManifest(storeId); if (!manifest?.warming) throw new Error("This store does not provide a profile-warming destination.");
    if (!orchestrator.isActive(browserProfileId)) await openSession(browserProfileId); const session = await waitForSessionReady(browserProfileId); const existing = await profiles.getProfileWarmState(browserProfileId, storeId); const now = Date.now();
    const state = await profiles.upsertProfileWarmState({ id: existing?.id ?? randomUUID(), browserProfileId, storeId, status: "IN_PROGRESS", storefrontReady: false, googleReady: false, shopPayReady: false, storefrontCompletedAt: existing?.storefrontCompletedAt ?? null, googleCompletedAt: existing?.googleCompletedAt ?? null, shopPayCompletedAt: existing?.shopPayCompletedAt ?? null, proxyProfileId: profile.proxyProfileId, driverKind: profile.driver.kind, routePublicIp: session.route.verification.publicIp, routeCountry: session.route.verification.country, startedAt: now, completedAt: existing?.completedAt ?? null, updatedAt: now }); emitWarmingChanged(); return state;
  }));
  ipcMain.handle(warmingIpc.update, (_event, browserProfileId: string, storeId: string, input: unknown): Promise<ApiResult<ProfileWarmState>> => resultAsync(async () => {
    const existing = await profiles.getProfileWarmState(browserProfileId, storeId); if (!existing) throw new Error("Start profile warming before updating its checklist."); const values = updateProfileWarmStateSchema.parse(input); const now = Date.now(); const state = await profiles.upsertProfileWarmState({ ...existing, ...values, status: "IN_PROGRESS", storefrontCompletedAt: values.storefrontReady && !existing.storefrontReady ? now : existing.storefrontCompletedAt, googleCompletedAt: values.googleReady && !existing.googleReady ? now : existing.googleCompletedAt, shopPayCompletedAt: values.shopPayReady && !existing.shopPayReady ? now : existing.shopPayCompletedAt, updatedAt: now }); emitWarmingChanged(); return state;
  }));
  ipcMain.handle(warmingIpc.openDestination, (_event, browserProfileId: string, storeId: string, destination: unknown): Promise<ApiResult<boolean>> => resultAsync(async () => {
    if (activeRun) throw new Error("Profile warming is unavailable during a run."); const state = await profiles.getProfileWarmState(browserProfileId, storeId); if (!state) throw new Error("Start profile warming first."); const value = warmDestinationSchema.parse(destination); const manifest = getStoreManifest(storeId); const url = warmDestinationUrl(value, manifest?.warming?.storefrontUrl); if (!orchestrator.isActive(browserProfileId)) await openSession(browserProfileId); await waitForSessionReady(browserProfileId); orchestrator.openWarmDestination(browserProfileId, url); return true;
  }));
  ipcMain.handle(warmingIpc.complete, (_event, browserProfileId: string, storeId: string): Promise<ApiResult<ProfileWarmState>> => resultAsync(async () => {
    const existing = await profiles.getProfileWarmState(browserProfileId, storeId); if (!existing) throw new Error("Start profile warming first."); if (!existing.storefrontReady || !existing.googleReady || !existing.shopPayReady) throw new Error("Confirm every warming step before marking the profile ready."); const session = orchestrator.snapshot(browserProfileId); const now = Date.now(); const state = await profiles.upsertProfileWarmState({ ...existing, status: "READY", routePublicIp: session.route.verification.publicIp, routeCountry: session.route.verification.country, completedAt: now, updatedAt: now }); emitWarmingChanged(); return state;
  }));

  ipcMain.handle(targetIpc.list, (): Promise<ApiResult<Target[]>> => resultAsync(() => profiles.listTargets()));
  ipcMain.handle(targetIpc.create, (_event, input: unknown): Promise<ApiResult<Target>> => resultAsync(async () => { const parsed = createTargetSchema.parse(input); assertKnownStore(parsed.storeId); const created = await profiles.createTarget(parsed); emitTargetsChanged(); return created; }));
  ipcMain.handle(targetIpc.update, (_event, id: string, input: unknown): Promise<ApiResult<Target>> => resultAsync(async () => { assertTargetInactive(id); const parsed = updateTargetSchema.parse(input); assertKnownStore(parsed.storeId); const updated = await profiles.updateTarget(id, parsed); emitTargetsChanged(); return updated; }));
  ipcMain.handle(targetIpc.remove, (_event, id: string): Promise<ApiResult<boolean>> => resultAsync(async () => { assertTargetInactive(id); const removed = await profiles.removeTarget(id); emitTargetsChanged(); return removed; }));
  ipcMain.handle(targetIpc.test, (_event, id: string): Promise<ApiResult<Target>> => resultAsync(async () => { const target = await requireTarget(id); if (!isMonitorable(target.storeId)) throw new Error("This target has no store adapter yet."); const policy = await monitorPolicy(snapshotTarget(target)); const elapsed = target.latestCheck ? Date.now() - target.latestCheck.checkedAt : Number.POSITIVE_INFINITY; if (elapsed < policy.pollIntervalMs) throw new Error(`This target can be checked again in ${Math.ceil((policy.pollIntervalMs - elapsed) / 1_000)} seconds.`); const check = await testTarget(target); const updated = await profiles.setTargetCheck(id, check); emitTargetsChanged(); return updated; }));

  ipcMain.handle(shippingIpc.list, (): Promise<ApiResult<ShippingProfile[]>> => resultAsync(() => profiles.listShippingProfiles()));
  ipcMain.handle(shippingIpc.reveal, (_event, id: string): Promise<ApiResult<ShippingSecretReveal | null>> => resultAsync(() => revealShippingProfile(id)));
  ipcMain.handle(shippingIpc.copyRevealed, (_event, token: string, field: unknown): Promise<ApiResult<boolean>> => resultAsync(() => copyRevealedSecret(token, field, "SHIPPING")));
  ipcMain.handle(shippingIpc.create, (_event, input: unknown): Promise<ApiResult<ShippingProfile>> => resultAsync(async () => { const parsed = createShippingProfileSchema.parse(input); const created = await profiles.createShippingProfile(parsed, await encryptSecret(JSON.stringify(parsed.details))); emitShippingChanged(); return created; }));
  ipcMain.handle(shippingIpc.update, (_event, id: string, input: unknown): Promise<ApiResult<ShippingProfile>> => resultAsync(async () => { assertShippingInactive(id); const parsed = updateShippingProfileSchema.parse(input); const updated = await profiles.updateShippingProfile(id, parsed, parsed.details === undefined ? undefined : parsed.details === null ? null : await encryptSecret(JSON.stringify(parsed.details))); emitShippingChanged(); return updated; }));
  ipcMain.handle(shippingIpc.remove, (_event, id: string): Promise<ApiResult<boolean>> => resultAsync(async () => { assertShippingInactive(id); const removed = await profiles.removeShippingProfile(id); emitShippingChanged(); return removed; }));

  ipcMain.handle(proxyIpc.list, (): Promise<ApiResult<ProxyProfile[]>> => resultAsync(() => profiles.listProxies()));
  ipcMain.handle(proxyIpc.reveal, (_event, id: string): Promise<ApiResult<ProxySecretReveal | null>> => resultAsync(() => revealProxyProfile(id)));
  ipcMain.handle(proxyIpc.copyRevealed, (_event, token: string, field: unknown): Promise<ApiResult<boolean>> => resultAsync(() => copyRevealedSecret(token, field, "PROXY")));
  ipcMain.handle(proxyIpc.create, (_event, input: unknown): Promise<ApiResult<ProxyProfile>> => resultAsync(async () => { const parsed = createProxyProfileSchema.parse(input); return profiles.createProxy(parsed, await encryptCreateCredentials(parsed)); }));
  ipcMain.handle(proxyIpc.update, (_event, id: string, input: unknown): Promise<ApiResult<ProxyProfile>> => resultAsync(async () => { await assertProxyInactive(id); const parsed = updateProxyProfileSchema.parse(input); const updated = await profiles.updateProxy(id, parsed, await encryptUpdateCredentials(parsed)); emitWarmingChanged(); return updated; }));
  ipcMain.handle(proxyIpc.remove, (_event, id: string): Promise<ApiResult<boolean>> => resultAsync(async () => { await assertProxyInactive(id); const removed = await profiles.removeProxy(id); if (removed) emitWarmingChanged(); return removed; }));
  ipcMain.handle(proxyIpc.benchmarks, (_event, proxyId: string | null): Promise<ApiResult<ProxyBenchmark[]>> => resultAsync(() => profiles.listBenchmarks(proxyId, 10)));
  ipcMain.handle(proxyIpc.test, (_event, proxyId: string | null): Promise<ApiResult<ProxyBenchmark>> => resultAsync(async () => { if (benchmarkRunning) throw new Error("A network benchmark is already running."); benchmarkRunning = true; try { const proxy = proxyId ? await resolveProxy(proxyId, true) : null; return profiles.addBenchmark(await benchmarkRoute(proxy, await profiles.getNetworkProbeUrl())); } finally { benchmarkRunning = false; } }));

  ipcMain.handle(storeIpc.list, (): Promise<ApiResult<Store[]>> => resultAsync(() => listStores()));
  ipcMain.handle(storeIpc.update, (_event, id: string, enabled: boolean): Promise<ApiResult<Store[]>> => resultAsync(async () => { if (!isKnownStore(id)) throw new Error("Unknown store."); await profiles.setStoreEnabled(id, Boolean(enabled)); const stores = await listStores(); mainWindow?.webContents.send(storeIpc.changed, stores); return stores; }));

  ipcMain.handle(settingsIpc.appInfo, (): ApiResult<AppInfo> => result(() => ({ version: app.getVersion(), electronVersion: process.versions.electron ?? "unknown", chromeVersion: process.versions.chrome ?? null, osVersion: `${process.platform} ${process.getSystemVersion?.() ?? ""}`.trim() })));

  ipcMain.handle(settingsIpc.getNetworkProbe, (): Promise<ApiResult<{ probeUrl: string }>> => resultAsync(async () => ({ probeUrl: await profiles.getNetworkProbeUrl() })));
  ipcMain.handle(settingsIpc.updateNetworkProbe, (_event, input: unknown): Promise<ApiResult<{ probeUrl: string }>> => resultAsync(async () => { const { probeUrl } = networkProbeSettingsSchema.parse(input); return { probeUrl: await profiles.setNetworkProbeUrl(probeUrl) }; }));
  ipcMain.handle(settingsIpc.getMonitor, (): Promise<ApiResult<MonitorSettings>> => resultAsync(() => profiles.getMonitorSettings()));
  ipcMain.handle(settingsIpc.updateMonitor, (_event, input: unknown): Promise<ApiResult<MonitorSettings>> => resultAsync(() => profiles.setMonitorSettings(monitorSettingsSchema.parse(input))));
  ipcMain.handle(settingsIpc.getAppearance, (): Promise<ApiResult<AppearanceSettings>> => resultAsync(() => profiles.getAppearanceSettings()));
  ipcMain.handle(settingsIpc.updateAppearance, (_event, input: unknown): Promise<ApiResult<AppearanceSettings>> => resultAsync(() => profiles.setAppearanceSettings(appearanceSettingsSchema.parse(input))));
  ipcMain.handle(settingsIpc.applyChrome, (_event, input: unknown): ApiResult<boolean> => result(() => { applyChromeColors(chromeColorsSchema.parse(input)); return true; }));
  ipcMain.handle(captchaIpc.settings, (): Promise<ApiResult<CaptchaSettings>> => resultAsync(() => profiles.getCaptchaSettings()));
  ipcMain.handle(captchaIpc.updateSettings, (_event, input: unknown): Promise<ApiResult<CaptchaSettings>> => resultAsync(async () => { assertCaptchaSettingsMutable(); const updated = await profiles.setCaptchaSettings(updateCaptchaSettingsSchema.parse(input)); emitCaptchaChanged(); return updated; }));
  ipcMain.handle(captchaIpc.upsertProvider, (_event, input: unknown): Promise<ApiResult<CaptchaSettings>> => resultAsync(async () => {
    assertCaptchaSettingsMutable(); const parsed = upsertCaptchaProviderSchema.parse(input);
    if (app.isPackaged && parsed.endpoint?.startsWith("http:")) throw new Error("Loopback HTTP CAPTCHA endpoints are development-only.");
    const updated = await profiles.upsertCaptchaProvider({ kind: parsed.kind, label: parsed.label, endpoint: parsed.endpoint, enabled: parsed.enabled }, parsed.apiKey === undefined ? undefined : parsed.apiKey === null ? null : await encryptSecret(parsed.apiKey));
    emitCaptchaChanged(); return updated;
  }));
  ipcMain.handle(captchaIpc.removeProvider, (_event, kind: import("@copify/shared").CaptchaProviderKind): Promise<ApiResult<CaptchaSettings>> => resultAsync(async () => { assertCaptchaSettingsMutable(); const updated = await profiles.removeCaptchaProvider(kind); emitCaptchaChanged(); return updated; }));
  ipcMain.handle(captchaIpc.diagnose, (_event, kind: import("@copify/shared").CaptchaProviderKind): Promise<ApiResult<CaptchaProviderDiagnostic>> => resultAsync(async () => { assertCaptchaSettingsMutable(); const diagnostic = await diagnoseStoredCaptchaProvider(kind); await profiles.setCaptchaProviderDiagnostic(diagnostic); emitCaptchaChanged(); return diagnostic; }));
  ipcMain.handle(monitorIpc.status, (): ApiResult<MonitorRuntimeStatus> => result(() => monitorStatus));
  ipcMain.handle(monitorIpc.setTurbo, (_event, enabled: boolean): ApiResult<MonitorRuntimeStatus> => result(() => { if (!activeRun?.monitor || !trySendMonitorCommand(activeRun.monitor, { type: "SET_MONITOR_TURBO", version: IPC_VERSION, enabled: Boolean(enabled) })) throw new Error("There is no active target monitor."); return monitorStatus; }));
  ipcMain.handle(usageIpc.run, (_event, runId: string): Promise<ApiResult<RunNetworkUsage[]>> => resultAsync(() => profiles.listRunNetworkUsage(runId)));
  ipcMain.handle(usageIpc.totals, (): Promise<ApiResult<RunNetworkUsage[]>> => resultAsync(() => profiles.listNetworkUsage()));
  ipcMain.handle(costIpc.query, (_event,input:unknown):Promise<ApiResult<CostSummary>>=>resultAsync(()=>profiles.queryCosts(costQuerySchema.parse(input))));
  ipcMain.handle(costIpc.manualSnapshot,(_event,input:unknown):Promise<ApiResult<boolean>>=>resultAsync(async()=>{await profiles.createManualCostSnapshot(createManualCostSnapshotSchema.parse(input));await evaluateCostBudgets();emitCostsChanged();return true;}));
  ipcMain.handle(costIpc.removeManualSnapshot,(_event,id:string):Promise<ApiResult<boolean>>=>resultAsync(async()=>{const removed=await profiles.removeManualCostSnapshot(id);await evaluateCostBudgets();emitCostsChanged();return removed;}));
  ipcMain.handle(costIpc.importOpen,(_event,input:unknown):Promise<ApiResult<ProviderImportPreview|null>>=>resultAsync(async()=>{const {provider}=openProviderImportSchema.parse(input);const selected=await dialog.showOpenDialog(mainWindow!,{title:"Import provider usage CSV",properties:["openFile"],filters:[{name:"CSV",extensions:["csv"]}]});if(selected.canceled||!selected.filePaths[0])return null;return providerImports.open(provider,selected.filePaths[0]);}));
  ipcMain.handle(costIpc.importPreview,(_event,input:unknown):ApiResult<ProviderImportPreview>=>result(()=>{const value=previewProviderImportSchema.parse(input);return providerImports.preview(value.token,value.mapping);}));
  ipcMain.handle(costIpc.importCommit,(_event,input:unknown):Promise<ApiResult<ProviderImportCommitResult>>=>resultAsync(async()=>{const value=commitProviderImportSchema.parse(input);const normalized=providerImports.commit(value.token,value.mapping);const committed=await profiles.commitProviderImport(normalized.provider,normalized.digest,normalized.records,normalized.rejected);await evaluateCostBudgets();emitCostsChanged();return committed;}));
  ipcMain.handle(costIpc.importCancel,(_event,token:string):ApiResult<boolean>=>result(()=>providerImports.cancel(token)));
  ipcMain.handle(costIpc.budgets,():Promise<ApiResult<CostBudget[]>>=>resultAsync(()=>profiles.listCostBudgets()));
  ipcMain.handle(costIpc.upsertBudget,(_event,input:unknown):Promise<ApiResult<CostBudget>>=>resultAsync(async()=>{const budget=await profiles.upsertCostBudget(upsertCostBudgetSchema.parse(input));await evaluateCostBudgets();emitCostsChanged();return budget;}));
  ipcMain.handle(costIpc.removeBudget,(_event,id:string):Promise<ApiResult<boolean>>=>resultAsync(async()=>{const removed=await profiles.removeCostBudget(id);await evaluateCostBudgets();emitCostsChanged();return removed;}));
  ipcMain.handle(costIpc.reconciliation,(_event,provider?:string):Promise<ApiResult<ReconciliationStatus>>=>resultAsync(async()=>({...(await profiles.listReconciliation(provider)),connectors:[{provider:"dataimpulse",available:false,unavailableReason:"Normal-plan read-only API endpoint has not been verified."}]})));

  ipcMain.handle(sessionIpc.list, (): ApiResult<SessionSnapshot[]> => result(() => orchestrator.list()));
  ipcMain.handle(sessionIpc.open, (_event, id: string): Promise<ApiResult<SessionSnapshot>> => resultAsync(() => openSession(id)));
  ipcMain.handle(sessionIpc.close, async (_event, id: string): Promise<ApiResult<SessionSnapshot>> => { await orchestrator.close(id); return { ok: true, value: orchestrator.snapshot(id) }; });
  ipcMain.handle(sessionIpc.restart, (_event, id: string): Promise<ApiResult<SessionSnapshot>> => resultAsync(() => restartSession(id)));
  ipcMain.handle(sessionIpc.checkCoherence, (_event, id: string): Promise<ApiResult<SessionSnapshot>> => resultAsync(() => checkSessionCoherence(id)));
  ipcMain.handle(sessionIpc.checkCoherenceAll, (): Promise<ApiResult<SessionSnapshot[]>> => resultAsync(() => checkAllSessionCoherence()));
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
  ipcMain.handle(runIpc.simulatePaymentHandoff, (_event, input: unknown): Promise<ApiResult<boolean>> => resultAsync(() => simulatePaymentHandoff(simulatePaymentHandoffSchema.parse(input))));
  ipcMain.handle(runIpc.remove, (_event, id: string): Promise<ApiResult<boolean>> => resultAsync(() => removeRun(id)));
  ipcMain.handle(analyticsIpc.query, (_event, input: unknown) => resultAsync(() => profiles.queryAnalytics(analyticsFilterSchema.parse(input))));
  ipcMain.handle(analyticsIpc.compare, (_event, ids: unknown) => resultAsync(async () => { if (!Array.isArray(ids) || ids.length < 2 || ids.length > 5 || ids.some((id) => typeof id !== "string")) throw new Error("Select between two and five runs."); const result = await profiles.queryAnalytics(analyticsFilterSchema.parse({ range: "ALL" })); const selected = new Set(ids); return { ...result, runs: result.runs.filter((run) => selected.has(run.id)), runMetrics: result.runMetrics.filter((metric) => selected.has(metric.runId)), sessionMetrics: result.sessionMetrics.filter((metric) => selected.has(metric.runId)), annotations: result.annotations.filter((annotation) => selected.has(annotation.runId)) }; }));
  ipcMain.handle(analyticsIpc.annotations, (_event, runId?: string) => resultAsync(() => profiles.listRunAnnotations(runId)));
  ipcMain.handle(analyticsIpc.createAnnotation, (_event, input: unknown) => resultAsync(() => profiles.createRunAnnotation(createRunAnnotationSchema.parse(input))));
  ipcMain.handle(analyticsIpc.removeAnnotation, (_event, id: string) => resultAsync(() => profiles.removeRunAnnotation(id)));
  ipcMain.handle(analyticsIpc.revealArtifact, (_event, runId: string, artifactId: string) => resultAsync(async () => { const detail = await profiles.getRun(runId); const artifact = detail?.artifacts.find((item) => item.id === artifactId); if (!artifact) throw new Error("Artifact not found."); const root = runDirectory(runId); const candidate = resolve(root, artifact.relativePath); if (!candidate.startsWith(`${root}${sep}`)) throw new Error("Invalid artifact path."); shell.showItemInFolder(candidate); return true; }));
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
  if (input.executionMode === "ASSISTED_CHECKOUT") {
    const proxyById = new Map((await profiles.listProxies()).map((proxy) => [proxy.id, proxy]));
    const rotating = selected.find((profile) => profile.proxyProfileId && proxyById.get(profile.proxyProfileId)?.type === "residential-rotating");
    if (rotating) throw new Error(`${rotating.name} uses a rotating residential route. Assisted checkout requires a direct, sticky, or static route.`);
  }
  const captchaSettings = await profiles.getCaptchaSettings();
  const activeCaptchaProvider = captchaSettings.activeProvider ? captchaSettings.providers.find((provider) => provider.kind === captchaSettings.activeProvider && provider.enabled) ?? null : null;
  const storedCaptchaProvider = activeCaptchaProvider ? await profiles.getStoredCaptchaProvider(activeCaptchaProvider.kind) : undefined;
  const providerReady = Boolean(storedCaptchaProvider?.apiKeyCiphertext);
  const captchaByProfile = new Map(selected.map((profile) => {
    const runOverride = (input.captchaOverrides ?? []).find((entry) => entry.browserProfileId === profile.id)?.captchaStrategy;
    const strategy = resolveCaptchaStrategy({ runOverride, profileOverride: profile.captchaStrategyOverride, targetStrategy: target?.captchaStrategy, appMode: captchaSettings.appMode });
    return [profile.id, { strategy, provider: strategy !== "MANUAL_HARVESTER" && activeCaptchaProvider && providerReady ? { kind: activeCaptchaProvider.kind, label: activeCaptchaProvider.label } : null }] as const;
  }));
  const blocked = selected.find((profile) => captchaByProfile.get(profile.id)?.strategy === "API_SOLVER" && !captchaByProfile.get(profile.id)?.provider);
  if (blocked) throw new Error(`${blocked.name} resolves to API-only CAPTCHA solving, but the active provider has no configured API key.`);
  const targetSnapshot = target ? snapshotTarget(target) : null;
  const specifications = await Promise.all(selected.map(async (profile) => ({ ...(await launchSpec(profile)), shipping: profile.shippingProfileId ? await profiles.getShippingProfile(profile.shippingProfileId) : undefined })));
  const startedAt = Date.now(); const sessions: RunSession[] = specifications.map(({ profile, proxy, shipping }) => ({ id: randomUUID(), runId: randomUUID(), browserProfileId: profile.id, browserProfileName: profile.name, route: initialRoute(proxy), shippingProfile: { shippingProfileId: shipping?.id ?? null, name: shipping?.name ?? null, country: shipping?.country ?? null, complete: Boolean(shipping?.enabled && shipping?.complete) }, captchaStrategy: captchaByProfile.get(profile.id)!.strategy, captchaProvider: captchaByProfile.get(profile.id)!.provider, assistedEligible: input.executionMode === "ASSISTED_CHECKOUT" && Boolean(shipping?.enabled && shipping?.complete), executionState: input.executionMode === "ASSISTED_CHECKOUT" && shipping?.enabled && shipping.complete ? "WAITING_FOR_TARGET" : "OBSERVING", checkpointReason: null, status: "STARTING", startedAt, endedAt: null, finalError: null }));
  const environment = runEnvironment(); const detail = await profiles.createRun(input, environment, sessions, targetSnapshot);
  const profileSessions = new Map(detail.sessions.map((session) => [session.browserProfileId, session])); const assistedShipping = new Map(detail.sessions.filter((session) => session.assistedEligible && session.shippingProfile.shippingProfileId).map((session) => [session.browserProfileId, session.shippingProfile.shippingProfileId!])); activeRun = { detail, profileSessions, assistedShipping, assistedDispatched: false, assistedActivated: new Set(), priorityProfileId: null, ending: false, pendingEnd: new Set(), monitorRouteProfiles: new Map() };
  const root = runDirectory(detail.run.id); await mkdir(root, { recursive: true }); await writeFile(join(root, "run.json"), JSON.stringify(detail.run, null, 2));
  await Promise.all(specifications.map(async ({ profile, driver, proxy }) => {
    const session = profileSessions.get(profile.id)!; const artifactDir = join(root, session.id); await mkdir(artifactDir, { recursive: true }); await writeFile(join(artifactDir, "manifest.json"), JSON.stringify({ runId: detail.run.id, runSessionId: session.id, profileId: profile.id, diagnosticLevel: input.diagnosticLevel }, null, 2));
    try { await orchestrator.open({ profile, driver, proxy, probeUrl: await profiles.getNetworkProbeUrl(), recording: { runId: detail.run.id, runSessionId: session.id, diagnosticLevel: input.diagnosticLevel, assisted: input.executionMode === "ASSISTED_CHECKOUT", captcha: { strategy: session.captchaStrategy, provider: session.captchaProvider, solveTimeoutMs: captchaSettings.solveTimeoutMs, fallbackAfterMs: captchaSettings.fallbackAfterMs }, artifactDir, startedAt } }); if (input.executionMode === "ASSISTED_CHECKOUT" && !session.assistedEligible) await profiles.addRunEvent({ id: randomUUID(), runId: detail.run.id, runSessionId: session.id, wallTimeMs: Date.now(), elapsedNs: elapsedSince(activeRun!), type: "SHIPPING_PROFILE_UNAVAILABLE", stateBefore: "OBSERVING", stateAfter: "OBSERVING", payload: { message: "This session will observe because it has no enabled complete shipping profile." } }); } catch (error) { await recordSessionFailure(profile.id, session, sessionFailure(error)); }
  }));
  emitRunsChanged(); return (await profiles.getRun(detail.run.id))!;
}

async function assertRunSetupReferences(input: CreateRunSetupInput): Promise<void> {
  const available = await profiles.list();
  if (input.profileIds.some((id) => !available.some((profile) => profile.id === id))) throw new Error("One or more selected browser profiles no longer exist.");
  if (input.targetId) await requireTarget(input.targetId);
}

async function endRun(): Promise<RunDetail> {
  const active = activeRun; if (!active) throw new Error("No run is currently recording."); active.ending = true;
  if (active.detail.run.discoverySnapshot) { active.detail.run.discoverySnapshot = { ...active.detail.run.discoverySnapshot, sourceHealth: monitorStatus.sources }; await profiles.setRunDiscoverySnapshot(active.detail.run.id, active.detail.run.discoverySnapshot); }
  clipboardCoordinator.cancelAll();
  if (active.monitor) await appendMonitorEvent(active.detail.run.id, "TARGET_MONITOR_STOPPED", null, "The shared target monitor was stopped when the run ended.");
  stopMonitor(active);
  const activeProfiles = [...active.profileSessions.entries()].filter(([profileId]) => orchestrator.isActive(profileId)); active.pendingEnd = new Set(activeProfiles.map(([, session]) => session.id));
  const wait = new Promise<void>((resolve) => { active.resolveEnd = resolve; });
  for (const [profileId, session] of activeProfiles) orchestrator.endRun(profileId, session.id);
  if (active.pendingEnd.size === 0) active.resolveEnd?.();
  await Promise.race([wait, new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
  for (const session of active.profileSessions.values()) if (session.status !== "FAILED") { session.status = "ENDED"; await profiles.setRunSession(session.id, "ENDED"); }
  await profiles.setRunStatus(active.detail.run.id, "COMPLETED", true); const completed = (await profiles.getRun(active.detail.run.id))!; await profiles.materializeRunMetrics(completed.run.id); activeRun = undefined; emitRunsChanged(); return completed;
}

async function removeRun(id: string): Promise<boolean> {
  if (activeRun?.detail.run.id === id) throw new Error("End the active run before deleting it."); const removed = await profiles.removeRun(id); if (removed) { const target = runDirectory(id); await rm(target, { recursive: true, force: true }); } emitRunsChanged(); return removed;
}

async function openSession(id: string, background = false): Promise<SessionSnapshot> { const profile = await requireProfile(id); try { await orchestrator.open(await launchSpec(profile, background)); } catch (error) { orchestrator.fail(id, sessionFailure(error)); throw error; } return orchestrator.snapshot(id); }
async function waitForSessionReady(id: string, timeoutMs = 20_000): Promise<SessionSnapshot> {
  const current = orchestrator.snapshot(id); if (current.state === "READY") return current; if (["ERROR", "CRASHED"].includes(current.state)) throw new Error(current.error?.message ?? "The browser failed to open.");
  return new Promise<SessionSnapshot>((resolvePromise, reject) => {
    let timeout: NodeJS.Timeout;
    const changed = (snapshot: SessionSnapshot) => { if (snapshot.profileId !== id) return; if (snapshot.state === "READY") { clearTimeout(timeout); orchestrator.off("changed", changed); resolvePromise(snapshot); } else if (["ERROR", "CRASHED"].includes(snapshot.state)) { clearTimeout(timeout); orchestrator.off("changed", changed); reject(new Error(snapshot.error?.message ?? "The browser failed to open.")); } };
    orchestrator.on("changed", changed);
    timeout = setTimeout(() => { orchestrator.off("changed", changed); reject(new Error("The browser did not become ready in time.")); }, timeoutMs);
  });
}
async function waitForSessionStopped(id: string, timeoutMs = 10_000): Promise<SessionSnapshot> {
  const current = orchestrator.snapshot(id); if (current.state === "STOPPED") return current;
  return new Promise<SessionSnapshot>((resolvePromise, reject) => {
    let timeout: NodeJS.Timeout;
    const changed = (snapshot: SessionSnapshot) => {
      if (snapshot.profileId !== id) return;
      if (snapshot.state === "STOPPED") { clearTimeout(timeout); orchestrator.off("changed", changed); resolvePromise(snapshot); }
      else if (["ERROR", "CRASHED"].includes(snapshot.state)) { clearTimeout(timeout); orchestrator.off("changed", changed); reject(new Error(snapshot.error?.message ?? "The browser did not close cleanly.")); }
    };
    orchestrator.on("changed", changed);
    timeout = setTimeout(() => { orchestrator.off("changed", changed); reject(new Error("The browser did not close after checking coherence.")); }, timeoutMs);
  });
}
function warmDestinationUrl(destination: WarmDestination, storefrontUrl?: string): string { if (destination === "STOREFRONT") { if (!storefrontUrl) throw new Error("The store has no warming URL."); return storefrontUrl; } return destination === "GOOGLE" ? "https://accounts.google.com/" : "https://shop.app/"; }
async function requestCartEmpty(id: string): Promise<CartStatus> {
  if (activeRun) throw new Error("End the active run before emptying a cart.");
  const profile = await requireProfile(id);
  if (!profile.enabled) throw new Error("Disabled profiles cannot empty their cart.");
  const wasActive = orchestrator.isActive(id);
  const checking: CartStatus = { profileId: id, status: "CHECKING", itemCount: null, checkedAt: null, message: "Removing cart items…" };
  cartStatuses.set(id, checking); mainWindow?.webContents.send(sessionIpc.cartChanged, checking);
  await openSession(id, true);
  if (!wasActive) closeAfterCartCheck.add(id);
  orchestrator.emptyCart(id);
  return checking;
}
async function restartSession(id: string): Promise<SessionSnapshot> { const profile = await requireProfile(id); try { await orchestrator.restart(await launchSpec(profile)); } catch (error) { orchestrator.fail(id, sessionFailure(error)); throw error; } return orchestrator.snapshot(id); }
async function checkSessionCoherence(id: string): Promise<SessionSnapshot> {
  if (activeRun) throw new Error("End the active run before checking browser coherence.");
  const profile = await requireProfile(id);
  if (!profile.enabled) throw new Error("Disabled profiles cannot check coherence.");
  if (profile.driver.kind !== "NATIVE_STEALTH") throw new Error("Coherence checks do not manage externally owned CDP browsers.");
  if (orchestrator.isActive(id)) throw new Error("Close this browser before checking coherence. Its route, locale, and timezone are immutable while it is open.");
  await openSession(id);
  await waitForSessionReady(id);
  const stopped = waitForSessionStopped(id);
  await orchestrator.close(id);
  return stopped;
}
async function checkAllSessionCoherence(): Promise<SessionSnapshot[]> {
  if (activeRun) throw new Error("End the active run before checking browser coherence.");
  const enabled = (await profiles.list()).filter((profile) => profile.enabled && profile.driver.kind === "NATIVE_STEALTH");
  if (enabled.length === 0) throw new Error("There are no enabled browser profiles to check.");
  if (enabled.some((profile) => orchestrator.isActive(profile.id))) throw new Error("Close all enabled browsers before checking coherence for all profiles.");
  return Promise.all(enabled.map(async (profile) => {
    try { return await checkSessionCoherence(profile.id); }
    catch { return orchestrator.snapshot(profile.id); }
  }));
}
async function requireProfile(id: string): Promise<BrowserProfile> { const profile = await profiles.get(id); if (!profile) throw new Error("Browser profile not found."); return profile; }
async function listStores(): Promise<Store[]> { const settings = await profiles.listStoreSettings(); return listStoreManifests().map((manifest) => ({ ...manifest, enabled: settings[manifest.id] ?? true })); }
function assertKnownStore(storeId: string | undefined): void { if (storeId !== undefined && !isKnownStore(storeId)) throw new Error("Unknown store."); }
async function requireTarget(id: string): Promise<Target> { const target = await profiles.getTarget(id); if (!target) throw new Error("Target not found."); return target; }
function assertTargetInactive(id: string): void { if (activeRun?.detail.run.targetSnapshot?.targetId === id) throw new Error("End the active run before changing its target."); }
function assertShippingInactive(id: string): void { if ([...(activeRun?.profileSessions.values() ?? [])].some((session) => session.shippingProfile.shippingProfileId === id)) throw new Error("End the active run before changing its captured shipping profile."); }
function assertSensitiveRevealAllowed(): void { if (activeRun) throw new Error("End the active run before revealing saved sensitive information."); }
function assertCaptchaSettingsMutable(): void { if (activeRun) throw new Error("End the active run before changing or testing CAPTCHA settings."); }

async function diagnoseStoredCaptchaProvider(kind: import("@copify/shared").CaptchaProviderKind): Promise<CaptchaProviderDiagnostic> {
  const checkedAt = Date.now(); const stored = await profiles.getStoredCaptchaProvider(kind);
  if (!stored?.enabled || !stored.apiKeyCiphertext) return captchaProviderDiagnosticSchema.parse({ provider: kind, status: "NOT_CONFIGURED", balanceMicrosUsd: null, checkedAt, message: "Configure and enable this provider before testing it." });
  try {
    const apiKey = await decryptSecret(stored.apiKeyCiphertext); const result = await diagnoseCaptchaProvider({ kind, endpoint: stored.endpoint, apiKey });
    return captchaProviderDiagnosticSchema.parse({ provider: kind, status: "CONNECTED", balanceMicrosUsd: result.balanceMicrosUsd, checkedAt, message: "Connection and balance verified." });
  } catch (error) {
    const code = error instanceof CaptchaProviderError ? error.code : "SERVICE_UNAVAILABLE";
    const status = code === "AUTH_INVALID" ? "AUTH_INVALID" : code === "INSUFFICIENT_CREDIT" ? "INSUFFICIENT_CREDIT" : code === "INVALID_RESPONSE" ? "INVALID_RESPONSE" : "UNAVAILABLE";
    return captchaProviderDiagnosticSchema.parse({ provider: kind, status, balanceMicrosUsd: null, checkedAt, message: error instanceof Error ? error.message : "The provider diagnostic failed." });
  }
}
async function confirmSensitiveReveal(kind: "proxy credentials" | "shipping address", name: string): Promise<boolean> {
  assertSensitiveRevealAllowed();
  const options: Electron.MessageBoxOptions = {
    type: "warning", title: "Reveal sensitive information?", message: `Reveal saved ${kind} for “${name}”?`,
    detail: "The information will be visible for 30 seconds. Only reveal it in private. Copify will never log it, and copied values are cleared from the clipboard after 60 seconds if unchanged.",
    buttons: ["Reveal for 30 seconds", "Cancel"], defaultId: 1, cancelId: 1, noLink: true,
  };
  const answer = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
  return answer.response === 0;
}
function retainSensitiveReveal<T extends SensitiveRevealLease>(value: T): T {
  sensitiveRevealLeases.set(value.token, value);
  const timer = setTimeout(() => sensitiveRevealLeases.delete(value.token), SECRET_REVEAL_TTL_MS + 250);
  timer.unref();
  return value;
}
async function revealProxyProfile(id: string): Promise<ProxySecretReveal | null> {
  const stored = await profiles.getStoredProxy(id); if (!stored) throw new Error("Proxy profile not found.");
  if (!await confirmSensitiveReveal("proxy credentials", stored.name)) return null;
  const username = stored.usernameCiphertext ? await decryptSecret(stored.usernameCiphertext) : null;
  const password = stored.passwordCiphertext ? await decryptSecret(stored.passwordCiphertext) : null;
  const now = Date.now();
  return retainSensitiveReveal(proxySecretRevealSchema.parse({ kind: "PROXY", token: randomUUID(), expiresAt: now + SECRET_REVEAL_TTL_MS, proxyProfileId: stored.id, name: stored.name, protocol: stored.protocol, host: stored.host, port: stored.port, username, password, url: formatProxyUrl(stored.protocol, stored.host, stored.port, username, password) }));
}
async function revealShippingProfile(id: string): Promise<ShippingSecretReveal | null> {
  const stored = await profiles.getStoredShippingProfile(id); if (!stored?.detailsCiphertext) throw new Error("The shipping profile has no saved details.");
  if (!await confirmSensitiveReveal("shipping address", stored.name)) return null;
  const details = runnerShippingSchema.parse(JSON.parse(await decryptSecret(stored.detailsCiphertext)));
  const now = Date.now();
  return retainSensitiveReveal(shippingSecretRevealSchema.parse({ kind: "SHIPPING", token: randomUUID(), expiresAt: now + SECRET_REVEAL_TTL_MS, shippingProfileId: stored.id, name: stored.name, details }));
}
async function copyRevealedSecret(token: string, rawField: unknown, expectedKind: SensitiveRevealLease["kind"]): Promise<boolean> {
  assertSensitiveRevealAllowed();
  const field = secretCopyFieldSchema.parse(rawField); const reveal = sensitiveRevealLeases.get(token);
  if (!reveal || reveal.expiresAt <= Date.now()) { sensitiveRevealLeases.delete(token); throw new Error("That reveal expired. Consent again to copy a value."); }
  if (reveal.kind !== expectedKind) throw new Error("That reveal does not match this item.");
  const value = revealedFieldValue(reveal, field); if (!value) throw new Error("That field is empty.");
  clipboard.writeText(value); scheduleSensitiveClipboardClear(value); return true;
}
function revealedFieldValue(reveal: SensitiveRevealLease, field: SecretCopyField): string | null {
  if (reveal.kind === "PROXY") {
    if (field === "proxy-url") return reveal.url;
    if (field === "proxy-server") return `${reveal.protocol}://${reveal.host}:${reveal.port}`;
    if (field === "proxy-username") return reveal.username;
    if (field === "proxy-password") return reveal.password;
    throw new Error("That field does not belong to a proxy reveal.");
  }
  const values: Record<Exclude<SecretCopyField, "proxy-url" | "proxy-server" | "proxy-username" | "proxy-password">, string | undefined> = {
    "shipping-full-name": reveal.details.fullName, "shipping-email": reveal.details.email, "shipping-phone": reveal.details.phone,
    "shipping-address-1": reveal.details.address1, "shipping-address-2": reveal.details.address2, "shipping-postal-code": reveal.details.postalCode,
    "shipping-city": reveal.details.city, "shipping-region": reveal.details.region, "shipping-country": reveal.details.country,
  };
  if (field.startsWith("proxy-")) throw new Error("That field does not belong to a shipping reveal.");
  return values[field as keyof typeof values] ?? null;
}
function scheduleSensitiveClipboardClear(value: string): void {
  const expectedHash = createHash("sha256").update(value).digest("hex");
  const timer = setTimeout(() => {
    try { if (createHash("sha256").update(clipboard.readText()).digest("hex") === expectedHash) clipboard.clear(); } catch { /* Clipboard access can fail after application shutdown. */ }
  }, SENSITIVE_CLIPBOARD_TTL_MS);
  timer.unref();
}
function snapshotTarget(target: Target): TargetSnapshot { const { id, latestCheck: _latestCheck, createdAt: _createdAt, updatedAt: _updatedAt, ...value } = target; return { ...value, targetId: id, capturedAt: Date.now() }; }
async function launchSpec(profile: BrowserProfile, background = false): Promise<SessionLaunchSpec> {
  if (profile.driver.kind === "EXTERNAL_CDP") {
    if (profile.proxyProfileId) throw new Error("External CDP profiles cannot use a Copify-managed proxy. Configure the route in the external browser.");
    const stored = await profiles.getStoredBrowserProfile(profile.id); if (!stored?.externalCdpEndpointCiphertext) throw new Error("Configure a local external CDP endpoint before opening this browser profile.");
    return { profile, driver: { kind: "EXTERNAL_CDP", endpoint: await decryptSecret(stored.externalCdpEndpointCiphertext) }, proxy: null, probeUrl: await profiles.getNetworkProbeUrl(), recording: null };
  }
  return { profile, driver: { kind: "NATIVE_STEALTH" }, proxy: profile.proxyProfileId ? await resolveProxy(profile.proxyProfileId) : null, probeUrl: await profiles.getNetworkProbeUrl(), recording: null, background };
}
function initialRoute(proxy: RunnerProxy | null): SessionRoute { return proxy ? { kind: "proxy", proxyProfileId: proxy.proxyProfileId, proxyName: proxy.proxyName, protocol: proxy.protocol, verification: defaultRoute().verification } : defaultRoute(); }
async function resolveProxy(id: string, allowDisabled = false): Promise<RunnerProxy> { const stored = await profiles.getStoredProxy(id); if (!stored) throw new Error("The assigned proxy profile no longer exists."); if (!allowDisabled && !stored.enabled) throw new Error("The assigned proxy profile is disabled."); const username = stored.usernameCiphertext ? await decryptSecret(stored.usernameCiphertext) : undefined; const password = stored.passwordCiphertext ? await decryptSecret(stored.passwordCiphertext) : undefined; return { proxyProfileId: stored.id, proxyName: stored.name, protocol: stored.protocol, host: stored.host, port: stored.port, ...(username ? { username } : {}), ...(password ? { password } : {}), expectedCountry: stored.expectedCountry, expectedCity: stored.expectedCity }; }
async function resolveShipping(id: string): Promise<RunnerShipping> { const stored = await profiles.getStoredShippingProfile(id); if (!stored || !stored.enabled || !stored.complete || !stored.detailsCiphertext) throw new Error("The assigned shipping profile is unavailable."); return JSON.parse(await decryptSecret(stored.detailsCiphertext)) as RunnerShipping; }
async function assertProxyInactive(proxyId: string): Promise<void> { const active = (await profiles.list()).some((profile) => profile.proxyProfileId === proxyId && (orchestrator.isActive(profile.id) || activeRun?.profileSessions.has(profile.id))); if (active) throw new Error("Close every browser using this proxy and end any active run before changing it."); }
async function encryptCreateCredentials(input: CreateProxyProfileInput): Promise<EncryptedProxyCredentials> { return { ...(input.username ? { username: await encryptSecret(input.username) } : {}), ...(input.password ? { password: await encryptSecret(input.password) } : {}) }; }
async function encryptUpdateCredentials(input: UpdateProxyProfileInput): Promise<EncryptedProxyCredentialUpdate> { return { ...(input.username === undefined ? {} : { username: input.username === null ? null : await encryptSecret(input.username) }), ...(input.password === undefined ? {} : { password: input.password === null ? null : await encryptSecret(input.password) }) }; }
async function encryptSecret(value: string): Promise<Buffer> { if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("Secure OS credential storage is unavailable. Credentials were not saved."); return safeStorage.encryptStringAsync(value); }
async function decryptSecret(value: Buffer): Promise<string> { if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("Secure OS credential storage is unavailable."); return (await safeStorage.decryptStringAsync(value)).result; }
function sessionFailure(error: unknown): SessionError { const text = message(error); return { code: /credential storage/i.test(text) ? "SECRET_STORAGE_UNAVAILABLE" : /external CDP endpoint/i.test(text) ? "INVALID_DRIVER_ENDPOINT" : /disabled|assigned proxy|proxy profile/i.test(text) ? "PROXY_CONNECTION_FAILED" : "UNKNOWN", message: text }; }
function runEnvironment(): RunEnvironment { return { appVersion: app.getVersion(), schemaVersion: SCHEMA_VERSION, osVersion: `${process.platform} ${process.getSystemVersion?.() ?? process.version}`, chromeVersion: process.versions.chrome ?? null, playwrightVersion: "rebrowser-playwright 1.52.0", capturedAt: Date.now() }; }
function runDirectory(id: string): string { const root = resolve(runsRoot); const candidate = resolve(root, id); if (!candidate.startsWith(`${root}${sep}`)) throw new Error("Invalid run artifact path."); return candidate; }
function elapsedSince(active: ActiveRun): string { return (BigInt(Date.now() - active.detail.run.startedAt) * 1_000_000n).toString(); }

async function monitorPolicy(target: TargetSnapshot): Promise<MonitorPolicy> { const monitoring = getStoreManifest(target.storeId)?.monitoring; if (!monitoring) throw new Error("MONITOR_ENDPOINT_UNSUPPORTED"); const behavior = resolveMonitorBehavior(await profiles.getMonitorSettings(), target.storeId); return { ...behavior, access: monitoring.access, endpoint: monitoring.endpoint, recommendedPollIntervalMs: monitoring.recommendedPollIntervalMs }; }
async function monitorRoutes(active?: ActiveRun): Promise<MonitorRoute[]> {
  const settings = await profiles.getMonitorSettings(); const routes: MonitorRoute[] = []; active?.monitorRouteProfiles.clear();
  for (const id of settings.proxyProfileIds) { const stored = await profiles.getStoredProxy(id); if (!stored?.enabled) continue; active?.monitorRouteProfiles.set(id, stored); routes.push({ kind: "PROXY", id: stored.id, proxyType: stored.type, protocol: stored.protocol, host: stored.host, port: stored.port, ...(stored.usernameCiphertext ? { username: await decryptSecret(stored.usernameCiphertext) } : {}), ...(stored.passwordCiphertext ? { password: await decryptSecret(stored.passwordCiphertext) } : {}) }); }
  return routes;
}
async function startMonitor(runId: string, target: TargetSnapshot): Promise<ChildProcess> {
  const active = activeRun; const policy = await monitorPolicy(target); const routes = await monitorRoutes(active);
  const monitoring = getStoreManifest(target.storeId)?.monitoring; if (!monitoring) throw new Error("MONITOR_ENDPOINT_UNSUPPORTED");
  const sources = target.directProductUrl ? monitoring.sources.filter((source) => source.kind === "direct-product") : monitoring.sources.filter((source) => source.kind !== "direct-product");
  const routeIds = (routes.length ? routes : [{ kind: "DIRECT" as const, id: "direct" as const }]).map((route) => route.id); const routeAllocation = Object.fromEntries(sources.map((source, index) => [source.kind, routeIds[index % routeIds.length]]));
  const discoverySnapshot = { descriptorVersion: 1 as const, mode: target.directProductUrl ? "DIRECT" as const : "MESH" as const, sources, sitemapStandbyIntervalMs: 30_000 as const, sitemapTurboIntervalMs: 5_000 as const, routeAllocation, sourceHealth: [] };
  await profiles.setRunDiscoverySnapshot(runId, discoverySnapshot); if (active?.detail.run.id === runId) active.detail.run.discoverySnapshot = discoverySnapshot;
  if (active?.detail.run.id === runId) await appendMonitorEvent(runId, "MONITOR_POLICY_APPLIED", null, JSON.stringify({ storeId: target.storeId, pollIntervalMs: policy.pollIntervalMs, fastPollIntervalMs: policy.fastPollIntervalMs, fastPollDurationMinutes: policy.fastPollDurationMinutes, requestTimeoutMs: policy.requestTimeoutMs, immediateFirstPoll: policy.immediateFirstPoll, routeUnhealthyMs: policy.routeUnhealthyMs, rotateOnProtection: policy.rotateOnProtection, serviceCooldownMs: policy.serviceCooldownMs, honorRetryAfter: policy.honorRetryAfter, configuredRouteCount: routes.length || 1 }));
  const worker = fork(join(__dirname, "monitor.js"), [], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
  worker.on("message", (value) => { void onMonitorEvent(value); }); worker.once("exit", () => {
    if (activeRun?.monitor === worker) activeRun.monitor = undefined;
    if (intentionallyStoppedMonitors.delete(worker)) return;
    if (activeRun?.detail.run.id === runId && !activeRun.ending) void appendMonitorEvent(runId, "TARGET_MONITOR_FAILED", null, "The shared monitor exited unexpectedly.");
  });
  if (!trySendMonitorCommand(worker, { type: "START_MONITOR", version: IPC_VERSION, runId, target, policy, routes })) throw new Error("The target monitor could not be started."); setTimeout(()=>{void evaluateCostBudgets();},0); return worker;
}
function stopMonitor(active: ActiveRun): void {
  const worker = active.monitor;
  if (!worker) return;
  intentionallyStoppedMonitors.add(worker);
  trySendMonitorCommand(worker, { type: "STOP_MONITOR", version: IPC_VERSION });
  setTimeout(() => { if (worker.exitCode === null && !worker.killed) worker.kill(); }, 3_000).unref();
  active.monitor = undefined;
}

function trySendMonitorCommand(worker: ChildProcess, command: MonitorCommand): boolean {
  if (!worker.connected || worker.killed || worker.exitCode !== null) return false;
  try {
    worker.send(command, (error) => {
      if (error && (error as NodeJS.ErrnoException).code !== "ERR_IPC_CHANNEL_CLOSED") console.error("Monitor IPC send failed:", message(error));
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ERR_IPC_CHANNEL_CLOSED") console.error("Monitor IPC send failed:", message(error));
    return false;
  }
}
async function testTarget(target: Target): Promise<TargetCheck> {
  const worker = fork(join(__dirname, "monitor.js"), [], { stdio: ["ignore", "inherit", "inherit", "ipc"] }); const snapshot = snapshotTarget(target);
  let settled = false;
  const check = await new Promise<TargetCheck>((resolve, reject) => {
    const timeout = setTimeout(() => { if (!settled) { settled = true; worker.kill(); reject(new Error("Target test timed out.")); } }, 45_000);
    worker.on("message", (value) => { const event = monitorEventSchema.safeParse(value); if (event.success && event.data.type === "MONITOR_TEST_RESULT") { if (!settled) { settled = true; clearTimeout(timeout); resolve(event.data.check); worker.kill(); } } });
    worker.once("exit", (code) => { if (!settled && code && code !== 0) { settled = true; clearTimeout(timeout); reject(new Error(`Target test monitor exited unexpectedly (code ${code}).`)); } });
    worker.on("error", (err) => { if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(`Target test monitor error: ${err.message}`)); } });
    void Promise.all([monitorRoutes(), monitorPolicy(snapshot)]).then(([routes, policy]) => {
      if (!trySendMonitorCommand(worker, { type: "TEST_TARGET", version: IPC_VERSION, target: snapshot, policy, routes })) throw new Error("The target test monitor could not be started.");
    }).catch((err) => { if (!settled) { settled = true; clearTimeout(timeout); worker.kill(); reject(err); } });
  });
  return check;
}
async function onMonitorEvent(value: unknown): Promise<void> {
  const parsed = monitorEventSchema.safeParse(value); if (!parsed.success) return; const event: MonitorEvent = parsed.data;
  const active = activeRun;
  if (event.type === "MONITOR_RUNTIME") { monitorStatus = event.status; emitMonitorChanged(); return; }
  if (event.type === "MONITOR_USAGE") {
    if (!active || event.runId !== active.detail.run.id) return; const proxy = active.monitorRouteProfiles.get(event.routeId); const costRate = proxy?.costPerGbMicrosUsd ?? null;
    await profiles.recordUsageSnapshot({ id: randomUUID(), runId: event.runId, usageKey: `monitor:${event.discoverySource ?? "all"}:${event.routeId}`, source: "MONITOR", runSessionId: null, browserProfileId:null, storeId: active.detail.run.targetSnapshot?.storeId ?? null, proxyProfileId: proxy?.id ?? null, proxyProvider:proxy?.provider??null, proxyName: proxy?.name ?? (event.routeId === "direct" ? "Direct" : null), discoverySource: event.discoverySource, ...event.usage, costPerGbMicrosUsd: costRate, estimatedCostMicrosUsd: estimateProxyCostMicrosUsd(event.usage.receivedBytes, event.usage.sentBytes, costRate), updatedAt: Date.now() }); await evaluateCostBudgets(); emitCostsChanged(); emitMonitorChanged(); return;
  }
  if (event.type === "MONITOR_HEALTH") {
    if (!active || event.runId !== active.detail.run.id) return;
    await saveHealth({ ...event.health, id: randomUUID(), subjectKind: "WATCHER", subjectId: active.detail.run.targetSnapshot?.storeId ?? "watcher", runId: active.detail.run.id, circuit: null });
    return;
  }
  if (event.type === "MONITOR_DISCOVERY_EVENT") {
    if (!active || event.runId !== active.detail.run.id) return;
    const storeId = active.detail.run.targetSnapshot?.storeId; if (storeId) await profiles.upsertMonitorDiscoveryState(storeId, event.event.source, event.event.routeId, { type: event.event.type, ...event.event.payload });
    const previous = monitorStatus.sources.find((source) => source.source === event.event.source && source.routeId === event.event.routeId); const unavailable = event.event.type === "DISCOVERY_SOURCE_UNAVAILABLE";
    const sourceHealth = { source: event.event.source, routeId: event.event.routeId, status: unavailable ? "BACKING_OFF" as const : "AVAILABLE" as const, lastStatusClass: typeof event.event.payload.statusClass === "number" ? event.event.payload.statusClass : previous?.lastStatusClass ?? null, lastLatencyMs: typeof event.event.payload.durationMs === "number" ? event.event.payload.durationMs : previous?.lastLatencyMs ?? null, backoffUntil: typeof event.event.payload.backoffUntil === "number" ? event.event.payload.backoffUntil : null, reasonCode: typeof event.event.payload.reasonCode === "string" ? event.event.payload.reasonCode : null, responseBytes: typeof event.event.payload.responseBytes === "number" ? event.event.payload.responseBytes : previous?.responseBytes ?? 0, candidateCount: typeof event.event.payload.candidateCount === "number" ? event.event.payload.candidateCount : previous?.candidateCount ?? 0 };
    monitorStatus = { ...monitorStatus, sources: [...monitorStatus.sources.filter((source) => source.source !== sourceHealth.source || source.routeId !== sourceHealth.routeId), sourceHealth], updatedAt: Date.now() }; emitMonitorChanged();
    await profiles.addRunEvent({ id: randomUUID(), runId: event.runId, runSessionId: null, wallTimeMs: Date.now(), elapsedNs: event.event.elapsedNs, type: event.event.type, stateBefore: null, stateAfter: null, payload: { source: event.event.source, routeId: event.event.routeId, ...event.event.payload } });
    emitRunsChanged(); return;
  }
  if (event.type !== "MONITOR_EVENT" || !active || event.runId !== active.detail.run.id) return;
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
    try { const shipping = await resolveShipping(shippingId); orchestrator.assist(profileId, active.detail.run.id, runSession.id, candidate, variant, target.quantity, { currency: target.currency, maxRetailMinor: target.maxRetailMinor }, shipping); active.assistedActivated.add(profileId); await profiles.setRunSessionExecution(runSession.id, "PRODUCT_OPEN"); }
    catch (error) { await profiles.setRunSessionExecution(runSession.id, "FAILED"); await profiles.addRunEvent({ id: randomUUID(), runId: active.detail.run.id, runSessionId: runSession.id, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type: "ASSIST_FAILED", stateBefore: "WAITING_FOR_TARGET", stateAfter: "FAILED", payload: { code: "SECRET_STORAGE_UNAVAILABLE", message: "Shipping details could not be loaded for assisted checkout." } }); }
  }));
}
async function promoteReadySession(active: ActiveRun, session: RunSession): Promise<void> {
  if (active.priorityProfileId) return;
  active.priorityProfileId = session.browserProfileId;
  await profiles.addRunEvent({ id: randomUUID(), runId: active.detail.run.id, runSessionId: null, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type: "LIVE_SESSION_PRIORITIZED", stateBefore: null, stateAfter: "READY_TO_CONFIRM", payload: { browserProfileId: session.browserProfileId, browserProfileName: session.browserProfileName, message: "This is the first session ready for manual payment review and confirmation." } });
}
async function saveHealth(snapshot: BrowserHealthSnapshot): Promise<void> { await profiles.addBrowserHealthSnapshot(snapshot); emitHealthChanged(); }
async function appendMonitorEvent(runId: string, type: string, check: TargetCheck | null, fallback: string | null): Promise<void> {
  const active = activeRun; if (!active || active.detail.run.id !== runId) return; const decision = check?.decision;
  await profiles.addRunEvent({ id: randomUUID(), runId, runSessionId: null, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type, stateBefore: null, stateAfter: null, payload: check ? { checkedAt: check.checkedAt, status: check.status, candidateCount: check.candidateCount, decision: decision?.kind, message: decision?.message, candidate: decision?.candidate ? { name: decision.candidate.name, url: decision.candidate.url, imageUrl: decision.candidate.imageUrl, priceMinor: decision.candidate.priceMinor, currency: decision.candidate.currency, variants: decision.candidate.variants } : null, selectedVariant: decision?.selectedVariant ?? null, retryAfterMs: check.retryAfterMs ?? null, errorMessage: check.errorMessage, errorCode: check.errorCode ?? null, routeId: check.routeId ?? null, routeAction: check.routeAction ?? "NONE" } : { message: fallback } });
}

async function onSessionChanged(snapshot: SessionSnapshot): Promise<void> {
  if (snapshot.state === "STOPPED" || snapshot.state === "ERROR" || snapshot.state === "CRASHED") clipboardCoordinator.cancelProfile(snapshot.profileId);
  mainWindow?.webContents.send(sessionIpc.changed, snapshot); const active = activeRun; const runSession = active?.profileSessions.get(snapshot.profileId); if (!active || !runSession) return;
  if (canStartTargetMonitor(Boolean(active.detail.run.targetSnapshot), Boolean(active.monitor), active.ending, snapshot.state)) {
    active.monitor = await startMonitor(active.detail.run.id, active.detail.run.targetSnapshot!);
  }
  if (snapshot.state === "READY") { runSession.status = "RECORDING"; runSession.route = snapshot.route; await profiles.setRunSession(runSession.id, "RECORDING", snapshot.route); await profiles.addRunEvent({ id: randomUUID(), runId: active.detail.run.id, runSessionId: runSession.id, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type: "SESSION_READY", stateBefore: "STARTING", stateAfter: "RECORDING", payload: { route: snapshot.route.kind, verification: snapshot.route.verification.status } }); await profiles.setRunStatus(active.detail.run.id, "RECORDING"); if (active.pendingAssist) await dispatchAssistedTarget(active, active.pendingAssist); emitRunsChanged(); }
  if (snapshot.state === "ERROR" || snapshot.state === "CRASHED") await recordSessionFailure(snapshot.profileId, runSession, snapshot.error ?? { code: "RUNNER_CRASHED", message: "The browser runner exited unexpectedly." });
}
async function recordSessionFailure(profileId: string, session: RunSession, error: SessionError): Promise<void> {
  const active = activeRun; if (!active || session.status === "FAILED") return;
  session.status = "FAILED"; session.finalError = error; session.executionState = "FAILED";
  await profiles.setRunSession(session.id, "FAILED", undefined, error);
  await profiles.setRunSessionExecution(session.id, "FAILED");
  await profiles.addRunEvent({ id: randomUUID(), runId: active.detail.run.id, runSessionId: session.id, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type: "SESSION_FAILED", stateBefore: null, stateAfter: "FAILED", payload: { code: error.code, message: error.message } });
  if (active.priorityProfileId === profileId) {
    active.priorityProfileId = null;
    const nextReady = [...active.profileSessions.values()].find((candidate) => candidate.status !== "FAILED" && candidate.executionState === "READY_TO_CONFIRM");
    if (nextReady) await promoteReadySession(active, nextReady);
  }
  if (active.detail.run.executionMode === "ASSISTED_CHECKOUT" && active.assistedDispatched) {
    const survivors = [...active.profileSessions.entries()].filter(([id, candidate]) => id !== profileId && candidate.status !== "FAILED" && candidate.status !== "ENDED");
    await profiles.addRunEvent({ id: randomUUID(), runId: active.detail.run.id, runSessionId: null, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type: survivors.length ? "SESSION_FAILOVER" : "CHECKOUT_SESSIONS_EXHAUSTED", stateBefore: null, stateAfter: null, payload: survivors.length ? { failedProfileId: profileId, continuingProfileIds: survivors.map(([id]) => id) } : { failedProfileId: profileId, message: "No checkout session remains available." } });
  }
  emitRunsChanged();
}
async function onRunnerEvent(event: RunnerEvent): Promise<void> {
  if (event.type === "CLIPBOARD_LEASE_REQUEST") { clipboardCoordinator.request(event); return; }
  if (event.type === "CLIPBOARD_LEASE_RELEASE") { clipboardCoordinator.release(event.profileId, event.requestId); return; }
  if (event.type === "CAPTCHA_CREDENTIAL_REQUEST") { await provideCaptchaCredential(event); return; }
  if (event.type === "CART_STATUS") { const status: CartStatus = { profileId: event.profileId, ...event.status }; cartStatuses.set(event.profileId, status); mainWindow?.webContents.send(sessionIpc.cartChanged, status); if (closeAfterCartCheck.delete(event.profileId)) void orchestrator.close(event.profileId); return; }
  if (event.type === "HEALTH") {
    const active = activeRun; if (!active) return;
    await saveHealth({ ...event.health, id: randomUUID(), subjectKind: "CHECKOUT", subjectId: event.profileId, runId: active.detail.run.id, circuit: null });
    return;
  }
  if (event.type === "NETWORK_USAGE") {
    const active = activeRun; if (!active || event.runId !== active.detail.run.id) return; const session = active.profileSessions.get(event.profileId); if (!session) return; const profile = await profiles.get(event.profileId); const proxy = profile?.proxyProfileId ? await profiles.getProxy(profile.proxyProfileId) : undefined; const rate = proxy?.costPerGbMicrosUsd ?? null;
    await profiles.recordUsageSnapshot({ id: randomUUID(), runId: event.runId, usageKey: `browser:${event.runSessionId}`, source: "BROWSER", runSessionId: event.runSessionId, browserProfileId:event.profileId, storeId: active.detail.run.targetSnapshot?.storeId ?? null, proxyProfileId: proxy?.id ?? null, proxyProvider:proxy?.provider??null, proxyName: proxy?.name ?? (session.route.kind === "direct" ? "Direct" : null), discoverySource: null, ...event.usage, costPerGbMicrosUsd: rate, estimatedCostMicrosUsd: estimateProxyCostMicrosUsd(event.usage.receivedBytes, event.usage.sentBytes, rate), updatedAt: Date.now() }); await evaluateCostBudgets();emitCostsChanged(); emitMonitorChanged(); return;
  }
  if (event.type === "PAYMENT_HANDOFF") { await handlePaymentHandoff(event.profileId, event.phase); return; }
  const active = activeRun; if (!active || (event.type !== "RUN_EVENT" && event.type !== "RUN_ARTIFACT" && event.type !== "RUN_ENDED")) return;
  const session = active.profileSessions.get(event.profileId); if (!session) return;
  if (event.type === "RUN_EVENT" && event.event.runId === active.detail.run.id) { await profiles.addRunEvent(event.event); if (event.event.type === "CAPTCHA_HARVESTER_OPENED") notifyCaptchaHarvester(event.profileId, session.browserProfileName); if (event.event.stateAfter) { const state = event.event.stateAfter as RunSession["executionState"]; await profiles.setRunSessionExecution(session.id, state, state === "CHECKPOINT" ? String(event.event.payload.reason ?? "CHECKPOINT") : null); session.executionState = state; session.checkpointReason = state === "CHECKPOINT" ? String(event.event.payload.reason ?? "CHECKPOINT") : null; if (state === "READY_TO_CONFIRM") await promoteReadySession(active, session); if (state === "FAILED") await recordSessionFailure(event.profileId, session, { code: "UNKNOWN", message: String(event.event.payload.message ?? "Assisted checkout failed.") }); } }
  if (event.type === "RUN_ARTIFACT" && event.artifact.runId === active.detail.run.id) await profiles.addRunArtifact(event.artifact);
  if (event.type === "RUN_ENDED" && event.runSessionId === session.id) { if (session.status !== "FAILED") session.status = "ENDED"; await profiles.setRunSession(session.id, session.status); active.pendingEnd.delete(session.id); if (active.pendingEnd.size === 0) active.resolveEnd?.(); }
  emitRunsChanged();
}

async function provideCaptchaCredential(event: Extract<RunnerEvent, { type: "CAPTCHA_CREDENTIAL_REQUEST" }>): Promise<void> {
  const active = activeRun; const session = active?.profileSessions.get(event.profileId);
  if (!active || active.detail.run.id !== event.runId || session?.id !== event.runSessionId || session.captchaProvider?.kind !== event.provider || session.captchaStrategy === "MANUAL_HARVESTER") { orchestrator.provideCaptchaCredential(event.profileId, event.requestId, null, "CANCELLED"); return; }
  const stored = await profiles.getStoredCaptchaProvider(event.provider);
  if (!stored?.enabled || !stored.apiKeyCiphertext) { orchestrator.provideCaptchaCredential(event.profileId, event.requestId, null, "NOT_CONFIGURED"); return; }
  try {
    const apiKey = await decryptSecret(stored.apiKeyCiphertext);
    orchestrator.provideCaptchaCredential(event.profileId, event.requestId, { kind: stored.kind, endpoint: stored.endpoint, apiKey }, null);
  } catch { orchestrator.provideCaptchaCredential(event.profileId, event.requestId, null, "UNAVAILABLE"); }
}

function notifyCaptchaHarvester(profileId: string, profileName: string): void {
  orchestrator.focusAssistPage(profileId); mainWindow?.flashFrame(true);
  if (Notification.isSupported()) { const notification = new Notification({ title: "CAPTCHA needs you", body: `${profileName} is showing the original challenged checkout page. Complete it once and Copify will resume automatically.` }); notification.on("click", () => orchestrator.focusAssistPage(profileId)); notification.show(); }
  setTimeout(() => mainWindow?.flashFrame(false), 15_000).unref();
}

function notifyPaymentHandoff(profileId: string): void {
  const active = activeRun; const name = active?.profileSessions.get(profileId)?.browserProfileName ?? "Checkout browser"; mainWindow?.show(); mainWindow?.focus(); mainWindow?.flashFrame(true);
  if (Notification.isSupported()) { const notification = new Notification({ title: "Payment authentication required", body: `${name} is waiting for PSD2 / 3DS approval. Complete it manually in Chrome.`, silent: false }); notification.on("click", () => { mainWindow?.show(); mainWindow?.focus(); }); notification.show(); }
  setTimeout(() => mainWindow?.flashFrame(false), 15_000).unref();
}

async function handlePaymentHandoff(profileId: string, phase: "DETECTED" | "RETURNED"): Promise<void> {
  if (phase === "DETECTED") {
    orchestrator.focusAssistPage(profileId);
    notifyPaymentHandoff(profileId);
  } else {
    mainWindow?.flashFrame(false);
  }
}

async function simulatePaymentHandoff(input: SimulatePaymentHandoffInput): Promise<boolean> {
  if (app.isPackaged) throw new Error("Payment handoff simulation is available only in development builds.");
  const active = activeRun;
  if (!active || active.detail.run.executionMode !== "ASSISTED_CHECKOUT") throw new Error("Start an assisted-checkout run before simulating a payment handoff.");
  const session = active.profileSessions.get(input.profileId);
  if (!session) throw new Error("The selected browser profile is not participating in this run.");
  const expectedState = input.phase === "DETECTED" ? "READY_TO_CONFIRM" : "CHECKOUT_HANDOFF";
  if (session.executionState !== expectedState) throw new Error(input.phase === "DETECTED" ? "A simulated handoff can start only after this session reaches READY_TO_CONFIRM." : "There is no simulated payment handoff to return from for this session.");

  const nextState = input.phase === "DETECTED" ? "CHECKOUT_HANDOFF" : "READY_TO_CONFIRM";
  const type = input.phase === "DETECTED" ? "PAYMENT_HANDOFF_DETECTED" : "PAYMENT_HANDOFF_RETURNED";
  await profiles.addRunEvent({
    id: randomUUID(),
    runId: active.detail.run.id,
    runSessionId: session.id,
    wallTimeMs: Date.now(),
    elapsedNs: elapsedSince(active),
    type,
    stateBefore: session.executionState,
    stateAfter: nextState,
    payload: { category: "PSD2_3DS", synthetic: true, message: "Development-only payment handoff simulation. No payment or checkout action was performed." },
  });
  await profiles.setRunSessionExecution(session.id, nextState);
  session.executionState = nextState;
  if (nextState === "READY_TO_CONFIRM") await promoteReadySession(active, session);
  await handlePaymentHandoff(input.profileId, input.phase);
  emitRunsChanged();
  return true;
}

async function resumeRunSession(profileId: string): Promise<boolean> {
  const active = activeRun; if (!active || active.detail.run.executionMode !== "ASSISTED_CHECKOUT") throw new Error("There is no active assisted run."); const session = active.profileSessions.get(profileId); if (!session || session.executionState !== "CHECKPOINT") throw new Error("This session is not waiting at a resumable checkpoint.");
  if (session.checkpointReason === "CAPTCHA_API_FAILED") { orchestrator.retryCaptcha(profileId, active.detail.run.id, session.id); return true; }
  const cartCheckpoint = /^(CART_NOT_EMPTY|CART_STATE_UNKNOWN|CART_CONTENT_CHANGED)$/.test(session.checkpointReason ?? ""); const nextState = cartCheckpoint ? (session.checkpointReason === "CART_CONTENT_CHANGED" ? "CARTED" : "PRODUCT_OPEN") : "CHECKOUT"; orchestrator.resumeAssist(profileId, active.detail.run.id, session.id); await profiles.addRunEvent({ id: randomUUID(), runId: active.detail.run.id, runSessionId: session.id, wallTimeMs: Date.now(), elapsedNs: elapsedSince(active), type: "CHECKPOINT_RESUMED", stateBefore: "CHECKPOINT", stateAfter: nextState, payload: { reason: session.checkpointReason } }); await profiles.setRunSessionExecution(session.id, nextState); session.executionState = nextState; emitRunsChanged(); return true;
}

app.whenReady().then(async () => {
  const dataRoot = app.getPath("userData"); runsRoot = join(dataRoot, "runs"); profiles = openProfileRepository(join(dataRoot, "copify.sqlite"), join(dataRoot, "browser-profiles")); await profiles.recoverInterruptedRuns(); orchestrator = new SessionOrchestrator(nodeRunnerFactory(join(__dirname, "runner.js")));
  protocol.handle("copify-artifact", async (request) => { const id = new URL(request.url).pathname.split("/").filter(Boolean).at(-1); if (!id) return new Response("Not found", { status: 404 }); const artifact = await profiles.getRunArtifact(id); if (!artifact || artifact.kind !== "SCREENSHOT") return new Response("Not found", { status: 404 }); const root = runDirectory(artifact.runId); const candidate = resolve(root, artifact.relativePath); if (!candidate.startsWith(`${root}${sep}`)) return new Response("Not found", { status: 404 }); return net.fetch(pathToFileURL(candidate).toString()); });
  clipboardCoordinator = new ClipboardCoordinator({
    availableFormats: () => clipboard.availableFormats(),
    writeLease: (value, requestId) => clipboard.write({ text: value, html: `<span data-copify-clipboard-lease="${requestId}"></span>` }),
    ownsLease: (value, requestId) => clipboard.readText() === value && clipboard.readHTML().includes(`data-copify-clipboard-lease="${requestId}"`),
    clear: () => clipboard.clear(),
  }, {
    grant: (profileId, requestId) => orchestrator.grantClipboardLease(profileId, requestId),
    deny: (profileId, requestId, reason) => orchestrator.denyClipboardLease(profileId, requestId, reason),
  });
  orchestrator.on("changed", (snapshot: SessionSnapshot) => { void onSessionChanged(snapshot); }); orchestrator.on("runner-event", (event: RunnerEvent) => { void onRunnerEvent(event); }); registerIpc(); applyApplicationMenu(); await createWindow(); await evaluateCostBudgets();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});
app.on("before-quit", (event) => { flushPlacement(); if (!orchestrator) return; event.preventDefault(); clipboardCoordinator?.cancelAll(); if (activeRun) stopMonitor(activeRun); void orchestrator.shutdown().finally(() => { profiles?.close(); app.exit(0); }); });
