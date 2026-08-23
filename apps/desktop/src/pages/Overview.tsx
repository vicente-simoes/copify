import { isMonitorable, type ProxyBenchmark, type Target } from "@copify/shared";
import { Metric } from "../ui/primitives";
import type { Workspace } from "../ui/Sidebar";

export function Overview({
  activeCount,
  readyCount,
  targets,
  benchmark,
  activeRun,
  navigate,
}: {
  activeCount: number;
  readyCount: number;
  targets: Target[];
  benchmark?: ProxyBenchmark;
  activeRun: boolean;
  navigate: (page: Workspace) => void;
}) {
  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <h2>
            {activeRun
              ? "A run is being recorded"
              : "Everything is ready for a clean run."}
          </h2>
          <p>
            {activeRun
              ? "Browser activity is being captured. Inspect its timeline or end recording from Runs."
              : "Launch browser profiles for manual browsing, then start a run with stopped profiles for a clean capture."}
          </p>
        </div>
        <div className="hero-actions">
          <button onClick={() => navigate("runs")}>
            {activeRun ? "View active run" : "Start a run"}
          </button>
          <button className="secondary" onClick={() => navigate("profiles")}>
            Manage profiles
          </button>
        </div>
      </section>
      <section className="stat-grid">
        <Metric
          label="Ready browsers"
          value={readyCount}
          detail={`${activeCount} currently active`}
        />
        <Metric
          label="Monitorable targets"
          value={targets.filter((target) => target.enabled && isMonitorable(target.storeId)).length}
          detail="Supreme EU read-only"
        />
        <Metric
          label="Direct route"
          value={benchmark ? `${benchmark.qualityScore}/100` : "—"}
          detail={
            benchmark
              ? `${benchmark.status} · latest benchmark`
              : "Not tested yet"
          }
        />
      </section>
      <section className="overview-grid">
        <section className="panel">
          <h2>Use Copify in three places</h2>
          <div className="quick-links">
            <button className="quick-link" onClick={() => navigate("profiles")}>
              <b>1. Profiles</b>
              <span>
                Create persistent Chrome sessions and optionally assign a proxy.
              </span>
            </button>
            <button className="quick-link" onClick={() => navigate("targets")}>
              <b>2. Targets</b>
              <span>Save a General template or configure a Supreme EU match.</span>
            </button>
            <button className="quick-link" onClick={() => navigate("runs")}>
              <b>3. Runs</b>
              <span>
                Record manual browsing and inspect the local timeline.
              </span>
            </button>
          </div>
        </section>
        <section className="panel route-summary">
          <h2>
            {benchmark
              ? `${benchmark.status} · ${benchmark.qualityScore}/100`
              : "No benchmark yet"}
          </h2>
          <p className="muted">
            {benchmark?.publicIp
              ? `${benchmark.publicIp}${benchmark.country ? ` · ${benchmark.country}` : ""}`
              : "Test your direct route before using it as a baseline."}
          </p>
          <button className="secondary" onClick={() => navigate("network")}>
            Open network health
          </button>
        </section>
      </section>
    </div>
  );
}

