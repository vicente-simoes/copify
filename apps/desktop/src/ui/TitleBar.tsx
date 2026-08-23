import { useEffect, useState } from "react";
import appIcon from "../../resources/icons/copify-icon-128.png";
import { BackIcon, PanelIcon } from "./icons";

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
  crumb,
  onBack,
  sidebarCollapsed,
  onToggleSidebar,
  recordingSince,
  readyCount,
  actions,
}: {
  crumb?: string;
  onBack?: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  recordingSince: number | null;
  readyCount: number;
  actions?: React.ReactNode;
}) {
  return (
    <header className="titlebar">
      <div className="titlebar-inner">
        {onBack && (
          <button className="titlebar-icon-button" onClick={onBack} aria-label="Back" title="Back">
            <BackIcon className="nav-icon" />
          </button>
        )}

        {/* The brand is inert. Hovering the mark swaps it for the collapse toggle. */}
        <div className="titlebar-brand">
          <span className="brand-icon">
            <img className="titlebar-mark" src={appIcon} alt="" />
            <button
              className="sidebar-toggle"
              onClick={onToggleSidebar}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-pressed={!sidebarCollapsed}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <PanelIcon className="toggle-icon" />
            </button>
          </span>
          <span className="titlebar-wordmark">Copify</span>
        </div>

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
