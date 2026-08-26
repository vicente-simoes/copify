/* Lists here are flat and unpaged, so the filter is the only way to narrow one.
   It is always present: a control that appears once a list crosses some length
   is a control nobody knows exists until it turns up, and the count it keys on
   is invisible to the operator. A permanent box in a known place beats one that
   comes and goes. */

/** Case-insensitive substring across every field a row shows. */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field?.toLowerCase().includes(needle));
}

export function ListFilter({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
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
