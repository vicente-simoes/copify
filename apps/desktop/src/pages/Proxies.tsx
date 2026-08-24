import { type ProxyBenchmark, type ProxyProfile } from "@copify/shared";
import { type ProxyDraft } from "../types";
import { Field } from "../ui/primitives";
import { Menu, type MenuEntry } from "../ui/Menu";
import { Drawer } from "../ui/Drawer";

function score(benchmark?: ProxyBenchmark): string {
  return benchmark ? `${benchmark.qualityScore}` : "—";
}

export function Proxies({
  proxies,
  latest,
  draft,
  editingId,
  drawerOpen,
  busy,
  testing,
  setDraft,
  onNew,
  onTest,
  onEdit,
  onClear,
  onToggleProxy,
  onRemoveProxy,
  onSave,
  onCancel,
}: {
  proxies: ProxyProfile[];
  latest: (id: string) => ProxyBenchmark | undefined;
  draft: ProxyDraft;
  editingId: string | null;
  drawerOpen: boolean;
  busy: boolean;
  testing: string | null;
  setDraft: (value: ProxyDraft) => void;
  onNew: () => void;
  onTest: (id: string) => void;
  onEdit: (proxy: ProxyProfile) => void;
  onClear: (proxy: ProxyProfile, field: "username" | "password") => void;
  onToggleProxy: (proxy: ProxyProfile) => void;
  onRemoveProxy: (proxy: ProxyProfile) => void;
  onSave: (event: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <>
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Proxies</h2>
            <p className="muted">A browser uses your own connection unless you assign one.</p>
          </div>
          <button disabled={busy} onClick={onNew}>New proxy</button>
        </div>

        {proxies.length === 0 ? (
          <div className="empty">
            No proxies.
            <button disabled={busy} onClick={onNew}>New proxy</button>
          </div>
        ) : (
          <div className="rows proxy-rows">
            <div className="row row-head">
              <span>Name</span>
              <span>Address</span>
              <span>Expected</span>
              <span>Latency</span>
              <span>Score</span>
              <span />
            </div>
            {proxies.map((proxy) => {
              const benchmark = latest(proxy.id);
              const credentials = proxy.usernameConfigured || proxy.passwordConfigured;
              const entries: MenuEntry[] = [
                { kind: "item", label: "Edit", disabled: busy, onSelect: () => onEdit(proxy) },
                { kind: "item", label: proxy.enabled ? "Disable" : "Enable", disabled: busy, onSelect: () => onToggleProxy(proxy) },
              ];
              if (credentials) {
                entries.push(
                  { kind: "separator" },
                  { kind: "item", label: "Clear credentials", disabled: busy, onSelect: () => {
                    if (proxy.usernameConfigured) onClear(proxy, "username");
                    if (proxy.passwordConfigured) onClear(proxy, "password");
                  } },
                );
              }
              entries.push(
                { kind: "separator" },
                { kind: "item", label: "Remove", danger: true, disabled: busy, onSelect: () => onRemoveProxy(proxy) },
              );

              return (
                <div className="row proxy-row" key={proxy.id}>
                  <div className="row-main">
                    <span className="row-name">
                      {proxy.name}
                      {!proxy.enabled && <span className="badge">off</span>}
                      {credentials && <span className="badge">auth</span>}
                    </span>
                    <span className="row-meta">{proxy.provider} · {proxy.type}{proxy.costPerGbMicrosUsd === null ? "" : ` · $${(proxy.costPerGbMicrosUsd / 1_000_000).toFixed(2)}/GB`}</span>
                    {benchmark?.errorMessage && <span className="error-detail">{benchmark.errorMessage}</span>}
                  </div>
                  <span className="row-cell mono">{proxy.host}:{proxy.port}</span>
                  <span className="row-cell mono">{proxy.expectedCountry ?? "—"}</span>
                  <span className="row-cell mono">
                    {benchmark?.medianLatencyMs == null ? "—" : `${Math.round(benchmark.medianLatencyMs)} ms`}
                  </span>
                  <span className={`row-cell mono score ${benchmark?.status.toLowerCase() ?? ""}`}>{score(benchmark)}</span>
                  <div className="row-actions">
                    <button disabled={busy || testing !== null} onClick={() => onTest(proxy.id)}>
                      {testing === proxy.id ? "Testing…" : "Test"}
                    </button>
                    <Menu entries={entries} label={`Actions for ${proxy.name}`} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Drawer
        open={drawerOpen}
        title={editingId ? "Edit proxy" : "New proxy"}
        onClose={onCancel}
        footer={
          <>
            <button className="primary" form="proxy-form" type="submit" disabled={busy}>Save</button>
            <button onClick={onCancel}>Cancel</button>
          </>
        }
      >
        <form id="proxy-form" className="drawer-form" onSubmit={onSave}>
          <Field label="Name">
            <input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. PT ISP 01" />
          </Field>

          <div className="field-pair">
            <Field label="Host">
              <input required value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} />
            </Field>
            <Field label="Port">
              <input
                required type="number" min="1" max="65535"
                value={draft.port}
                onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) })}
              />
            </Field>
          </div>

          <div className="field-pair">
            <Field label="Provider">
              <select value={draft.provider} onChange={(event) => { const provider = event.target.value as ProxyDraft["provider"]; setDraft({ ...draft, provider, costPerGbUsd: provider === "dataimpulse" && !draft.costPerGbUsd ? "1.00" : draft.costPerGbUsd }); }}>
                <option value="custom">Custom</option>
                <option value="dataimpulse">DataImpulse</option>
                <option value="brightdata">Bright Data</option>
                <option value="decodo">Decodo</option>
                <option value="oxylabs">Oxylabs</option>
              </select>
            </Field>
            <Field label="Cost / GB (USD)">
              <input type="number" min="0" step="0.01" value={draft.costPerGbUsd} onChange={(event) => setDraft({ ...draft, costPerGbUsd: event.target.value })} placeholder="Optional" />
            </Field>
          </div>

          <div className="field-pair">
            <Field label="Protocol">
              <select value={draft.protocol} onChange={(event) => setDraft({ ...draft, protocol: event.target.value as ProxyDraft["protocol"] })}>
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </Field>
            <Field label="Type">
              <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as ProxyDraft["type"] })}>
                <option value="residential-sticky">Sticky residential</option>
                <option value="residential-rotating">Rotating residential</option>
                <option value="isp-static">Static ISP</option>
                <option value="datacenter">Datacenter</option>
                <option value="home">Home</option>
              </select>
            </Field>
          </div>

          <div className="field-pair">
            <Field label="Username">
              <input
                autoComplete="off"
                value={draft.username}
                onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                placeholder={editingId ? "Leave blank to keep" : "Optional"}
              />
            </Field>
            <Field label="Password">
              <input
                type="password" autoComplete="new-password"
                value={draft.password}
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                placeholder={editingId ? "Leave blank to keep" : "Optional"}
              />
            </Field>
          </div>

          <Field label="Expected country">
            <input
              maxLength={2}
              value={draft.expectedCountry ?? ""}
              onChange={(event) => setDraft({ ...draft, expectedCountry: event.target.value.toUpperCase() || undefined })}
              placeholder="PT"
            />
          </Field>
          <p className="field-note">Copify warns when a test lands somewhere else.</p>
        </form>
      </Drawer>
    </>
  );
}
