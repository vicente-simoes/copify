import { useEffect, useState } from "react";
import { type RunAnnotation, type RunDetail, type RunEvent, type RunMetrics, type RunNetworkUsage, type RunSession, type SessionMetrics } from "@copify/shared";
import { fromMinor } from "../types";
import { Route } from "../ui/primitives";
import { BackIcon } from "../ui/icons";

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

export function RunInspector({ detail, onBack, onDelete }: { detail: RunDetail; onBack: () => void; onDelete: () => void }) {
  const [usage, setUsage] = useState<RunNetworkUsage[]>([]);
  const [runMetric, setRunMetric] = useState<RunMetrics | null>(null); const [sessionMetrics, setSessionMetrics] = useState<SessionMetrics[]>([]); const [annotations, setAnnotations] = useState<RunAnnotation[]>([]); const [note, setNote] = useState("");
  const refreshAnnotations = () => void window.copify.analytics.annotations(detail.run.id).then((result) => { if (result.ok) setAnnotations(result.value); });
  useEffect(() => { void window.copify.usage.run(detail.run.id).then((result) => { if (result.ok) setUsage(result.value); }); void window.copify.analytics.query({ targetId: detail.run.targetSnapshot?.targetId ?? null, storeId: null, profileId: null, proxyProfileId: null, appVersions: [], range: "ALL" }).then((result) => { if (result.ok) { setRunMetric(result.value.runMetrics.find((metric) => metric.runId === detail.run.id) ?? null); setSessionMetrics(result.value.sessionMetrics.filter((metric) => metric.runId === detail.run.id)); } }); refreshAnnotations(); }, [detail.run.id]);
  const target = detail.run.targetSnapshot;
  const duration = detail.run.endedAt ? detail.run.endedAt - detail.run.startedAt : null;
  const recording = detail.run.status === "STARTING" || detail.run.status === "RECORDING";

  return (
    <div className="page-stack">
      <section className="panel">
        <button className="text inspector-back" onClick={onBack}>
          <BackIcon className="nav-icon" />
          Back to runs
        </button>
        <div className="section-title">
          <div>
            <h2>{detail.run.name}</h2>
            <p className="muted">
              {new Date(detail.run.startedAt).toLocaleString()}
              {duration === null ? " · in progress" : ` · ${formatDuration(duration)}`}
              {" · "}
              {detail.run.executionMode === "CHECKOUT" ? "checkout" : "observe"}
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

      {runMetric && <section className="panel"><div className="section-title"><div><h2>Latency breakdown</h2><p className="muted">Derived from monotonic event timestamps.</p></div></div><div className="rows"><div className="row"><span className="row-name">Monitor to verified detection</span><span className="row-cell mono">{runMetric.monitorToDetectMs === null ? "—" : formatDuration(runMetric.monitorToDetectMs)}</span><span className="row-cell">{runMetric.discoveryWinner ?? "No winner"}</span></div>{sessionMetrics.map((metric) => <div className="row" key={metric.runSessionId}><span className="row-main"><span className="row-name">{metric.browserProfileName}</span><span className="row-meta">{metric.observedOutcome.toLowerCase().replaceAll("_", " ")} · CAPTCHA {metric.captchaStrategy?.replaceAll("_", " ").toLowerCase() ?? "—"} · challenges {metric.captchaChallengeCount} · failovers {metric.captchaFailoverCount} · solve {metric.captchaSolveDurationMs === null ? "—" : formatDuration(metric.captchaSolveDurationMs)} · cost {metric.captchaSolveCostMicrosUsd === null ? "unavailable" : `$${(metric.captchaSolveCostMicrosUsd / 1_000_000).toFixed(4)}`}</span></span><span className="row-cell mono">detect → cart {metric.detectToCartMs === null ? "—" : formatDuration(metric.detectToCartMs)}</span><span className="row-cell mono">cart → checkout {metric.cartToCheckoutMs === null ? "—" : formatDuration(metric.cartToCheckoutMs)}</span></div>)}</div></section>}

      {detail.events.some((event) => event.type.startsWith("DISCOVERY_")) && <section className="panel"><div className="section-title"><h2>Discovery mesh</h2></div><div className="rows">{detail.events.filter((event) => event.type === "DISCOVERY_SOURCE_PROBED" || event.type === "DISCOVERY_SOURCE_UNAVAILABLE" || event.type === "DISCOVERY_MESH_WINNER").map((event) => <div className="row" key={event.id}><span className="row-main"><span className="row-name">{String(event.payload.source ?? "source")}</span><span className="row-meta">{readableEvent(event.type)} · route {String(event.payload.routeId ?? "—")}</span></span><span className="row-cell mono">{event.payload.durationMs === undefined ? "" : formatDuration(Number(event.payload.durationMs))}</span><span className="row-cell mono">{event.payload.responseBytes === undefined ? "" : `${Number(event.payload.responseBytes).toLocaleString()} B`}</span></div>)}</div></section>}

      {usage.length > 0 && <section className="panel">
        <div className="section-title"><div><h2>Network usage</h2><p className="muted">Application-observed bytes; tunnel overhead is excluded.</p></div></div>
        <div className="rows">
          {usage.map((row) => <div className="row" key={row.id}><span className="row-main"><span className="row-name">{row.source.toLowerCase()} · {row.proxyName ?? "Direct"}</span><span className="row-meta">{row.requestCount.toLocaleString()} requests · {row.completeness.toLowerCase()}</span></span><span className="row-cell mono">{((row.receivedBytes + row.sentBytes) / 1_000_000).toFixed(2)} MB</span><span className="row-cell mono">{row.estimatedCostMicrosUsd === null ? "—" : `$${(row.estimatedCostMicrosUsd / 1_000_000).toFixed(4)}`}</span></div>)}
          <div className="row"><span className="row-main"><span className="row-name">Total</span></span><span className="row-cell mono">{(usage.reduce((sum, row) => sum + row.receivedBytes + row.sentBytes, 0) / 1_000_000).toFixed(2)} MB</span><span className="row-cell mono">${(usage.reduce((sum, row) => sum + (row.estimatedCostMicrosUsd ?? 0), 0) / 1_000_000).toFixed(4)}</span></div>
        </div>
      </section>}

      <section className="panel">
        <div className="section-title"><h2>Sessions</h2></div>
        <div className="rows">
          {detail.sessions.map((session) => (
            <div className="row" key={session.id}>
              <div className="row-main">
                <span className="row-name">{session.browserProfileName}</span>
                <Route route={session.route} />
                <span className="row-meta">CAPTCHA {session.captchaStrategy.replaceAll("_", " ").toLowerCase()}{session.captchaProvider ? ` · ${session.captchaProvider.label}` : ""} · types {[...new Set(detail.events.filter((event) => event.runSessionId === session.id && event.type === "CAPTCHA_CHALLENGE_DETECTED").map((event) => String(event.payload.kind ?? "unknown").replaceAll("_", " ").toLowerCase()))].join(", ") || "none"}</span>
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
          {detail.artifacts.some((artifact) => artifact.kind === "SCREENSHOT") && <div className="screenshot-strip">{detail.artifacts.filter((artifact) => artifact.kind === "SCREENSHOT").map((artifact) => <img key={artifact.id} src={window.copify.analytics.artifactPreviewUrl(artifact.id)} alt={`Run screenshot ${artifact.relativePath}`} />)}</div>}
          <div className="rows">
            {detail.artifacts.map((artifact) => (
              <div className="row" key={artifact.id}>
                <div className="row-main">
                  <span className="row-name">{artifact.kind.toLowerCase()}</span>
                  <span className="row-meta mono">{artifact.relativePath}</span>
                </div>
                <div className="row-actions">{artifact.sensitive && <span className="badge">sensitive</span>}<button className="text" onClick={() => void window.copify.analytics.revealArtifact(detail.run.id, artifact.id)}>Reveal</button></div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel"><div className="section-title"><div><h2>Annotations</h2><p className="muted">Manual outcomes never replace observed run states.</p></div></div><div className="actions"><input value={note} maxLength={2000} placeholder="Add a post-run note" onChange={(event) => setNote(event.target.value)} /><button disabled={!note.trim()} onClick={() => void window.copify.analytics.createAnnotation({ runId: detail.run.id, runSessionId: null, kind: "NOTE", text: note, failureCategory: null, manualOutcome: null }).then((result) => { if (result.ok) { setNote(""); refreshAnnotations(); } })}>Add note</button><select defaultValue="" onChange={(event) => { if (!event.target.value) return; void window.copify.analytics.createAnnotation({ runId: detail.run.id, runSessionId: null, kind: "FAILURE_CLASSIFICATION", text: null, failureCategory: event.target.value as any, manualOutcome: null }).then(refreshAnnotations); }}><option value="">Failure category…</option>{["NETWORK_PROXY","STOREFRONT_PROTECTION","PRODUCT_VARIANT","CART","CHECKOUT","CAPTCHA","PAYMENT_HANDOFF","BROWSER_RUNNER","USER_ABORTED","UNKNOWN"].map((value) => <option key={value} value={value}>{value.toLowerCase().replaceAll("_", " ")}</option>)}</select><select defaultValue="" onChange={(event) => { if (!event.target.value) return; void window.copify.analytics.createAnnotation({ runId: detail.run.id, runSessionId: null, kind: "MANUAL_OUTCOME", text: null, failureCategory: null, manualOutcome: event.target.value as "ORDER_CONFIRMED" | "ORDER_NOT_CONFIRMED" | "UNKNOWN" }).then(refreshAnnotations); }}><option value="">Operator outcome…</option><option value="ORDER_CONFIRMED">Order confirmed</option><option value="ORDER_NOT_CONFIRMED">Order not confirmed</option><option value="UNKNOWN">Unknown</option></select></div><div className="rows">{annotations.map((annotation) => <div className="row" key={annotation.id}><span className="row-main"><span className="row-name">{annotation.kind.toLowerCase().replaceAll("_", " ")}</span><span className="row-meta">{annotation.text ?? annotation.failureCategory ?? annotation.manualOutcome}</span></span><button className="text danger" onClick={() => void window.copify.analytics.removeAnnotation(annotation.id).then(refreshAnnotations)}>Remove</button></div>)}</div></section>

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
