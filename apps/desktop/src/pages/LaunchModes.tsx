import { type BrowserProfile, type ProxyProfile, type SessionSnapshot } from "@copify/shared";

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
          <p className="muted">Native Chrome cannot use proxies that need a password.</p>
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

