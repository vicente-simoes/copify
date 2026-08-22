import { contextBridge, ipcRenderer } from "electron";
import {
  profileIpc,
  sessionIpc,
  type ApiResult,
  type BrowserProfile,
  type CreateBrowserProfileInput,
  type SessionSnapshot,
  type UpdateBrowserProfileInput
} from "@copify/shared";

const api = {
  profiles: {
    list: (): Promise<ApiResult<BrowserProfile[]>> => ipcRenderer.invoke(profileIpc.list),
    create: (input: CreateBrowserProfileInput): Promise<ApiResult<BrowserProfile>> => ipcRenderer.invoke(profileIpc.create, input),
    update: (id: string, input: UpdateBrowserProfileInput): Promise<ApiResult<BrowserProfile>> => ipcRenderer.invoke(profileIpc.update, id, input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(profileIpc.remove, id)
  },
  sessions: {
    list: (): Promise<ApiResult<SessionSnapshot[]>> => ipcRenderer.invoke(sessionIpc.list),
    open: (id: string): Promise<ApiResult<SessionSnapshot>> => ipcRenderer.invoke(sessionIpc.open, id),
    close: (id: string): Promise<ApiResult<SessionSnapshot>> => ipcRenderer.invoke(sessionIpc.close, id),
    restart: (id: string): Promise<ApiResult<SessionSnapshot>> => ipcRenderer.invoke(sessionIpc.restart, id),
    openAll: (): Promise<ApiResult<SessionSnapshot[]>> => ipcRenderer.invoke(sessionIpc.openAll),
    closeAll: (): Promise<ApiResult<SessionSnapshot[]>> => ipcRenderer.invoke(sessionIpc.closeAll),
    onChanged: (listener: (snapshot: SessionSnapshot) => void): (() => void) => {
      const callback = (_event: Electron.IpcRendererEvent, snapshot: SessionSnapshot) => listener(snapshot);
      ipcRenderer.on(sessionIpc.changed, callback);
      return () => ipcRenderer.removeListener(sessionIpc.changed, callback);
    }
  }
};

contextBridge.exposeInMainWorld("copify", api);

export type CopifyApi = typeof api;
