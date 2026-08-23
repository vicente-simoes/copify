import { type BrowserProfile, type CartStatus, type ProxyBenchmark, type ProxyProfile, type SessionSnapshot } from "@copify/shared";
import { type ProxyDraft } from "../types";
import { Field, Route, Benchmark, BenchmarkHistory } from "../ui/primitives";

export function Profiles({
  profiles,
  proxies,
  sessions,
  cartStatuses,
  benchmarks,
  latest,
  profileName,
  draft,
  editingId,
  busy,
  testing,
  setProfileName,
  onCreate,
  onProfile,
  onUpdate,
  onRemoveProfile,
  onTest,
  onCheckCart,
  onEmptyCart,
  onEdit,
  onClear,
  onToggleProxy,
  onRemoveProxy,
  setDraft,
  onSave,
  onCancel,
}: {
  profiles: BrowserProfile[];
  proxies: ProxyProfile[];
  sessions: Record<string, SessionSnapshot>;
  cartStatuses: Record<string, CartStatus>;
  benchmarks: Record<string, ProxyBenchmark[]>;
  latest: (id: string) => ProxyBenchmark | undefined;
  profileName: string;
  draft: ProxyDraft;
  editingId: string | null;
  busy: boolean;
  testing: string | null;
  setProfileName: (value: string) => void;
  onCreate: () => void;
  onProfile: (
    id: string,
    action: (id: string) => Promise<{ ok: boolean; error?: string }>,
  ) => void;
  onUpdate: (
    id: string,
    input: { name?: string; enabled?: boolean; proxyProfileId?: string | null },
    success?: string,
  ) => void;
  onRemoveProfile: (profile: BrowserProfile) => void;
  onTest: (id: string) => void;
  onCheckCart: (id: string) => void;
  onEmptyCart: (id: string) => void;
  onEdit: (proxy: ProxyProfile) => void;
  onClear: (proxy: ProxyProfile, field: "username" | "password") => void;
  onToggleProxy: (proxy: ProxyProfile) => void;
  onRemoveProxy: (proxy: ProxyProfile) => void;
  setDraft: (value: ProxyDraft) => void;
  onSave: (event: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const getSession = (id: string): SessionSnapshot =>
    sessions[id] ?? {
      profileId: id,
      state: "STOPPED",
      error: null,
      route: {
        kind: "direct",
        verification: {
          status: "PENDING",
          publicIp: null,
          country: null,
          city: null,
          verifiedAt: null,
          message: null,
        },
      },
      updatedAt: 0,
    };
  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Browser profiles</h2>
            <p className="muted">
              Each profile owns an isolated, persistent Chrome session.
            </p>
          </div>
          <form
            className="compact-create"
            onSubmit={(event) => {
              event.preventDefault();
              onCreate();
            }}
          >
            <input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              maxLength={80}
              placeholder="e.g. Home session"
            />
            <button disabled={busy || !profileName.trim()} type="submit">
              Add profile
            </button>
          </form>
        </div>
        <div className="profiles">
          {profiles.length === 0 && (
            <div className="empty">
              Create a profile to launch its isolated, persistent Chrome
              session.
            </div>
          )}
          {profiles.map((profile) => {
            const current = getSession(profile.id);
            const cart = cartStatuses[profile.id] ?? { profileId: profile.id, status: "UNKNOWN" as const, itemCount: null, checkedAt: null, message: null };
            const active = ["STARTING", "READY", "STOPPING"].includes(
              current.state,
            );
            return (
              <article key={profile.id} className="profile-card">
                <div className="profile-title">
                  <div>
                    <h3>{profile.name}</h3>
                    <p>
                      {profile.enabled ? "Enabled" : "Disabled"} ·{" "}
                      {current.route.kind === "proxy"
                        ? current.route.proxyName
                        : "Direct network"}
                    </p>
                  </div>
                  <span className={`state ${current.state.toLowerCase()}`}>
                    {current.state}
                  </span>
                </div>
                <Route route={current.route} />
                <p className={`cart-status ${cart.status.toLowerCase()}`}>
                  Supreme cart: {cart.status === "EMPTY" ? "Empty" : cart.status === "ITEMS" ? `${cart.itemCount ?? "Some"} item${cart.itemCount === 1 ? "" : "s"}` : cart.status === "CHECKING" ? "Checking…" : cart.status === "ERROR" ? "Check failed" : "Not checked"}
                  {cart.checkedAt ? ` · ${new Date(cart.checkedAt).toLocaleTimeString()}` : ""}
                </p>
                {current.error && (
                  <p className="error-detail">
                    {current.error.code}: {current.error.message}
                  </p>
                )}
                <div className="actions">
                  <label className="select-label">
                    Route
                    <select
                      value={profile.proxyProfileId ?? ""}
                      disabled={busy || active}
                      onChange={(event) =>
                        onUpdate(
                          profile.id,
                          { proxyProfileId: event.target.value || null },
                          "Browser route updated.",
                        )
                      }
                    >
                      <option value="">Direct network</option>
                      {proxies.map((proxy) => (
                        <option
                          key={proxy.id}
                          value={proxy.id}
                          disabled={!proxy.enabled}
                        >
                          {proxy.name}
                          {proxy.enabled ? "" : " (disabled)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={busy || !profile.enabled || active}
                    onClick={() =>
                      onProfile(profile.id, window.copify.sessions.open)
                    }
                  >
                    Open
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || !active}
                    onClick={() =>
                      onProfile(profile.id, window.copify.sessions.close)
                    }
                  >
                    Close
                  </button>
                  <button
                    className="secondary"
                    disabled={
                      busy ||
                      !profile.enabled ||
                      current.state === "STARTING" ||
                      current.state === "STOPPING"
                    }
                    onClick={() =>
                      onProfile(profile.id, window.copify.sessions.restart)
                    }
                  >
                    Restart
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || !profile.enabled || current.state === "STARTING" || current.state === "STOPPING"}
                    onClick={() => onCheckCart(profile.id)}
                  >
                    Check cart
                  </button>
                  {cart.status === "ITEMS" && (
                    <button
                      className="danger"
                      disabled={busy || !profile.enabled}
                      onClick={() => onEmptyCart(profile.id)}
                    >
                      Empty cart
                    </button>
                  )}
                  <button
                    className="text"
                    disabled={busy || active}
                    onClick={() => {
                      const name = window
                        .prompt("Profile name", profile.name)
                        ?.trim();
                      if (name && name !== profile.name)
                        onUpdate(profile.id, { name });
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="text"
                    disabled={busy || active}
                    onClick={() =>
                      onUpdate(profile.id, { enabled: !profile.enabled })
                    }
                  >
                    {profile.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="danger"
                    disabled={busy || active}
                    onClick={() => onRemoveProfile(profile)}
                  >
                    Remove
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
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
    </div>
  );
}

export function LaunchModes({
  profiles,
  proxies,
  sessions,
  busy,
  onUpdate,
}: {
  profiles: BrowserProfile[];
  proxies: ProxyProfile[];
  sessions: Record<string, SessionSnapshot>;
  busy: boolean;
  onUpdate: (id: string, mode: BrowserProfile["launchMode"]) => void;
}) {
  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <h2>Native Chrome or Playwright</h2>
          <p className="muted">
            Native Chrome starts Google Chrome first and then attaches locally
            through CDP. It keeps the existing isolated profile directory.
          </p>
        </div>
      </div>
      <div className="profiles">
        {profiles.map((profile) => {
          const active = ["STARTING", "READY", "STOPPING"].includes(
            sessions[profile.id]?.state ?? "STOPPED",
          );
          const proxy = proxies.find(
            (item) => item.id === profile.proxyProfileId,
          );
          const nativeBlockedByProxy =
            profile.launchMode === "NATIVE_CDP" &&
            Boolean(proxy?.usernameConfigured || proxy?.passwordConfigured);
          return (
            <article className="profile-card" key={profile.id}>
              <div className="profile-title">
                <div>
                  <h3>{profile.name}</h3>
                  <p>
                    {profile.launchMode === "NATIVE_CDP"
                      ? "Native Chrome + CDP"
                      : "Playwright launch"}
                  </p>
                </div>
                <select
                  aria-label={`Launch method for ${profile.name}`}
                  value={profile.launchMode}
                  disabled={busy || active}
                  onChange={(event) =>
                    onUpdate(
                      profile.id,
                      event.target.value as BrowserProfile["launchMode"],
                    )
                  }
                >
                  <option value="NATIVE_CDP">Native Chrome + CDP</option>
                  <option value="PLAYWRIGHT">Playwright launch</option>
                </select>
              </div>
              {nativeBlockedByProxy && (
                <p className="error-detail">
                  This profile has proxy credentials. Native Chrome + CDP cannot
                  use authenticated proxies yet; select Playwright launch before
                  opening it.
                </p>
              )}
              {active && (
                <p className="muted">
                  Close this browser session before changing its launch method.
                </p>
              )}
            </article>
          );
        })}
        {profiles.length === 0 && (
          <div className="empty">
            Create a browser profile before selecting a launch method.
          </div>
        )}
      </div>
    </section>
  );
}
