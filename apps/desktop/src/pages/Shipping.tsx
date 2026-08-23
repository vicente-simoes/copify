import { type BrowserProfile, type ShippingProfile } from "@copify/shared";
import { type ShippingDraft } from "../types";
import { Field } from "../ui/primitives";

export function Shipping({
  profiles,
  shipping,
  draft,
  editingId,
  activeRun,
  busy,
  setDraft,
  onSave,
  onEdit,
  onCancel,
  onToggle,
  onRemove,
  onAssign,
}: {
  profiles: BrowserProfile[];
  shipping: ShippingProfile[];
  draft: ShippingDraft;
  editingId: string | null;
  activeRun: boolean;
  busy: boolean;
  setDraft: (value: ShippingDraft) => void;
  onSave: (event: React.FormEvent) => void;
  onEdit: (profile: ShippingProfile) => void;
  onCancel: () => void;
  onToggle: (profile: ShippingProfile) => void;
  onRemove: (profile: ShippingProfile) => void;
  onAssign: (profileId: string, shippingId: string) => void;
}) {
  return (
    <div className="page-stack">
      <section className="page-intro">
        <div>
          <h2>Shipping profiles</h2>
          <p>
            Copify encrypts saved contact and address details with Windows
            secure storage. Existing details are never displayed again or
            included in run records.
          </p>
        </div>
      </section>
      <section className="profiles">
        {shipping.length === 0 && (
          <div className="empty">
            Create a complete shipping profile to make a browser eligible for
            assisted checkout.
          </div>
        )}
        {shipping.map((item) => (
          <article key={item.id} className="profile-card">
            <div className="profile-title">
              <div>
                <h3>{item.name}</h3>
                <p>
                  {item.enabled ? "Enabled" : "Disabled"} ·{" "}
                  {item.country ?? "No country"} ·{" "}
                  {item.complete
                    ? "Details encrypted and complete"
                    : "Details unavailable"}
                </p>
              </div>
              <span
                className={`state ${item.complete && item.enabled ? "ready" : "warn"}`}
              >
                {item.complete && item.enabled ? "READY" : "INCOMPLETE"}
              </span>
            </div>
            <div className="actions">
              <button
                className="secondary"
                disabled={busy || activeRun}
                onClick={() => onEdit(item)}
              >
                Replace details
              </button>
              <button
                className="text"
                disabled={busy || activeRun}
                onClick={() => onToggle(item)}
              >
                {item.enabled ? "Disable" : "Enable"}
              </button>
              <button
                className="danger"
                disabled={busy || activeRun}
                onClick={() => onRemove(item)}
              >
                Remove
              </button>
            </div>
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>Use a shipping profile per browser</h2>
        <div className="profiles">
          {profiles.map((profile) => (
            <div className="profile-card" key={profile.id}>
              <div className="profile-title">
                <div>
                  <h3>{profile.name}</h3>
                  <p>Used only by opt-in assisted runs.</p>
                </div>
                <select
                  disabled={busy || activeRun}
                  value={profile.shippingProfileId ?? ""}
                  onChange={(event) => onAssign(profile.id, event.target.value)}
                >
                  <option value="">No shipping profile — observe only</option>
                  {shipping.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={!item.enabled || !item.complete}
                    >
                      {item.name}
                      {item.complete && item.enabled ? "" : " (unavailable)"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      </section>
      <form className="form-card" onSubmit={onSave}>
        <div className="section-title">
          <div>
            <h2>
              {editingId
                ? "Replace encrypted shipping details"
                : "Add shipping profile"}
            </h2>
          </div>
          {editingId && (
            <button className="text" type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
        <Field label="Profile name">
          <input
            required
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="e.g. Home delivery"
          />
        </Field>
        <Field label="Full name">
          <input
            required
            value={draft.fullName}
            onChange={(event) =>
              setDraft({ ...draft, fullName: event.target.value })
            }
          />
        </Field>
        <Field label="Email">
          <input
            required
            type="email"
            value={draft.email}
            onChange={(event) =>
              setDraft({ ...draft, email: event.target.value })
            }
          />
        </Field>
        <Field label="Phone">
          <input
            required
            value={draft.phone}
            onChange={(event) =>
              setDraft({ ...draft, phone: event.target.value })
            }
          />
        </Field>
        <Field label="Address line 1">
          <input
            required
            value={draft.address1}
            onChange={(event) =>
              setDraft({ ...draft, address1: event.target.value })
            }
          />
        </Field>
        <Field label="Address line 2">
          <input
            value={draft.address2}
            onChange={(event) =>
              setDraft({ ...draft, address2: event.target.value })
            }
          />
        </Field>
        <Field label="Postal code">
          <input
            required
            value={draft.postalCode}
            onChange={(event) =>
              setDraft({ ...draft, postalCode: event.target.value })
            }
          />
        </Field>
        <Field label="City">
          <input
            required
            value={draft.city}
            onChange={(event) =>
              setDraft({ ...draft, city: event.target.value })
            }
          />
        </Field>
        <Field label="Region">
          <input
            value={draft.region}
            onChange={(event) =>
              setDraft({ ...draft, region: event.target.value })
            }
          />
        </Field>
        <Field label="Country code">
          <input
            required
            maxLength={2}
            value={draft.country}
            onChange={(event) =>
              setDraft({ ...draft, country: event.target.value.toUpperCase() })
            }
            placeholder="PT"
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
          {editingId ? "Replace and save" : "Encrypt and save"}
        </button>
      </form>
    </div>
  );
}

