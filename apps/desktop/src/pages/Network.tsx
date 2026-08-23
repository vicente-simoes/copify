import { type ProxyBenchmark } from "@copify/shared";
import { Field, Benchmark, BenchmarkHistory } from "../ui/primitives";

export function Network({
  benchmark,
  history,
  probeUrl,
  busy,
  testing,
  setProbeUrl,
  onTest,
  onSave,
}: {
  benchmark?: ProxyBenchmark;
  history: ProxyBenchmark[];
  probeUrl: string;
  busy: boolean;
  testing: boolean;
  setProbeUrl: (value: string) => void;
  onTest: () => void;
  onSave: (event: React.FormEvent) => void;
}) {
  return (
    <div className="page-stack">
      <section className="page-intro">
        <div>
          <h2>Direct network baseline</h2>
          <p>
            Test the connection used whenever a browser profile has no proxy
            assigned. Tests are manual and do not change any session route.
          </p>
        </div>
        <button disabled={busy || testing} onClick={onTest}>
          {testing ? "Testing…" : "Test direct route"}
        </button>
      </section>
      <section className="panel network-card">
        <Benchmark benchmark={benchmark} />
        <BenchmarkHistory benchmarks={history} />
        <form className="inline-form" onSubmit={onSave}>
          <Field label="HTTPS probe endpoint">
            <input
              value={probeUrl}
              onChange={(event) => setProbeUrl(event.target.value)}
            />
          </Field>
          <button className="secondary" disabled={busy || !probeUrl}>
            Save probe URL
          </button>
        </form>
      </section>
      <section className="panel info-panel">
        <h2>Direct is always the default</h2>
        <p className="muted">
          A browser uses your normal connection unless you explicitly assign an
          enabled proxy from Profiles. Proxy benchmark history remains on each
          proxy profile so configuration and its health stay together.
        </p>
      </section>
    </div>
  );
}

