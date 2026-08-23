import { type RunDetail, type RunEvent, type RunSession } from "@copify/shared";
import { fromMinor } from "../types";
import { Route } from "../ui/primitives";

const ms = (elapsedNs: string) => Number(elapsedNs) / 1_000_000;

function formatDuration(value: number): string {
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`;
}

function readableEvent(type: string): string {
  return type.toLowerCase().replaceAll("_", " ");
}

/** One track per session, ticks positioned by elapsed time — spec 29.1. */
function Gantt({ detail }: { detail: RunDetail }) {
  const total = Math.max(...detail.events.map((event) => ms(event.elapsedNs)), 1);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({ fraction, label: formatDuration(total * fraction) }));

  const tracks: { key: string; label: string; events: RunEvent[]; session?: RunSession }[] = [
    ...detail.sessions.map((session) => ({
      key: session.id,
      label: session.browserProfileName,
      events: detail.events.filter((event) => event.runSessionId === session.id),
      session,
    })),
  ];

  const monitorEvents = detail.events.filter((event) => event.runSessionId === null);
  if (monitorEvents.length) tracks.push({ key: "monitor", label: "Monitor", events: monitorEvents });

  return (
    <div className="gantt">
      <div className="gantt-row gantt-scale">
        <span className="gantt-label" />
        <div className="gantt-track">
          {ticks.map((tick) => (
            <span key={tick.fraction} className="gantt-tick" style={{ left: `${tick.fraction * 100}%` }}>
              {tick.label}
            </span>
          ))}
        </div>
      </div>

      {tracks.map((track) => (
        <div className="gantt-row" key={track.key}>
          <span className="gantt-label">
            {track.label}
            {track.session && (
              <span className={`state ${track.session.status.toLowerCase()}`}>{track.session.executionState}</span>
            )}
          </span>
          <div className="gantt-track">
            <span className="gantt-line" />
            {track.events.map((event) => {
              const at = ms(event.elapsedNs);
              return (
                <span
                  key={event.id}
                  className={`gantt-mark ${/FAIL|ERROR|CHECKPOINT/.test(event.type) ? "alert" : ""}`}
                  style={{ left: `${Math.min(100, (at / total) * 100)}%` }}
                  title={`${readableEvent(event.type)} · +${formatDuration(at)}`}
                />
              );
            })}
            {track.events.length === 0 && <span className="gantt-empty">no events</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RunInspector({ detail, onDelete }: { detail: RunDetail; onDelete: () => void }) {
  const target = detail.run.targetSnapshot;
  const duration = detail.run.endedAt ? detail.run.endedAt - detail.run.startedAt : null;
  const recording = detail.run.status === "STARTING" || detail.run.status === "RECORDING";

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>{detail.run.name}</h2>
            <p className="muted">
              {new Date(detail.run.startedAt).toLocaleString()}
              {duration === null ? " · in progress" : ` · ${formatDuration(duration)}`}
              {" · "}
              {detail.run.executionMode === "ASSISTED_CHECKOUT" ? "assisted" : "observe"}
              {" · "}
              {detail.run.diagnosticLevel.toLowerCase().replace("_", " ")}
            </p>
          </div>
          <div className="actions">
            <span className={`state ${detail.run.status.toLowerCase()}`}>{detail.run.status}</span>
            <button className="danger" onClick={onDelete} disabled={recording}>Delete</button>
          </div>
        </div>

        {target && (
          <p className="muted run-target">
            {target.name} · {target.productKeywords.join(", ")} · max {target.currency} {fromMinor(target.maxRetailMinor)}
          </p>
        )}

        <Gantt detail={detail} />
      </section>

      <section className="panel">
        <div className="section-title"><h2>Sessions</h2></div>
        <div className="rows">
          {detail.sessions.map((session) => (
            <div className="row" key={session.id}>
              <div className="row-main">
                <span className="row-name">{session.browserProfileName}</span>
                <Route route={session.route} />
                {session.checkpointReason && (
                  <span className="row-meta">Waited at {readableEvent(session.checkpointReason)}</span>
                )}
                {session.finalError && (
                  <span className="error-detail">{session.finalError.code}: {session.finalError.message}</span>
                )}
              </div>
              <span className={`state ${session.status.toLowerCase()}`}>{session.status}</span>
            </div>
          ))}
        </div>
      </section>

      {detail.artifacts.length > 0 && (
        <section className="panel">
          <div className="section-title"><h2>Artifacts</h2></div>
          <div className="rows">
            {detail.artifacts.map((artifact) => (
              <div className="row" key={artifact.id}>
                <div className="row-main">
                  <span className="row-name">{artifact.kind.toLowerCase()}</span>
                  <span className="row-meta mono">{artifact.relativePath}</span>
                </div>
                {artifact.sensitive && <span className="badge">sensitive</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      <details className="panel event-log-panel">
        <summary>Event log · {detail.events.length}</summary>
        <div className="event-log">
          {detail.events.map((event) => (
            <p key={event.id}>
              +{formatDuration(ms(event.elapsedNs)).padStart(9)} {event.type}
            </p>
          ))}
        </div>
      </details>
    </div>
  );
}
