import { useRef, useState } from "react";
import { type BrowserHealthDetail, type BrowserHealthSnapshot, type BrowserProfile, type CartStatus, type ProfileWarmState, type ProxyBenchmark, type ProxyProfile, type SessionSnapshot, type Store, type WarmDestination } from "@copify/shared";
import { Menu, type MenuEntry } from "../ui/Menu";
import { GripIcon } from "../ui/icons";
import { Drawer } from "../ui/Drawer";
import { ListFilter, NoMatches, matchesQuery } from "../ui/ListFilter";

const STOPPED_SESSION = (profileId: string): SessionSnapshot => ({
  profileId,
  state: "STOPPED",
  error: null,
  route: {
    kind: "direct",
    verification: { status: "PENDING", publicIp: null, country: null, city: null, verifiedAt: null, message: null },
  },
  coherence: null,
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
      {health.monitorTransport === "HTTP" && <section><h3>HTTP monitor</h3><p className="muted">Endpoint: {health.monitorEndpoint ?? "—"}</p><p className="muted">Interval: {number(health.pollIntervalMs, " ms")} · Routes: {number(health.healthyRouteCount)}/{number(health.configuredRouteCount)} healthy · Last status: {number(health.lastHttpStatus)}</p><p className="muted">Last response: {number(health.lastResponseLatencyMs, " ms")} · Received: {number(health.bytesReceived, " bytes")} · Next poll: {health.nextPollAt ? new Date(health.nextPollAt).toLocaleTimeString() : "—"}</p></section>}
      <section><h3>Identity</h3><p className="muted">webdriver: {health.navigatorWebdriver === null ? "—" : String(health.navigatorWebdriver)} · {health.browserVersion ?? "Browser version unavailable"}</p><p className="muted">Profile age: {number(health.profileAgeMs == null ? null : health.profileAgeMs / 86_400_000, " days")} · Cookies: {number(health.cookieCount)}</p></section>
      {health.coherence && <section><h3>Route coherence</h3><p className="muted">{health.coherence.status} · {health.coherence.country ?? "unknown country"}{health.coherence.city ? ` / ${health.coherence.city}` : ""} · {health.coherence.locale ?? "locale unavailable"} · {health.coherence.timezoneId ?? "timezone unavailable"}</p><p className="muted">Geolocation {health.coherence.geolocationApplied ? "applied" : "not applied"} · WebRTC {health.coherence.webRtcPolicy.toLowerCase().replaceAll("_", " ")}</p>{health.coherence.message && <p className="error-detail">{health.coherence.message}</p>}</section>}
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
  warmStates,
  activeRun,
  latest,
  profileName,
  busy,
  setProfileName,
  onCreate,
  onProfile,
  onCheckCoherence,
  onUpdate,
  onRemoveProfile,
  onReorder,
  onCheckCart,
  onEmptyCart,
  onEmptyCarts,
  onOpenAll,
  onCloseAll,
  onCheckAllCoherence,
  onFailure,
}: {
  profiles: BrowserProfile[];
  proxies: ProxyProfile[];
  stores: Store[];
  sessions: Record<string, SessionSnapshot>;
  cartStatuses: Record<string, CartStatus>;
  warmStates: ProfileWarmState[];
  activeRun: boolean;
  latest: (id: string) => ProxyBenchmark | undefined;
  profileName: string;
  busy: boolean;
  setProfileName: (value: string) => void;
  onCreate: () => void;
  onProfile: (id: string, action: (id: string) => Promise<{ ok: boolean; error?: string }>) => void;
  onCheckCoherence: (id: string) => void;
  onUpdate: (
    id: string,
    input: Pick<import("@copify/shared").UpdateBrowserProfileInput, "name" | "enabled" | "proxyProfileId" | "captchaStrategyOverride">,
    success?: string,
  ) => void;
  onRemoveProfile: (profile: BrowserProfile) => void;
  onReorder: (ordered: BrowserProfile[]) => void;
  onCheckCart: (id: string) => void;
  onEmptyCart: (id: string) => void;
  onEmptyCarts: () => void;
  onOpenAll: () => void;
  onCloseAll: () => void;
  onCheckAllCoherence: () => void;
  onFailure: (message: string) => void;
}) {
  const [healthDetail, setHealthDetail] = useState<BrowserHealthDetail | null>(null);
  const [healthTitle, setHealthTitle] = useState("");
  const [warmProfile, setWarmProfile] = useState<BrowserProfile | null>(null);
  const [warmStore, setWarmStore] = useState<Store | null>(null);
  const [warmState, setWarmState] = useState<ProfileWarmState | null>(null);
  const [warmBusy, setWarmBusy] = useState(false);
  const [warmError, setWarmError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // `armed` keeps a row undraggable until its handle is pressed, so selecting
  // text or hitting a button in the row never starts a drag.
  const [armed, setArmed] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean } | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const showHealth = async (subjectKind: BrowserHealthSnapshot["subjectKind"], subjectId: string, title: string) => {
    const result = await window.copify.health.get(subjectKind, subjectId); if (result.ok) { setHealthTitle(title); setHealthDetail(result.value); }
  };
  // Cart is a store-specific idea, so the column only exists when some enabled
  // adapter can actually read one.
  const showCart = stores.some((store) => store.enabled && store.capabilities.cartInspection);
  const watcherStores = stores.filter((store) => store.enabled && store.capabilities.monitor === "shared");
  const visible = profiles.filter((profile) => matchesQuery(query, profile.name, proxies.find((proxy) => proxy.id === profile.proxyProfileId)?.name ?? "Direct", profile.driver.kind));
  const warmingStore = stores.find((store) => store.enabled && store.warming);
  const beginWarming = async (profile: BrowserProfile) => {
    if (!warmingStore) return; setWarmBusy(true); setWarmError(null);
    try { const result = await window.copify.warming.start(profile.id, warmingStore.id); if (!result.ok) { setWarmError(result.error); onFailure(result.error); return; } setWarmProfile(profile); setWarmStore(warmingStore); setWarmState(result.value); }
    finally { setWarmBusy(false); }
  };
  const updateWarming = async (field: "storefrontReady" | "googleReady" | "shopPayReady", checked: boolean) => {
    if (!warmProfile || !warmStore || !warmState) return; setWarmBusy(true); setWarmError(null);
    try { const input = { storefrontReady: warmState.storefrontReady, googleReady: warmState.googleReady, shopPayReady: warmState.shopPayReady, [field]: checked }; const result = await window.copify.warming.update(warmProfile.id, warmStore.id, input); if (result.ok) setWarmState(result.value); else setWarmError(result.error); }
    finally { setWarmBusy(false); }
  };
  const openWarmDestination = async (destination: WarmDestination) => { if (!warmProfile || !warmStore) return; setWarmBusy(true); setWarmError(null); try { const result = await window.copify.warming.openDestination(warmProfile.id, warmStore.id, destination); if (!result.ok) setWarmError(result.error); } finally { setWarmBusy(false); } };
  const completeWarming = async () => { if (!warmProfile || !warmStore) return; setWarmBusy(true); setWarmError(null); try { const result = await window.copify.warming.complete(warmProfile.id, warmStore.id); if (result.ok) setWarmState(result.value); else setWarmError(result.error); } finally { setWarmBusy(false); } };

  // Reordering rewrites the whole list, so it only makes sense while every
  // profile is on screen. A filtered view hides the rows the order depends on.
  const canReorder = profiles.length > 1 && query.trim() === "";
  const endDrag = () => { setArmed(null); setDragging(null); setDropTarget(null); };
  const commitOrder = (next: BrowserProfile[]) => {
    if (next.every((profile, index) => profile.id === profiles[index]?.id)) return;
    onReorder(next);
  };
  const moveTo = (sourceId: string, targetId: string, before: boolean) => {
    const source = profiles.find((profile) => profile.id === sourceId);
    if (!source || sourceId === targetId) return;
    const next = profiles.filter((profile) => profile.id !== sourceId);
    const index = next.findIndex((profile) => profile.id === targetId);
    if (index < 0) return;
    next.splice(before ? index : index + 1, 0, source);
    commitOrder(next);
  };
  const moveBy = (profileId: string, delta: number) => {
    const from = profiles.findIndex((profile) => profile.id === profileId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= profiles.length) return;
    const next = [...profiles];
    next.splice(to, 0, ...next.splice(from, 1));
    commitOrder(next);
  };

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
          {/* The header states what the page is and how to add to it. */}
          <form
            className="compact-create"
            onSubmit={(event) => { event.preventDefault(); onCreate(); }}
          >
            <input
              ref={nameInput}
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              maxLength={80}
              placeholder="New browser name"
            />
            <button disabled={busy || !profileName.trim()} type="submit">Add</button>
          </form>
        </div>

        {/* The toolbar carries what you do with the browsers that already
            exist: how the list is narrowed on the left, what happens to every
            session on the right. It is absent only when there is nothing to
            act on, where the empty state below speaks for the page instead. */}
        {(profiles.length > 0 || watcherStores.length > 0) && (
          <div className="toolbar">
            <ListFilter value={query} onChange={setQuery} label="browsers" />
            <div className="toolbar-actions">
              <button
                className="primary"
                disabled={busy || !profiles.some((profile) => profile.enabled)}
                onClick={onOpenAll}
              >
                Open all
              </button>
              <button disabled={busy || activeCount === 0} onClick={onCloseAll}>Close all</button>
              {showCart && <button disabled={busy || !profiles.some((profile) => profile.enabled)} onClick={onEmptyCarts}>Empty carts</button>}
              <button disabled={busy || activeRun || activeCount > 0 || !profiles.some((profile) => profile.enabled && profile.driver.kind === "NATIVE_STEALTH")} onClick={onCheckAllCoherence}>Check coherence all</button>
            </div>
          </div>
        )}

        {profiles.length === 0 && watcherStores.length === 0 ? (
          <div className="empty">
            No browsers yet.
            <button disabled={busy} onClick={() => nameInput.current?.focus()}>Add a browser</button>
          </div>
        ) : visible.length === 0 && watcherStores.length === 0 ? (
          <NoMatches label="browsers" onClear={() => setQuery("")} />
        ) : (
          <div className={`rows browser-rows ${showCart ? "has-cart" : ""}`}>
            <div className="row row-head">
              <span className="col-drag" />
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
                <span className="col-drag drag-pinned" title="The storefront watcher always stays at the top." />
                <span className="state ready col-state">WATCHER</span>
                <div className="col-name row-main"><span className="row-name">Storefront watcher</span><span className="row-meta">{store.name} · persistent direct profile</span></div>
                <span className="col-route row-cell">Direct</span><span className="col-ip row-cell mono">—</span><span className="col-latency row-cell mono">—</span>
                {showCart && <span className="col-cart row-cell">—</span>}
                <div className="col-actions row-actions"><button onClick={() => void showHealth("WATCHER", store.id, "Storefront watcher")}>Details</button></div>
              </div>
            ))}

            {visible.map((profile) => {
              const session = sessions[profile.id] ?? STOPPED_SESSION(profile.id);
              const cart = cartStatuses[profile.id] ?? EMPTY_CART(profile.id);
              const active = ["STARTING", "READY", "STOPPING"].includes(session.state);
              const busyState = session.state === "STARTING" || session.state === "STOPPING";
              const proxy = proxies.find((item) => item.id === profile.proxyProfileId);
              const benchmark = latest(profile.proxyProfileId ?? "direct");
              const check = session.route.verification;
              const warm = warmStates.find((item) => item.browserProfileId === profile.id && item.storeId === warmingStore?.id);

              const entries: MenuEntry[] = [
                { kind: "item", label: "Details", onSelect: () => void showHealth("CHECKOUT", profile.id, profile.name) },
                { kind: "item", label: "Check coherence", disabled: busy || activeRun || !profile.enabled || active || profile.driver.kind !== "NATIVE_STEALTH", onSelect: () => onCheckCoherence(profile.id) },
                { kind: "item", label: warm?.status === "READY" ? "Warm profile again" : "Warm profile", disabled: busy || warmBusy || activeRun || !warmingStore || busyState, onSelect: () => void beginWarming(profile) },
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
                { kind: "separator" },
                { kind: "header", label: "CAPTCHA strategy" },
                ...([{"value":"INHERIT_TARGET","label":"Inherit target"},{"value":"MANUAL_HARVESTER","label":"Local Harvester"},{"value":"API_SOLVER","label":"API only"},{"value":"API_WITH_FALLBACK","label":"API with fallback"}] as const).map((item): MenuEntry => ({ kind: "check", label: item.label, checked: profile.captchaStrategyOverride === item.value, disabled: busy || active, onSelect: () => onUpdate(profile.id, { captchaStrategyOverride: item.value }, "CAPTCHA strategy updated.") })),
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
                <div
                  className={[
                    "row browser-row",
                    profile.enabled ? "" : "is-disabled",
                    dragging === profile.id ? "is-dragging" : "",
                    dropTarget?.id === profile.id ? (dropTarget.before ? "drop-before" : "drop-after") : "",
                  ].filter(Boolean).join(" ")}
                  key={profile.id}
                  draggable={canReorder && armed === profile.id}
                  onDragStart={(event) => {
                    if (!canReorder || armed !== profile.id) { event.preventDefault(); return; }
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", profile.id);
                    setDragging(profile.id);
                  }}
                  onDragOver={(event) => {
                    if (!dragging || dragging === profile.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const box = event.currentTarget.getBoundingClientRect();
                    setDropTarget({ id: profile.id, before: event.clientY < box.top + box.height / 2 });
                  }}
                  onDrop={(event) => {
                    if (!dragging || dragging === profile.id) return;
                    event.preventDefault();
                    const box = event.currentTarget.getBoundingClientRect();
                    moveTo(dragging, profile.id, event.clientY < box.top + box.height / 2);
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                >
                  <span className="col-drag">
                    <button
                      type="button"
                      className="drag-handle"
                      aria-label={`Reorder ${profile.name}`}
                      disabled={!canReorder}
                      title={canReorder ? "Drag to reorder" : "Clear the filter to reorder browsers"}
                      onPointerDown={() => setArmed(profile.id)}
                      onPointerUp={() => setArmed(null)}
                      onBlur={() => setArmed(null)}
                      onKeyDown={(event) => {
                        if (!canReorder) return;
                        if (event.key === "ArrowUp") { event.preventDefault(); moveBy(profile.id, -1); }
                        if (event.key === "ArrowDown") { event.preventDefault(); moveBy(profile.id, 1); }
                      }}
                    >
                      <GripIcon className="icon" />
                    </button>
                  </span>
                  <span className={`state ${session.state.toLowerCase()} col-state`}>{session.state}</span>

                  <div className="col-name row-main">
                    <span className="row-name">{profile.name}</span>
                    {!profile.enabled && <span className="row-meta">Disabled</span>}
                    {warm && <span className={`row-meta ${warm.status === "REVIEW" ? "warning" : ""}`}>Warming: {warm.status.toLowerCase().replaceAll("_", " ")}{warm.completedAt ? ` · ${new Date(warm.completedAt).toLocaleString()}` : ""}</span>}
                    {session.coherence && <span className={`row-meta ${session.coherence.status === "WARNING" ? "warning" : ""}`}>{session.coherence.status} coherence · {session.coherence.locale ?? "locale unavailable"} · {session.coherence.timezoneId ?? "timezone unavailable"}</span>}
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
      <Drawer open={Boolean(warmProfile && warmStore && warmState)} title={warmProfile ? `Warm ${warmProfile.name}` : "Warm profile"} onClose={() => { setWarmProfile(null); setWarmStore(null); setWarmState(null); setWarmError(null); }}>
        {warmState && warmStore && <div className="page-stack">
          <section><h3>Route snapshot</h3><p className="muted">{warmStore.name} · {warmState.routeCountry ?? "unknown country"} · {warmState.routePublicIp ?? "IP unavailable"}</p><p className="muted">This workflow keeps sign-in manual. Copify never reads or stores account passwords or cookie values.</p></section>
          <section><h3>1. Storefront</h3><button disabled={warmBusy} onClick={() => void openWarmDestination("STOREFRONT")}>Open {warmStore.name}</button><label className="check"><input type="checkbox" checked={warmState.storefrontReady} disabled={warmBusy} onChange={(event) => void updateWarming("storefrontReady", event.target.checked)} /> I reviewed the storefront in this profile.</label>{warmState.storefrontCompletedAt && <p className="muted">Last confirmed {new Date(warmState.storefrontCompletedAt).toLocaleString()}</p>}</section>
          <section><h3>2. Google account</h3><button disabled={warmBusy} onClick={() => void openWarmDestination("GOOGLE")}>Open Google sign-in</button><label className="check"><input type="checkbox" checked={warmState.googleReady} disabled={warmBusy} onChange={(event) => void updateWarming("googleReady", event.target.checked)} /> Google account state is ready.</label>{warmState.googleCompletedAt && <p className="muted">Last confirmed {new Date(warmState.googleCompletedAt).toLocaleString()}</p>}</section>
          <section><h3>3. Shop / Shop Pay</h3><button disabled={warmBusy} onClick={() => void openWarmDestination("SHOP_PAY")}>Open Shop</button><label className="check"><input type="checkbox" checked={warmState.shopPayReady} disabled={warmBusy} onChange={(event) => void updateWarming("shopPayReady", event.target.checked)} /> Shop or Shop Pay state is ready.</label>{warmState.shopPayCompletedAt && <p className="muted">Last confirmed {new Date(warmState.shopPayCompletedAt).toLocaleString()}</p>}</section>
          {warmError && <p className="error-detail">{warmError}</p>}
          <div className="drawer-actions"><button className="primary" disabled={warmBusy || !warmState.storefrontReady || !warmState.googleReady || !warmState.shopPayReady || warmState.status === "READY"} onClick={() => void completeWarming()}>{warmState.status === "READY" ? "Profile ready" : "Finish warming"}</button></div>
        </div>}
      </Drawer>
    </div>
  );
}
