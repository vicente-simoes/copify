import { useState } from "react";
import type { BrowserProfile, ProxyBenchmark, ProxyProfile, SessionSnapshot, Store } from "@copify/shared";
import type { ProxyDraft } from "../types";
import { Field, Benchmark } from "../ui/primitives";
import { Proxies } from "./Proxies";
import { LaunchModes } from "./LaunchModes";

type Tab = "routes" | "stores" | "advanced" | "about";

const TABS: { id: Tab; label: string }[] = [
  { id: "routes", label: "Routes" },
  { id: "stores", label: "Stores" },
  { id: "advanced", label: "Advanced" },
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
  onLaunchMode: (id: string, mode: BrowserProfile["launchMode"]) => void;
}) {
  const [tab, setTab] = useState<Tab>("routes");

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
        <LaunchModes
          profiles={props.profiles}
          proxies={props.proxies}
          sessions={props.sessions}
          busy={props.busy}
          onUpdate={props.onLaunchMode}
        />
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
