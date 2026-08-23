import { useState } from "react";
import { type BrowserDriverInput, type BrowserProfile, type ProxyProfile, type SessionSnapshot } from "@copify/shared";

export function BrowserDrivers({
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
  onUpdate: (id: string, driver: BrowserDriverInput) => void;
}) {
  const [endpoints, setEndpoints] = useState<Record<string, string>>({});
  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <h2>Browser drivers</h2>
          <p className="muted">Native Stealth is managed by Copify. External CDP attaches to an already-running local anti-detect browser.</p>
        </div>
      </div>
      <div className="profiles">
        {profiles.map((profile) => {
          const active = ["STARTING", "READY", "STOPPING"].includes(
            sessions[profile.id]?.state ?? "STOPPED",
          );
          const proxy = proxies.find((item) => item.id === profile.proxyProfileId);
          const externalProxyConflict = profile.driver.kind === "EXTERNAL_CDP" && Boolean(proxy);
          const metadata = sessions[profile.id]?.driver;
          return (
            <article className="profile-card" key={profile.id}>
              <div className="profile-title">
                <div>
                  <h3>{profile.name}</h3>
                  <p>
                    {profile.driver.kind === "NATIVE_STEALTH" ? "Native Stealth · Rebrowser" : `External CDP · endpoint ${profile.driver.endpointConfigured ? "configured" : "missing"}`}
                  </p>
                </div>
                <select
                  aria-label={`Browser driver for ${profile.name}`}
                  value={profile.driver.kind}
                  disabled={busy || active}
                  onChange={(event) =>
                    onUpdate(profile.id, event.target.value === "EXTERNAL_CDP" ? { kind: "EXTERNAL_CDP" } : { kind: "NATIVE_STEALTH" })
                  }
                >
                  <option value="NATIVE_STEALTH">Native Stealth</option>
                  <option value="EXTERNAL_CDP">External local CDP</option>
                </select>
              </div>
              {profile.driver.kind === "EXTERNAL_CDP" && (
                <div className="inline-form">
                  <input
                    aria-label={`Local CDP endpoint for ${profile.name}`}
                    type="password"
                    autoComplete="off"
                    placeholder={profile.driver.endpointConfigured ? "Enter a replacement endpoint" : "http://127.0.0.1:9222"}
                    value={endpoints[profile.id] ?? ""}
                    disabled={busy || active}
                    onChange={(event) => setEndpoints((current) => ({ ...current, [profile.id]: event.target.value }))}
                  />
                  <button disabled={busy || active || !(endpoints[profile.id] ?? "").trim()} onClick={() => { onUpdate(profile.id, { kind: "EXTERNAL_CDP", endpoint: endpoints[profile.id].trim() }); setEndpoints((current) => ({ ...current, [profile.id]: "" })); }}>{profile.driver.endpointConfigured ? "Replace" : "Set endpoint"}</button>
                  {profile.driver.endpointConfigured && <button className="quiet" disabled={busy || active} onClick={() => onUpdate(profile.id, { kind: "EXTERNAL_CDP", endpoint: null })}>Clear</button>}
                </div>
              )}
              {externalProxyConflict && (
                <p className="error-detail">
                  External CDP owns its network route. Remove the assigned {proxy?.name ?? "Copify proxy"} before opening this profile.
                </p>
              )}
              {metadata && <p className="muted">{metadata.browserVersion ?? "Unknown Chrome"} · {metadata.ownsBrowser ? "Copify managed" : "externally managed"} · stealth {metadata.stealthStatus.toLowerCase()}</p>}
              {active && (
                <p className="muted">
                  Close this browser session before changing its driver or endpoint.
                </p>
              )}
            </article>
          );
        })}
        {profiles.length === 0 && (
          <div className="empty">
            Create a browser profile before selecting a browser driver.
          </div>
        )}
      </div>
    </section>
  );
}

