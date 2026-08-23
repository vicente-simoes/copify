import { contextBridge, ipcRenderer } from "electron";
import {
  healthIpc, profileIpc, proxyIpc, runIpc, runSetupIpc, settingsIpc, sessionIpc, shippingIpc, storeIpc, targetIpc,
  type ApiResult, type AppInfo, type BrowserHealthDetail, type BrowserHealthSnapshot, type BrowserProfile, type CartStatus, type CreateBrowserProfileInput, type CreateProxyProfileInput, type CreateRunInput, type CreateRunSetupInput, type CreateShippingProfileInput, type CreateTargetInput, type NetworkProbeSettings, type ProxyBenchmark, type ProxyProfile, type Run, type RunDetail, type RunSetup, type SessionSnapshot, type ShippingProfile, type Store, type Target, type UpdateBrowserProfileInput, type UpdateProxyProfileInput, type UpdateShippingProfileInput, type UpdateTargetInput
} from "@copify/shared";

const api = {
  profiles: {
    list: (): Promise<ApiResult<BrowserProfile[]>> => ipcRenderer.invoke(profileIpc.list),
    create: (input: CreateBrowserProfileInput): Promise<ApiResult<BrowserProfile>> => ipcRenderer.invoke(profileIpc.create, input),
    update: (id: string, input: UpdateBrowserProfileInput): Promise<ApiResult<BrowserProfile>> => ipcRenderer.invoke(profileIpc.update, id, input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(profileIpc.remove, id)
  },
  targets: {
    list: (): Promise<ApiResult<Target[]>> => ipcRenderer.invoke(targetIpc.list),
    create: (input: CreateTargetInput): Promise<ApiResult<Target>> => ipcRenderer.invoke(targetIpc.create, input),
    update: (id: string, input: UpdateTargetInput): Promise<ApiResult<Target>> => ipcRenderer.invoke(targetIpc.update, id, input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(targetIpc.remove, id),
    test: (id: string): Promise<ApiResult<Target>> => ipcRenderer.invoke(targetIpc.test, id),
    onChanged: (listener: () => void): (() => void) => { const callback = () => listener(); ipcRenderer.on(targetIpc.changed, callback); return () => ipcRenderer.removeListener(targetIpc.changed, callback); }
  },
  proxies: {
    list: (): Promise<ApiResult<ProxyProfile[]>> => ipcRenderer.invoke(proxyIpc.list),
    create: (input: CreateProxyProfileInput): Promise<ApiResult<ProxyProfile>> => ipcRenderer.invoke(proxyIpc.create, input),
    update: (id: string, input: UpdateProxyProfileInput): Promise<ApiResult<ProxyProfile>> => ipcRenderer.invoke(proxyIpc.update, id, input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(proxyIpc.remove, id),
    test: (id: string | null): Promise<ApiResult<ProxyBenchmark>> => ipcRenderer.invoke(proxyIpc.test, id),
    benchmarks: (id: string | null): Promise<ApiResult<ProxyBenchmark[]>> => ipcRenderer.invoke(proxyIpc.benchmarks, id)
  },
  shipping: {
    list: (): Promise<ApiResult<ShippingProfile[]>> => ipcRenderer.invoke(shippingIpc.list),
    create: (input: CreateShippingProfileInput): Promise<ApiResult<ShippingProfile>> => ipcRenderer.invoke(shippingIpc.create, input),
    update: (id: string, input: UpdateShippingProfileInput): Promise<ApiResult<ShippingProfile>> => ipcRenderer.invoke(shippingIpc.update, id, input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(shippingIpc.remove, id),
    onChanged: (listener: () => void): (() => void) => { const callback = () => listener(); ipcRenderer.on(shippingIpc.changed, callback); return () => ipcRenderer.removeListener(shippingIpc.changed, callback); }
  },
  stores: {
    list: (): Promise<ApiResult<Store[]>> => ipcRenderer.invoke(storeIpc.list),
    update: (id: string, enabled: boolean): Promise<ApiResult<Store[]>> => ipcRenderer.invoke(storeIpc.update, id, enabled),
    onChanged: (listener: () => void): (() => void) => { const callback = () => listener(); ipcRenderer.on(storeIpc.changed, callback); return () => ipcRenderer.removeListener(storeIpc.changed, callback); }
  },
  settings: {
    getNetworkProbe: (): Promise<ApiResult<NetworkProbeSettings>> => ipcRenderer.invoke(settingsIpc.getNetworkProbe),
    updateNetworkProbe: (input: NetworkProbeSettings): Promise<ApiResult<NetworkProbeSettings>> => ipcRenderer.invoke(settingsIpc.updateNetworkProbe, input),
    appInfo: (): Promise<ApiResult<AppInfo>> => ipcRenderer.invoke(settingsIpc.appInfo)
  },
  sessions: {
    list: (): Promise<ApiResult<SessionSnapshot[]>> => ipcRenderer.invoke(sessionIpc.list), open: (id: string): Promise<ApiResult<SessionSnapshot>> => ipcRenderer.invoke(sessionIpc.open, id), close: (id: string): Promise<ApiResult<SessionSnapshot>> => ipcRenderer.invoke(sessionIpc.close, id), restart: (id: string): Promise<ApiResult<SessionSnapshot>> => ipcRenderer.invoke(sessionIpc.restart, id), openAll: (): Promise<ApiResult<SessionSnapshot[]>> => ipcRenderer.invoke(sessionIpc.openAll), closeAll: (): Promise<ApiResult<SessionSnapshot[]>> => ipcRenderer.invoke(sessionIpc.closeAll), carts: (): Promise<ApiResult<CartStatus[]>> => ipcRenderer.invoke(sessionIpc.carts), checkCart: (id: string): Promise<ApiResult<CartStatus>> => ipcRenderer.invoke(sessionIpc.checkCart, id), emptyCart: (id: string): Promise<ApiResult<CartStatus>> => ipcRenderer.invoke(sessionIpc.emptyCart, id), emptyCarts: (): Promise<ApiResult<CartStatus[]>> => ipcRenderer.invoke(sessionIpc.emptyCarts),
    onChanged: (listener: (snapshot: SessionSnapshot) => void): (() => void) => { const callback = (_event: Electron.IpcRendererEvent, snapshot: SessionSnapshot) => listener(snapshot); ipcRenderer.on(sessionIpc.changed, callback); return () => ipcRenderer.removeListener(sessionIpc.changed, callback); }, onCartChanged: (listener: (status: CartStatus) => void): (() => void) => { const callback = (_event: Electron.IpcRendererEvent, status: CartStatus) => listener(status); ipcRenderer.on(sessionIpc.cartChanged, callback); return () => ipcRenderer.removeListener(sessionIpc.cartChanged, callback); }
  },
  runs: {
    list: (): Promise<ApiResult<{ runs: Run[]; activeRunId: string | null }>> => ipcRenderer.invoke(runIpc.list),
    get: (id: string): Promise<ApiResult<RunDetail | null>> => ipcRenderer.invoke(runIpc.get, id),
    start: (input: CreateRunInput): Promise<ApiResult<RunDetail>> => ipcRenderer.invoke(runIpc.start, input),
    end: (): Promise<ApiResult<RunDetail>> => ipcRenderer.invoke(runIpc.end), resume: (profileId: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(runIpc.resume, profileId),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(runIpc.remove, id),
    onChanged: (listener: () => void): (() => void) => { const callback = () => listener(); ipcRenderer.on(runIpc.changed, callback); return () => ipcRenderer.removeListener(runIpc.changed, callback); }
  },
  health: {
    get: (subjectKind: BrowserHealthSnapshot["subjectKind"], subjectId: string): Promise<ApiResult<BrowserHealthDetail>> => ipcRenderer.invoke(healthIpc.get, subjectKind, subjectId),
    onChanged: (listener: () => void): (() => void) => { const callback = () => listener(); ipcRenderer.on(healthIpc.changed, callback); return () => ipcRenderer.removeListener(healthIpc.changed, callback); },
  },
  runSetups: {
    list: (): Promise<ApiResult<RunSetup[]>> => ipcRenderer.invoke(runSetupIpc.list),
    create: (input: CreateRunSetupInput): Promise<ApiResult<RunSetup>> => ipcRenderer.invoke(runSetupIpc.create, input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(runSetupIpc.remove, id),
    onChanged: (listener: () => void): (() => void) => { const callback = () => listener(); ipcRenderer.on(runSetupIpc.changed, callback); return () => ipcRenderer.removeListener(runSetupIpc.changed, callback); }
  }
};
contextBridge.exposeInMainWorld("copify", api);
export type CopifyApi = typeof api;
