import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import {
  createBrowserProfileSchema,
  profileIpc,
  sessionIpc,
  updateBrowserProfileSchema,
  type ApiResult,
  type BrowserProfile,
  type SessionSnapshot
} from "@copify/shared";
import { openProfileRepository, type ProfileRepository } from "@copify/persistence";
import { SessionOrchestrator, nodeRunnerFactory } from "@copify/core";

let mainWindow: BrowserWindow | undefined;
let profiles: ProfileRepository;
let orchestrator: SessionOrchestrator;

function result<T>(action: () => T): ApiResult<T> {
  try { return { ok: true, value: action() }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Unexpected application error." }; }
}
async function resultAsync<T>(action: () => Promise<T>): Promise<ApiResult<T>> {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Unexpected application error." }; }
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

function registerIpc(): void {
  ipcMain.handle(profileIpc.list, (): Promise<ApiResult<BrowserProfile[]>> => resultAsync(() => profiles.list()));
  ipcMain.handle(profileIpc.create, (_event, input: unknown): Promise<ApiResult<BrowserProfile>> => resultAsync(() => profiles.create(createBrowserProfileSchema.parse(input))));
  ipcMain.handle(profileIpc.update, (_event, id: string, input: unknown): Promise<ApiResult<BrowserProfile>> => resultAsync(() => profiles.update(id, updateBrowserProfileSchema.parse(input))));
  ipcMain.handle(profileIpc.remove, async (_event, id: string): Promise<ApiResult<boolean>> => {
    await orchestrator.close(id);
    return resultAsync(() => profiles.remove(id));
  });
  ipcMain.handle(sessionIpc.list, (): ApiResult<SessionSnapshot[]> => result(() => orchestrator.list()));
  ipcMain.handle(sessionIpc.open, async (_event, id: string): Promise<ApiResult<SessionSnapshot>> => {
    const profile = await profiles.get(id);
    if (!profile) return { ok: false, error: "Browser profile not found." };
    await orchestrator.open(profile);
    return { ok: true, value: orchestrator.snapshot(id) };
  });
  ipcMain.handle(sessionIpc.close, async (_event, id: string): Promise<ApiResult<SessionSnapshot>> => {
    await orchestrator.close(id);
    return { ok: true, value: orchestrator.snapshot(id) };
  });
  ipcMain.handle(sessionIpc.restart, async (_event, id: string): Promise<ApiResult<SessionSnapshot>> => {
    const profile = await profiles.get(id);
    if (!profile) return { ok: false, error: "Browser profile not found." };
    await orchestrator.restart(profile);
    return { ok: true, value: orchestrator.snapshot(id) };
  });
  ipcMain.handle(sessionIpc.openAll, async (): Promise<ApiResult<SessionSnapshot[]>> => {
    const enabled = (await profiles.list()).filter((profile) => profile.enabled);
    await Promise.all(enabled.map((profile) => orchestrator.open(profile)));
    return { ok: true, value: orchestrator.list() };
  });
  ipcMain.handle(sessionIpc.closeAll, async (): Promise<ApiResult<SessionSnapshot[]>> => {
    await orchestrator.shutdown();
    return { ok: true, value: orchestrator.list() };
  });
}

app.whenReady().then(async () => {
  const dataRoot = app.getPath("userData");
  profiles = openProfileRepository(join(dataRoot, "copify.sqlite"), join(dataRoot, "browser-profiles"));
  orchestrator = new SessionOrchestrator(nodeRunnerFactory(join(__dirname, "runner.js")));
  orchestrator.on("changed", (snapshot: SessionSnapshot) => mainWindow?.webContents.send(sessionIpc.changed, snapshot));
  registerIpc();
  await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});

app.on("before-quit", (event) => {
  if (!orchestrator) return;
  event.preventDefault();
  void orchestrator.shutdown().finally(() => {
    profiles?.close();
    app.exit(0);
  });
});
