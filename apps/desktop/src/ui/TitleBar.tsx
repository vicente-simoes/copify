import { useEffect, useState } from "react";
import appIcon from "../../resources/icons/copify-icon-128.png";
import { BackIcon } from "./icons";

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function RecordingClock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="elapsed">{formatElapsed(now - startedAt)}</span>;
}

export function TitleBar({
  section,
  crumb,
  onBack,
  recordingSince,
  readyCount,
  actions,
}: {
  section: string;
  crumb?: string;
  onBack?: () => void;
  recordingSince: number | null;
  readyCount: number;
  actions?: React.ReactNode;
}) {
  return (
    <header className="titlebar">
      <div className="titlebar-inner">
        {onBack ? (
          <button className="titlebar-back" onClick={onBack} aria-label="Back">
            <BackIcon className="nav-icon" />
          </button>
        ) : (
          <img className="titlebar-mark" src={appIcon} alt="" />
        )}
        <span className="titlebar-section">{section}</span>
        {crumb && (
          <>
            <span className="titlebar-crumb">/</span>
            <span className="titlebar-crumb">{crumb}</span>
          </>
        )}

        <span className="titlebar-spacer" />

        <span className="status-chip">
          {recordingSince === null ? (
            <>
              <span className={`status-dot ${readyCount > 0 ? "ready" : ""}`} />
              <b>{readyCount}</b> ready
            </>
          ) : (
            <>
              <span className="status-dot recording" />
              <b>REC</b>
              <RecordingClock startedAt={recordingSince} />
            </>
          )}
        </span>

        {actions && <div className="titlebar-actions">{actions}</div>}
      </div>
    </header>
  );
}
