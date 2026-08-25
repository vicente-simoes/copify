import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, MoreIcon } from "./icons";

export type MenuEntry =
  | { kind: "item"; label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }
  | { kind: "check"; label: string; checked: boolean; onSelect: () => void; disabled?: boolean }
  | { kind: "header"; label: string }
  | { kind: "separator" };

type Placement = { top: number; left: number; maxHeight: number };

const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 4;
/* Below this there is no point opening on a side: it would show one row and a
   scrollbar, so the other side wins even if it is also tight. */
const MIN_USABLE_HEIGHT = 120;

/* The menu is measured against the viewport rather than its row. A row near an
   edge used to open past it: the list was capped at a share of the window
   instead of the space actually available, so the overflow fell outside the
   screen instead of scrolling, and flipping sides only moved which end was
   lost. The route list grows with the proxy count, so this is reachable with an
   ordinary setup rather than a pathological one. */
export function placeMenu(
  trigger: { top: number; bottom: number; right: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): Placement {
  const below = viewport.height - trigger.bottom - TRIGGER_GAP - VIEWPORT_MARGIN;
  const above = trigger.top - TRIGGER_GAP - VIEWPORT_MARGIN;
  // Prefer opening downwards, and only flip when doing so buys real room.
  const dropDown = menu.height <= below || below >= above || above < MIN_USABLE_HEIGHT;

  /* The floor can exceed the room on both sides in a very short window, so it
     is capped by the window itself: the menu may be cramped, never off-screen. */
  const maxHeight = Math.min(
    Math.max(dropDown ? below : above, MIN_USABLE_HEIGHT),
    viewport.height - VIEWPORT_MARGIN * 2,
  );
  const height = Math.min(menu.height, maxHeight);
  const wanted = dropDown ? trigger.bottom + TRIGGER_GAP : trigger.top - TRIGGER_GAP - height;

  // Right-aligned to the trigger, then pulled back inside the window.
  const left = Math.min(trigger.right - menu.width, viewport.width - menu.width - VIEWPORT_MARGIN);
  return {
    top: Math.max(VIEWPORT_MARGIN, Math.min(wanted, viewport.height - height - VIEWPORT_MARGIN)),
    left: Math.max(VIEWPORT_MARGIN, left),
    maxHeight,
  };
}

/** Overflow menu: everything a row can do that is not its one primary action. */
export function Menu({ entries, label = "More actions" }: { entries: MenuEntry[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The list is portalled out of the wrapper, so it needs its own test or
      // clicking an entry would dismiss the menu before the click landed.
      if (!wrapper.current?.contains(target) && !list.current?.contains(target)) setOpen(false);
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

  const place = useCallback(() => {
    const trigger = wrapper.current?.getBoundingClientRect();
    const menu = list.current;
    if (!trigger || !menu) return;
    setPlacement(placeMenu(
      { top: trigger.top, bottom: trigger.bottom, right: trigger.right },
      { width: menu.offsetWidth, height: menu.scrollHeight },
      { width: window.innerWidth, height: window.innerHeight },
    ));
  }, []);

  useLayoutEffect(() => {
    if (!open) { setPlacement(null); return; }
    place();
    // Capture, so scrolling the workspace under the menu moves it too.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

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

      {open && createPortal(
        <div
          className="menu-list"
          role="menu"
          ref={list}
          // Hidden for the first layout pass only, while it is measured in place.
          style={placement
            ? { top: placement.top, left: placement.left, maxHeight: placement.maxHeight }
            : { top: 0, left: 0, visibility: "hidden" }}
        >
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
        </div>,
        document.body,
      )}
    </div>
  );
}
