import { isMonitorable, type BrowserProfile, type DiagnosticLevel, type RunDetail, type RunSession, type SessionSnapshot, type Target } from "@copify/shared";
import { list, fromMinor } from "../types";
import { Field, Route } from "../ui/primitives";

export function Runs({
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

export function RunInspector({
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
