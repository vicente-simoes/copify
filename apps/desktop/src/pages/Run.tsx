import { isMonitorable, type BrowserProfile, type DiagnosticLevel, type ProxyBenchmark, type ProxyProfile, type RunDetail, type RunSetup, type SessionSnapshot, type ShippingProfile, type Target } from "@copify/shared";
import { preflight, type PreflightCheck } from "../preflight";
import { Field, Route } from "../ui/primitives";
import { Menu, type MenuEntry } from "../ui/Menu";

type Mode = "OBSERVATION" | "ASSISTED_CHECKOUT";

function CheckRow({ check }: { check: PreflightCheck }) {
  return (
    <li className={`check-row ${check.status}`}>
      <span className="check-mark" aria-hidden="true" />
      <span className="check-label">{check.label}</span>
      <span className="check-detail">{check.detail}</span>
    </li>
  );
}

/** The live board: one row per session, which is what you watch during a drop. */
function LiveBoard({
  detail,
  busy,
  onResume,
  onEnd,
}: {
  detail: RunDetail | null;
  busy: boolean;
  onResume: (profileId: string) => void;
  onEnd: () => void;
}) {
  const sessions = [...(detail?.sessions ?? [])].sort((left, right) => {
    const rank = (state: string) => state === "READY_TO_CONFIRM" ? 0 : state === "CHECKPOINT" ? 1 : state === "FAILED" ? 3 : 2;
    return rank(left.executionState) - rank(right.executionState) || left.startedAt - right.startedAt;
  });
  const checkpointCopy = (reason: string | null) =>
    reason === "CART_NOT_EMPTY"
      ? "Cart is not empty. Copify left it alone — empty it, then recheck."
      : reason === "CART_CONTENT_CHANGED"
        ? "Cart must hold only the detected item before checkout."
        : reason === "CART_STATE_UNKNOWN"
          ? "Cart could not be read safely. Review it, then recheck."
          : "Waiting for you.";

  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <h2>Recording</h2>
          <p className="muted">Ending the run keeps the browsers open.</p>
        </div>
        <button className="danger" disabled={busy} onClick={onEnd}>End run</button>
      </div>

      <div className="rows live-board">
        {sessions.map((session, index) => {
          const waiting = session.executionState === "CHECKPOINT";
          const readyToConfirm = session.executionState === "READY_TO_CONFIRM";
          const cartCheckpoint = /^CART_/.test(session.checkpointReason ?? "");
          return (
            <div key={session.id} className={`row ${waiting || readyToConfirm ? "needs-action" : ""}`}>
              <span className={`state ${session.status.toLowerCase()}`}>{session.executionState}</span>
              <div className="row-main">
                <span className="row-name">{session.browserProfileName}</span>
                {readyToConfirm && index === 0 && <span className="badge">live priority</span>}
                <Route route={session.route} />
                {waiting && <span className="row-meta">{checkpointCopy(session.checkpointReason)}</span>}
                {readyToConfirm && <span className="row-meta">Checkout is filled. Review payment and confirm manually in the browser.</span>}
                {session.finalError && (
                  <span className="error-detail">{session.finalError.code}: {session.finalError.message}</span>
                )}
              </div>
              {waiting && (
                <div className="row-actions">
                  <button className="primary" disabled={busy} onClick={() => onResume(session.browserProfileId)}>
                    {cartCheckpoint ? "Recheck cart" : "Resume"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {sessions.length === 0 && <div className="row"><span className="row-meta">Starting browsers…</span></div>}
      </div>
    </section>
  );
}

export function Run({
  profiles,
  targets,
  proxies,
  shipping,
  latest,
  getSession,
  runs,
  setups,
  activeRun,
  selected,
  name,
  level,
  mode,
  selectedProfiles,
  targetId,
  acknowledged,
  busy,
  onName,
  onLevel,
  onMode,
  onTarget,
  onToggle,
  onAck,
  onStart,
  onEnd,
  onResume,
  onShow,
  onSaveSetup,
  onLoadSetup,
  onRemoveSetup,
}: {
  profiles: BrowserProfile[];
  targets: Target[];
  proxies: ProxyProfile[];
  shipping: ShippingProfile[];
  latest: (id: string) => ProxyBenchmark | undefined;
  getSession: (id: string) => SessionSnapshot;
  runs: RunDetail["run"][];
  setups: RunSetup[];
  activeRun: boolean;
  selected: RunDetail | null;
  name: string;
  level: DiagnosticLevel;
  mode: Mode;
  selectedProfiles: string[];
  targetId: string;
  acknowledged: boolean;
  busy: boolean;
  onName: (value: string) => void;
  onLevel: (value: DiagnosticLevel) => void;
  onMode: (value: Mode) => void;
  onTarget: (value: string) => void;
  onToggle: (id: string) => void;
  onAck: (value: boolean) => void;
  onStart: () => void;
  onEnd: () => void;
  onResume: (profileId: string) => void;
  onShow: (id: string) => void;
  onSaveSetup: () => void;
  onLoadSetup: (setup: RunSetup) => void;
  onRemoveSetup: (setup: RunSetup) => void;
}) {
  if (activeRun) {
    return (
      <div className="page-stack">
        <LiveBoard detail={selected} busy={busy} onResume={onResume} onEnd={onEnd} />
      </div>
    );
  }

  const armable = targets.filter((target) => target.enabled && isMonitorable(target.storeId));
  const target = targets.find((item) => item.id === targetId) ?? null;
  const selectable = profiles.filter((profile) => profile.enabled);

  const status = preflight({
    mode,
    diagnosticLevel: level,
    profiles,
    selectedProfileIds: selectedProfiles,
    session: getSession,
    proxies,
    latestBenchmark: latest,
    shipping,
    target,
  });

  const blocked =
    !status.canStart ||
    busy ||
    (level === "DEEP_DEBUG" && !acknowledged);

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Start a run</h2>
            <p className="muted">
              Copify opens the selected browsers itself so it can record from the first page.
            </p>
          </div>
          <div className="row-actions">
            <button disabled={busy || !name.trim() || selectedProfiles.length === 0} onClick={onSaveSetup}>Save setup</button>
            <button className="primary" disabled={blocked} onClick={onStart}>Start run</button>
          </div>
        </div>

        <ul className="preflight">
          {status.checks.map((check) => <CheckRow key={check.id} check={check} />)}
        </ul>

        <div className="run-form">
          <Field label="Mode">
            <select value={mode} onChange={(event) => onMode(event.target.value as Mode)}>
              <option value="OBSERVATION">Observe</option>
              <option value="ASSISTED_CHECKOUT">Assisted</option>
            </select>
          </Field>
          <Field label="Target">
            <select value={targetId} onChange={(event) => onTarget(event.target.value)}>
              <option value="">None</option>
              {armable.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Capture">
            <select value={level} onChange={(event) => onLevel(event.target.value as DiagnosticLevel)}>
              <option value="NORMAL">Normal</option>
              <option value="DIAGNOSTIC">Diagnostic</option>
              <option value="DEEP_DEBUG">Deep debug</option>
            </select>
          </Field>

          <fieldset className="run-profile-picker">
            <legend>Browsers</legend>
            {selectable.map((profile) => {
              const open = getSession(profile.id).state !== "STOPPED";
              return (
                <label key={profile.id} className="check">
                  <input
                    type="checkbox"
                    checked={selectedProfiles.includes(profile.id)}
                    onChange={() => onToggle(profile.id)}
                  />
                  {profile.name}
                  <span className="dim">{open ? " · open" : profile.proxyProfileId ? " · proxy" : " · direct"}</span>
                </label>
              );
            })}
            {selectable.length === 0 && <p className="muted">No enabled browsers yet.</p>}
          </fieldset>

          <Field label="Run / setup name">
            <input value={name} onChange={(event) => onName(event.target.value)} maxLength={120} placeholder="e.g. Air Max 95 drop" />
          </Field>

          {level === "DEEP_DEBUG" && (
            <label className="check warning">
              <input type="checkbox" checked={acknowledged} onChange={(event) => onAck(event.target.checked)} />
              Deep debug captures HAR, video and traces. They stay local.
            </label>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Saved setups</h2>
            <p className="muted">Load a prepared target, capture mode, and browser selection before a drop.</p>
          </div>
        </div>
        {setups.length === 0 ? (
          <div className="empty">Save the current run configuration to reuse it later.</div>
        ) : (
          <div className="rows">
            {setups.map((setup) => {
              const setupTarget = targets.find((item) => item.id === setup.targetId);
              const browserNames = setup.profileIds.map((id) => profiles.find((profile) => profile.id === id)?.name ?? "Missing browser");
              const entries: MenuEntry[] = [{ kind: "item", label: "Remove", danger: true, disabled: busy, onSelect: () => onRemoveSetup(setup) }];
              return (
                <div className="row" key={setup.id}>
                  <div className="row-main">
                    <span className="row-name">{setup.name}</span>
                    <span className="row-meta">{setupTarget?.name ?? (setup.targetId ? "Missing target" : "No target")} · {browserNames.join(", ")}</span>
                  </div>
                  <span className="dim">{setup.executionMode === "ASSISTED_CHECKOUT" ? "Assisted" : "Observe"} · {setup.diagnosticLevel.toLowerCase()}</span>
                  <div className="row-actions">
                    <button className="primary" disabled={busy} onClick={() => onLoadSetup(setup)}>Load</button>
                    <Menu entries={entries} label={`Actions for ${setup.name}`} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>Recent runs</h2>
        </div>
        {runs.length === 0 ? (
          <div className="empty">No runs yet.</div>
        ) : (
          <div className="run-list">
            {runs.map((run) => (
              <button key={run.id} className="run-row" onClick={() => onShow(run.id)}>
                <span>
                  <b>{run.name}</b>
                  <small>{new Date(run.startedAt).toLocaleString()}</small>
                </span>
                <span className={`state ${run.status.toLowerCase()}`}>{run.status}</span>
                <small className="dim">
                  {run.executionMode === "ASSISTED_CHECKOUT" ? "Assisted" : "Observe"} · {run.diagnosticLevel.toLowerCase()}
                </small>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
