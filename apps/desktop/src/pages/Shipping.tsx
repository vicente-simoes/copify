import { useEffect, useState } from "react";
import { getStoreShippingDestinations, type BrowserProfile, type SecretCopyField, type ShippingProfile, type ShippingSecretReveal, type Store } from "@copify/shared";
import { type ShippingDraft } from "../types";
import { Field } from "../ui/primitives";
import { Menu, type MenuEntry } from "../ui/Menu";
import { Drawer } from "../ui/Drawer";
import { SensitiveValue } from "../ui/SensitiveValue";
import { FILTER_THRESHOLD, ListFilter, NoMatches, matchesQuery } from "../ui/ListFilter";

type AssignmentColumn = { id: string; label: string };

export function Shipping({
  profiles,
  shipping,
  stores,
  draft,
  editingId,
  drawerOpen,
  activeRun,
  busy,
  setDraft,
  onNew,
  onSave,
  onEdit,
  onCancel,
  onToggle,
  onRemove,
  onAssign,
}: {
  profiles: BrowserProfile[];
  shipping: ShippingProfile[];
  stores: Store[];
  draft: ShippingDraft;
  editingId: string | null;
  drawerOpen: boolean;
  activeRun: boolean;
  busy: boolean;
  setDraft: (value: ShippingDraft) => void;
  onNew: () => void;
  onSave: (event: React.FormEvent) => void;
  onEdit: (profile: ShippingProfile) => void;
  onCancel: () => void;
  onToggle: (profile: ShippingProfile) => void;
  onRemove: (profile: ShippingProfile) => void;
  onAssign: (profileId: string, shippingId: string) => void;
}) {
  const [reveal, setReveal] = useState<ShippingSecretReveal | null>(null);
  const [revealError, setRevealError] = useState("");
  const [query, setQuery] = useState("");
  const visible = shipping.filter((profile) => matchesQuery(query, profile.name, profile.country));
  useEffect(() => {
    if (!reveal) return;
    const close = () => setReveal(null); const timer = window.setTimeout(close, Math.max(0, reveal.expiresAt - Date.now()));
    window.addEventListener("blur", close); document.addEventListener("visibilitychange", close);
    return () => { window.clearTimeout(timer); window.removeEventListener("blur", close); document.removeEventListener("visibilitychange", close); };
  }, [reveal]);
  const viewShipping = async (profile: ShippingProfile) => {
    setRevealError(""); const response = await window.copify.shipping.reveal(profile.id);
    if (!response.ok) setRevealError(response.error); else if (response.value) setReveal(response.value);
  };
  const copy = async (field: SecretCopyField) => {
    if (!reveal) return; const response = await window.copify.shipping.copyRevealed(reveal.token, field);
    if (!response.ok) setRevealError(response.error);
  };
  // One column today, backed by browser_profiles.shipping_profile_id. Per-store
  // columns need their own persistence, so they are added when a second
  // checkout-capable adapter exists rather than rendered with nowhere to save.
  const checkoutStores = stores.filter((store) => store.enabled && store.capabilities.checkoutAutofill);
  const columns: AssignmentColumn[] = [{ id: "default", label: checkoutStores.length > 1 ? "Default" : "Address" }];
  const destinations = getStoreShippingDestinations(checkoutStores[0]?.id ?? stores.find((store) => store.capabilities.checkoutAutofill)?.id ?? "");
  const selectedDestination = destinations.find((destination) => destination.country === draft.country);
  const regions = selectedDestination?.regions ?? [];

  const usable = shipping.filter((item) => item.enabled && item.complete);

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Addresses</h2>
            <p className="muted">Encrypted by Windows. Viewing requires explicit consent and expires automatically.</p>
          </div>
          <div className="header-actions">
            <ListFilter value={query} onChange={setQuery} label="addresses" hidden={shipping.length < FILTER_THRESHOLD} />
            <button className="primary" disabled={busy || activeRun} onClick={onNew}>New address</button>
          </div>
        </div>

        {shipping.length === 0 ? (
          <div className="empty">
            No addresses yet.
            <button disabled={busy || activeRun} onClick={onNew}>New address</button>
          </div>
        ) : visible.length === 0 ? (
          <NoMatches label="addresses" onClear={() => setQuery("")} />
        ) : (
          <div className="rows address-rows">
            <div className="row row-head">
              <span>Name</span>
              <span>Country</span>
              <span>Status</span>
              <span />
            </div>
            {visible.map((item) => {
              const ready = item.enabled && item.complete;
              const entries: MenuEntry[] = [
                { kind: "item", label: "View", disabled: busy || activeRun || !item.detailsConfigured, onSelect: () => { void viewShipping(item); } },
                { kind: "item", label: "Replace details", disabled: busy || activeRun, onSelect: () => onEdit(item) },
                { kind: "item", label: item.enabled ? "Disable" : "Enable", disabled: busy || activeRun, onSelect: () => onToggle(item) },
                { kind: "separator" },
                { kind: "item", label: "Remove", danger: true, disabled: busy || activeRun, onSelect: () => onRemove(item) },
              ];
              return (
                <div className="row address-row" key={item.id}>
                  <span className="row-name">{item.name}</span>
                  <span className="row-cell mono">{item.country ?? "—"}</span>
                  <span className={`state ${ready ? "ready" : "warn"}`}>
                    {!item.complete ? "INCOMPLETE" : item.enabled ? "READY" : "OFF"}
                  </span>
                  <div className="row-actions">
                    <Menu entries={entries} label={`Actions for ${item.name}`} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {revealError && !reveal && <p className="error-detail" role="alert">{revealError}</p>}
      </section>

      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Who ships where</h2>
            <p className="muted">Only used by assisted runs. Unassigned browsers observe.</p>
          </div>
        </div>

        {profiles.length === 0 ? (
          <div className="empty">Assignments appear once a browser profile exists.</div>
        ) : (
          <div className="rows assignment-rows">
            <div className="row row-head">
              <span>Browser</span>
              {columns.map((column) => <span key={column.id}>{column.label}</span>)}
            </div>
            {profiles.map((profile) => (
              <div className="row" key={profile.id}>
                <span className="row-name">{profile.name}</span>
                <span>
                  <select
                    aria-label={`Address for ${profile.name}`}
                    disabled={busy || activeRun}
                    value={profile.shippingProfileId ?? ""}
                    onChange={(event) => onAssign(profile.id, event.target.value)}
                  >
                    <option value="">None</option>
                    {shipping.map((item) => (
                      <option key={item.id} value={item.id} disabled={!item.enabled || !item.complete}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
            ))}
          </div>
        )}

        {shipping.length > 0 && usable.length === 0 && (
          <p className="muted assignment-note">No address is both complete and enabled, so no browser can check out.</p>
        )}
      </section>

      <Drawer
        open={drawerOpen}
        title={editingId ? "Replace details" : "New address"}
        onClose={onCancel}
        footer={
          <>
            <button className="primary" form="shipping-form" type="submit" disabled={busy}>Save</button>
            <button onClick={onCancel}>Cancel</button>
          </>
        }
      >
        <form id="shipping-form" className="drawer-form" onSubmit={onSave}>
          {editingId && (
            <p className="preset-notice">Replacing details overwrites the encrypted address. Enter every field in full.</p>
          )}

          <Field label="Name">
            <input
              required
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="e.g. Home"
            />
          </Field>
          <Field label="Full name">
            <input required value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} />
          </Field>
          <Field label="Email">
            <input required type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
          </Field>
          <Field label="Phone">
            <input required value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />
          </Field>
          <Field label="Address">
            <input required value={draft.address1} onChange={(event) => setDraft({ ...draft, address1: event.target.value })} />
          </Field>
          <Field label="Address line 2">
            <input value={draft.address2} onChange={(event) => setDraft({ ...draft, address2: event.target.value })} placeholder="Optional" />
          </Field>
          <Field label="Postal code">
            <input required value={draft.postalCode} onChange={(event) => setDraft({ ...draft, postalCode: event.target.value })} />
          </Field>
          <Field label="City">
            <input required value={draft.city} onChange={(event) => setDraft({ ...draft, city: event.target.value })} />
          </Field>
          <Field label="Country">
            <select
              required
              value={draft.country}
              onChange={(event) => setDraft({ ...draft, country: event.target.value, region: "" })}
            >
              {destinations.map((destination) => <option key={destination.country} value={destination.country}>{destination.label}</option>)}
            </select>
          </Field>
          {regions.length > 0 && (
            <Field label="Region">
              <select required value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })}>
                <option value="" disabled>Select region</option>
                {regions.map((region) => <option key={region} value={region}>{region}</option>)}
              </select>
            </Field>
          )}
        </form>
      </Drawer>

      <Drawer open={Boolean(reveal)} title={reveal ? `${reveal.name} — sensitive details` : "Sensitive details"} onClose={() => { setReveal(null); setRevealError(""); }}>
        {reveal && (
          <div className="sensitive-reveal">
            <p className="preset-notice">Visible for 30 seconds and cleared when this window loses focus. Copied values clear from the clipboard after 60 seconds if unchanged.</p>
            <SensitiveValue label="Full name" value={reveal.details.fullName} onCopy={() => void copy("shipping-full-name")} />
            <SensitiveValue label="Email" value={reveal.details.email} onCopy={() => void copy("shipping-email")} />
            <SensitiveValue label="Phone" value={reveal.details.phone} onCopy={() => void copy("shipping-phone")} />
            <SensitiveValue label="Address" value={reveal.details.address1} onCopy={() => void copy("shipping-address-1")} />
            <SensitiveValue label="Address line 2" value={reveal.details.address2} onCopy={() => void copy("shipping-address-2")} />
            <SensitiveValue label="Postal code" value={reveal.details.postalCode} onCopy={() => void copy("shipping-postal-code")} />
            <SensitiveValue label="City" value={reveal.details.city} onCopy={() => void copy("shipping-city")} />
            <SensitiveValue label="Region" value={reveal.details.region} onCopy={() => void copy("shipping-region")} />
            <SensitiveValue label="Country" value={reveal.details.country} onCopy={() => void copy("shipping-country")} />
            {revealError && <p className="error-detail">{revealError}</p>}
          </div>
        )}
      </Drawer>
    </div>
  );
}
