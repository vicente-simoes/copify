import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { join } from "node:path";
import {
  createBrowserProfileSchema, createProxyProfileSchema, networkProbeSettingsSchema, profileIpc, proxyIpc, settingsIpc, sessionIpc, updateBrowserProfileSchema, updateProxyProfileSchema,
  type ApiResult, type BrowserProfile, type CreateProxyProfileInput, type ProxyBenchmark, type ProxyProfile, type RunnerProxy, type SessionError, type SessionSnapshot, type UpdateProxyProfileInput
} from "@copify/shared";
import { openProfileRepository, type EncryptedProxyCredentialUpdate, type EncryptedProxyCredentials, type ProfileRepository } from "@copify/persistence";
import { SessionOrchestrator, nodeRunnerFactory, type SessionLaunchSpec } from "@copify/core";
import { benchmarkRoute } from "@copify/runner";

let mainWindow: BrowserWindow | undefined;
let profiles: ProfileRepository;
let orchestrator: SessionOrchestrator;
let benchmarkRunning = false;

function result<T>(action: () => T): ApiResult<T> { try { return { ok: true, value: action() }; } catch (error) { return { ok: false, error: message(error) }; } }
async function resultAsync<T>(action: () => Promise<T>): Promise<ApiResult<T>> { try { return { ok: true, value: await action() }; } catch (error) { return { ok: false, error: message(error) }; } }
function message(error: unknown): string { return error instanceof Error ? error.message : "Unexpected application error."; }

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({ width: 1180, height: 820, minWidth: 900, minHeight: 600, webPreferences: { preload: join(__dirname, "../preload/preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false } });
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL); else await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

function registerIpc(): void {
  ipcMain.handle(profileIpc.list, (): Promise<ApiResult<BrowserProfile[]>> => resultAsync(() => profiles.list()));
  ipcMain.handle(profileIpc.create, (_event, input: unknown): Promise<ApiResult<BrowserProfile>> => resultAsync(() => profiles.create(createBrowserProfileSchema.parse(input))));
  ipcMain.handle(profileIpc.update, (_event, id: string, input: unknown): Promise<ApiResult<BrowserProfile>> => resultAsync(async () => {
    const update = updateBrowserProfileSchema.parse(input); if (orchestrator.isActive(id) && update.proxyProfileId !== undefined) throw new Error("Close this browser session before changing its route."); return profiles.update(id, update);
  }));
  ipcMain.handle(profileIpc.remove, async (_event, id: string): Promise<ApiResult<boolean>> => { await orchestrator.close(id); return resultAsync(() => profiles.remove(id)); });

  ipcMain.handle(proxyIpc.list, (): Promise<ApiResult<ProxyProfile[]>> => resultAsync(() => profiles.listProxies()));
  ipcMain.handle(proxyIpc.create, (_event, input: unknown): Promise<ApiResult<ProxyProfile>> => resultAsync(async () => {
    const parsed = createProxyProfileSchema.parse(input); return profiles.createProxy(parsed, await encryptCreateCredentials(parsed));
  }));
  ipcMain.handle(proxyIpc.update, (_event, id: string, input: unknown): Promise<ApiResult<ProxyProfile>> => resultAsync(async () => {
    await assertProxyInactive(id); const parsed = updateProxyProfileSchema.parse(input); return profiles.updateProxy(id, parsed, await encryptUpdateCredentials(parsed));
  }));
  ipcMain.handle(proxyIpc.remove, (_event, id: string): Promise<ApiResult<boolean>> => resultAsync(async () => { await assertProxyInactive(id); return profiles.removeProxy(id); }));
  ipcMain.handle(proxyIpc.benchmarks, (_event, proxyId: string | null): Promise<ApiResult<ProxyBenchmark[]>> => resultAsync(() => profiles.listBenchmarks(proxyId, 10)));
  ipcMain.handle(proxyIpc.test, (_event, proxyId: string | null): Promise<ApiResult<ProxyBenchmark>> => resultAsync(async () => {
    if (benchmarkRunning) throw new Error("A network benchmark is already running."); benchmarkRunning = true;
    try { const proxy = proxyId ? await resolveProxy(proxyId, true) : null; const benchmark = await benchmarkRoute(proxy, await profiles.getNetworkProbeUrl()); return profiles.addBenchmark(benchmark); } finally { benchmarkRunning = false; }
  }));

  ipcMain.handle(settingsIpc.getNetworkProbe, (): Promise<ApiResult<{ probeUrl: string }>> => resultAsync(async () => ({ probeUrl: await profiles.getNetworkProbeUrl() })));
  ipcMain.handle(settingsIpc.updateNetworkProbe, (_event, input: unknown): Promise<ApiResult<{ probeUrl: string }>> => resultAsync(async () => {
    const { probeUrl } = networkProbeSettingsSchema.parse(input); return { probeUrl: await profiles.setNetworkProbeUrl(probeUrl) };
  }));

  ipcMain.handle(sessionIpc.list, (): ApiResult<SessionSnapshot[]> => result(() => orchestrator.list()));
  ipcMain.handle(sessionIpc.open, (_event, id: string): Promise<ApiResult<SessionSnapshot>> => resultAsync(() => openSession(id)));
  ipcMain.handle(sessionIpc.close, async (_event, id: string): Promise<ApiResult<SessionSnapshot>> => { await orchestrator.close(id); return { ok: true, value: orchestrator.snapshot(id) }; });
  ipcMain.handle(sessionIpc.restart, (_event, id: string): Promise<ApiResult<SessionSnapshot>> => resultAsync(() => restartSession(id)));
  ipcMain.handle(sessionIpc.openAll, (): Promise<ApiResult<SessionSnapshot[]>> => resultAsync(async () => {
    const enabled = (await profiles.list()).filter((profile) => profile.enabled);
    await Promise.all(enabled.map(async (profile) => { try { await orchestrator.open(await launchSpec(profile)); } catch (error) { orchestrator.fail(profile.id, sessionFailure(error)); } }));
    return orchestrator.list();
  }));
  ipcMain.handle(sessionIpc.closeAll, async (): Promise<ApiResult<SessionSnapshot[]>> => { await orchestrator.shutdown(); return { ok: true, value: orchestrator.list() }; });
}

async function openSession(id: string): Promise<SessionSnapshot> { const profile = await requireProfile(id); try { await orchestrator.open(await launchSpec(profile)); } catch (error) { orchestrator.fail(id, sessionFailure(error)); throw error; } return orchestrator.snapshot(id); }
async function restartSession(id: string): Promise<SessionSnapshot> { const profile = await requireProfile(id); try { await orchestrator.restart(await launchSpec(profile)); } catch (error) { orchestrator.fail(id, sessionFailure(error)); throw error; } return orchestrator.snapshot(id); }
async function requireProfile(id: string): Promise<BrowserProfile> { const profile = await profiles.get(id); if (!profile) throw new Error("Browser profile not found."); return profile; }
async function launchSpec(profile: BrowserProfile): Promise<SessionLaunchSpec> { return { profile, proxy: profile.proxyProfileId ? await resolveProxy(profile.proxyProfileId) : null, probeUrl: await profiles.getNetworkProbeUrl() }; }
async function resolveProxy(id: string, allowDisabled = false): Promise<RunnerProxy> {
  const stored = await profiles.getStoredProxy(id); if (!stored) throw new Error("The assigned proxy profile no longer exists."); if (!allowDisabled && !stored.enabled) throw new Error("The assigned proxy profile is disabled.");
  const username = stored.usernameCiphertext ? await decryptSecret(stored.usernameCiphertext) : undefined; const password = stored.passwordCiphertext ? await decryptSecret(stored.passwordCiphertext) : undefined;
  return { proxyProfileId: stored.id, proxyName: stored.name, protocol: stored.protocol, host: stored.host, port: stored.port, ...(username ? { username } : {}), ...(password ? { password } : {}), expectedCountry: stored.expectedCountry, expectedCity: stored.expectedCity };
}
async function assertProxyInactive(proxyId: string): Promise<void> { const active = (await profiles.list()).some((profile) => profile.proxyProfileId === proxyId && orchestrator.isActive(profile.id)); if (active) throw new Error("Close every browser using this proxy before changing it."); }
async function encryptCreateCredentials(input: CreateProxyProfileInput): Promise<EncryptedProxyCredentials> { return { ...(input.username ? { username: await encryptSecret(input.username) } : {}), ...(input.password ? { password: await encryptSecret(input.password) } : {}) }; }
async function encryptUpdateCredentials(input: UpdateProxyProfileInput): Promise<EncryptedProxyCredentialUpdate> { return { ...(input.username === undefined ? {} : { username: input.username === null ? null : await encryptSecret(input.username) }), ...(input.password === undefined ? {} : { password: input.password === null ? null : await encryptSecret(input.password) }) }; }
async function encryptSecret(value: string): Promise<Buffer> { if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("Secure OS credential storage is unavailable. Credentials were not saved."); return safeStorage.encryptStringAsync(value); }
async function decryptSecret(value: Buffer): Promise<string> { if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("Secure OS credential storage is unavailable."); return (await safeStorage.decryptStringAsync(value)).result; }
function sessionFailure(error: unknown): SessionError { const text = message(error); return { code: /credential storage/i.test(text) ? "SECRET_STORAGE_UNAVAILABLE" : /disabled|assigned proxy|proxy profile/i.test(text) ? "PROXY_CONNECTION_FAILED" : "UNKNOWN", message: text }; }

app.whenReady().then(async () => {
  const dataRoot = app.getPath("userData"); profiles = openProfileRepository(join(dataRoot, "copify.sqlite"), join(dataRoot, "browser-profiles")); orchestrator = new SessionOrchestrator(nodeRunnerFactory(join(__dirname, "runner.js")));
  orchestrator.on("changed", (snapshot: SessionSnapshot) => mainWindow?.webContents.send(sessionIpc.changed, snapshot)); registerIpc(); await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});
app.on("before-quit", (event) => { if (!orchestrator) return; event.preventDefault(); void orchestrator.shutdown().finally(() => { profiles?.close(); app.exit(0); }); });
