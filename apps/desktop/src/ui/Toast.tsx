import { useEffect, useRef, useState } from "react";

export type Notice = { kind: "error" | "info"; message: string } | null;
type Queued = { id: number; kind: "error" | "info"; message: string };

const LIFETIME_MS = { error: 9000, info: 3500 } as const;
/* Beyond a few, the stack is covering the page it is reporting on. Oldest go
   first, because the newest failure is the one still being acted on. */
const MAX_VISIBLE = 3;

/** Transient, bottom-left. Failures linger; confirmations get out of the way. */
export function Toast({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const [queue, setQueue] = useState<Queued[]>([]);
  const nextId = useRef(0);
  // Held in a ref because the caller passes an inline arrow: as a dependency it
  // would change identity every render and enqueue the same notice twice.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  /* A burst of failures used to overwrite each other in a single slot, so only
     the last one was ever read. Each notice now gets its own row and its own
     timer; the parent's slot is cleared immediately so an identical message
     arriving twice still enqueues twice. */
  useEffect(() => {
    if (!notice) return;
    setQueue((current) => [...current, { id: nextId.current++, ...notice }].slice(-MAX_VISIBLE));
    dismiss.current();
  }, [notice]);

  if (queue.length === 0) return null;

  return (
    <div className="toast-layer" role="status" aria-live="polite">
      {queue.map((entry) => (
        <ToastRow key={entry.id} entry={entry} onExpire={() => setQueue((current) => current.filter((item) => item.id !== entry.id))} />
      ))}
    </div>
  );
}

function ToastRow({ entry, onExpire }: { entry: Queued; onExpire: () => void }) {
  const expire = useRef(onExpire);
  expire.current = onExpire;

  // Keyed on the entry, so the timer is never restarted by an unrelated render.
  useEffect(() => {
    const timer = setTimeout(() => expire.current(), LIFETIME_MS[entry.kind]);
    return () => clearTimeout(timer);
  }, [entry.id, entry.kind]);

  return (
    <div className={`toast ${entry.kind}`}>
      <span>{entry.message}</span>
      <button className="ghost" onClick={() => expire.current()} aria-label="Dismiss">Dismiss</button>
    </div>
  );
}
