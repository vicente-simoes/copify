import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/* The app draws its own frameless chrome and its own palette; a native
   window.confirm ignores both, and ignores the theme entirely. This is the
   in-app replacement.

   The API stays a promise so a call site reads the way the native one did:
   `if (await confirm({ ... })) …`. Nothing else about those handlers changes. */

export type ConfirmRequest = {
  /* States what will happen, in the operator's terms. */
  title: string;
  /* One line of consequence. Omitted when the title already carries it. */
  body?: string;
  /* A verb, not "OK" — the button says what it does. */
  confirmLabel?: string;
  /* Destructive actions read in the app's failure colour, as rows do. */
  danger?: boolean;
};

type Pending = ConfirmRequest & { resolve: (confirmed: boolean) => void };

const ConfirmContext = createContext<((request: ConfirmRequest) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (request: ConfirmRequest) => new Promise<boolean>((resolve) => setPending({ ...request, resolve })),
    [],
  );

  const settle = useCallback((confirmed: boolean) => {
    setPending((current) => { current?.resolve(confirmed); return null; });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog pending={pending} onSettle={settle} />
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ pending, onSettle }: { pending: Pending | null; onSettle: (confirmed: boolean) => void }) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onSettle(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending, onSettle]);

  // Cancel takes focus, not the action: Enter on a dialog the operator did not
  // read should do nothing, and most of these dialogs guard a deletion.
  useEffect(() => { if (pending) cancel.current?.focus(); }, [pending]);

  if (!pending) return null;

  return (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onSettle(false); }}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-label={pending.title}>
        <h2>{pending.title}</h2>
        {pending.body ? <p className="muted">{pending.body}</p> : null}
        <div className="modal-actions">
          <button ref={cancel} onClick={() => onSettle(false)}>Cancel</button>
          <button className={pending.danger ? "danger" : "primary"} onClick={() => onSettle(true)}>
            {pending.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm(): (request: ConfirmRequest) => Promise<boolean> {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm requires ConfirmProvider.");
  return confirm;
}
