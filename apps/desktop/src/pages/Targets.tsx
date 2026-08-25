import { useState } from "react";
import { getStoreManifest, isMonitorable, type StoreManifest, type Store, type Target } from "@copify/shared";
import { list, fromMinor, type TargetDraft } from "../types";
import { Field } from "../ui/primitives";
import { Menu, type MenuEntry } from "../ui/Menu";
import { Drawer } from "../ui/Drawer";
import { StoreMark } from "../ui/StoreMark";
import { FILTER_THRESHOLD, ListFilter, NoMatches, matchesQuery } from "../ui/ListFilter";

const FREEFORM: StoreManifest["variants"]["sizes"] = { kind: "freeform" };

function DetectionSummary({ check }: { check: NonNullable<Target["latestCheck"]> }) {
  const candidate = check.decision.candidate;
  const when = new Date(check.checkedAt).toLocaleString();
  // `errorMessage` is produced by the monitor after removing secrets.  The
  // decision message stays intentionally broad for programmatic callers, but
  // hiding the stored detail in the UI made a storefront challenge impossible
  // to distinguish from a product-matching failure.
  const message = check.status === "ERROR" && check.errorMessage
    ? check.errorMessage
    : check.decision.message;

  if (!candidate) {
    return (
      <p className={check.status === "ERROR" ? "error-detail" : "muted"}>
        {when} · {message === "NO_ADAPTER" ? "No adapter for this store yet." : message}
      </p>
    );
  }

  const selected = check.decision.selectedVariant;
  const available = [...new Set(candidate.variants.filter((variant) => variant.available).map((variant) => variant.size))];
  const imageUrl = candidate.imageUrl?.startsWith("https://") ? candidate.imageUrl : null;

  return (
    <section className={`detected-product${imageUrl ? "" : " no-image"}`} aria-label="Latest detection">
      {imageUrl && <img className="detected-product-image" src={imageUrl} alt="" />}
      <div className="detected-product-copy">
        <div className="detected-product-header">
          <h4>{candidate.name}</h4>
          <span className={`state ${check.status === "ERROR" ? "error" : "ready"}`}>{check.decision.kind}</span>
        </div>
        <p className={check.status === "ERROR" ? "error-detail" : "muted"}>{when} · {message}</p>
        <div className="detected-product-meta">
          <span>
            {candidate.priceMinor !== null && candidate.currency
              ? `${candidate.currency} ${fromMinor(candidate.priceMinor)}`
              : "No price"}
          </span>
          {selected && <span>Picked {selected.color} · {selected.size}</span>}
          <span>{available.length ? available.join(", ") : "No sizes available"}</span>
        </div>
        <a href={candidate.url} target="_blank" rel="noreferrer">Open product</a>
      </div>
    </section>
  );
}

export function Targets({
  targets,
  stores,
  draft,
  editingId,
  drawerOpen,
  activeRun,
  busy,
  testing,
  setDraft,
  onNew,
  onSave,
  onEdit,
  onCancel,
  onTest,
  onToggle,
  onRemove,
}: {
  targets: Target[];
  stores: Store[];
  draft: TargetDraft;
  editingId: string | null;
  drawerOpen: boolean;
  activeRun: boolean;
  busy: boolean;
  testing: string | null;
  setDraft: (value: TargetDraft) => void;
  onNew: () => void;
  onSave: (event: React.FormEvent) => void;
  onEdit: (target: Target) => void;
  onCancel: () => void;
  onTest: (id: string) => void;
  onToggle: (target: Target) => void;
  onRemove: (target: Target) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = targets.filter((target) => matchesQuery(query, target.name, target.storeId, ...target.productKeywords));
  const manifest = getStoreManifest(draft.storeId);
  const sizes = manifest?.variants.sizes ?? FREEFORM;
  const selectableStores = stores.filter((store) => store.enabled);

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Targets</h2>
            <p className="muted">What Copify watches for, and which variants it will accept.</p>
          </div>
          <div className="header-actions">
            <ListFilter value={query} onChange={setQuery} label="targets" hidden={targets.length < FILTER_THRESHOLD} />
            <button className="primary" disabled={busy || activeRun} onClick={onNew}>New target</button>
          </div>
        </div>

        {targets.length === 0 ? (
          <div className="empty">
            No targets yet.
            <button disabled={busy || activeRun} onClick={onNew}>New target</button>
          </div>
        ) : visible.length === 0 ? (
          <NoMatches label="targets" onClear={() => setQuery("")} />
        ) : (
          <div className="rows target-rows">
            {visible.map((target) => {
              const monitorable = isMonitorable(target.storeId);
              const check = target.latestCheck;
              const entries: MenuEntry[] = [
                { kind: "item", label: "Edit", disabled: busy || activeRun, onSelect: () => onEdit(target) },
                { kind: "item", label: target.enabled ? "Disable" : "Enable", disabled: busy || activeRun, onSelect: () => onToggle(target) },
                { kind: "separator" },
                { kind: "item", label: "Remove", danger: true, disabled: busy || activeRun, onSelect: () => onRemove(target) },
              ];

              return (
                <div className="row target-row" key={target.id}>
                  <StoreMark storeId={target.storeId} className="target-store" />

                  <div className="row-main">
                    <span className="row-name">
                      {target.name}
                      {!target.enabled && <span className="badge">off</span>}
                      {!monitorable && <span className="badge">no adapter</span>}
                    </span>
                    <span className="row-meta">
                      {target.productKeywords.join(", ")}
                      {target.negativeKeywords.length ? ` · not ${target.negativeKeywords.join(", ")}` : ""}
                    </span>
                    {check && <DetectionSummary check={check} />}
                  </div>

                  <span className="row-cell mono">{target.currency} {fromMinor(target.maxRetailMinor)}</span>
                  <span className={`state ${!monitorable ? "template" : check?.status === "ERROR" ? "error" : check ? "ready" : "untested"}`}>
                    {!monitorable ? "TEMPLATE" : check?.decision.kind ?? "UNTESTED"}
                  </span>

                  <div className="row-actions">
                    <button
                      disabled={busy || testing !== null || activeRun || !monitorable}
                      onClick={() => onTest(target.id)}
                      title={monitorable ? undefined : "This store has no adapter yet."}
                    >
                      {testing === target.id ? "Testing…" : "Test"}
                    </button>
                    <Menu entries={entries} label={`Actions for ${target.name}`} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Drawer
        open={drawerOpen}
        title={editingId ? "Edit target" : "New target"}
        onClose={onCancel}
        footer={
          <>
            <button className="primary" form="target-form" type="submit" disabled={busy}>
              {editingId ? "Save" : "Add target"}
            </button>
            <button onClick={onCancel}>Cancel</button>
          </>
        }
      >
        <form id="target-form" className="drawer-form" onSubmit={onSave}>
          <Field label="Store">
            <select
              value={draft.storeId}
              onChange={(event) => {
                const storeId = event.target.value;
                setDraft({ ...draft, storeId, currency: getStoreManifest(storeId)?.currency ?? draft.currency });
              }}
            >
              {selectableStores.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </Field>

          {manifest && manifest.capabilities.monitor === null && (
            <p className="preset-notice">Saved as a template. Copify cannot watch this store yet.</p>
          )}

          <Field label="Name">
            <input
              required
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="e.g. Box Logo Hoodie"
            />
          </Field>

          <Field label="Must match">
            <input
              required
              value={draft.productKeywords}
              onChange={(event) => setDraft({ ...draft, productKeywords: event.target.value })}
              placeholder="Comma-separated"
            />
          </Field>

          <Field label="Must not match">
            <input
              value={draft.negativeKeywords}
              onChange={(event) => setDraft({ ...draft, negativeKeywords: event.target.value })}
              placeholder="Optional"
            />
          </Field>

          <Field label="Colors, best first">
            <input
              value={draft.preferredColors}
              onChange={(event) => setDraft({ ...draft, preferredColors: event.target.value })}
              placeholder="Optional"
            />
          </Field>

          {sizes.kind === "enum" ? (
            <Field label="Sizes, best first">
              <div className="preset-size-picker">
                <div className="preset-size-options">
                  {sizes.values.map((size) => {
                    const chosen = list(draft.sizePriority).includes(size);
                    return (
                      <button
                        key={size}
                        type="button"
                        className={`preset-size-option ${chosen ? "selected" : ""}`}
                        onClick={() => {
                          const current = list(draft.sizePriority);
                          const next = chosen ? current.filter((value) => value !== size) : [...current, size];
                          setDraft({ ...draft, sizePriority: next.join(", ") });
                        }}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
                <input
                  value={draft.sizePriority}
                  onChange={(event) => setDraft({ ...draft, sizePriority: event.target.value })}
                  placeholder="Or type an exact storefront size"
                />
              </div>
            </Field>
          ) : (
            <Field label="Sizes, best first">
              <input
                value={draft.sizePriority}
                onChange={(event) => setDraft({ ...draft, sizePriority: event.target.value })}
                placeholder="Optional"
              />
            </Field>
          )}

          <Field label={`Maximum price (${draft.currency})`}>
            <input
              required
              value={draft.maxRetailPrice}
              onChange={(event) => setDraft({ ...draft, maxRetailPrice: event.target.value })}
              placeholder="180.00"
            />
          </Field>
          <p className="field-note">Copify stops rather than buying above this.</p>
        </form>
      </Drawer>
    </div>
  );
}
