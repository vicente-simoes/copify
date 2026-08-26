import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  BrowserProfile,
  CartStatus,
  DiagnosticLevel,
  ProxyBenchmark,
  ProxyProfile,
  ProfileWarmState,
  RunDetail,
  RunSetup,
  SessionSnapshot,
  ShippingProfile,
  Store,
  Target,
} from "@copify/shared";
import { Sidebar, type Workspace } from "./ui/Sidebar";
import { TitleBar } from "./ui/TitleBar";
import { Toast, type Notice } from "./ui/Toast";
import { ConfirmProvider, useConfirm } from "./ui/Confirm";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { ThemeProvider } from "./ui/ThemeProvider";
import { bootTheme } from "./ui/theme";
import "./styles/index.css";

/* Applied before the first render so a light theme never opens on a dark frame. */
const bootedAppearance = bootTheme();

import { blankProxy, blankShipping, blankTarget, fromMinor, list, toMinor, type ProxyDraft, type ShippingDraft, type TargetDraft } from "./types";
import { Run } from "./pages/Run";
import { RunInspector } from "./pages/RunInspector";
import { Targets } from "./pages/Targets";
import { Browsers } from "./pages/Browsers";
import { Shipping } from "./pages/Shipping";
import { Settings } from "./pages/Settings";


function App() {
  const confirm = useConfirm();
  const [workspace, setWorkspace] = useState<Workspace>("run");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem("copify.sidebarCollapsed") === "1",
  );
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [appVersion, setAppVersion] = useState("");
  const [proxies, setProxies] = useState<ProxyProfile[]>([]);
  const [sessions, setSessions] = useState<Record<string, SessionSnapshot>>({});
  const [cartStatuses, setCartStatuses] = useState<Record<string, CartStatus>>({});
  const [warmStates, setWarmStates] = useState<ProfileWarmState[]>([]);
  const [benchmarks, setBenchmarks] = useState<
    Record<string, ProxyBenchmark[]>
  >({});
  const [profileName, setProfileName] = useState("");
  const [proxyDraft, setProxyDraft] = useState<ProxyDraft>(blankProxy());
  const [editingProxyId, setEditingProxyId] = useState<string | null>(null);
  const [proxyDrawerOpen, setProxyDrawerOpen] = useState(false);
  const [probeUrl, setProbeUrl] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunDetail["run"][]>([]);
  const [runSetups, setRunSetups] = useState<RunSetup[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [runName, setRunName] = useState("");
  const [runLevel, setRunLevel] = useState<DiagnosticLevel>("NORMAL");
  const [runMode, setRunMode] = useState<"OBSERVATION" | "ASSISTED_CHECKOUT">(
    "OBSERVATION",
  );
  const [runProfiles, setRunProfiles] = useState<string[]>([]);
  const [runTargetId, setRunTargetId] = useState("");
  const [deepDebugAcknowledged, setDeepDebugAcknowledged] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetDraft, setTargetDraft] = useState<TargetDraft>(blankTarget());
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [targetDrawerOpen, setTargetDrawerOpen] = useState(false);
  const [targetTesting, setTargetTesting] = useState<string | null>(null);
  const [shippingProfiles, setShippingProfiles] = useState<ShippingProfile[]>(
    [],
  );
  const [shippingDraft, setShippingDraft] =
    useState<ShippingDraft>(blankShipping());
  const [editingShippingId, setEditingShippingId] = useState<string | null>(null);
  const [shippingDrawerOpen, setShippingDrawerOpen] = useState(false);
  const reload = async (): Promise<void> => {
    const [
      profileResult,
      proxyResult,
      sessionResult,
      settingResult,
      runResult,
      runSetupResult,
      targetResult,
      shippingResult,
      cartResult,
      storeResult,
      warmingResult,
    ] = await Promise.all([
      window.copify.profiles.list(),
      window.copify.proxies.list(),
      window.copify.sessions.list(),
      window.copify.settings.getNetworkProbe(),
      window.copify.runs.list(),
      window.copify.runSetups.list(),
      window.copify.targets.list(),
      window.copify.shipping.list(),
      window.copify.sessions.carts(),
      window.copify.stores.list(),
      window.copify.warming.list(),
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
    if (storeResult.ok) setStores(storeResult.value);
    if (warmingResult.ok) setWarmStates(warmingResult.value);
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
    if (runSetupResult.ok) setRunSetups(runSetupResult.value);
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
    window.localStorage.setItem("copify.sidebarCollapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);
  useEffect(() => {
    void reload();
    void window.copify.settings.appInfo().then((result) => { if (result.ok) setAppVersion(result.value.version); });
    const offSessions = window.copify.sessions.onChanged((snapshot) =>
      setSessions((current) => ({
        ...current,
        [snapshot.profileId]: snapshot,
      })),
    );
    const offRuns = window.copify.runs.onChanged(() => {
      void reload();
      setSelectedRun((current) => {
        if (!current) return current;
        const id = current.run.id;
        void window.copify.runs.get(id).then((response) => {
          if (response.ok) setSelectedRun((latest) => latest?.run.id === id ? response.value : latest);
        });
        return current;
      });
    });
    const offRunSetups = window.copify.runSetups.onChanged(() => void reload());
    const offCarts = window.copify.sessions.onCartChanged((status) => setCartStatuses((current) => ({ ...current, [status.profileId]: status })));
    const offTargets = window.copify.targets.onChanged(() => void reload());
    const offShipping = window.copify.shipping.onChanged(() => void reload());
    const offWarming = window.copify.warming.onChanged((states) => setWarmStates(states));
    return () => {
      offSessions();
      offRuns();
      offRunSetups();
      offCarts();
      offTargets();
      offShipping();
      offWarming();
    };
  }, []);
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
      coherence: null,
      driver: null,
      updatedAt: 0,
    };
  const latest = (id: string) => benchmarks[id]?.[0];
  const execute = async (
    operation: () => Promise<{ ok: boolean; error?: string }>,
    success?: string,
  ): Promise<boolean> => {
    setBusy(true);
    setNotice(null);
    let completed = false;
    try {
      const response = await operation();
      if (!response.ok)
        setNotice({
          kind: "error",
          message: response.error ?? "Operation failed.",
        });
      else {
        completed = true;
        if (success) setNotice({ kind: "info", message: success });
      }
    } finally {
      setBusy(false);
      await reload();
    }
    return completed;
  };
  const saveProxy = async (event: React.FormEvent) => {
    event.preventDefault();
    const { costPerGbUsd, ...draft } = proxyDraft;
    const input = {
      ...draft,
      expectedCountry: proxyDraft.expectedCountry?.trim() || null,
      costPerGbMicrosUsd: costPerGbUsd.trim() ? Math.round(Number(costPerGbUsd) * 1_000_000) : null,
      username: proxyDraft.username || undefined,
      password: proxyDraft.password || undefined,
    };
    await execute(
      () =>
        editingProxyId
          ? window.copify.proxies.update(editingProxyId, input)
          : window.copify.proxies.create(input),
    );
    setProxyDraft(blankProxy());
    setEditingProxyId(null);
    setProxyDrawerOpen(false);
  };
  const editProxy = (proxy: ProxyProfile) => {
    setWorkspace("settings");
    setEditingProxyId(proxy.id);
    setProxyDrawerOpen(true);
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
      costPerGbUsd: proxy.costPerGbMicrosUsd === null ? "" : (proxy.costPerGbMicrosUsd / 1_000_000).toFixed(2),
      enabled: proxy.enabled,
    });
  };
  const clearCredential = async (
    proxy: ProxyProfile,
    field: "username" | "password",
  ) => {
    if (await confirm({ title: `Clear the saved proxy ${field}?`, body: `"${proxy.name}" will need the ${field} again before it can be used.`, confirmLabel: "Clear", danger: true }))
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
      });
      if (response.ok) {
        setSelectedRun(response.value);
        setRunName("");
      }
      return response;
    });
  };
  const saveRunSetup = async () => {
    await execute(
      () => window.copify.runSetups.create({ name: runName.trim(), diagnosticLevel: runLevel, executionMode: runMode, profileIds: runProfiles, targetId: runTargetId || null }),
      "Run setup saved.",
    );
  };
  const loadRunSetup = (setup: RunSetup) => {
    setRunName(setup.name); setRunLevel(setup.diagnosticLevel); setRunMode(setup.executionMode); setRunProfiles(setup.profileIds); setRunTargetId(setup.targetId ?? "");
    setDeepDebugAcknowledged(false);
    setNotice({ kind: "info", message: `Loaded “${setup.name}”. Review preflight, then start when ready.` });
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
    );
    setShippingDraft(blankShipping());
    setEditingShippingId(null);
    setShippingDrawerOpen(false);
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
      directProductUrl: targetDraft.directProductUrl.trim() || null,
      preferredColors: list(targetDraft.preferredColors),
      sizePriority: list(targetDraft.sizePriority),
      currency: targetDraft.currency,
      maxRetailMinor,
      quantity: 1,
      enabled: targetDraft.enabled,
    };
    const saved = await execute(
      () =>
        editingTargetId
          ? window.copify.targets.update(editingTargetId, input)
          : window.copify.targets.create(input),
    );
    if (!saved) return;
    setTargetDraft(blankTarget());
    setEditingTargetId(null);
    setTargetDrawerOpen(false);
  };
  const editTarget = (target: Target) => {
    setWorkspace("targets");
    setEditingTargetId(target.id);
    setTargetDrawerOpen(true);
    setTargetDraft({
      storeId: target.storeId,
      name: target.name,
      productKeywords: target.productKeywords.join(", "),
      negativeKeywords: target.negativeKeywords.join(", "),
      directProductUrl: target.directProductUrl ?? "",
      preferredColors: target.preferredColors.join(", "),
      sizePriority: target.sizePriority.join(", "),
      currency: target.currency,
      maxRetailPrice: fromMinor(target.maxRetailMinor),
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
      setWorkspace("run");
    } else setNotice({ kind: "error", message: response.error });
  };
  const recordingSince = activeRunId ? runs.find((run) => run.id === activeRunId)?.startedAt ?? null : null;
  const inspecting = workspace === "run" && selectedRun !== null && !activeRunId;
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <TitleBar
        crumb={inspecting ? selectedRun!.run.name : undefined}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        recordingSince={recordingSince}
        readyCount={readyCount}
      />
      <div className="app-body">
      <Sidebar workspace={workspace} collapsed={sidebarCollapsed} onNavigate={setWorkspace} />
      <main className="workspace">
        <div className="workspace-inner page-stack">
        <ErrorBoundary page={workspace} key={workspace}>
        {workspace === "run" && (
          selectedRun && !activeRunId ? (
            <RunInspector
              detail={selectedRun}
              onBack={() => setSelectedRun(null)}
              onDelete={async () => {
                if (await confirm({ title: `Delete "${selectedRun.run.name}"?`, body: "Its traces, screenshots and recordings are removed from this machine.", confirmLabel: "Delete", danger: true }))
                  void execute(async () => {
                    const response = await window.copify.runs.remove(selectedRun.run.id);
                    if (response.ok) setSelectedRun(null);
                    return response;
                  });
              }}
            />
          ) : (
            <Run
              profiles={profiles}
              targets={targets}
              proxies={proxies}
              shipping={shippingProfiles}
              warmStates={warmStates}
              latest={latest}
              getSession={session}
              runs={runs}
              setups={runSetups}
              activeRun={Boolean(activeRunId)}
              selected={selectedRun}
              name={runName}
              level={runLevel}
              mode={runMode}
              selectedProfiles={runProfiles}
              targetId={runTargetId}
              acknowledged={deepDebugAcknowledged}
              busy={busy}
              onName={setRunName}
              onLevel={(value) => { setRunLevel(value); setDeepDebugAcknowledged(false); }}
              onMode={setRunMode}
              onTarget={setRunTargetId}
              onToggle={(id) =>
                setRunProfiles((current) =>
                  current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
                )
              }
              onAck={setDeepDebugAcknowledged}
              onStart={() => void beginRun()}
              onEnd={() =>
                void execute(async () => {
                  const response = await window.copify.runs.end();
                  if (response.ok) setSelectedRun(response.value);
                  return response;
                })
              }
              onResume={(profileId) =>
                void execute(() => window.copify.runs.resume(profileId))
              }
              developmentMode={import.meta.env.DEV}
              onSimulatePaymentHandoff={(profileId, phase) =>
                void execute(
                  () => window.copify.runs.simulatePaymentHandoff({ profileId, phase }),
                  phase === "DETECTED"
                    ? "Development 3DS handoff simulated. No payment was attempted."
                    : "Development 3DS handoff cleared.",
                )
              }
              onShow={(id) => void showRun(id)}
              onSaveSetup={() => void saveRunSetup()}
              onLoadSetup={loadRunSetup}
              onRemoveSetup={async (setup) => {
                if (await confirm({ title: `Remove saved setup "${setup.name}"?`, confirmLabel: "Remove", danger: true })) void execute(() => window.copify.runSetups.remove(setup.id));
              }}
            />
          )
        )}
        {workspace === "browsers" && (
          <Browsers
            profiles={profiles}
            proxies={proxies}
            stores={stores}
            sessions={sessions}
            cartStatuses={cartStatuses}
            warmStates={warmStates}
            activeRun={Boolean(activeRunId)}
            latest={latest}
            profileName={profileName}
            busy={busy}
            setProfileName={setProfileName}
            onCreate={() =>
              void execute(async () => {
                const response = await window.copify.profiles.create({ name: profileName });
                if (response.ok) setProfileName("");
                return response;
              })
            }
            onProfile={(id, action) => void execute(() => action(id))}
            onCheckCoherence={(id) =>
              void execute(
                () => window.copify.sessions.checkCoherence(id),
                "Coherence check completed. The browser has closed; review the route and coherence summary in its row.",
              )
            }
            onCheckAllCoherence={() =>
              void execute(
                () => window.copify.sessions.checkCoherenceAll(),
                "Coherence checks finished. All browsers have closed; review any failed rows.",
              )
            }
            onReorder={(ordered) => {
              // Paint the new order immediately; `execute` reloads from the
              // repository afterwards and corrects the list if the write failed.
              setProfiles(ordered);
              void execute(() => window.copify.profiles.reorder(ordered.map((profile) => profile.id)));
            }}
            onUpdate={(id, input, success) =>
              void execute(() => window.copify.profiles.update(id, input), success)
            }
            onRemoveProfile={async (profile) => {
              if (await confirm({ title: `Remove "${profile.name}"?`, body: "Its Chrome data stays on disk.", confirmLabel: "Remove", danger: true }))
                void execute(() => window.copify.profiles.remove(profile.id));
            }}
            onCheckCart={(id) => void execute(() => window.copify.sessions.checkCart(id))}
            onEmptyCart={async (id) => {
              if (await confirm({ title: "Remove every item from this cart?", confirmLabel: "Empty cart", danger: true }))
                void execute(() => window.copify.sessions.emptyCart(id));
            }}
            onEmptyCarts={async () => {
              if (await confirm({ title: "Empty every enabled browser's cart?", body: "Browsers opened only for this task will close again automatically.", confirmLabel: "Empty carts", danger: true }))
                void execute(() => window.copify.sessions.emptyCarts());
            }}
            onOpenAll={() => void execute(() => window.copify.sessions.openAll())}
            onCloseAll={() => void execute(() => window.copify.sessions.closeAll())}
            onFailure={(message) => setNotice({ kind: "error", message })}
          />
        )}
        {workspace === "settings" && (
          <Settings
            proxies={proxies}
            benchmarks={benchmarks}
            latest={latest}
            draft={proxyDraft}
            editingProxyId={editingProxyId}
            proxyDrawerOpen={proxyDrawerOpen}
            onNewProxy={() => {
              setEditingProxyId(null);
              setProxyDraft(blankProxy());
              setProxyDrawerOpen(true);
            }}
            busy={busy}
            testing={testing}
            probeUrl={probeUrl}
            stores={stores}
            profiles={profiles}
            sessions={sessions}
            appVersion={appVersion}
            setProbeUrl={setProbeUrl}
            onTestRoute={(id) => void testRoute(id)}
            onSaveProbe={(event) => {
              event.preventDefault();
              void execute(
                () => window.copify.settings.updateNetworkProbe({ probeUrl }),
                "Probe endpoint saved.",
              );
            }}
            onEditProxy={editProxy}
            onClearCredential={clearCredential}
            onToggleProxy={(proxy) =>
              void execute(() => window.copify.proxies.update(proxy.id, { enabled: !proxy.enabled }))
            }
            onRemoveProxy={async (proxy) => {
              if (await confirm({ title: `Remove "${proxy.name}"?`, body: "Browsers using it return to the direct connection.", confirmLabel: "Remove", danger: true }))
                void execute(() => window.copify.proxies.remove(proxy.id));
            }}
            setDraft={setProxyDraft}
            onSaveProxy={(event) => void saveProxy(event)}
            onCancelProxy={() => { setEditingProxyId(null); setProxyDraft(blankProxy()); setProxyDrawerOpen(false); }}
            onToggleStore={(id, enabled) =>
              void execute(() => window.copify.stores.update(id, enabled))
            }
            onBrowserDriver={(id, driver) =>
              void execute(() => window.copify.profiles.update(id, { driver }))
            }
          />
        )}
        {workspace === "targets" && (
          <Targets
            targets={targets}
            stores={stores}
            draft={targetDraft}
            editingId={editingTargetId}
            drawerOpen={targetDrawerOpen}
            activeRun={Boolean(activeRunId)}
            busy={busy}
            testing={targetTesting}
            setDraft={setTargetDraft}
            onNew={() => {
              // Default to a store that can actually be watched, not a template.
              const watchable = stores.find((store) => store.enabled && store.capabilities.monitor !== null);
              setEditingTargetId(null);
              setTargetDraft(
                watchable
                  ? { ...blankTarget(), storeId: watchable.id, currency: watchable.currency }
                  : blankTarget(),
              );
              setTargetDrawerOpen(true);
            }}
            onSave={(event) => void saveTarget(event)}
            onEdit={editTarget}
            onCancel={() => {
              setEditingTargetId(null);
              setTargetDraft(blankTarget());
              setTargetDrawerOpen(false);
            }}
            onTest={(id) => void testTarget(id)}
            onToggle={(target) =>
              void execute(() =>
                window.copify.targets.update(target.id, {
                  enabled: !target.enabled,
                }),
              )
            }
            onRemove={async (target) => {
              if (
                await confirm({ title: `Remove "${target.name}"?`, body: "Completed runs keep their snapshots.", confirmLabel: "Remove", danger: true })
              )
                void execute(() => window.copify.targets.remove(target.id));
            }}
          />
        )}
        {workspace === "shipping" && (
          <Shipping
            profiles={profiles}
            shipping={shippingProfiles}
            stores={stores}
            draft={shippingDraft}
            editingId={editingShippingId}
            drawerOpen={shippingDrawerOpen}
            activeRun={Boolean(activeRunId)}
            busy={busy}
            setDraft={setShippingDraft}
            onNew={() => {
              setEditingShippingId(null);
              setShippingDraft(blankShipping());
              setShippingDrawerOpen(true);
            }}
            onSave={(event) => void saveShipping(event)}
            onEdit={(profile) => {
              setEditingShippingId(profile.id);
              setShippingDraft({
                ...blankShipping(),
                name: profile.name,
                country: profile.country ?? "PT",
                enabled: profile.enabled,
              });
              setShippingDrawerOpen(true);
            }}
            onCancel={() => {
              setEditingShippingId(null);
              setShippingDraft(blankShipping());
              setShippingDrawerOpen(false);
            }}
            onToggle={(profile) =>
              void execute(() =>
                window.copify.shipping.update(profile.id, {
                  enabled: !profile.enabled,
                }),
              )
            }
            onRemove={async (profile) => {
              if (
                await confirm({ title: `Remove "${profile.name}"?`, body: "Assigned browsers become observation-only.", confirmLabel: "Remove", danger: true })
              )
                void execute(() => window.copify.shipping.remove(profile.id));
            }}
            onAssign={(profileId, shippingProfileId) =>
              void execute(
                () =>
                  window.copify.profiles.update(profileId, {
                    shippingProfileId: shippingProfileId || null,
                  }),
              )
            }
          />
        )}
        </ErrorBoundary>
        </div>
      </main>
      </div>
      <Toast notice={notice} onDismiss={() => setNotice(null)} />
    </div>
  );
}


createRoot(document.getElementById("root")!).render(
  <ThemeProvider initial={bootedAppearance}>
    <ErrorBoundary page="Copify" scope="app" className="app-error">
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </ErrorBoundary>
  </ThemeProvider>,
);
