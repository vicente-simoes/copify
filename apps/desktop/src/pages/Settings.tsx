import { useEffect, useState } from "react";
import type { BrowserDriverInput, BrowserProfile, ProxyBenchmark, ProxyProfile, SessionSnapshot, Store } from "@copify/shared";
import type { ProxyDraft } from "../types";
import { Field, Benchmark } from "../ui/primitives";
import { Proxies } from "./Proxies";
import { BrowserDrivers } from "./LaunchModes";

type Tab = "routes" | "stores" | "advanced" | "validation" | "about";

const TABS: { id: Tab; label: string }[] = [
  { id: "routes", label: "Routes" },
  { id: "stores", label: "Stores" },
  { id: "advanced", label: "Advanced" },
  { id: "validation", label: "Validation" },
  { id: "about", label: "About" },
];

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
  const [monitorProxyIds, setMonitorProxyIds] = useState<string[]>([]);
  const [monitorNotice, setMonitorNotice] = useState<string>("");
  useEffect(() => { void window.copify.settings.getMonitorNetwork().then((result) => { if (result.ok) setMonitorProxyIds(result.value.proxyProfileIds); }); }, []);
  const saveMonitorRoutes = async () => { const result = await window.copify.settings.updateMonitorNetwork({ proxyProfileIds: monitorProxyIds }); setMonitorNotice(result.ok ? "Monitor routes saved." : result.error); if (result.ok) setMonitorProxyIds(result.value.proxyProfileIds); };

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
          <section className="panel">
            <div className="section-title"><div><h2>HTTP monitor routes</h2><p className="muted">No selection uses your direct connection. Selected routes are used round-robin only between scheduled polls; any 403 or 429 stops the entire monitor.</p></div><button disabled={props.busy} onClick={() => void saveMonitorRoutes()}>Save</button></div>
            <div className="rows">
              {props.proxies.filter((proxy) => proxy.enabled).map((proxy) => <label className="row" key={proxy.id}><span className="row-main"><span className="row-name">{proxy.name}</span><span className="row-meta">{proxy.protocol} · {proxy.host}:{proxy.port}</span></span><input type="checkbox" checked={monitorProxyIds.includes(proxy.id)} onChange={(event) => setMonitorProxyIds((ids) => event.target.checked ? [...ids, proxy.id] : ids.filter((id) => id !== proxy.id))} /></label>)}
              {!props.proxies.some((proxy) => proxy.enabled) && <div className="row"><span className="row-meta">No enabled proxies. The monitor will use the direct connection.</span></div>}
            </div>
            {monitorNotice && <p className="field-note">{monitorNotice}</p>}
          </section>
        </>
      )}

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

      {tab === "validation" && (
        <>
          <section className="panel">
            <div className="section-title">
              <div>
                <h2>FAST_DROP input fixture</h2>
                <p className="muted">A local, network-independent check for the v0.8 cursor, typing, and safe paste behavior.</p>
              </div>
            </div>
            <div className="rows">
              <div className="row">
                <div className="row-main">
                  <span className="row-name">Run from PowerShell</span>
                  <span className="row-meta">Close Copify, then run <code>pnpm test:input</code> in the Copify folder.</span>
                </div>
              </div>
              <div className="row">
                <div className="row-main">
                  <span className="row-name">What a pass proves</span>
                  <span className="row-meta">Trusted browser mouse, wheel, keyboard and input events; curved movement; click dwell; text insertion fallback; and External CDP detaching without closing Chrome.</span>
                </div>
              </div>
              <div className="row">
                <div className="row-main">
                  <span className="row-name">Clipboard safety</span>
                  <span className="row-meta">The fixture never reads or overwrites a nonempty Windows clipboard. A denied clipboard lease uses browser text insertion instead.</span>
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="section-title">
              <div>
                <h2>Live-store note</h2>
                <p className="muted">A target test can be blocked by the store before Copify reaches product matching.</p>
              </div>
            </div>
            <p className="field-note">If Targets reports “Storefront access challenge detected,” wait before retrying. That is a storefront access result for the separate monitor browser, not a FAST_DROP input failure or proof that the product is unavailable.</p>
          </section>
        </>
      )}

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
