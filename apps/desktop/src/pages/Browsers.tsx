import { type BrowserProfile, type CartStatus, type ProxyBenchmark, type ProxyProfile, type SessionSnapshot, type Store } from "@copify/shared";
import { Menu, type MenuEntry } from "../ui/Menu";

const STOPPED_SESSION = (profileId: string): SessionSnapshot => ({
  profileId,
  state: "STOPPED",
  error: null,
  route: {
    kind: "direct",
    verification: { status: "PENDING", publicIp: null, country: null, city: null, verifiedAt: null, message: null },
  },
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
  // Cart is a store-specific idea, so the column only exists when some enabled
  // adapter can actually read one.
  const showCart = stores.some((store) => store.enabled && store.capabilities.cartInspection);

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

        {profiles.length === 0 ? (
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

            {profiles.map((profile) => {
              const session = sessions[profile.id] ?? STOPPED_SESSION(profile.id);
              const cart = cartStatuses[profile.id] ?? EMPTY_CART(profile.id);
              const active = ["STARTING", "READY", "STOPPING"].includes(session.state);
              const busyState = session.state === "STARTING" || session.state === "STOPPING";
              const proxy = proxies.find((item) => item.id === profile.proxyProfileId);
              const benchmark = latest(profile.proxyProfileId ?? "direct");
              const check = session.route.verification;

              const entries: MenuEntry[] = [
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
    </div>
  );
}
