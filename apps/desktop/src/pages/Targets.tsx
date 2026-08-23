import { getStoreManifest, isMonitorable, listStoreManifests, type Target, type StoreManifest } from "@copify/shared";
import { list, fromMinor, type TargetDraft } from "../types";
import { Field } from "../ui/primitives";

export function Targets({
  targets,
  draft,
  editingId,
  activeRun,
  busy,
  testing,
  setDraft,
  onSave,
  onEdit,
  onCancel,
  onTest,
  onToggle,
  onRemove,
}: {
  targets: Target[];
  draft: TargetDraft;
  editingId: string | null;
  activeRun: boolean;
  busy: boolean;
  testing: string | null;
  setDraft: (value: TargetDraft) => void;
  onSave: (event: React.FormEvent) => void;
  onEdit: (target: Target) => void;
  onCancel: () => void;
  onTest: (id: string) => void;
  onToggle: (target: Target) => void;
  onRemove: (target: Target) => void;
}) {
  const draftManifest = getStoreManifest(draft.storeId);
  const draftSizes: StoreManifest["variants"]["sizes"] = draftManifest?.variants.sizes ?? { kind: "freeform" };
  return (
    <div className="page-stack">
      <section className="page-intro">
        <div>
          <h2>Product targets</h2>
          <p>
            General targets are saved as future-ready templates. Supreme EU
            targets use the direct shared monitor and never open product pages
            in browser profiles or take cart and checkout actions.
          </p>
        </div>
        <span>Supreme EU polls every 15 seconds during target-bound runs</span>
      </section>
      <section className="profiles">
        {targets.length === 0 && (
          <div className="empty">
            Create a General template or a monitorable Supreme EU target.
          </div>
        )}
        {targets.map((target) => {
          const monitorable = isMonitorable(target.storeId);
          return <article key={target.id} className="profile-card target-card">
            <div className="profile-title">
              <div>
                <h3>{target.name}</h3>
                <p>
                  {monitorable ? "Supreme EU" : "General template"} · {target.enabled ? "Enabled" : "Disabled"} · {target.currency}{" "}
                  {fromMinor(target.maxRetailMinor)} max · {target.quantity}{" "}
                  item{target.quantity === 1 ? "" : "s"}
                </p>
              </div>
              <span
                className={`state ${!monitorable ? "warn" : target.latestCheck?.status === "ERROR" ? "error" : "ready"}`}
              >
                {monitorable ? target.latestCheck?.decision.kind ?? "UNTESTED" : "TEMPLATE"}
              </span>
            </div>
            <p className="muted">
              Match: {target.productKeywords.join(" · ")}
              {target.negativeKeywords.length
                ? ` · exclude ${target.negativeKeywords.join(" · ")}`
                : ""}
            </p>
            {target.latestCheck && <DetectionSummary check={target.latestCheck} />}
            <div className="actions">
              <button
                disabled={busy || testing !== null || activeRun || !monitorable}
                onClick={() => onTest(target.id)}
              >
                {monitorable ? testing === target.id ? "Testing…" : "Test target" : "Adapter pending"}
              </button>
              <button
                className="secondary"
                disabled={busy || activeRun}
                onClick={() => onEdit(target)}
              >
                Edit
              </button>
              <button
                className="text"
                disabled={busy || activeRun}
                onClick={() => onToggle(target)}
              >
                {target.enabled ? "Disable" : "Enable"}
              </button>
              <button
                className="danger"
                disabled={busy || activeRun}
                onClick={() => onRemove(target)}
              >
                Remove
              </button>
            </div>
          </article>;
        })}
      </section>
      <form className="form-card target-form" onSubmit={onSave}>
        <div className="section-title">
          <div>
            <h2>{editingId ? "Edit target" : "Add target"}</h2>
          </div>
          {editingId && (
            <button type="button" className="text" onClick={onCancel}>
              Cancel edit
            </button>
          )}
        </div>
        <Field label="Target preset">
          <select
            value={draft.storeId}
            onChange={(event) => {
              const storeId = event.target.value;
              setDraft({ ...draft, storeId, currency: getStoreManifest(storeId)?.currency ?? draft.currency });
            }}
          >
            {listStoreManifests().map((manifest) => (
              <option key={manifest.id} value={manifest.id}>{manifest.name}</option>
            ))}
          </select>
        </Field>
        {draftManifest && draftManifest.capabilities.monitor === null && (
          <p className="preset-notice">No adapter yet — saved as a template.</p>
        )}
        <Field label="Target name">
          <input
            required
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="e.g. Leather jacket"
          />
        </Field>
        <Field label="Positive keywords">
          <input
            required
            value={draft.productKeywords}
            onChange={(event) =>
              setDraft({ ...draft, productKeywords: event.target.value })
            }
            placeholder="Comma-separated phrases"
          />
        </Field>
        <Field label="Negative keywords">
          <input
            value={draft.negativeKeywords}
            onChange={(event) =>
              setDraft({ ...draft, negativeKeywords: event.target.value })
            }
            placeholder="Optional exclusions"
          />
        </Field>
        <Field label="Color priority">
          <input
            value={draft.preferredColors}
            onChange={(event) =>
              setDraft({ ...draft, preferredColors: event.target.value })
            }
            placeholder="First choice first"
          />
        </Field>
        {draftSizes.kind === "enum" ? (
          <Field label="Size priority">
            <div className="preset-size-picker">
              <div className="preset-size-options">
                {draftSizes.values.map((size) => {
                  const selected = list(draft.sizePriority).includes(size);
                  return <button key={size} className={`preset-size-option ${selected ? "selected" : ""}`} type="button" onClick={() => {
                    const current = list(draft.sizePriority);
                    setDraft({ ...draft, sizePriority: (selected ? current.filter((value) => value !== size) : [...current, size]).join(", ") });
                  }}>{size}</button>;
                })}
              </div>
              <input value={draft.sizePriority} onChange={(event) => setDraft({ ...draft, sizePriority: event.target.value })} placeholder="Choose above, or type an exact storefront size" />
            </div>
          </Field>
        ) : (
          <Field label="Size priority">
            <input value={draft.sizePriority} onChange={(event) => setDraft({ ...draft, sizePriority: event.target.value })} placeholder="First choice first" />
          </Field>
        )}
        <Field label="Currency">
          <select
            value={draft.currency}
            disabled={Boolean(draftManifest)}
            onChange={(event) =>
              setDraft({
                ...draft,
                currency: event.target.value as TargetDraft["currency"],
              })
            }
          >
            <option value="EUR">EUR (€)</option>
            <option value="GBP">GBP (£)</option>
            <option value="USD">USD ($)</option>
          </select>
        </Field>
        <Field label="Maximum retail price">
          <input
            required
            value={draft.maxRetailPrice}
            onChange={(event) =>
              setDraft({ ...draft, maxRetailPrice: event.target.value })
            }
            placeholder="e.g. 180.00"
          />
        </Field>
        <Field label="Quantity">
          <input
            required
            type="number"
            min="1"
            max="10"
            value={draft.quantity}
            onChange={(event) =>
              setDraft({ ...draft, quantity: Number(event.target.value) })
            }
          />
        </Field>
        <label className="check form-check">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              setDraft({ ...draft, enabled: event.target.checked })
            }
          />{" "}
          Enabled
        </label>
        <button disabled={busy} type="submit">
          {editingId ? "Save target" : "Add target"}
        </button>
      </form>
    </div>
  );
}

export function DetectionSummary({ check }: { check: NonNullable<Target["latestCheck"]> }) {
  const candidate = check.decision.candidate;
  if (!candidate) {
    return <p className={check.status === "ERROR" ? "error-detail" : "muted"}>
      {new Date(check.checkedAt).toLocaleString()} · {check.decision.message}
      {check.errorMessage ? ` · ${check.errorMessage}` : ""}
    </p>;
  }
  const selected = check.decision.selectedVariant;
  const available = candidate.variants.filter((variant) => variant.available);
  const availableSizes = [...new Set(available.map((variant) => variant.size))];
  const imageUrl = candidate.imageUrl?.startsWith("https://") ? candidate.imageUrl : null;
  return <section className={`detected-product${imageUrl ? "" : " no-image"}`} aria-label="Latest product detection">
    {imageUrl && <img className="detected-product-image" src={imageUrl} alt="" />}
    <div className="detected-product-copy">
      <div className="detected-product-header">
        <span className={`state ${check.status === "ERROR" ? "error" : "ready"}`}>{check.decision.kind}</span>
      </div>
      <h4>{candidate.name}</h4>
      <p className={check.status === "ERROR" ? "error-detail" : "muted"}>
        {new Date(check.checkedAt).toLocaleString()} · {check.decision.message}
        {check.errorMessage ? ` · ${check.errorMessage}` : ""}
      </p>
      <div className="detected-product-meta">
        <span>{candidate.priceMinor !== null && candidate.currency ? `${candidate.currency} ${fromMinor(candidate.priceMinor)}` : "Price unavailable"}</span>
        {selected && <span>Selected: {selected.color} · {selected.size}</span>}
        <span>{availableSizes.length ? `Available sizes: ${availableSizes.join(", ")}` : "Availability unavailable"}</span>
        <span>{check.candidateCount} candidate{check.candidateCount === 1 ? "" : "s"} checked</span>
      </div>
      <a href={candidate.url} target="_blank" rel="noreferrer">View product</a>
    </div>
  </section>;
}

