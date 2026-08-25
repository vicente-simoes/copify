/* Lists here are flat and unpaged. Below a dozen rows a filter is one more
   control to skip past; above it, scanning stops working. The input therefore
   appears only once a list is long enough to need it, which also keeps the
   common three-profile setup exactly as it was. */

export const FILTER_THRESHOLD = 8;

/** Case-insensitive substring across every field a row shows. */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field?.toLowerCase().includes(needle));
}

export function ListFilter({ value, onChange, label, hidden }: { value: string; onChange: (value: string) => void; label: string; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <input
      className="list-filter"
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={`Filter ${label}`}
      aria-label={`Filter ${label}`}
    />
  );
}

/** Shown in place of the rows when a filter excludes everything. */
export function NoMatches({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className="empty">
      No {label} match this filter.
      <button onClick={onClear}>Clear filter</button>
    </div>
  );
}
