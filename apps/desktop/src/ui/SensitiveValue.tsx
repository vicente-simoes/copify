export function SensitiveValue({ label, value, onCopy }: { label: string; value: string | null | undefined; onCopy: () => void }) {
  return (
    <div className="sensitive-value">
      <span className="sensitive-label">{label}</span>
      <code>{value || "Not configured"}</code>
      <button type="button" disabled={!value} onClick={onCopy}>Copy</button>
    </div>
  );
}
