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
import { Sidebar, allNavigation, type Workspace } from "./ui/Sidebar";
import { TitleBar } from "./ui/TitleBar";
import "./styles/index.css";

import { blankProxy, blankShipping, blankTarget, fromMinor, list, toMinor, type ProxyDraft, type ShippingDraft, type TargetDraft } from "./types";
import { Overview } from "./pages/Overview";
import { Runs } from "./pages/Runs";
import { Targets } from "./pages/Targets";
import { Profiles, LaunchModes } from "./pages/Profiles";
import { Shipping } from "./pages/Shipping";
import { Network } from "./pages/Network";

type Notice = { kind: "error" | "info"; message: string } | null;

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
  const page = allNavigation.find((item) => item.id === workspace) ?? allNavigation[0];
  const recordingSince = activeRunId ? runs.find((run) => run.id === activeRunId)?.startedAt ?? null : null;
  return (
    <div className="app-shell">
      <TitleBar
        section={page.label}
        recordingSince={recordingSince}
        readyCount={readyCount}
        actions={
          <>
            <button
              className="primary"
              disabled={busy || !profiles.some((profile) => profile.enabled)}
              onClick={() => void execute(() => window.copify.sessions.openAll())}
            >
              Open all
            </button>
            <button
              disabled={busy || activeCount === 0}
              onClick={() => void execute(() => window.copify.sessions.closeAll())}
            >
              Close all
            </button>
          </>
        }
      />
      <Sidebar workspace={workspace} onNavigate={setWorkspace} />
      <main className="workspace">
        <div className="workspace-inner page-stack">
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
        </div>
      </main>
    </div>
  );
}


createRoot(document.getElementById("root")!).render(<App />);
