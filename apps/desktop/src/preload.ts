import { contextBridge, ipcRenderer } from "electron";
import {
  profileIpc, proxyIpc, settingsIpc, sessionIpc,
  type ApiResult, type BrowserProfile, type CreateBrowserProfileInput, type CreateProxyProfileInput, type NetworkProbeSettings, type ProxyBenchmark, type ProxyProfile, type SessionSnapshot, type UpdateBrowserProfileInput, type UpdateProxyProfileInput
} from "@copify/shared";

const api = {
  profiles: {
    list: (): Promise<ApiResult<BrowserProfile[]>> => ipcRenderer.invoke(profileIpc.list),
    create: (input: CreateBrowserProfileInput): Promise<ApiResult<BrowserProfile>> => ipcRenderer.invoke(profileIpc.create, input),
    update: (id: string, input: UpdateBrowserProfileInput): Promise<ApiResult<BrowserProfile>> => ipcRenderer.invoke(profileIpc.update, id, input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(profileIpc.remove, id)
  },
  proxies: {
    list: (): Promise<ApiResult<ProxyProfile[]>> => ipcRenderer.invoke(proxyIpc.list),
    create: (input: CreateProxyProfileInput): Promise<ApiResult<ProxyProfile>> => ipcRenderer.invoke(proxyIpc.create, input),
    update: (id: string, input: UpdateProxyProfileInput): Promise<ApiResult<ProxyProfile>> => ipcRenderer.invoke(proxyIpc.update, id, input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(proxyIpc.remove, id),
    test: (id: string | null): Promise<ApiResult<ProxyBenchmark>> => ipcRenderer.invoke(proxyIpc.test, id),
    benchmarks: (id: string | null): Promise<ApiResult<ProxyBenchmark[]>> => ipcRenderer.invoke(proxyIpc.benchmarks, id)
  },
  settings: {
    getNetworkProbe: (): Promise<ApiResult<NetworkProbeSettings>> => ipcRenderer.invoke(settingsIpc.getNetworkProbe),
    updateNetworkProbe: (input: NetworkProbeSettings): Promise<ApiResult<NetworkProbeSettings>> => ipcRenderer.invoke(settingsIpc.updateNetworkProbe, input)
  },
  sessions: {
    list: (): Promise<ApiResult<SessionSnapshot[]>> => ipcRenderer.invoke(sessionIpc.list), open: (id: string): Promise<ApiResult<SessionSnapshot>> => ipcRenderer.invoke(sessionIpc.open, id), close: (id: string): Promise<ApiResult<SessionSnapshot>> => ipcRenderer.invoke(sessionIpc.close, id), restart: (id: string): Promise<ApiResult<SessionSnapshot>> => ipcRenderer.invoke(sessionIpc.restart, id), openAll: (): Promise<ApiResult<SessionSnapshot[]>> => ipcRenderer.invoke(sessionIpc.openAll), closeAll: (): Promise<ApiResult<SessionSnapshot[]>> => ipcRenderer.invoke(sessionIpc.closeAll),
    onChanged: (listener: (snapshot: SessionSnapshot) => void): (() => void) => { const callback = (_event: Electron.IpcRendererEvent, snapshot: SessionSnapshot) => listener(snapshot); ipcRenderer.on(sessionIpc.changed, callback); return () => ipcRenderer.removeListener(sessionIpc.changed, callback); }
  }
};
contextBridge.exposeInMainWorld("copify", api);
export type CopifyApi = typeof api;
