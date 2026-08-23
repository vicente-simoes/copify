import { type ProxyBenchmark, type SessionSnapshot } from "@copify/shared";

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <article className="metric">
      <span>{label}</span>
      <b>{value}</b>
      <small>{detail}</small>
    </article>
  );
}
export function Route({ route }: { route: SessionSnapshot["route"] }) {
  const check = route.verification;
  return (
    <p className={`route ${check.status.toLowerCase()}`}>
      {check.status === "PENDING"
        ? "Route awaiting verification"
        : check.publicIp
          ? `${check.status} · ${check.publicIp}${check.country ? ` · ${check.country}` : ""}${check.city ? ` / ${check.city}` : ""}`
          : `${check.status} · ${check.message ?? "No public route confirmed"}`}
    </p>
  );
}
export function Benchmark({ benchmark }: { benchmark?: ProxyBenchmark }) {
  if (!benchmark) return <p className="muted">No benchmark yet.</p>;
  return (
    <div className={`benchmark ${benchmark.status.toLowerCase()}`}>
      <span>
        <b>{benchmark.qualityScore}</b> / 100
      </span>
      <span>{benchmark.publicIp ?? "No IP"}</span>
      <span>
        {benchmark.country
          ? `Location: ${benchmark.country}${benchmark.city ? ` / ${benchmark.city}` : ""}`
          : "Location unavailable"}
      </span>
      <span>
        {benchmark.medianLatencyMs === null
          ? "—"
          : `${Math.round(benchmark.medianLatencyMs)} ms median`}
      </span>
      <span>
        {benchmark.jitterMs === null
          ? "—"
          : `${Math.round(benchmark.jitterMs)} ms jitter`}
      </span>
      <span>{Math.round(benchmark.failureRate * 100)}% failures</span>
      <span>{benchmark.ipStable ? "Stable IP" : "Unstable IP"}</span>
      {benchmark.errorMessage && <span>{benchmark.errorMessage}</span>}
    </div>
  );
}
