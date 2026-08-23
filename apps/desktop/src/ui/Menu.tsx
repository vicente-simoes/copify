import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckIcon, MoreIcon } from "./icons";

export type MenuEntry =
  | { kind: "item"; label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }
  | { kind: "check"; label: string; checked: boolean; onSelect: () => void; disabled?: boolean }
  | { kind: "header"; label: string }
  | { kind: "separator" };

/** Overflow menu: everything a row can do that is not its one primary action. */
export function Menu({ entries, label = "More actions" }: { entries: MenuEntry[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Rows near the bottom of a scrolling page would otherwise open off-screen.
  useLayoutEffect(() => {
    if (!open || !list.current) return;
    const rect = list.current.getBoundingClientRect();
    setDropUp(rect.bottom > window.innerHeight - 8);
  }, [open]);

  const select = (entry: Extract<MenuEntry, { onSelect: () => void }>) => {
    if (entry.disabled) return;
    setOpen(false);
    entry.onSelect();
  };

  return (
    <div className="menu" ref={wrapper}>
      <button
        className="menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon className="nav-icon" />
      </button>

      {open && (
        <div className={`menu-list ${dropUp ? "drop-up" : ""}`} role="menu" ref={list}>
          {entries.map((entry, index) => {
            if (entry.kind === "separator") return <span key={index} className="menu-separator" role="separator" />;
            if (entry.kind === "header") return <span key={index} className="menu-header">{entry.label}</span>;
            if (entry.kind === "check") {
              return (
                <button
                  key={index}
                  className="menu-item"
                  role="menuitemradio"
                  aria-checked={entry.checked}
                  disabled={entry.disabled}
                  onClick={() => select(entry)}
                >
                  <span className="menu-check">{entry.checked && <CheckIcon className="nav-icon" />}</span>
                  {entry.label}
                </button>
              );
            }
            return (
              <button
                key={index}
                className={`menu-item ${entry.danger ? "danger" : ""}`}
                role="menuitem"
                disabled={entry.disabled}
                onClick={() => select(entry)}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
