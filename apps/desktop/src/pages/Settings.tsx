import { useEffect, useState } from "react";
import { defaultMonitorSettings, resolveMonitorBehavior, type BrowserDriverInput, type BrowserProfile, type MonitorBehavior, type MonitorSettings, type ProxyBenchmark, type ProxyProfile, type RunNetworkUsage, type SessionSnapshot, type Store } from "@copify/shared";
import type { ProxyDraft } from "../types";
import { Field, Benchmark } from "../ui/primitives";
import { Proxies } from "./Proxies";
import { BrowserDrivers } from "./LaunchModes";
import { Appearance } from "./Appearance";
import { StoreMark, hasStoreMark } from "../ui/StoreMark";

type Tab = "routes" | "monitor" | "stores" | "advanced" | "appearance" | "about";

const TABS: { id: Tab; label: string }[] = [
  { id: "routes", label: "Routes" },
  { id: "monitor", label: "Monitor" },
  { id: "stores", label: "Stores" },
  { id: "advanced", label: "Advanced" },
  { id: "appearance", label: "Appearance" },
  { id: "about", label: "About" },
];

function BehaviorEditor({ value, onChange, recommended }: { value: MonitorBehavior; onChange: (value: MonitorBehavior) => void; recommended?: number }) {
  const number = (key: keyof MonitorBehavior, minimum: number, maximum: number) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: Math.max(minimum, Math.min(maximum, Number(event.target.value))) });
  return <div className="run-form">
    <Field label="Standby interval (ms)"><input type="number" min="200" max="60000" value={value.pollIntervalMs} onChange={number("pollIntervalMs", 200, 60_000)} /></Field>
    <Field label="Turbo interval (ms)"><input type="number" min="200" max="5000" value={value.fastPollIntervalMs} onChange={number("fastPollIntervalMs", 200, 5_000)} /></Field>
    <Field label="Turbo duration (minutes)"><input type="number" min="1" max="60" value={value.fastPollDurationMinutes} onChange={number("fastPollDurationMinutes", 1, 60)} /></Field>
    <Field label="Request timeout (ms)"><input type="number" min="1000" max="30000" value={value.requestTimeoutMs} onChange={number("requestTimeoutMs", 1_000, 30_000)} /></Field>
    <Field label="Route cooldown (ms)"><input type="number" min="5000" max="1800000" value={value.routeUnhealthyMs} onChange={number("routeUnhealthyMs", 5_000, 1_800_000)} /></Field>
    <Field label="503 cooldown (ms)"><input type="number" min="1000" max="60000" value={value.serviceCooldownMs} onChange={number("serviceCooldownMs", 1_000, 60_000)} /></Field>
    <label className="check"><input type="checkbox" checked={value.immediateFirstPoll} onChange={(event) => onChange({ ...value, immediateFirstPoll: event.target.checked })} /> Poll immediately on start</label>
    <label className="check"><input type="checkbox" checked={value.rotateOnProtection} onChange={(event) => onChange({ ...value, rotateOnProtection: event.target.checked })} /> Rotate sticky/static routes on protection</label>
    <label className="check"><input type="checkbox" checked={value.honorRetryAfter} onChange={(event) => onChange({ ...value, honorRetryAfter: event.target.checked })} /> Honor Retry-After</label>
    {recommended && value.pollIntervalMs < recommended ? <p className="field-note warning">Below the store recommendation of {recommended.toLocaleString()} ms. Copify will allow this setting.</p> : null}
  </div>;
}

function usageBytes(value: number): string { return `${(value / 1_000_000).toFixed(2)} MB`; }
function usageCost(value: number | null): string { return value === null ? "—" : `$${(value / 1_000_000).toFixed(4)}`; }

export function Settings(props: {
  proxies: ProxyProfile[];
  benchmarks: Record<string, ProxyBenchmark[]>;
  latest: (id: string) => ProxyBenchmark | undefined;
  draft: ProxyDraft;
  editingProxyId: string | null;
  proxyDrawerOpen: boolean;
  onNewProxy: () => void;
  busy: boolean;
  testing: string | null;
  probeUrl: string;
  stores: Store[];
  profiles: BrowserProfile[];
  sessions: Record<string, SessionSnapshot>;
  appVersion: string;
  setProbeUrl: (value: string) => void;
  onTestRoute: (id: string | null) => void;
  onSaveProbe: (event: React.FormEvent) => void;
  onEditProxy: (proxy: ProxyProfile) => void;
  onClearCredential: (proxy: ProxyProfile, field: "username" | "password") => void;
  onToggleProxy: (proxy: ProxyProfile) => void;
  onRemoveProxy: (proxy: ProxyProfile) => void;
  setDraft: (value: ProxyDraft) => void;
  onSaveProxy: (event: React.FormEvent) => void;
  onCancelProxy: () => void;
  onToggleStore: (id: string, enabled: boolean) => void;
  onBrowserDriver: (id: string, driver: BrowserDriverInput) => void;
}) {
  const [tab, setTab] = useState<Tab>("routes");
  const [monitorSettings, setMonitorSettings] = useState<MonitorSettings>(defaultMonitorSettings());
  const [monitorNotice, setMonitorNotice] = useState<string>("");
  const [monitorStoreId, setMonitorStoreId] = useState("supreme-eu");
  const [usage, setUsage] = useState<RunNetworkUsage[]>([]);
  useEffect(() => { void window.copify.settings.getMonitor().then((result) => { if (result.ok) setMonitorSettings(result.value); }); void window.copify.usage.totals().then((result) => { if (result.ok) setUsage(result.value); }); }, []);
  const saveMonitor = async () => { const result = await window.copify.settings.updateMonitor(monitorSettings); setMonitorNotice(result.ok ? "Monitor settings saved." : result.error); if (result.ok) setMonitorSettings(result.value); };

  return (
    <div className="page-stack">
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className={`tab ${tab === entry.id ? "active" : ""}`}
            aria-current={tab === entry.id ? "page" : undefined}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === "routes" && (
        <>
          <section className="panel">
            <div className="section-title">
              <div>
                <h2>Direct network</h2>
                <p className="muted">The connection used by any browser without a proxy.</p>
              </div>
              <button
                disabled={props.busy || props.testing === "direct"}
                onClick={() => props.onTestRoute(null)}
              >
                {props.testing === "direct" ? "Testing…" : "Test"}
              </button>
            </div>
            <Benchmark benchmark={props.latest("direct")} />
            <form className="inline-form" onSubmit={props.onSaveProbe}>
              <Field label="Probe endpoint">
                <input value={props.probeUrl} onChange={(event) => props.setProbeUrl(event.target.value)} />
              </Field>
              <button disabled={props.busy || !props.probeUrl}>Save</button>
            </form>
          </section>

          <Proxies
            proxies={props.proxies}
            latest={props.latest}
            draft={props.draft}
            editingId={props.editingProxyId}
            drawerOpen={props.proxyDrawerOpen}
            busy={props.busy}
            testing={props.testing}
            onNew={props.onNewProxy}
            onTest={props.onTestRoute}
            onEdit={props.onEditProxy}
            onClear={props.onClearCredential}
            onToggleProxy={props.onToggleProxy}
            onRemoveProxy={props.onRemoveProxy}
            setDraft={props.setDraft}
            onSave={props.onSaveProxy}
            onCancel={props.onCancelProxy}
          />
        </>
      )}

      {tab === "monitor" && (() => {
        const manifestStore = props.stores.find((store) => store.id === monitorStoreId && store.monitoring);
        const storeBehavior = resolveMonitorBehavior(monitorSettings, monitorStoreId);
        const grouped = new Map<string, { label: string; store: string; bytes: number; requests: number; cost: number | null }>();
        for (const row of usage) { const key = `${row.source}:${row.proxyProfileId ?? "direct"}:${row.storeId ?? "none"}`; const current = grouped.get(key) ?? { label: `${row.source.toLowerCase()} · ${row.proxyName ?? "Direct"}`, store: row.storeId ?? "—", bytes: 0, requests: 0, cost: row.estimatedCostMicrosUsd === null ? null : 0 }; current.bytes += row.receivedBytes + row.sentBytes; current.requests += row.requestCount; if (current.cost !== null) current.cost += row.estimatedCostMicrosUsd ?? 0; grouped.set(key, current); }
        return <>
          <section className="panel">
            <div className="section-title"><div><h2>Monitor behavior</h2><p className="muted">Settings are snapshotted when a monitor starts.</p></div><button disabled={props.busy} onClick={() => void saveMonitor()}>Save</button></div>
            <BehaviorEditor value={monitorSettings.defaults} onChange={(defaults) => setMonitorSettings({ ...monitorSettings, defaults })} />
          </section>
          <section className="panel">
            <div className="section-title"><div><h2>Proxy pool</h2><p className="muted">No selection uses the direct connection. Rotating gateways remain healthy after storefront protection.</p></div></div>
            <div className="rows">
              {props.proxies.filter((proxy) => proxy.enabled).map((proxy) => <label className="row" key={proxy.id}><span className="row-main"><span className="row-name">{proxy.name}</span><span className="row-meta">{proxy.provider} · {proxy.type} · {proxy.host}:{proxy.port}</span></span><input type="checkbox" checked={monitorSettings.proxyProfileIds.includes(proxy.id)} onChange={(event) => setMonitorSettings({ ...monitorSettings, proxyProfileIds: event.target.checked ? [...monitorSettings.proxyProfileIds, proxy.id] : monitorSettings.proxyProfileIds.filter((id) => id !== proxy.id) })} /></label>)}
              {!props.proxies.some((proxy) => proxy.enabled) && <div className="row"><span className="row-meta">No enabled proxies. The monitor will use the direct connection.</span></div>}
            </div>
          </section>
          <section className="panel">
            <div className="section-title"><div><h2>Store override</h2><p className="muted">The manifest recommends cadence and owns the endpoint; your settings remain authoritative.</p></div>{monitorSettings.stores[monitorStoreId] ? <button onClick={() => { const stores = { ...monitorSettings.stores }; delete stores[monitorStoreId]; setMonitorSettings({ ...monitorSettings, stores }); }}>Use global</button> : null}</div>
            <Field label="Store"><select value={monitorStoreId} onChange={(event) => setMonitorStoreId(event.target.value)}>{props.stores.filter((store) => store.monitoring).map((store) => <option key={store.id} value={store.id}>{store.name} {store.region}</option>)}</select></Field>
            <BehaviorEditor value={storeBehavior} recommended={manifestStore?.monitoring?.recommendedPollIntervalMs} onChange={(behavior) => setMonitorSettings({ ...monitorSettings, stores: { ...monitorSettings.stores, [monitorStoreId]: behavior } })} />
            <div className="rows"><div className="row"><span className="row-main"><span className="row-name">Effective policy</span><span className="row-meta">{storeBehavior.pollIntervalMs} ms standby / {storeBehavior.fastPollIntervalMs} ms Turbo · route cooldown {Math.round(storeBehavior.routeUnhealthyMs / 60_000)}m · 503 {Math.round(storeBehavior.serviceCooldownMs / 1_000)}s · {storeBehavior.rotateOnProtection ? "rotate on protection" : "monitor cooldown on protection"}</span></span></div></div>
          </section>
          <section className="panel">
            <div className="section-title"><div><h2>Recorded usage</h2><p className="muted">Measured application bytes; proxy tunnel overhead is not observable.</p></div></div>
            <div className="rows">{[...grouped.entries()].map(([key, row]) => <div className="row" key={key}><span className="row-main"><span className="row-name">{row.label}</span><span className="row-meta">{row.store} · {row.requests.toLocaleString()} requests</span></span><span className="row-cell mono">{usageBytes(row.bytes)}</span><span className="row-cell mono">{usageCost(row.cost)}</span></div>)}{grouped.size === 0 ? <div className="empty">Usage appears after a monitored run.</div> : null}</div>
          </section>
          {monitorNotice && <p className="field-note">{monitorNotice}</p>}
        </>;
      })()}

      {tab === "stores" && (
        <section className="panel">
          <div className="section-title">
            <div>
              <h2>Stores</h2>
              <p className="muted">Adapters Copify ships with. Disabling one hides its targets.</p>
            </div>
          </div>
          <div className="rows">
            {props.stores.map((store) => (
              <div className="row" key={store.id}>
                <span className="store-row-mark">{hasStoreMark(store.id) ? <StoreMark storeId={store.id} /> : null}</span>
                <div className="row-main">
                  <span className="row-name">
                    {store.name}
                    {store.region ? <span className="dim"> · {store.region}</span> : null}
                  </span>
                  <span className="row-meta">
                    {store.capabilities.monitor === null
                      ? "No adapter — targets are saved as templates."
                      : `Monitor · ${store.capabilities.addToCart ? "cart" : "no cart"} · ${store.capabilities.checkoutAutofill ? "checkout" : "no checkout"}`}
                  </span>
                </div>
                <span className="badge">{store.status}</span>
                <div className="row-actions">
                  <button
                    disabled={props.busy || store.capabilities.monitor === null}
                    onClick={() => props.onToggleStore(store.id, !store.enabled)}
                  >
                    {store.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
            ))}
            {props.stores.length === 0 && <div className="row"><span className="row-meta">No stores registered.</span></div>}
          </div>
        </section>
      )}

      {tab === "advanced" && (
        <BrowserDrivers
          profiles={props.profiles}
          proxies={props.proxies}
          sessions={props.sessions}
          busy={props.busy}
          onUpdate={props.onBrowserDriver}
        />
      )}

      {tab === "appearance" && <Appearance />}

      {tab === "about" && (
        <section className="panel">
          <div className="section-title">
            <h2>Copify</h2>
          </div>
          <div className="rows">
            <div className="row">
              <div className="row-main"><span className="row-name">Version</span></div>
              <span className="row-cell mono">{props.appVersion}</span>
            </div>
            <div className="row">
              <div className="row-main"><span className="row-name">Data</span></div>
              <span className="row-cell">Everything stays on this machine.</span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
