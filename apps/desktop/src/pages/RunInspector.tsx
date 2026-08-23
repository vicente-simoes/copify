import { type RunDetail, type RunSession } from "@copify/shared";
import { fromMinor } from "../types";
import { Route } from "../ui/primitives";

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

