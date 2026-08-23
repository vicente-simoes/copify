import { type BrowserProfile, type CartStatus, type ProxyProfile, type SessionSnapshot } from "@copify/shared";
import { Route } from "../ui/primitives";

export function Browsers({
  profiles,
  proxies,
  sessions,
  cartStatuses,
  profileName,
  busy,
  setProfileName,
  onCreate,
  onProfile,
  onUpdate,
  onRemoveProfile,
  onCheckCart,
  onEmptyCart,
}: {
  profiles: BrowserProfile[];
  proxies: ProxyProfile[];
  sessions: Record<string, SessionSnapshot>;
  cartStatuses: Record<string, CartStatus>;
  profileName: string;
  busy: boolean;
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
  onCheckCart: (id: string) => void;
  onEmptyCart: (id: string) => void;
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
    </div>
  );
}
