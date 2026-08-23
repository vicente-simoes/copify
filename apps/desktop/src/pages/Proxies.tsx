import { type ProxyBenchmark, type ProxyProfile } from "@copify/shared";
import { type ProxyDraft } from "../types";
import { Field, Benchmark, BenchmarkHistory } from "../ui/primitives";

export function Proxies({
  proxies,
  benchmarks,
  latest,
  draft,
  editingId,
  busy,
  testing,
  onTest,
  onEdit,
  onClear,
  onToggleProxy,
  onRemoveProxy,
  setDraft,
  onSave,
  onCancel,
}: {
  proxies: ProxyProfile[];
  benchmarks: Record<string, ProxyBenchmark[]>;
  latest: (id: string) => ProxyBenchmark | undefined;
  draft: ProxyDraft;
  editingId: string | null;
  busy: boolean;
  testing: string | null;
  onTest: (id: string) => void;
  onEdit: (proxy: ProxyProfile) => void;
  onClear: (proxy: ProxyProfile, field: "username" | "password") => void;
  onToggleProxy: (proxy: ProxyProfile) => void;
  onRemoveProxy: (proxy: ProxyProfile) => void;
  setDraft: (value: ProxyDraft) => void;
  onSave: (event: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return (
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Proxy profiles</h2>
            <p className="muted">
              Credentials are encrypted and never shown again.
            </p>
          </div>
        </div>
        <div className="profiles">
          {proxies.length === 0 && (
            <div className="empty">
              No proxies configured. Every browser uses your direct network
              until you assign one.
            </div>
          )}
          {proxies.map((proxy) => (
            <article key={proxy.id} className="profile-card">
              <div className="profile-title">
                <div>
                  <h3>{proxy.name}</h3>
                  <p>
                    {proxy.protocol.toUpperCase()} · {proxy.type} · {proxy.host}
                    :{proxy.port} · {proxy.enabled ? "Enabled" : "Disabled"}
                  </p>
                </div>
                <span
                  className={`state ${latest(proxy.id)?.status.toLowerCase() ?? ""}`}
                >
                  {latest(proxy.id)?.status ?? "UNTESTED"}
                </span>
              </div>
              <p className="muted">
                {proxy.usernameConfigured ? "Username saved" : "No username"} ·{" "}
                {proxy.passwordConfigured ? "Password saved" : "No password"}
                {proxy.expectedCountry
                  ? ` · Expected ${proxy.expectedCountry}${proxy.expectedCity ? ` / ${proxy.expectedCity}` : ""}`
                  : ""}
              </p>
              <Benchmark benchmark={latest(proxy.id)} />
              <BenchmarkHistory benchmarks={benchmarks[proxy.id] ?? []} />
              <div className="actions">
                <button
                  disabled={busy || testing !== null}
                  onClick={() => onTest(proxy.id)}
                >
                  {testing === proxy.id ? "Testing…" : "Test proxy"}
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => onEdit(proxy)}
                >
                  Edit
                </button>
                <button
                  className="text"
                  disabled={busy}
                  onClick={() => onToggleProxy(proxy)}
                >
                  {proxy.enabled ? "Disable" : "Enable"}
                </button>
                {proxy.usernameConfigured && (
                  <button
                    className="text"
                    disabled={busy}
                    onClick={() => onClear(proxy, "username")}
                  >
                    Clear username
                  </button>
                )}
                {proxy.passwordConfigured && (
                  <button
                    className="text"
                    disabled={busy}
                    onClick={() => onClear(proxy, "password")}
                  >
                    Clear password
                  </button>
                )}
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => onRemoveProxy(proxy)}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
        <form className="form-card proxy-form" onSubmit={onSave}>
          <div className="section-title">
            <div>
              <h2>{editingId ? "Edit proxy profile" : "Add proxy profile"}</h2>
            </div>
            {editingId && (
              <button className="text" type="button" onClick={onCancel}>
                Cancel edit
              </button>
            )}
          </div>
          <Field label="Proxy name">
            <input
              required
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              placeholder="Proxy name"
            />
          </Field>
          <Field label="Provider">
            <select
              value={draft.provider}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  provider: event.target.value as ProxyDraft["provider"],
                })
              }
            >
              <option value="custom">Custom</option>
              <option value="brightdata">Bright Data</option>
              <option value="decodo">Decodo</option>
              <option value="oxylabs">Oxylabs</option>
            </select>
          </Field>
          <Field label="Type">
            <select
              value={draft.type}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  type: event.target.value as ProxyDraft["type"],
                })
              }
            >
              <option value="residential-sticky">Sticky residential</option>
              <option value="isp-static">Static ISP</option>
              <option value="datacenter">Datacenter</option>
              <option value="home">Home</option>
            </select>
          </Field>
          <Field label="Protocol">
            <select
              value={draft.protocol}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  protocol: event.target.value as ProxyDraft["protocol"],
                })
              }
            >
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="socks5">SOCKS5</option>
            </select>
          </Field>
          <Field label="Host">
            <input
              required
              value={draft.host}
              onChange={(event) =>
                setDraft({ ...draft, host: event.target.value })
              }
              placeholder="Host"
            />
          </Field>
          <Field label="Port">
            <input
              required
              type="number"
              min="1"
              max="65535"
              value={draft.port}
              onChange={(event) =>
                setDraft({ ...draft, port: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="Username">
            <input
              autoComplete="off"
              value={draft.username}
              onChange={(event) =>
                setDraft({ ...draft, username: event.target.value })
              }
              placeholder={editingId ? "Leave blank to keep" : "Optional"}
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              autoComplete="new-password"
              value={draft.password}
              onChange={(event) =>
                setDraft({ ...draft, password: event.target.value })
              }
              placeholder={editingId ? "Leave blank to keep" : "Optional"}
            />
          </Field>
          <Field label="Expected country">
            <input
              maxLength={2}
              value={draft.expectedCountry ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  expectedCountry:
                    event.target.value.toUpperCase() || undefined,
                })
              }
              placeholder="PT"
            />
          </Field>
          <Field label="Expected city">
            <input
              value={draft.expectedCity ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  expectedCity: event.target.value || undefined,
                })
              }
              placeholder="Optional"
            />
          </Field>
          <label className="check form-check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) =>
                setDraft({ ...draft, enabled: event.target.checked })
              }
            />{" "}
            Enabled
          </label>
          <button disabled={busy} type="submit">
            {editingId ? "Save proxy" : "Add proxy"}
          </button>
        </form>
      </section>
  );
}
