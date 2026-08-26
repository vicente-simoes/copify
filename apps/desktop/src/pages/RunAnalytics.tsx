import { useEffect, useState } from "react";
import type { AnalyticsResult, ReliabilityRow, Target } from "@copify/shared";

const duration = (value: number | null) => value === null ? "—" : value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(2)} s`;
const rate = (value: ReliabilityRow["readyRate"]) => value.rate === null ? "—" : `${Math.round(value.rate * 100)}% · ${value.numerator}/${value.denominator}`;

export function RunAnalytics({ targets, onShow }: { targets: Target[]; onShow: (id: string) => void }) {
  const [targetId, setTargetId] = useState<string | null>(targets[0]?.id ?? null); const [range, setRange] = useState<"LAST_20" | "7_DAYS" | "30_DAYS" | "90_DAYS" | "ALL">("LAST_20"); const [data, setData] = useState<AnalyticsResult | null>(null);
  useEffect(() => { void window.copify.analytics.query({ targetId, storeId: null, profileId: null, proxyProfileId: null, appVersions: [], range }).then((result) => { if (result.ok) setData(result.value); }); }, [targetId, range]);
  const reliability = (title: string, rows: ReliabilityRow[]) => <section className="panel"><div className="section-title"><h2>{title}</h2></div>{rows.length ? <div className="rows">{rows.map((row) => <div className="row" key={row.id}><span className="row-main"><span className="row-name">{row.name}</span><span className="row-meta">{row.attempts} attempts · ready {rate(row.readyRate)} · failed {rate(row.failureRate)}</span></span><span className="row-cell mono">checkpoint {rate(row.checkpointRate)}</span><span className="row-cell mono">p95 {duration(row.p95DetectToCartMs)}</span></div>)}</div> : <div className="empty">Completed runs fill this table.</div>}</section>;
  return <div className="page-stack">
    <section className="panel"><div className="section-title"><div><h2>Historical analytics</h2><p className="muted">Observed states and monotonic timings. Order outcomes are operator-confirmed only.</p></div><div className="actions"><select value={targetId ?? ""} onChange={(event) => setTargetId(event.target.value || null)}><option value="">All targets</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select><select value={range} onChange={(event) => setRange(event.target.value as typeof range)}><option value="LAST_20">Last 20</option><option value="7_DAYS">7 days</option><option value="30_DAYS">30 days</option><option value="90_DAYS">90 days</option><option value="ALL">All history</option></select></div></div>
      <div className="rows">{data?.runs.map((run) => { const metric = data.runMetrics.find((item) => item.runId === run.id); const sessions = data.sessionMetrics.filter((item) => item.runId === run.id); return <button className="run-row" key={run.id} onClick={() => onShow(run.id)}><span><b>{run.name}</b><small>{new Date(run.startedAt).toLocaleString()} · {run.environment.appVersion}</small></span><small className="mono">detect {duration(metric?.monitorToDetectMs ?? null)}</small><small className="dim">{sessions.filter((item) => item.observedOutcome === "READY_TO_CONFIRM").length}/{sessions.length} ready</small></button>; })}</div>
    </section>
    {reliability("Browser reliability", data?.profiles ?? [])}{reliability("Proxy reliability", data?.proxies ?? [])}
  </div>;
}
