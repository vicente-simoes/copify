import { useEffect } from "react";

export type Notice = { kind: "error" | "info"; message: string } | null;

/** Transient, bottom-left. Failures linger; confirmations get out of the way. */
export function Toast({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(onDismiss, notice.kind === "error" ? 9000 : 3500);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);

  if (!notice) return null;

  return (
    <div className="toast-layer" role="status" aria-live="polite">
      <div className={`toast ${notice.kind}`}>
        <span>{notice.message}</span>
        <button className="ghost" onClick={onDismiss} aria-label="Dismiss">Dismiss</button>
      </div>
    </div>
  );
}
