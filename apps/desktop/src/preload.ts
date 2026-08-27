import { contextBridge, ipcRenderer } from "electron";
import {
  analyticsIpc, captchaIpc, costIpc, healthIpc, monitorIpc, paymentIpc, profileIpc, proxyIpc, runIpc, runSetupIpc, settingsIpc, sessionIpc, shippingIpc, storeIpc, targetIpc, usageIpc, warmingIpc,
  type AnalyticsFilter, type AnalyticsResult, type ApiResult, type AppInfo, type AppearanceSettings, type BrowserHealthDetail, type CaptchaLabStatus, type CaptchaProviderDiagnostic, type CaptchaProviderKind, type CaptchaSettings, type ChromeColors, type BrowserHealthSnapshot, type BrowserProfile, type CartStatus, type CommitPaymentBatchInput, type CostBudget, type CostQuery, type CostSummary, type CreateBrowserProfileInput, type CreateManualCostSnapshotInput, type CreatePaymentProfileInput, type CreateProxyProfileInput, type CreateRunAnnotationInput, type CreateRunInput, type CreateRunSetupInput, type CreateShippingProfileInput, type CreateTargetInput, type MonitorRuntimeStatus, type MonitorSettings, type NetworkProbeSettings, type PaymentBatchCommitResult, type PaymentBatchPreview, type PaymentProfile, type ProfileWarmState, type ProviderImportCommitResult, type ProviderImportMapping, type ProviderImportPreview, type ProxyBenchmark, type ProxyProfile, type ProxySecretReveal, type ReconciliationStatus, type Run, type RunAnnotation, type RunDetail, type RunNetworkUsage, type RunSetup, type SecretCopyField, type SessionSnapshot, type ShippingProfile, type ShippingSecretReveal, type SimulatePaymentHandoffInput, type StartCaptchaLabInput, type Store, type Target, type UpdateBrowserProfileInput, type UpdateCaptchaSettingsInput, type UpdatePaymentProfileInput, type UpdateProfileWarmStateInput, type UpdateProxyProfileInput, type UpdateShippingProfileInput, type UpdateTargetInput, type UpsertCaptchaProviderInput, type UpsertCostBudgetInput, type WarmDestination
} from "@copify/shared";

const api = {
  profiles: {
    list: (): Promise<ApiResult<BrowserProfile[]>> => ipcRenderer.invoke(profileIpc.list),
    create: (input: CreateBrowserProfileInput): Promise<ApiResult<BrowserProfile>> => ipcRenderer.invoke(profileIpc.create, input),
    update: (id: string, input: UpdateBrowserProfileInput): Promise<ApiResult<BrowserProfile>> => ipcRenderer.invoke(profileIpc.update, id, input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(profileIpc.remove, id),
    reorder: (ids: string[]): Promise<ApiResult<BrowserProfile[]>> => ipcRenderer.invoke(profileIpc.reorder, ids)
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
    benchmarks: (id: string | null): Promise<ApiResult<ProxyBenchmark[]>> => ipcRenderer.invoke(proxyIpc.benchmarks, id),
    reveal: (id: string): Promise<ApiResult<ProxySecretReveal | null>> => ipcRenderer.invoke(proxyIpc.reveal, id),
    copyRevealed: (token: string, field: SecretCopyField): Promise<ApiResult<boolean>> => ipcRenderer.invoke(proxyIpc.copyRevealed, token, field)
  },
  shipping: {
    list: (): Promise<ApiResult<ShippingProfile[]>> => ipcRenderer.invoke(shippingIpc.list),
    create: (input: CreateShippingProfileInput): Promise<ApiResult<ShippingProfile>> => ipcRenderer.invoke(shippingIpc.create, input),
    update: (id: string, input: UpdateShippingProfileInput): Promise<ApiResult<ShippingProfile>> => ipcRenderer.invoke(shippingIpc.update, id, input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(shippingIpc.remove, id),
    reveal: (id: string): Promise<ApiResult<ShippingSecretReveal | null>> => ipcRenderer.invoke(shippingIpc.reveal, id),
    copyRevealed: (token: string, field: SecretCopyField): Promise<ApiResult<boolean>> => ipcRenderer.invoke(shippingIpc.copyRevealed, token, field),
    onChanged: (listener: () => void): (() => void) => { const callback = () => listener(); ipcRenderer.on(shippingIpc.changed, callback); return () => ipcRenderer.removeListener(shippingIpc.changed, callback); }
  },
  payments: {
    list: (): Promise<ApiResult<PaymentProfile[]>> => ipcRenderer.invoke(paymentIpc.list),
    create: (input: CreatePaymentProfileInput): Promise<ApiResult<PaymentProfile>> => ipcRenderer.invoke(paymentIpc.create, input),
    update: (id: string, input: UpdatePaymentProfileInput): Promise<ApiResult<PaymentProfile>> => ipcRenderer.invoke(paymentIpc.update, id, input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(paymentIpc.remove, id),
    previewCsv: (): Promise<ApiResult<PaymentBatchPreview | null>> => ipcRenderer.invoke(paymentIpc.previewCsv),
    previewPaste: (csv: string): Promise<ApiResult<PaymentBatchPreview>> => ipcRenderer.invoke(paymentIpc.previewPaste, { text: csv }),
    commitBatch: (input: CommitPaymentBatchInput): Promise<ApiResult<PaymentBatchCommitResult>> => ipcRenderer.invoke(paymentIpc.commitBatch, input),
    cancelBatch: (token: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(paymentIpc.cancelBatch, token),
    onChanged: (listener: () => void): (() => void) => { const callback = () => listener(); ipcRenderer.on(paymentIpc.changed, callback); return () => ipcRenderer.removeListener(paymentIpc.changed, callback); }
  },
  stores: {
    list: (): Promise<ApiResult<Store[]>> => ipcRenderer.invoke(storeIpc.list),
    update: (id: string, enabled: boolean): Promise<ApiResult<Store[]>> => ipcRenderer.invoke(storeIpc.update, id, enabled),
    onChanged: (listener: () => void): (() => void) => { const callback = () => listener(); ipcRenderer.on(storeIpc.changed, callback); return () => ipcRenderer.removeListener(storeIpc.changed, callback); }
  },
  settings: {
    getNetworkProbe: (): Promise<ApiResult<NetworkProbeSettings>> => ipcRenderer.invoke(settingsIpc.getNetworkProbe),
    updateNetworkProbe: (input: NetworkProbeSettings): Promise<ApiResult<NetworkProbeSettings>> => ipcRenderer.invoke(settingsIpc.updateNetworkProbe, input),
    getMonitor: (): Promise<ApiResult<MonitorSettings>> => ipcRenderer.invoke(settingsIpc.getMonitor),
    updateMonitor: (input: MonitorSettings): Promise<ApiResult<MonitorSettings>> => ipcRenderer.invoke(settingsIpc.updateMonitor, input),
    getAppearance: (): Promise<ApiResult<AppearanceSettings>> => ipcRenderer.invoke(settingsIpc.getAppearance),
    updateAppearance: (input: AppearanceSettings): Promise<ApiResult<AppearanceSettings>> => ipcRenderer.invoke(settingsIpc.updateAppearance, input),
    applyChrome: (colors: ChromeColors): Promise<ApiResult<boolean>> => ipcRenderer.invoke(settingsIpc.applyChrome, colors),
    appInfo: (): Promise<ApiResult<AppInfo>> => ipcRenderer.invoke(settingsIpc.appInfo)
  },
  captcha: {
    settings: (): Promise<ApiResult<CaptchaSettings>> => ipcRenderer.invoke(captchaIpc.settings),
    updateSettings: (input: UpdateCaptchaSettingsInput): Promise<ApiResult<CaptchaSettings>> => ipcRenderer.invoke(captchaIpc.updateSettings, input),
    upsertProvider: (input: UpsertCaptchaProviderInput): Promise<ApiResult<CaptchaSettings>> => ipcRenderer.invoke(captchaIpc.upsertProvider, input),
    removeProvider: (kind: CaptchaProviderKind): Promise<ApiResult<CaptchaSettings>> => ipcRenderer.invoke(captchaIpc.removeProvider, kind),
    diagnose: (kind: CaptchaProviderKind): Promise<ApiResult<CaptchaProviderDiagnostic>> => ipcRenderer.invoke(captchaIpc.diagnose, kind),
    labStatus: (): Promise<ApiResult<CaptchaLabStatus>> => ipcRenderer.invoke(captchaIpc.labStatus),
    startLab: (input: StartCaptchaLabInput): Promise<ApiResult<CaptchaLabStatus>> => ipcRenderer.invoke(captchaIpc.labStart, input),
    stopLab: (): Promise<ApiResult<CaptchaLabStatus>> => ipcRenderer.invoke(captchaIpc.labStop),
    onChanged: (listener: () => void): (() => void) => { const callback = () => listener(); ipcRenderer.on(captchaIpc.changed, callback); return () => ipcRenderer.removeListener(captchaIpc.changed, callback); },
    onLabChanged: (listener: (status: CaptchaLabStatus) => void): (() => void) => { const callback = (_event: Electron.IpcRendererEvent, status: CaptchaLabStatus) => listener(status); ipcRenderer.on(captchaIpc.labChanged, callback); return () => ipcRenderer.removeListener(captchaIpc.labChanged, callback); }
  },
  sessions: {
    list: (): Promise<ApiResult<SessionSnapshot[]>> => ipcRenderer.invoke(sessionIpc.list), open: (id: string): Promise<ApiResult<SessionSnapshot>> => ipcRenderer.invoke(sessionIpc.open, id), close: (id: string): Promise<ApiResult<SessionSnapshot>> => ipcRenderer.invoke(sessionIpc.close, id), restart: (id: string): Promise<ApiResult<SessionSnapshot>> => ipcRenderer.invoke(sessionIpc.restart, id), checkCoherence: (id: string): Promise<ApiResult<SessionSnapshot>> => ipcRenderer.invoke(sessionIpc.checkCoherence, id), checkCoherenceAll: (): Promise<ApiResult<SessionSnapshot[]>> => ipcRenderer.invoke(sessionIpc.checkCoherenceAll), openAll: (): Promise<ApiResult<SessionSnapshot[]>> => ipcRenderer.invoke(sessionIpc.openAll), closeAll: (): Promise<ApiResult<SessionSnapshot[]>> => ipcRenderer.invoke(sessionIpc.closeAll), carts: (): Promise<ApiResult<CartStatus[]>> => ipcRenderer.invoke(sessionIpc.carts), checkCart: (id: string): Promise<ApiResult<CartStatus>> => ipcRenderer.invoke(sessionIpc.checkCart, id), emptyCart: (id: string): Promise<ApiResult<CartStatus>> => ipcRenderer.invoke(sessionIpc.emptyCart, id), emptyCarts: (): Promise<ApiResult<CartStatus[]>> => ipcRenderer.invoke(sessionIpc.emptyCarts),
    onChanged: (listener: (snapshot: SessionSnapshot) => void): (() => void) => { const callback = (_event: Electron.IpcRendererEvent, snapshot: SessionSnapshot) => listener(snapshot); ipcRenderer.on(sessionIpc.changed, callback); return () => ipcRenderer.removeListener(sessionIpc.changed, callback); }, onCartChanged: (listener: (status: CartStatus) => void): (() => void) => { const callback = (_event: Electron.IpcRendererEvent, status: CartStatus) => listener(status); ipcRenderer.on(sessionIpc.cartChanged, callback); return () => ipcRenderer.removeListener(sessionIpc.cartChanged, callback); }
  },
  runs: {
    list: (): Promise<ApiResult<{ runs: Run[]; activeRunId: string | null }>> => ipcRenderer.invoke(runIpc.list),
    get: (id: string): Promise<ApiResult<RunDetail | null>> => ipcRenderer.invoke(runIpc.get, id),
    start: (input: CreateRunInput): Promise<ApiResult<RunDetail>> => ipcRenderer.invoke(runIpc.start, input),
    end: (): Promise<ApiResult<RunDetail>> => ipcRenderer.invoke(runIpc.end), resume: (profileId: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(runIpc.resume, profileId),
    simulatePaymentHandoff: (input: SimulatePaymentHandoffInput): Promise<ApiResult<boolean>> => ipcRenderer.invoke(runIpc.simulatePaymentHandoff, input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(runIpc.remove, id),
    onChanged: (listener: () => void): (() => void) => { const callback = () => listener(); ipcRenderer.on(runIpc.changed, callback); return () => ipcRenderer.removeListener(runIpc.changed, callback); }
  },
  health: {
    get: (subjectKind: BrowserHealthSnapshot["subjectKind"], subjectId: string): Promise<ApiResult<BrowserHealthDetail>> => ipcRenderer.invoke(healthIpc.get, subjectKind, subjectId),
    onChanged: (listener: () => void): (() => void) => { const callback = () => listener(); ipcRenderer.on(healthIpc.changed, callback); return () => ipcRenderer.removeListener(healthIpc.changed, callback); },
  },
  warming: {
    list: (): Promise<ApiResult<ProfileWarmState[]>> => ipcRenderer.invoke(warmingIpc.list),
    start: (browserProfileId: string, storeId: string): Promise<ApiResult<ProfileWarmState>> => ipcRenderer.invoke(warmingIpc.start, browserProfileId, storeId),
    update: (browserProfileId: string, storeId: string, input: UpdateProfileWarmStateInput): Promise<ApiResult<ProfileWarmState>> => ipcRenderer.invoke(warmingIpc.update, browserProfileId, storeId, input),
    openDestination: (browserProfileId: string, storeId: string, destination: WarmDestination): Promise<ApiResult<boolean>> => ipcRenderer.invoke(warmingIpc.openDestination, browserProfileId, storeId, destination),
    complete: (browserProfileId: string, storeId: string): Promise<ApiResult<ProfileWarmState>> => ipcRenderer.invoke(warmingIpc.complete, browserProfileId, storeId),
    onChanged: (listener: (states: ProfileWarmState[]) => void): (() => void) => { const callback = (_event: Electron.IpcRendererEvent, states: ProfileWarmState[]) => listener(states); ipcRenderer.on(warmingIpc.changed, callback); return () => ipcRenderer.removeListener(warmingIpc.changed, callback); },
  },
  monitor: {
    status: (): Promise<ApiResult<MonitorRuntimeStatus>> => ipcRenderer.invoke(monitorIpc.status),
    setTurbo: (enabled: boolean): Promise<ApiResult<MonitorRuntimeStatus>> => ipcRenderer.invoke(monitorIpc.setTurbo, enabled),
    onChanged: (listener: (status: MonitorRuntimeStatus) => void): (() => void) => { const callback = (_event: Electron.IpcRendererEvent, status: MonitorRuntimeStatus) => listener(status); ipcRenderer.on(monitorIpc.changed, callback); return () => ipcRenderer.removeListener(monitorIpc.changed, callback); },
  },
  usage: {
    run: (runId: string): Promise<ApiResult<RunNetworkUsage[]>> => ipcRenderer.invoke(usageIpc.run, runId),
    totals: (): Promise<ApiResult<RunNetworkUsage[]>> => ipcRenderer.invoke(usageIpc.totals),
  },
  costs: {
    query:(input:CostQuery):Promise<ApiResult<CostSummary>>=>ipcRenderer.invoke(costIpc.query,input),
    manualSnapshot:(input:CreateManualCostSnapshotInput):Promise<ApiResult<boolean>>=>ipcRenderer.invoke(costIpc.manualSnapshot,input),
    removeManualSnapshot:(id:string):Promise<ApiResult<boolean>>=>ipcRenderer.invoke(costIpc.removeManualSnapshot,id),
    importOpen:(provider:string):Promise<ApiResult<ProviderImportPreview|null>>=>ipcRenderer.invoke(costIpc.importOpen,{provider}),
    importPreview:(token:string,mapping?:ProviderImportMapping):Promise<ApiResult<ProviderImportPreview>>=>ipcRenderer.invoke(costIpc.importPreview,{token,mapping}),
    importCommit:(token:string,mapping:ProviderImportMapping):Promise<ApiResult<ProviderImportCommitResult>>=>ipcRenderer.invoke(costIpc.importCommit,{token,mapping}),
    importCancel:(token:string):Promise<ApiResult<boolean>>=>ipcRenderer.invoke(costIpc.importCancel,token),
    budgets:():Promise<ApiResult<CostBudget[]>>=>ipcRenderer.invoke(costIpc.budgets),
    upsertBudget:(input:UpsertCostBudgetInput):Promise<ApiResult<CostBudget>>=>ipcRenderer.invoke(costIpc.upsertBudget,input),
    removeBudget:(id:string):Promise<ApiResult<boolean>>=>ipcRenderer.invoke(costIpc.removeBudget,id),
    reconciliation:(provider?:string):Promise<ApiResult<ReconciliationStatus>>=>ipcRenderer.invoke(costIpc.reconciliation,provider),
    onChanged:(listener:()=>void):(()=>void)=>{const callback=()=>listener();ipcRenderer.on(costIpc.changed,callback);return()=>ipcRenderer.removeListener(costIpc.changed,callback);},
  },
  analytics: {
    query: (input: AnalyticsFilter): Promise<ApiResult<AnalyticsResult>> => ipcRenderer.invoke(analyticsIpc.query, input),
    compare: (ids: string[]): Promise<ApiResult<AnalyticsResult>> => ipcRenderer.invoke(analyticsIpc.compare, ids),
    annotations: (runId?: string): Promise<ApiResult<RunAnnotation[]>> => ipcRenderer.invoke(analyticsIpc.annotations, runId),
    createAnnotation: (input: CreateRunAnnotationInput): Promise<ApiResult<RunAnnotation>> => ipcRenderer.invoke(analyticsIpc.createAnnotation, input),
    removeAnnotation: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(analyticsIpc.removeAnnotation, id),
    revealArtifact: (runId: string, artifactId: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke(analyticsIpc.revealArtifact, runId, artifactId),
    artifactPreviewUrl: (artifactId: string): string => `copify-artifact://preview/${encodeURIComponent(artifactId)}`,
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
