import { useState } from "react";
import { type BrowserHealthDetail, type BrowserHealthSnapshot, type BrowserProfile, type CartStatus, type ProxyBenchmark, type ProxyProfile, type SessionSnapshot, type Store } from "@copify/shared";
import { Menu, type MenuEntry } from "../ui/Menu";
import { Drawer } from "../ui/Drawer";

const STOPPED_SESSION = (profileId: string): SessionSnapshot => ({
  profileId,
  state: "STOPPED",
  error: null,
  route: {
    kind: "direct",
    verification: { status: "PENDING", publicIp: null, country: null, city: null, verifiedAt: null, message: null },
  },
  driver: null,
  updatedAt: 0,
});

const EMPTY_CART = (profileId: string): CartStatus => ({
  profileId, status: "UNKNOWN", itemCount: null, checkedAt: null, message: null,
});

function cartLabel(cart: CartStatus): string {
  if (cart.status === "EMPTY") return "Empty";
  if (cart.status === "ITEMS") return `${cart.itemCount ?? "Some"} item${cart.itemCount === 1 ? "" : "s"}`;
  if (cart.status === "CHECKING") return "Checking…";
  if (cart.status === "ERROR") return "Failed";
  return "—";
}

function HealthDrawer({ detail, title, onClose }: { detail: BrowserHealthDetail | null; title: string; onClose: () => void }) {
  const health = detail?.latest;
  const number = (value: number | null | undefined, suffix = "") => value == null ? "—" : `${Math.round(value)}${suffix}`;
  return <Drawer open={Boolean(detail)} title={`${title} details`} onClose={onClose}>
    {!health ? <p className="muted">No recorded health yet. It appears after this profile participates in a run.</p> : <div className="page-stack health-detail">
      <section><h3>Identity</h3><p className="muted">webdriver: {health.navigatorWebdriver === null ? "—" : String(health.navigatorWebdriver)} · {health.browserVersion ?? "Browser version unavailable"}</p><p className="muted">Profile age: {number(health.profileAgeMs == null ? null : health.profileAgeMs / 86_400_000, " days")} · Cookies: {number(health.cookieCount)}</p></section>
      <section><h3>Activity</h3><p className="muted">Requests: {number(health.requestCount)} ({number(health.requestsPerMinute)}/min) · Navigations: {number(health.navigationCount)} ({number(health.navigationsPerMinute)}/min)</p><p className="muted">ATC attempts: {number(health.atcAttempts)} · Average page load: {number(health.averagePageLoadMs, " ms")}</p></section>
      <section><h3>Protection & checkout</h3><p className="muted">403: {number(health.forbiddenCount)} · 429: {number(health.rateLimitedCount)} · Challenges: {number(health.challengeCount)} · Checkout failures: {number(health.checkoutFailures)}</p>{health.circuit?.state === "OPEN" && <p className="error-detail">Circuit open until {health.circuit.reopenAt ? new Date(health.circuit.reopenAt).toLocaleTimeString() : "unknown"}.</p>}</section>
    </div>}
  </Drawer>;
}

export function Browsers({
  profiles,
  proxies,
  stores,
  sessions,
  cartStatuses,
  latest,
  profileName,
  busy,
  setProfileName,
  onCreate,
  onProfile,
  onUpdate,
  onRemoveProfile,
  onCheckCart,
  onEmptyCart,
  onEmptyCarts,
  onOpenAll,
  onCloseAll,
}: {
  profiles: BrowserProfile[];
  proxies: ProxyProfile[];
  stores: Store[];
  sessions: Record<string, SessionSnapshot>;
  cartStatuses: Record<string, CartStatus>;
  latest: (id: string) => ProxyBenchmark | undefined;
  profileName: string;
  busy: boolean;
  setProfileName: (value: string) => void;
  onCreate: () => void;
  onProfile: (id: string, action: (id: string) => Promise<{ ok: boolean; error?: string }>) => void;
  onUpdate: (
    id: string,
    input: { name?: string; enabled?: boolean; proxyProfileId?: string | null },
    success?: string,
  ) => void;
  onRemoveProfile: (profile: BrowserProfile) => void;
  onCheckCart: (id: string) => void;
  onEmptyCart: (id: string) => void;
  onEmptyCarts: () => void;
  onOpenAll: () => void;
  onCloseAll: () => void;
}) {
  const [healthDetail, setHealthDetail] = useState<BrowserHealthDetail | null>(null);
  const [healthTitle, setHealthTitle] = useState("");
  const showHealth = async (subjectKind: BrowserHealthSnapshot["subjectKind"], subjectId: string, title: string) => {
    const result = await window.copify.health.get(subjectKind, subjectId); if (result.ok) { setHealthTitle(title); setHealthDetail(result.value); }
  };
  // Cart is a store-specific idea, so the column only exists when some enabled
  // adapter can actually read one.
  const showCart = stores.some((store) => store.enabled && store.capabilities.cartInspection);
  const watcherStores = stores.filter((store) => store.enabled && store.capabilities.monitor === "shared");

  const activeCount = profiles.filter((profile) =>
    ["STARTING", "READY", "STOPPING"].includes((sessions[profile.id] ?? STOPPED_SESSION(profile.id)).state),
  ).length;

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Browsers</h2>
            <p className="muted">Each browser keeps its own Chrome profile and login state.</p>
          </div>
          <div className="actions">
            <form
              className="compact-create"
              onSubmit={(event) => { event.preventDefault(); onCreate(); }}
            >
              <input
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                maxLength={80}
                placeholder="New browser name"
              />
              <button disabled={busy || !profileName.trim()} type="submit">Add</button>
            </form>
            <button
              className="primary"
              disabled={busy || !profiles.some((profile) => profile.enabled)}
              onClick={onOpenAll}
            >
              Open all
            </button>
            <button disabled={busy || activeCount === 0} onClick={onCloseAll}>Close all</button>
            {showCart && <button disabled={busy || !profiles.some((profile) => profile.enabled)} onClick={onEmptyCarts}>Empty carts</button>}
          </div>
        </div>

        {profiles.length === 0 && watcherStores.length === 0 ? (
          <div className="empty">No browsers yet.</div>
        ) : (
          <div className={`rows browser-rows ${showCart ? "has-cart" : ""}`}>
            <div className="row row-head">
              <span className="col-state">Status</span>
              <span className="col-name">Name</span>
              <span className="col-route">Route</span>
              <span className="col-ip">IP</span>
              <span className="col-latency">Latency</span>
              {showCart && <span className="col-cart">Cart</span>}
              <span className="col-actions" />
            </div>

            {watcherStores.map((store) => (
              <div className="row browser-row" key={`watcher-${store.id}`}>
                <span className="state ready col-state">WATCHER</span>
                <div className="col-name row-main"><span className="row-name">Storefront watcher</span><span className="row-meta">{store.name} · persistent direct profile</span></div>
                <span className="col-route row-cell">Direct</span><span className="col-ip row-cell mono">—</span><span className="col-latency row-cell mono">—</span>
                {showCart && <span className="col-cart row-cell">—</span>}
                <div className="col-actions row-actions"><button onClick={() => void showHealth("WATCHER", store.id, "Storefront watcher")}>Details</button></div>
              </div>
            ))}

            {profiles.map((profile) => {
              const session = sessions[profile.id] ?? STOPPED_SESSION(profile.id);
              const cart = cartStatuses[profile.id] ?? EMPTY_CART(profile.id);
              const active = ["STARTING", "READY", "STOPPING"].includes(session.state);
              const busyState = session.state === "STARTING" || session.state === "STOPPING";
              const proxy = proxies.find((item) => item.id === profile.proxyProfileId);
              const benchmark = latest(profile.proxyProfileId ?? "direct");
              const check = session.route.verification;

              const entries: MenuEntry[] = [
                { kind: "item", label: "Details", onSelect: () => void showHealth("CHECKOUT", profile.id, profile.name) },
                { kind: "item", label: "Restart", disabled: busy || !profile.enabled || busyState, onSelect: () => onProfile(profile.id, window.copify.sessions.restart) },
                { kind: "item", label: "Rename", disabled: busy || active, onSelect: () => {
                  const name = window.prompt("Browser name", profile.name)?.trim();
                  if (name && name !== profile.name) onUpdate(profile.id, { name });
                } },
                { kind: "separator" },
                { kind: "header", label: "Route" },
                { kind: "check", label: "Direct network", checked: !profile.proxyProfileId, disabled: busy || active, onSelect: () => onUpdate(profile.id, { proxyProfileId: null }, "Route updated.") },
                ...proxies.map((item): MenuEntry => ({
                  kind: "check",
                  label: item.enabled ? item.name : `${item.name} (disabled)`,
                  checked: profile.proxyProfileId === item.id,
                  disabled: busy || active || !item.enabled,
                  onSelect: () => onUpdate(profile.id, { proxyProfileId: item.id }, "Route updated."),
                })),
              ];

              if (showCart) {
                entries.push(
                  { kind: "separator" },
                  { kind: "item", label: "Check cart", disabled: busy || !profile.enabled || busyState, onSelect: () => onCheckCart(profile.id) },
                );
                if (cart.status === "ITEMS") {
                  entries.push({ kind: "item", label: "Empty cart", disabled: busy || !profile.enabled, danger: true, onSelect: () => onEmptyCart(profile.id) });
                }
              }

              entries.push(
                { kind: "separator" },
                { kind: "item", label: profile.enabled ? "Disable" : "Enable", disabled: busy || active, onSelect: () => onUpdate(profile.id, { enabled: !profile.enabled }) },
                { kind: "item", label: "Remove", danger: true, disabled: busy || active, onSelect: () => onRemoveProfile(profile) },
              );

              return (
                <div className={`row browser-row ${profile.enabled ? "" : "is-disabled"}`} key={profile.id}>
                  <span className={`state ${session.state.toLowerCase()} col-state`}>{session.state}</span>

                  <div className="col-name row-main">
                    <span className="row-name">{profile.name}</span>
                    {!profile.enabled && <span className="row-meta">Disabled</span>}
                    {cart.status === "ERROR" && cart.message && <span className="error-detail">{cart.message}</span>}
                    {session.error && <span className="error-detail">{session.error.message}</span>}
                    {check.status === "FAILED" && !session.error && (
                      <span className="error-detail">{check.message ?? "Route not confirmed"}</span>
                    )}
                  </div>

                  <span className="col-route row-cell">{proxy ? proxy.name : "Direct"}</span>
                  <span className={`col-ip row-cell mono ${check.status === "VERIFIED" ? "verified" : ""}`}>
                    {check.publicIp ?? "—"}
                    {check.country ? <span className="dim"> {check.country}</span> : null}
                  </span>
                  <span className="col-latency row-cell mono">
                    {benchmark?.medianLatencyMs == null ? "—" : `${Math.round(benchmark.medianLatencyMs)} ms`}
                  </span>
                  {showCart && (
                    <span className={`col-cart row-cell cart-status cart-${cart.status.toLowerCase()}`} title={cart.message ?? undefined}>{cartLabel(cart)}</span>
                  )}

                  <div className="col-actions row-actions">
                    {active ? (
                      <button
                        disabled={busy || busyState}
                        onClick={() => onProfile(profile.id, window.copify.sessions.close)}
                      >
                        Close
                      </button>
                    ) : (
                      <button
                        className="primary"
                        disabled={busy || !profile.enabled}
                        onClick={() => onProfile(profile.id, window.copify.sessions.open)}
                      >
                        Open
                      </button>
                    )}
                    <Menu entries={entries} label={`Actions for ${profile.name}`} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <HealthDrawer detail={healthDetail} title={healthTitle} onClose={() => setHealthDetail(null)} />
    </div>
  );
}
