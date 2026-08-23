import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  BrowserProfile,
  CartStatus,
  DiagnosticLevel,
  ProxyBenchmark,
  ProxyProfile,
  RunDetail,
  RunSession,
  SessionSnapshot,
  ShippingProfile,
  Target,
} from "@copify/shared";
import { STORE_GENERAL, getStoreManifest, isMonitorable, listStoreManifests, type StoreManifest } from "@copify/shared";
import appIcon from "../resources/icons/copify-icon-128.png";
import "./styles.css";

type Notice = { kind: "error" | "info"; message: string } | null;
type Workspace =
  | "overview"
  | "runs"
  | "targets"
  | "profiles"
  | "shipping"
  | "network";
type ProxyDraft = {
  name: string;
  provider: ProxyProfile["provider"];
  type: ProxyProfile["type"];
  protocol: ProxyProfile["protocol"];
  host: string;
  port: number;
  username: string;
  password: string;
  expectedCountry?: string;
  expectedCity?: string;
  enabled: boolean;
};
type TargetDraft = {
  storeId: Target["storeId"];
  name: string;
  productKeywords: string;
  negativeKeywords: string;
  preferredColors: string;
  sizePriority: string;
  currency: "EUR" | "GBP" | "USD";
  maxRetailPrice: string;
  quantity: number;
  enabled: boolean;
};
type ShippingDraft = {
  name: string;
  fullName: string;
  email: string;
  phone: string;
  address1: string;
  address2: string;
  postalCode: string;
  city: string;
  region: string;
  country: string;
  enabled: boolean;
};
const blankProxy = (): ProxyDraft => ({
  name: "",
  provider: "custom",
  type: "residential-sticky",
  protocol: "http",
  host: "",
  port: 8080,
  username: "",
  password: "",
  enabled: true,
});
const blankTarget = (): TargetDraft => ({
  storeId: STORE_GENERAL,
  name: "",
  productKeywords: "",
  negativeKeywords: "",
  preferredColors: "",
  sizePriority: "",
  currency: "EUR",
  maxRetailPrice: "0.00",
  quantity: 1,
  enabled: true,
});
const blankShipping = (): ShippingDraft => ({
  name: "",
  fullName: "",
  email: "",
  phone: "",
  address1: "",
  address2: "",
  postalCode: "",
  city: "",
  region: "",
  country: "PT",
  enabled: true,
});
const list = (value: string) =>
  value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
const toMinor = (value: string) => {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  return match
    ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
    : -1;
};
const fromMinor = (value: number) => (value / 100).toFixed(2);
const navigation: { id: Workspace; label: string; caption: string }[] = [
  { id: "overview", label: "Overview", caption: "Command center" },
  { id: "runs", label: "Runs", caption: "Record & inspect" },
  { id: "targets", label: "Targets", caption: "Store presets" },
  { id: "profiles", label: "Profiles", caption: "Browsers & proxies" },
  { id: "shipping", label: "Shipping", caption: "Checkout details" },
  { id: "network", label: "Network", caption: "Route health" },
];

function App() {
  const [workspace, setWorkspace] = useState<Workspace>("overview");
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [proxies, setProxies] = useState<ProxyProfile[]>([]);
  const [sessions, setSessions] = useState<Record<string, SessionSnapshot>>({});
  const [cartStatuses, setCartStatuses] = useState<Record<string, CartStatus>>({});
  const [benchmarks, setBenchmarks] = useState<
    Record<string, ProxyBenchmark[]>
  >({});
  const [profileName, setProfileName] = useState("");
  const [proxyDraft, setProxyDraft] = useState<ProxyDraft>(blankProxy());
  const [editingProxyId, setEditingProxyId] = useState<string | null>(null);
  const [probeUrl, setProbeUrl] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunDetail["run"][]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [runName, setRunName] = useState(
    () => `Run ${new Date().toLocaleString()}`,
  );
  const [runLevel, setRunLevel] = useState<DiagnosticLevel>("NORMAL");
  const [runMode, setRunMode] = useState<"OBSERVATION" | "ASSISTED_CHECKOUT">(
    "OBSERVATION",
  );
  const [runProfiles, setRunProfiles] = useState<string[]>([]);
  const [runTargetId, setRunTargetId] = useState("");
  const [deepDebugAcknowledged, setDeepDebugAcknowledged] = useState(false);
  const [assistedAcknowledged, setAssistedAcknowledged] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetDraft, setTargetDraft] = useState<TargetDraft>(blankTarget());
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [targetTesting, setTargetTesting] = useState<string | null>(null);
  const [shippingProfiles, setShippingProfiles] = useState<ShippingProfile[]>(
    [],
  );
  const [shippingDraft, setShippingDraft] =
    useState<ShippingDraft>(blankShipping());
  const [editingShippingId, setEditingShippingId] = useState<string | null>(
    null,
  );
  const reload = async (): Promise<void> => {
    const [
      profileResult,
      proxyResult,
      sessionResult,
      settingResult,
      runResult,
      targetResult,
      shippingResult,
      cartResult,
    ] = await Promise.all([
      window.copify.profiles.list(),
      window.copify.proxies.list(),
      window.copify.sessions.list(),
      window.copify.settings.getNetworkProbe(),
      window.copify.runs.list(),
      window.copify.targets.list(),
      window.copify.shipping.list(),
      window.copify.sessions.carts(),
    ]);
    if (!profileResult.ok) {
      setNotice({ kind: "error", message: profileResult.error });
      return;
    }
    if (!proxyResult.ok) {
      setNotice({ kind: "error", message: proxyResult.error });
      return;
    }
    setProfiles(profileResult.value);
    setProxies(proxyResult.value);
    if (targetResult.ok) setTargets(targetResult.value);
    if (shippingResult.ok) setShippingProfiles(shippingResult.value);
    if (cartResult.ok) setCartStatuses(Object.fromEntries(cartResult.value.map((item) => [item.profileId, item])));
    if (sessionResult.ok)
      setSessions(
        Object.fromEntries(
          sessionResult.value.map((item) => [item.profileId, item]),
        ),
      );
    if (settingResult.ok) setProbeUrl(settingResult.value.probeUrl);
    if (runResult.ok) {
      setRuns(runResult.value.runs);
      setActiveRunId(runResult.value.activeRunId);
    }
    const results = await Promise.all(
      [null, ...proxyResult.value.map((proxy) => proxy.id)].map(
        async (id) =>
          [id ?? "direct", await window.copify.proxies.benchmarks(id)] as const,
      ),
    );
    const next: Record<string, ProxyBenchmark[]> = {};
    for (const [key, result] of results)
      if (result.ok) next[key] = result.value;
    setBenchmarks(next);
  };
  useEffect(() => {
    void reload();
    const offSessions = window.copify.sessions.onChanged((snapshot) =>
      setSessions((current) => ({
        ...current,
        [snapshot.profileId]: snapshot,
      })),
    );
    const offRuns = window.copify.runs.onChanged(() => void reload());
    const offCarts = window.copify.sessions.onCartChanged((status) => setCartStatuses((current) => ({ ...current, [status.profileId]: status })));
    const offTargets = window.copify.targets.onChanged(() => void reload());
    const offShipping = window.copify.shipping.onChanged(() => void reload());
    return () => {
      offSessions();
      offRuns();
      offCarts();
      offTargets();
      offShipping();
    };
  }, []);
  const activeCount = useMemo(
    () =>
      Object.values(sessions).filter((item) =>
        ["STARTING", "READY", "STOPPING"].includes(item.state),
      ).length,
    [sessions],
  );
  const readyCount = useMemo(
    () =>
      Object.values(sessions).filter((item) => item.state === "READY").length,
    [sessions],
  );
  const session = (profileId: string): SessionSnapshot =>
    sessions[profileId] ?? {
      profileId,
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
  const latest = (id: string) => benchmarks[id]?.[0];
  const execute = async (
    operation: () => Promise<{ ok: boolean; error?: string }>,
    success?: string,
  ): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await operation();
      if (!response.ok)
        setNotice({
          kind: "error",
          message: response.error ?? "Operation failed.",
        });
      else if (success) setNotice({ kind: "info", message: success });
    } finally {
      setBusy(false);
      await reload();
    }
  };
  const saveProxy = async (event: React.FormEvent) => {
    event.preventDefault();
    const input = {
      ...proxyDraft,
      expectedCountry: proxyDraft.expectedCountry?.trim() || null,
      expectedCity: proxyDraft.expectedCity?.trim() || null,
      username: proxyDraft.username || undefined,
      password: proxyDraft.password || undefined,
    };
    await execute(
      () =>
        editingProxyId
          ? window.copify.proxies.update(editingProxyId, input)
          : window.copify.proxies.create(input),
      editingProxyId ? "Proxy profile updated." : "Proxy profile created.",
    );
    if (!editingProxyId) setProxyDraft(blankProxy());
    setEditingProxyId(null);
  };
  const editProxy = (proxy: ProxyProfile) => {
    setWorkspace("profiles");
    setEditingProxyId(proxy.id);
    setProxyDraft({
      name: proxy.name,
      provider: proxy.provider,
      type: proxy.type,
      protocol: proxy.protocol,
      host: proxy.host,
      port: proxy.port,
      username: "",
      password: "",
      expectedCountry: proxy.expectedCountry ?? undefined,
      expectedCity: proxy.expectedCity ?? undefined,
      enabled: proxy.enabled,
    });
  };
  const clearCredential = (
    proxy: ProxyProfile,
    field: "username" | "password",
  ) => {
    if (window.confirm(`Clear the saved proxy ${field}?`))
      void execute(
        () => window.copify.proxies.update(proxy.id, { [field]: null }),
        `Proxy ${field} cleared.`,
      );
  };
  const testRoute = async (id: string | null) => {
    const key = id ?? "direct";
    setTesting(key);
    setNotice(null);
    try {
      const response = await window.copify.proxies.test(id);
      setNotice(
        response.ok
          ? {
              kind: "info",
              message: `${id ? "Proxy" : "Direct network"} benchmark completed.`,
            }
          : { kind: "error", message: response.error },
      );
    } finally {
      setTesting(null);
      await reload();
    }
  };
  const beginRun = async () => {
    await execute(async () => {
      const response = await window.copify.runs.start({
        name: runName.trim() || `Run ${new Date().toLocaleString()}`,
        diagnosticLevel: runLevel,
        executionMode: runMode,
        profileIds: runProfiles,
        targetId: runTargetId || null,
        deepDebugAcknowledged,
        assistedAcknowledged,
      });
      if (response.ok) {
        setSelectedRun(response.value);
        setRunName(`Run ${new Date().toLocaleString()}`);
      }
      return response;
    }, "Run recording started.");
  };
  const saveShipping = async (event: React.FormEvent) => {
    event.preventDefault();
    const { name, enabled, ...details } = shippingDraft;
    const input = {
      name: name.trim(),
      enabled,
      details: {
        ...details,
        address2: details.address2 || undefined,
        region: details.region || undefined,
        country: details.country.toUpperCase(),
      },
    };
    await execute(
      () =>
        editingShippingId
          ? window.copify.shipping.update(editingShippingId, input)
          : window.copify.shipping.create(input),
      editingShippingId
        ? "Shipping profile updated."
        : "Shipping profile encrypted and saved.",
    );
    setShippingDraft(blankShipping());
    setEditingShippingId(null);
  };
  const saveTarget = async (event: React.FormEvent) => {
    event.preventDefault();
    const maxRetailMinor = toMinor(targetDraft.maxRetailPrice);
    if (maxRetailMinor < 0) {
      setNotice({
        kind: "error",
        message: "Use a max retail price with up to two decimal places.",
      });
      return;
    }
    const input = {
      storeId: targetDraft.storeId,
      name: targetDraft.name.trim(),
      productKeywords: list(targetDraft.productKeywords),
      negativeKeywords: list(targetDraft.negativeKeywords),
      preferredColors: list(targetDraft.preferredColors),
      sizePriority: list(targetDraft.sizePriority),
      currency: targetDraft.currency,
      maxRetailMinor,
      quantity: targetDraft.quantity,
      enabled: targetDraft.enabled,
    };
    await execute(
      () =>
        editingTargetId
          ? window.copify.targets.update(editingTargetId, input)
          : window.copify.targets.create(input),
      editingTargetId ? "Target updated." : "Target created.",
    );
    setTargetDraft(blankTarget());
    setEditingTargetId(null);
  };
  const editTarget = (target: Target) => {
    setWorkspace("targets");
    setEditingTargetId(target.id);
    setTargetDraft({
      storeId: target.storeId,
      name: target.name,
      productKeywords: target.productKeywords.join(", "),
      negativeKeywords: target.negativeKeywords.join(", "),
      preferredColors: target.preferredColors.join(", "),
      sizePriority: target.sizePriority.join(", "),
      currency: target.currency,
      maxRetailPrice: fromMinor(target.maxRetailMinor),
      quantity: target.quantity,
      enabled: target.enabled,
    });
  };
  const testTarget = async (id: string) => {
    setTargetTesting(id);
    try {
      await execute(
        () => window.copify.targets.test(id),
        "Target test completed.",
      );
    } finally {
      setTargetTesting(null);
    }
  };
  const showRun = async (id: string) => {
    const response = await window.copify.runs.get(id);
    if (response.ok) {
      setSelectedRun(response.value);
      setWorkspace("runs");
    } else setNotice({ kind: "error", message: response.error });
  };
  const page = navigation.find((item) => item.id === workspace)!;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={appIcon} className="brand-mark" alt="Copify" />
          <div>
            <strong>Copify</strong>
            <span>v0.5</span>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="Copify sections">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${workspace === item.id ? "active" : ""}`}
              aria-current={workspace === item.id ? "page" : undefined}
              onClick={() => setWorkspace(item.id)}
            >
              <span>{item.label}</span>
              <small>{item.caption}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <span className={`status-dot ${activeRunId ? "recording" : ""}`} />
          <div>
            <b>{activeRunId ? "Run recording" : "Ready"}</b>
            <small>
              {activeCount} active browser session{activeCount === 1 ? "" : "s"}
            </small>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">COPIFY / {page.caption.toUpperCase()}</p>
            <h1>{page.label}</h1>
          </div>
          <div className="header-actions">
            <span className="header-metric">
              <b>{activeRunId ? "REC" : readyCount}</b>
              {activeRunId ? " active run" : " ready sessions"}
            </span>
            <button
              disabled={busy || !profiles.some((profile) => profile.enabled)}
              onClick={() =>
                void execute(() => window.copify.sessions.openAll())
              }
            >
              Open all
            </button>
            <button
              className="secondary"
              disabled={busy || activeCount === 0}
              onClick={() =>
                void execute(() => window.copify.sessions.closeAll())
              }
            >
              Close all
            </button>
          </div>
        </header>
        {notice && <p className={`notice ${notice.kind}`}>{notice.message}</p>}
        {workspace === "overview" && (
          <Overview
            activeCount={activeCount}
            readyCount={readyCount}
            targets={targets}
            benchmark={latest("direct")}
            activeRun={Boolean(activeRunId)}
            navigate={setWorkspace}
          />
        )}
        {workspace === "runs" && (
          <Runs
            profiles={profiles}
            targets={targets}
            getSession={session}
            runs={runs}
            activeRun={Boolean(activeRunId)}
            selected={selectedRun}
            name={runName}
            level={runLevel}
            mode={runMode}
            selectedProfiles={runProfiles}
            targetId={runTargetId}
            acknowledged={deepDebugAcknowledged}
            assistedAcknowledged={assistedAcknowledged}
            busy={busy}
            onName={setRunName}
            onLevel={(value) => {
              setRunLevel(value);
              setDeepDebugAcknowledged(false);
            }}
            onMode={(value) => {
              setRunMode(value);
              setAssistedAcknowledged(false);
            }}
            onTarget={setRunTargetId}
            onToggle={(id) =>
              setRunProfiles((current) =>
                current.includes(id)
                  ? current.filter((item) => item !== id)
                  : [...current, id],
              )
            }
            onAck={setDeepDebugAcknowledged}
            onAssistedAck={setAssistedAcknowledged}
            onStart={() => void beginRun()}
            onEnd={() =>
              void execute(async () => {
                const response = await window.copify.runs.end();
                if (response.ok) setSelectedRun(response.value);
                return response;
              }, "Run completed. Chrome sessions remain open.")
            }
            onResume={(profileId) =>
              void execute(
                () => window.copify.runs.resume(profileId),
                "Checkpoint resumed.",
              )
            }
            onShow={(id) => void showRun(id)}
            onDelete={() => {
              if (
                selectedRun &&
                window.confirm(
                  `Delete “${selectedRun.run.name}” and its local artifacts?`,
                )
              )
                void execute(async () => {
                  const response = await window.copify.runs.remove(
                    selectedRun.run.id,
                  );
                  if (response.ok) setSelectedRun(null);
                  return response;
                }, "Run deleted.");
            }}
          />
        )}
        {workspace === "targets" && (
          <Targets
            targets={targets}
            draft={targetDraft}
            editingId={editingTargetId}
            activeRun={Boolean(activeRunId)}
            busy={busy}
            testing={targetTesting}
            setDraft={setTargetDraft}
            onSave={(event) => void saveTarget(event)}
            onEdit={editTarget}
            onCancel={() => {
              setEditingTargetId(null);
              setTargetDraft(blankTarget());
            }}
            onTest={(id) => void testTarget(id)}
            onToggle={(target) =>
              void execute(() =>
                window.copify.targets.update(target.id, {
                  enabled: !target.enabled,
                }),
              )
            }
            onRemove={(target) => {
              if (
                window.confirm(
                  `Remove “${target.name}”? Completed runs keep their snapshots.`,
                )
              )
                void execute(() => window.copify.targets.remove(target.id));
            }}
          />
        )}
        {workspace === "profiles" && (
          <Profiles
            profiles={profiles}
            proxies={proxies}
            sessions={sessions}
            cartStatuses={cartStatuses}
            benchmarks={benchmarks}
            latest={latest}
            profileName={profileName}
            draft={proxyDraft}
            editingId={editingProxyId}
            busy={busy}
            testing={testing}
            setProfileName={setProfileName}
            onCreate={() =>
              void execute(async () => {
                const response = await window.copify.profiles.create({
                  name: profileName,
                });
                if (response.ok) setProfileName("");
                return response;
              }, "Browser profile created.")
            }
            onProfile={(id, action) => void execute(() => action(id))}
            onUpdate={(id, input, success) =>
              void execute(
                () => window.copify.profiles.update(id, input),
                success,
              )
            }
            onRemoveProfile={(profile) => {
              if (
                window.confirm(
                  `Remove “${profile.name}” from Copify? Its Chrome data will stay on disk.`,
                )
              )
                void execute(() => window.copify.profiles.remove(profile.id));
            }}
            onTest={(id) => void testRoute(id)}
            onCheckCart={(id) => void execute(() => window.copify.sessions.checkCart(id))}
            onEmptyCart={(id) => {
              if (window.confirm("Remove every item from this profile’s Supreme cart? This cannot be undone.")) void execute(() => window.copify.sessions.emptyCart(id), "Cart emptied.");
            }}
            onEdit={editProxy}
            onClear={clearCredential}
            onToggleProxy={(proxy) =>
              void execute(() =>
                window.copify.proxies.update(proxy.id, {
                  enabled: !proxy.enabled,
                }),
              )
            }
            onRemoveProxy={(proxy) => {
              if (
                window.confirm(
                  `Remove “${proxy.name}”? Assigned inactive profiles will return to direct networking.`,
                )
              )
                void execute(() => window.copify.proxies.remove(proxy.id));
            }}
            setDraft={setProxyDraft}
            onSave={(event) => void saveProxy(event)}
            onCancel={() => {
              setEditingProxyId(null);
              setProxyDraft(blankProxy());
            }}
          />
        )}
        {workspace === "shipping" && (
          <Shipping
            profiles={profiles}
            shipping={shippingProfiles}
            draft={shippingDraft}
            editingId={editingShippingId}
            activeRun={Boolean(activeRunId)}
            busy={busy}
            setDraft={setShippingDraft}
            onSave={(event) => void saveShipping(event)}
            onEdit={(profile) => {
              setEditingShippingId(profile.id);
              setShippingDraft({
                ...blankShipping(),
                name: profile.name,
                country: profile.country ?? "PT",
                enabled: profile.enabled,
              });
            }}
            onCancel={() => {
              setEditingShippingId(null);
              setShippingDraft(blankShipping());
            }}
            onToggle={(profile) =>
              void execute(() =>
                window.copify.shipping.update(profile.id, {
                  enabled: !profile.enabled,
                }),
              )
            }
            onRemove={(profile) => {
              if (
                window.confirm(
                  `Remove “${profile.name}”? Assigned browsers will become observation-only.`,
                )
              )
                void execute(() => window.copify.shipping.remove(profile.id));
            }}
            onAssign={(profileId, shippingProfileId) =>
              void execute(
                () =>
                  window.copify.profiles.update(profileId, {
                    shippingProfileId: shippingProfileId || null,
                  }),
                "Shipping assignment updated.",
              )
            }
          />
        )}
        {workspace === "network" && (
          <Network
            benchmark={latest("direct")}
            history={benchmarks.direct ?? []}
            probeUrl={probeUrl}
            busy={busy}
            testing={testing === "direct"}
            setProbeUrl={setProbeUrl}
            onTest={() => void testRoute(null)}
            onSave={(event) => {
              event.preventDefault();
              void execute(
                () => window.copify.settings.updateNetworkProbe({ probeUrl }),
                "Network probe updated.",
              );
            }}
          />
        )}
        {workspace === "profiles" && (
          <LaunchModes
            profiles={profiles}
            proxies={proxies}
            sessions={sessions}
            busy={busy}
            onUpdate={(id, launchMode) =>
              void execute(
                () => window.copify.profiles.update(id, { launchMode }),
                "Browser launch method updated.",
              )
            }
          />
        )}
      </main>
    </div>
  );
}

function Overview({
  activeCount,
  readyCount,
  targets,
  benchmark,
  activeRun,
  navigate,
}: {
  activeCount: number;
  readyCount: number;
  targets: Target[];
  benchmark?: ProxyBenchmark;
  activeRun: boolean;
  navigate: (page: Workspace) => void;
}) {
  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">OPERATIONS CONSOLE</p>
          <h2>
            {activeRun
              ? "A run is being recorded"
              : "Everything is ready for a clean run."}
          </h2>
          <p>
            {activeRun
              ? "Browser activity is being captured. Inspect its timeline or end recording from Runs."
              : "Launch browser profiles for manual browsing, then start a run with stopped profiles for a clean capture."}
          </p>
        </div>
        <div className="hero-actions">
          <button onClick={() => navigate("runs")}>
            {activeRun ? "View active run" : "Start a run"}
          </button>
          <button className="secondary" onClick={() => navigate("profiles")}>
            Manage profiles
          </button>
        </div>
      </section>
      <section className="stat-grid">
        <Metric
          label="Ready browsers"
          value={readyCount}
          detail={`${activeCount} currently active`}
        />
        <Metric
          label="Monitorable targets"
          value={targets.filter((target) => target.enabled && isMonitorable(target.storeId)).length}
          detail="Supreme EU read-only"
        />
        <Metric
          label="Direct route"
          value={benchmark ? `${benchmark.qualityScore}/100` : "—"}
          detail={
            benchmark
              ? `${benchmark.status} · latest benchmark`
              : "Not tested yet"
          }
        />
      </section>
      <section className="overview-grid">
        <section className="panel">
          <p className="eyebrow">NEXT STEPS</p>
          <h2>Use Copify in three places</h2>
          <div className="quick-links">
            <button className="quick-link" onClick={() => navigate("profiles")}>
              <b>1. Profiles</b>
              <span>
                Create persistent Chrome sessions and optionally assign a proxy.
              </span>
            </button>
            <button className="quick-link" onClick={() => navigate("targets")}>
              <b>2. Targets</b>
              <span>Save a General template or configure a Supreme EU match.</span>
            </button>
            <button className="quick-link" onClick={() => navigate("runs")}>
              <b>3. Runs</b>
              <span>
                Record manual browsing and inspect the local timeline.
              </span>
            </button>
          </div>
        </section>
        <section className="panel route-summary">
          <p className="eyebrow">DIRECT NETWORK</p>
          <h2>
            {benchmark
              ? `${benchmark.status} · ${benchmark.qualityScore}/100`
              : "No benchmark yet"}
          </h2>
          <p className="muted">
            {benchmark?.publicIp
              ? `${benchmark.publicIp}${benchmark.country ? ` · ${benchmark.country}` : ""}`
              : "Test your direct route before using it as a baseline."}
          </p>
          <button className="secondary" onClick={() => navigate("network")}>
            Open network health
          </button>
        </section>
      </section>
    </div>
  );
}

function Runs({
  profiles,
  targets,
  getSession,
  runs,
  activeRun,
  selected,
  name,
  level,
  mode,
  selectedProfiles,
  targetId,
  acknowledged,
  assistedAcknowledged,
  busy,
  onName,
  onLevel,
  onMode,
  onTarget,
  onToggle,
  onAck,
  onAssistedAck,
  onStart,
  onEnd,
  onResume,
  onShow,
  onDelete,
}: {
  profiles: BrowserProfile[];
  targets: Target[];
  getSession: (id: string) => SessionSnapshot;
  runs: RunDetail["run"][];
  activeRun: boolean;
  selected: RunDetail | null;
  name: string;
  level: DiagnosticLevel;
  mode: "OBSERVATION" | "ASSISTED_CHECKOUT";
  selectedProfiles: string[];
  targetId: string;
  acknowledged: boolean;
  assistedAcknowledged: boolean;
  busy: boolean;
  onName: (value: string) => void;
  onLevel: (value: DiagnosticLevel) => void;
  onMode: (value: "OBSERVATION" | "ASSISTED_CHECKOUT") => void;
  onTarget: (value: string) => void;
  onToggle: (id: string) => void;
  onAck: (value: boolean) => void;
  onAssistedAck: (value: boolean) => void;
  onStart: () => void;
  onEnd: () => void;
  onResume: (profileId: string) => void;
  onShow: (id: string) => void;
  onDelete: () => void;
}) {
  const stopped = profiles.filter(
    (profile) => profile.enabled && getSession(profile.id).state === "STOPPED",
  );
  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">RUN ENGINE</p>
            <h2>
              {activeRun ? "Recording in progress" : "Start a recorded run"}
            </h2>
            <p className="muted">
              Observation is read-only. Assisted mode adds to cart, fills
              shipping, then always stops before payment.
            </p>
          </div>
          {activeRun && (
            <button className="danger" disabled={busy} onClick={onEnd}>
              End run
            </button>
          )}
        </div>
        {!activeRun ? (
          <div className="run-form">
            <Field label="Run name">
              <input
                value={name}
                onChange={(event) => onName(event.target.value)}
                maxLength={120}
              />
            </Field>
            <Field label="Run mode">
              <select
                value={mode}
                onChange={(event) =>
                  onMode(
                    event.target.value as "OBSERVATION" | "ASSISTED_CHECKOUT",
                  )
                }
              >
                <option value="OBSERVATION">Observation — read-only</option>
                <option value="ASSISTED_CHECKOUT">
                  Assisted checkout — cart and shipping handoff
                </option>
              </select>
            </Field>
            <Field label="Target monitor">
              <select
                value={targetId}
                onChange={(event) => onTarget(event.target.value)}
              >
                <option value="">Observation only — no target monitor</option>
                {targets
                  .filter((target) => target.enabled && isMonitorable(target.storeId))
                  .map((target) => (
                    <option key={target.id} value={target.id}>
                      Supreme EU · {target.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Capture level">
              <select
                value={level}
                onChange={(event) =>
                  onLevel(event.target.value as DiagnosticLevel)
                }
              >
                <option value="NORMAL">
                  Normal — sanitized events and screenshots
                </option>
                <option value="DIAGNOSTIC">
                  Diagnostic — trace and sanitized console
                </option>
                <option value="DEEP_DEBUG">
                  Deep Debug — HAR and video, sensitive
                </option>
              </select>
            </Field>
            <fieldset className="run-profile-picker">
              <legend>Stopped browser profiles</legend>
              {stopped.map((profile) => (
                <label key={profile.id} className="check">
                  <input
                    type="checkbox"
                    checked={selectedProfiles.includes(profile.id)}
                    onChange={() => onToggle(profile.id)}
                  />{" "}
                  {profile.name}
                  <span>
                    {" "}
                    · {profile.proxyProfileId ? "Proxy route" : "Direct"}
                  </span>
                </label>
              ))}
              {stopped.length === 0 && (
                <p className="muted">
                  Close an enabled browser profile before selecting it for a
                  clean recorded run.
                </p>
              )}
            </fieldset>
            {mode === "ASSISTED_CHECKOUT" && (
              <label className="check warning">
                <input
                  type="checkbox"
                  checked={assistedAcknowledged}
                  onChange={(event) => onAssistedAck(event.target.checked)}
                />{" "}
                I understand Copify may add to cart and fill shipping for
                profiles with an assigned complete shipping profile only when
                their cart starts empty. It never removes existing items,
                enters payment details, or submits an order.
              </label>
            )}
            {level === "DEEP_DEBUG" && (
              <label className="check warning">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => onAck(event.target.checked)}
                />{" "}
                I understand HAR, video, and traces may contain sensitive
                browser state and stay local.
              </label>
            )}
            <button
              disabled={
                busy ||
                selectedProfiles.length === 0 ||
                (level === "DEEP_DEBUG" && !acknowledged) ||
                (mode === "ASSISTED_CHECKOUT" &&
                  (!assistedAcknowledged || !targetId))
              }
              onClick={onStart}
            >
              Start run
            </button>
          </div>
        ) : (
          <div className="active-run-copy">
            {selected?.run.executionMode === "ASSISTED_CHECKOUT"
              ? "Assisted sessions will act once an acceptable target is found; sessions without a complete shipping profile remain observers."
              : "The selected sessions are recording. End Run finalizes the timeline without closing Chrome."}
            {selected?.sessions
              .filter((session) => session.executionState === "CHECKPOINT")
              .map((session) => (
                <div key={session.id} className="checkpoint-action">
                  <p className="muted">
                    {session.browserProfileName}: {session.checkpointReason === "CART_NOT_EMPTY"
                      ? "cart is not empty; Copify left it unchanged. Empty it manually, then recheck."
                      : session.checkpointReason === "CART_CONTENT_CHANGED"
                        ? "cart must contain only the detected target before checkout."
                        : session.checkpointReason === "CART_STATE_UNKNOWN"
                          ? "Copify could not safely verify the cart; review it manually, then recheck."
                          : `waiting at ${session.checkpointReason ?? "a manual checkpoint"}.`}
                  </p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => onResume(session.browserProfileId)}
                  >
                    {/^CART_/.test(session.checkpointReason ?? "") ? "Recheck cart" : "Resume"} {session.browserProfileName}
                  </button>
                </div>
              ))}
          </div>
        )}
      </section>
      <section className="panel">
        <p className="eyebrow">RUN HISTORY</p>
        <h2>Saved runs</h2>
        {runs.length === 0 ? (
          <div className="empty">
            No recorded runs yet. Start a run with stopped browser profiles to
            build a timeline.
          </div>
        ) : (
          <div className="run-list">
            {runs.map((run) => (
              <button
                key={run.id}
                className={`run-row ${selected?.run.id === run.id ? "selected-run" : ""}`}
                onClick={() => onShow(run.id)}
              >
                <span>
                  <b>{run.name}</b>
                  <small>{new Date(run.startedAt).toLocaleString()}</small>
                </span>
                <span className={`state ${run.status.toLowerCase()}`}>
                  {run.status}
                </span>
                <small>
                  {run.executionMode === "ASSISTED_CHECKOUT"
                    ? "ASSISTED"
                    : "OBSERVE"}{" "}
                  · {run.diagnosticLevel}
                </small>
              </button>
            ))}
          </div>
        )}
        {selected && <RunInspector detail={selected} onDelete={onDelete} />}
      </section>
    </div>
  );
}

function Targets({
  targets,
  draft,
  editingId,
  activeRun,
  busy,
  testing,
  setDraft,
  onSave,
  onEdit,
  onCancel,
  onTest,
  onToggle,
  onRemove,
}: {
  targets: Target[];
  draft: TargetDraft;
  editingId: string | null;
  activeRun: boolean;
  busy: boolean;
  testing: string | null;
  setDraft: (value: TargetDraft) => void;
  onSave: (event: React.FormEvent) => void;
  onEdit: (target: Target) => void;
  onCancel: () => void;
  onTest: (id: string) => void;
  onToggle: (target: Target) => void;
  onRemove: (target: Target) => void;
}) {
  const draftManifest = getStoreManifest(draft.storeId);
  const draftSizes: StoreManifest["variants"]["sizes"] = draftManifest?.variants.sizes ?? { kind: "freeform" };
  return (
    <div className="page-stack">
      <section className="page-intro">
        <div>
          <p className="eyebrow">TARGET PRESETS / READ-ONLY</p>
          <h2>Product targets</h2>
          <p>
            General targets are saved as future-ready templates. Supreme EU
            targets use the direct shared monitor and never open product pages
            in browser profiles or take cart and checkout actions.
          </p>
        </div>
        <span>Supreme EU polls every 15 seconds during target-bound runs</span>
      </section>
      <section className="profiles">
        {targets.length === 0 && (
          <div className="empty">
            Create a General template or a monitorable Supreme EU target.
          </div>
        )}
        {targets.map((target) => {
          const monitorable = isMonitorable(target.storeId);
          return <article key={target.id} className="profile-card target-card">
            <div className="profile-title">
              <div>
                <h3>{target.name}</h3>
                <p>
                  {monitorable ? "Supreme EU" : "General template"} · {target.enabled ? "Enabled" : "Disabled"} · {target.currency}{" "}
                  {fromMinor(target.maxRetailMinor)} max · {target.quantity}{" "}
                  item{target.quantity === 1 ? "" : "s"}
                </p>
              </div>
              <span
                className={`state ${!monitorable ? "warn" : target.latestCheck?.status === "ERROR" ? "error" : "ready"}`}
              >
                {monitorable ? target.latestCheck?.decision.kind ?? "UNTESTED" : "TEMPLATE"}
              </span>
            </div>
            <p className="muted">
              Match: {target.productKeywords.join(" · ")}
              {target.negativeKeywords.length
                ? ` · exclude ${target.negativeKeywords.join(" · ")}`
                : ""}
            </p>
            {target.latestCheck && <DetectionSummary check={target.latestCheck} />}
            <div className="actions">
              <button
                disabled={busy || testing !== null || activeRun || !monitorable}
                onClick={() => onTest(target.id)}
              >
                {monitorable ? testing === target.id ? "Testing…" : "Test target" : "Adapter pending"}
              </button>
              <button
                className="secondary"
                disabled={busy || activeRun}
                onClick={() => onEdit(target)}
              >
                Edit
              </button>
              <button
                className="text"
                disabled={busy || activeRun}
                onClick={() => onToggle(target)}
              >
                {target.enabled ? "Disable" : "Enable"}
              </button>
              <button
                className="danger"
                disabled={busy || activeRun}
                onClick={() => onRemove(target)}
              >
                Remove
              </button>
            </div>
          </article>;
        })}
      </section>
      <form className="form-card target-form" onSubmit={onSave}>
        <div className="section-title">
          <div>
            <p className="eyebrow">TARGET SETUP</p>
            <h2>{editingId ? "Edit target" : "Add target"}</h2>
          </div>
          {editingId && (
            <button type="button" className="text" onClick={onCancel}>
              Cancel edit
            </button>
          )}
        </div>
        <Field label="Target preset">
          <select
            value={draft.storeId}
            onChange={(event) => {
              const storeId = event.target.value;
              setDraft({ ...draft, storeId, currency: getStoreManifest(storeId)?.currency ?? draft.currency });
            }}
          >
            {listStoreManifests().map((manifest) => (
              <option key={manifest.id} value={manifest.id}>{manifest.name}</option>
            ))}
          </select>
        </Field>
        {draftManifest && draftManifest.capabilities.monitor === null && (
          <p className="preset-notice">No adapter yet — saved as a template.</p>
        )}
        <Field label="Target name">
          <input
            required
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="e.g. Leather jacket"
          />
        </Field>
        <Field label="Positive keywords">
          <input
            required
            value={draft.productKeywords}
            onChange={(event) =>
              setDraft({ ...draft, productKeywords: event.target.value })
            }
            placeholder="Comma-separated phrases"
          />
        </Field>
        <Field label="Negative keywords">
          <input
            value={draft.negativeKeywords}
            onChange={(event) =>
              setDraft({ ...draft, negativeKeywords: event.target.value })
            }
            placeholder="Optional exclusions"
          />
        </Field>
        <Field label="Color priority">
          <input
            value={draft.preferredColors}
            onChange={(event) =>
              setDraft({ ...draft, preferredColors: event.target.value })
            }
            placeholder="First choice first"
          />
        </Field>
        {draftSizes.kind === "enum" ? (
          <Field label="Size priority">
            <div className="preset-size-picker">
              <div className="preset-size-options">
                {draftSizes.values.map((size) => {
                  const selected = list(draft.sizePriority).includes(size);
                  return <button key={size} className={`preset-size-option ${selected ? "selected" : ""}`} type="button" onClick={() => {
                    const current = list(draft.sizePriority);
                    setDraft({ ...draft, sizePriority: (selected ? current.filter((value) => value !== size) : [...current, size]).join(", ") });
                  }}>{size}</button>;
                })}
              </div>
              <input value={draft.sizePriority} onChange={(event) => setDraft({ ...draft, sizePriority: event.target.value })} placeholder="Choose above, or type an exact storefront size" />
            </div>
          </Field>
        ) : (
          <Field label="Size priority">
            <input value={draft.sizePriority} onChange={(event) => setDraft({ ...draft, sizePriority: event.target.value })} placeholder="First choice first" />
          </Field>
        )}
        <Field label="Currency">
          <select
            value={draft.currency}
            disabled={Boolean(draftManifest)}
            onChange={(event) =>
              setDraft({
                ...draft,
                currency: event.target.value as TargetDraft["currency"],
              })
            }
          >
            <option value="EUR">EUR (€)</option>
            <option value="GBP">GBP (£)</option>
            <option value="USD">USD ($)</option>
          </select>
        </Field>
        <Field label="Maximum retail price">
          <input
            required
            value={draft.maxRetailPrice}
            onChange={(event) =>
              setDraft({ ...draft, maxRetailPrice: event.target.value })
            }
            placeholder="e.g. 180.00"
          />
        </Field>
        <Field label="Quantity">
          <input
            required
            type="number"
            min="1"
            max="10"
            value={draft.quantity}
            onChange={(event) =>
              setDraft({ ...draft, quantity: Number(event.target.value) })
            }
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
          {editingId ? "Save target" : "Add target"}
        </button>
      </form>
    </div>
  );
}

function DetectionSummary({ check }: { check: NonNullable<Target["latestCheck"]> }) {
  const candidate = check.decision.candidate;
  if (!candidate) {
    return <p className={check.status === "ERROR" ? "error-detail" : "muted"}>
      {new Date(check.checkedAt).toLocaleString()} · {check.decision.message}
      {check.errorMessage ? ` · ${check.errorMessage}` : ""}
    </p>;
  }
  const selected = check.decision.selectedVariant;
  const available = candidate.variants.filter((variant) => variant.available);
  const availableSizes = [...new Set(available.map((variant) => variant.size))];
  const imageUrl = candidate.imageUrl?.startsWith("https://") ? candidate.imageUrl : null;
  return <section className={`detected-product${imageUrl ? "" : " no-image"}`} aria-label="Latest product detection">
    {imageUrl && <img className="detected-product-image" src={imageUrl} alt="" />}
    <div className="detected-product-copy">
      <div className="detected-product-header">
        <p className="eyebrow">LATEST DETECTION</p>
        <span className={`state ${check.status === "ERROR" ? "error" : "ready"}`}>{check.decision.kind}</span>
      </div>
      <h4>{candidate.name}</h4>
      <p className={check.status === "ERROR" ? "error-detail" : "muted"}>
        {new Date(check.checkedAt).toLocaleString()} · {check.decision.message}
        {check.errorMessage ? ` · ${check.errorMessage}` : ""}
      </p>
      <div className="detected-product-meta">
        <span>{candidate.priceMinor !== null && candidate.currency ? `${candidate.currency} ${fromMinor(candidate.priceMinor)}` : "Price unavailable"}</span>
        {selected && <span>Selected: {selected.color} · {selected.size}</span>}
        <span>{availableSizes.length ? `Available sizes: ${availableSizes.join(", ")}` : "Availability unavailable"}</span>
        <span>{check.candidateCount} candidate{check.candidateCount === 1 ? "" : "s"} checked</span>
      </div>
      <a href={candidate.url} target="_blank" rel="noreferrer">View product</a>
    </div>
  </section>;
}

function Profiles({
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
            <p className="eyebrow">BROWSER SESSIONS</p>
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
            <p className="eyebrow">OPTIONAL ROUTES</p>
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
              <p className="eyebrow">PROXY SETUP</p>
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

function Shipping({
  profiles,
  shipping,
  draft,
  editingId,
  activeRun,
  busy,
  setDraft,
  onSave,
  onEdit,
  onCancel,
  onToggle,
  onRemove,
  onAssign,
}: {
  profiles: BrowserProfile[];
  shipping: ShippingProfile[];
  draft: ShippingDraft;
  editingId: string | null;
  activeRun: boolean;
  busy: boolean;
  setDraft: (value: ShippingDraft) => void;
  onSave: (event: React.FormEvent) => void;
  onEdit: (profile: ShippingProfile) => void;
  onCancel: () => void;
  onToggle: (profile: ShippingProfile) => void;
  onRemove: (profile: ShippingProfile) => void;
  onAssign: (profileId: string, shippingId: string) => void;
}) {
  return (
    <div className="page-stack">
      <section className="page-intro">
        <div>
          <p className="eyebrow">ENCRYPTED LOCAL DETAILS</p>
          <h2>Shipping profiles</h2>
          <p>
            Copify encrypts saved contact and address details with Windows
            secure storage. Existing details are never displayed again or
            included in run records.
          </p>
        </div>
      </section>
      <section className="profiles">
        {shipping.length === 0 && (
          <div className="empty">
            Create a complete shipping profile to make a browser eligible for
            assisted checkout.
          </div>
        )}
        {shipping.map((item) => (
          <article key={item.id} className="profile-card">
            <div className="profile-title">
              <div>
                <h3>{item.name}</h3>
                <p>
                  {item.enabled ? "Enabled" : "Disabled"} ·{" "}
                  {item.country ?? "No country"} ·{" "}
                  {item.complete
                    ? "Details encrypted and complete"
                    : "Details unavailable"}
                </p>
              </div>
              <span
                className={`state ${item.complete && item.enabled ? "ready" : "warn"}`}
              >
                {item.complete && item.enabled ? "READY" : "INCOMPLETE"}
              </span>
            </div>
            <div className="actions">
              <button
                className="secondary"
                disabled={busy || activeRun}
                onClick={() => onEdit(item)}
              >
                Replace details
              </button>
              <button
                className="text"
                disabled={busy || activeRun}
                onClick={() => onToggle(item)}
              >
                {item.enabled ? "Disable" : "Enable"}
              </button>
              <button
                className="danger"
                disabled={busy || activeRun}
                onClick={() => onRemove(item)}
              >
                Remove
              </button>
            </div>
          </article>
        ))}
      </section>
      <section className="panel">
        <p className="eyebrow">BROWSER ASSIGNMENT</p>
        <h2>Use a shipping profile per browser</h2>
        <div className="profiles">
          {profiles.map((profile) => (
            <div className="profile-card" key={profile.id}>
              <div className="profile-title">
                <div>
                  <h3>{profile.name}</h3>
                  <p>Used only by opt-in assisted runs.</p>
                </div>
                <select
                  disabled={busy || activeRun}
                  value={profile.shippingProfileId ?? ""}
                  onChange={(event) => onAssign(profile.id, event.target.value)}
                >
                  <option value="">No shipping profile — observe only</option>
                  {shipping.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={!item.enabled || !item.complete}
                    >
                      {item.name}
                      {item.complete && item.enabled ? "" : " (unavailable)"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      </section>
      <form className="form-card" onSubmit={onSave}>
        <div className="section-title">
          <div>
            <p className="eyebrow">SHIPPING SETUP</p>
            <h2>
              {editingId
                ? "Replace encrypted shipping details"
                : "Add shipping profile"}
            </h2>
          </div>
          {editingId && (
            <button className="text" type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
        <Field label="Profile name">
          <input
            required
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="e.g. Home delivery"
          />
        </Field>
        <Field label="Full name">
          <input
            required
            value={draft.fullName}
            onChange={(event) =>
              setDraft({ ...draft, fullName: event.target.value })
            }
          />
        </Field>
        <Field label="Email">
          <input
            required
            type="email"
            value={draft.email}
            onChange={(event) =>
              setDraft({ ...draft, email: event.target.value })
            }
          />
        </Field>
        <Field label="Phone">
          <input
            required
            value={draft.phone}
            onChange={(event) =>
              setDraft({ ...draft, phone: event.target.value })
            }
          />
        </Field>
        <Field label="Address line 1">
          <input
            required
            value={draft.address1}
            onChange={(event) =>
              setDraft({ ...draft, address1: event.target.value })
            }
          />
        </Field>
        <Field label="Address line 2">
          <input
            value={draft.address2}
            onChange={(event) =>
              setDraft({ ...draft, address2: event.target.value })
            }
          />
        </Field>
        <Field label="Postal code">
          <input
            required
            value={draft.postalCode}
            onChange={(event) =>
              setDraft({ ...draft, postalCode: event.target.value })
            }
          />
        </Field>
        <Field label="City">
          <input
            required
            value={draft.city}
            onChange={(event) =>
              setDraft({ ...draft, city: event.target.value })
            }
          />
        </Field>
        <Field label="Region">
          <input
            value={draft.region}
            onChange={(event) =>
              setDraft({ ...draft, region: event.target.value })
            }
          />
        </Field>
        <Field label="Country code">
          <input
            required
            maxLength={2}
            value={draft.country}
            onChange={(event) =>
              setDraft({ ...draft, country: event.target.value.toUpperCase() })
            }
            placeholder="PT"
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
          {editingId ? "Replace and save" : "Encrypt and save"}
        </button>
      </form>
    </div>
  );
}

function Network({
  benchmark,
  history,
  probeUrl,
  busy,
  testing,
  setProbeUrl,
  onTest,
  onSave,
}: {
  benchmark?: ProxyBenchmark;
  history: ProxyBenchmark[];
  probeUrl: string;
  busy: boolean;
  testing: boolean;
  setProbeUrl: (value: string) => void;
  onTest: () => void;
  onSave: (event: React.FormEvent) => void;
}) {
  return (
    <div className="page-stack">
      <section className="page-intro">
        <div>
          <p className="eyebrow">NETWORK HEALTH</p>
          <h2>Direct network baseline</h2>
          <p>
            Test the connection used whenever a browser profile has no proxy
            assigned. Tests are manual and do not change any session route.
          </p>
        </div>
        <button disabled={busy || testing} onClick={onTest}>
          {testing ? "Testing…" : "Test direct route"}
        </button>
      </section>
      <section className="panel network-card">
        <Benchmark benchmark={benchmark} />
        <BenchmarkHistory benchmarks={history} />
        <form className="inline-form" onSubmit={onSave}>
          <Field label="HTTPS probe endpoint">
            <input
              value={probeUrl}
              onChange={(event) => setProbeUrl(event.target.value)}
            />
          </Field>
          <button className="secondary" disabled={busy || !probeUrl}>
            Save probe URL
          </button>
        </form>
      </section>
      <section className="panel info-panel">
        <p className="eyebrow">ABOUT ROUTES</p>
        <h2>Direct is always the default</h2>
        <p className="muted">
          A browser uses your normal connection unless you explicitly assign an
          enabled proxy from Profiles. Proxy benchmark history remains on each
          proxy profile so configuration and its health stay together.
        </p>
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <article className="metric">
      <span>{label}</span>
      <b>{value}</b>
      <small>{detail}</small>
    </article>
  );
}
function RunInspector({
  detail,
  onDelete,
}: {
  detail: RunDetail;
  onDelete: () => void;
}) {
  const eventsFor = (item: RunSession) =>
    detail.events.filter((event) => event.runSessionId === item.id);
  const target = detail.run.targetSnapshot;
  return (
    <div className="run-detail">
      <div className="profile-title">
        <div>
          <h3>{detail.run.name}</h3>
          <p>
            {detail.run.status} · {detail.run.diagnosticLevel} ·{" "}
            {detail.run.endedAt
              ? `${Math.max(0, detail.run.endedAt - detail.run.startedAt)} ms`
              : "In progress"}
          </p>
        </div>
        <button
          className="danger"
          onClick={onDelete}
          disabled={
            detail.run.status === "STARTING" ||
            detail.run.status === "RECORDING"
          }
        >
          Delete run
        </button>
      </div>
      {target && (
        <p className="muted">
          Supreme EU target snapshot: {target.name} ·{" "}
          {target.productKeywords.join(" · ")} · {target.currency}{" "}
          {fromMinor(target.maxRetailMinor)} max
        </p>
      )}
      <div className="timeline">
        {detail.sessions.map((item) => (
          <article key={item.id} className="timeline-row">
            <h4>
              {item.browserProfileName}{" "}
              <span className={`state ${item.status.toLowerCase()}`}>
                {item.status}
              </span>
            </h4>
            <Route route={item.route} />
            {item.executionState === "CHECKPOINT" && (
              <p className="muted">Waiting: {item.checkpointReason ?? "manual checkpoint"}</p>
            )}
            <div className="event-strip">
              {eventsFor(item).map((event) => (
                <span
                  key={event.id}
                  title={`${event.type} · +${(Number(event.elapsedNs) / 1_000_000).toFixed(0)} ms`}
                >
                  {event.type.replaceAll("_", " ")}
                </span>
              )) || <span>No events yet.</span>}
            </div>
            {item.finalError && (
              <p className="error-detail">
                {item.finalError.code}: {item.finalError.message}
              </p>
            )}
          </article>
        ))}
      </div>
      {detail.artifacts.length > 0 && (
        <div className="artifact-list">
          <strong>Local artifacts</strong>
          {detail.artifacts.map((artifact) => (
            <span key={artifact.id}>
              {artifact.kind}: {artifact.relativePath}
              {artifact.sensitive ? " · sensitive" : ""}
            </span>
          ))}
        </div>
      )}
      <div className="event-log">
        <strong>Timeline</strong>
        {detail.events.map((event) => (
          <p key={event.id}>
            +{(Number(event.elapsedNs) / 1_000_000).toFixed(0)} ms ·{" "}
            {event.type}
            {Object.keys(event.payload).length
              ? ` · ${JSON.stringify(event.payload)}`
              : ""}
          </p>
        ))}
      </div>
    </div>
  );
}
function LaunchModes({
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
          <p className="eyebrow">CHROME LAUNCH METHOD</p>
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
function Route({ route }: { route: SessionSnapshot["route"] }) {
  const check = route.verification;
  return (
    <p className={`route ${check.status.toLowerCase()}`}>
      {check.status === "PENDING"
        ? "Route awaiting verification"
        : check.publicIp
          ? `${check.status} · ${check.publicIp}${check.country ? ` · ${check.country}` : ""}${check.city ? ` / ${check.city}` : ""}`
          : `${check.status} · ${check.message ?? "No public route confirmed"}`}
    </p>
  );
}
function Benchmark({ benchmark }: { benchmark?: ProxyBenchmark }) {
  if (!benchmark) return <p className="muted">No benchmark yet.</p>;
  return (
    <div className={`benchmark ${benchmark.status.toLowerCase()}`}>
      <span>
        <b>{benchmark.qualityScore}</b> / 100
      </span>
      <span>{benchmark.publicIp ?? "No IP"}</span>
      <span>
        {benchmark.country
          ? `Location: ${benchmark.country}${benchmark.city ? ` / ${benchmark.city}` : ""}`
          : "Location unavailable"}
      </span>
      <span>
        {benchmark.medianLatencyMs === null
          ? "—"
          : `${Math.round(benchmark.medianLatencyMs)} ms median`}
      </span>
      <span>
        {benchmark.jitterMs === null
          ? "—"
          : `${Math.round(benchmark.jitterMs)} ms jitter`}
      </span>
      <span>{Math.round(benchmark.failureRate * 100)}% failures</span>
      <span>{benchmark.ipStable ? "Stable IP" : "Unstable IP"}</span>
      {benchmark.errorMessage && <span>{benchmark.errorMessage}</span>}
    </div>
  );
}
function BenchmarkHistory({ benchmarks }: { benchmarks: ProxyBenchmark[] }) {
  if (benchmarks.length < 2) return null;
  return (
    <div className="history">
      <span>Recent tests</span>
      {benchmarks.slice(1).map((benchmark) => (
        <span key={benchmark.id}>
          {new Date(benchmark.completedAt).toLocaleString()} ·{" "}
          {benchmark.status} · {benchmark.qualityScore}/100
        </span>
      ))}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
