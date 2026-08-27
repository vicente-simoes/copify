import { useCallback, useEffect, useMemo, useState } from "react";
import { captchaProviderKindSchema, type BudgetCadence, type BudgetStatus, type CostAuthority, type CostBudget, type CostCategory, type CostGroupBy, type CostPeriodPreset, type CostScope, type CostSeriesGranularity, type CostSeriesPoint, type CostSummary, type ProviderImportMapping, type ProviderImportPreview, type ProxyProfile, type ReconciliationStatus } from "@copify/shared";
import { Field, Metric } from "../ui/primitives";
import { useConfirm } from "../ui/Confirm";

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const usd = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(value / 1_000_000);
const bytes = (value: number) => value >= 1_000_000_000 ? `${(value / 1_000_000_000).toFixed(2)} GB` : value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)} MB` : `${(value / 1_000).toFixed(1)} kB`;
/* en-CA is ISO-shaped and resolves in the operator's zone. toISOString resolves
   in UTC, so a date input opened in the evening started a day early. */
const dateInput = (timestamp: number) => new Date(timestamp).toLocaleDateString("en-CA");
const ALL_PROVIDERS = "ALL";

/* Every enum below reaches the operator as a question, not as its wire value.
   The values themselves stay exactly as the schema defines them. */
const PERIODS: { value: CostPeriodPreset; label: string }[] = [
  { value: "TODAY", label: "Today" }, { value: "LAST_24_HOURS", label: "Last 24 hours" }, { value: "ROLLING_7_DAYS", label: "Rolling 7 days" },
  { value: "CALENDAR_MONTH", label: "Calendar month" }, { value: "CUSTOM", label: "Custom range" },
];
const SCOPES: { value: CostScope; label: string }[] = [
  { value: "ALL", label: "All costs" }, { value: "PROXY", label: "Proxy traffic" }, { value: "CAPTCHA", label: "CAPTCHA solving" },
];
const GROUPS: { value: CostGroupBy; label: string; scope?: CostScope }[] = [
  { value: "CATEGORY", label: "Category" }, { value: "PROVIDER", label: "Provider" },
  { value: "PROXY", label: "Proxy route", scope: "PROXY" }, { value: "CAPTCHA_KIND", label: "CAPTCHA type", scope: "CAPTCHA" },
  { value: "STORE", label: "Store" }, { value: "SOURCE", label: "Traffic source" },
  { value: "BROWSER_PROFILE", label: "Browser" }, { value: "RUN", label: "Run" },
];
const CADENCES: { value: BudgetCadence; label: string }[] = [
  { value: "DAILY", label: "Daily" }, { value: "WEEKLY", label: "Weekly" }, { value: "MONTHLY", label: "Monthly" },
];
const AUTHORITY: Record<CostAuthority, string> = {
  COPIFY_ESTIMATED: "Copify estimate", PROVIDER_CONFIRMED: "Provider confirmed",
  MANUAL_CONFIRMED: "Manually confirmed", PROVIDER_REPORTED: "Provider reported", MIXED: "Mixed sources",
};
const COMPLETENESS = { EXACT: "complete", PARTIAL: "partial", UNSUPPORTED: "unavailable" } as const;
const MAPPING_FIELDS: { key: Exclude<keyof ProviderImportMapping, "trafficUnit">; label: string }[] = [
  { key: "timestampColumn", label: "Interval start" }, { key: "endTimestampColumn", label: "Interval end" },
  { key: "trafficColumn", label: "Traffic used" }, { key: "requestCountColumn", label: "Requests" },
  { key: "costColumn", label: "Billed cost" }, { key: "planColumn", label: "Plan name" },
];

const pointLabel = (at: number, granularity: CostSeriesGranularity) => new Intl.DateTimeFormat(undefined, granularity === "HOUR"
  ? { hour: "2-digit", minute: "2-digit", timeZone: timezone }
  : { month: "short", day: "numeric", timeZone: timezone }).format(at);

/* Columns rather than a line: spend arrives in discrete buckets, and a line
   drawn between two of them would imply values that were never sampled. Proxy
   and CAPTCHA stack because the first question is what the period cost and the
   split is the second read. The two series separate by value, not by hue —
   colour on this page stays reserved for budget state. */
function SpendChart({ series, granularity }: { series: CostSeriesPoint[]; granularity: CostSeriesGranularity }) {
  const peak = Math.max(0, ...series.map((point) => (point.proxyCostMicrosUsd ?? 0) + (point.captchaCostMicrosUsd ?? 0)));
  if (!series.length || peak === 0) return <p className="muted spend-empty">No priced activity in this period. Traffic on a route with no configured rate is still counted, but it cannot be priced.</p>;
  // A floor of 1.5% so a real but tiny bucket stays visible; an empty one draws nothing.
  const height = (value: number) => value <= 0 ? "0%" : `${Math.max(1.5, value / peak * 100)}%`;
  return <figure className="spend-chart">
    <div className="spend-plot">
      <span className="spend-peak mono">{usd(peak)}</span>
      {series.map((point) => <div
        className="spend-column"
        key={point.startAt}
        title={`${pointLabel(point.startAt, granularity)} · proxy ${usd(point.proxyCostMicrosUsd)} · CAPTCHA ${usd(point.captchaCostMicrosUsd)} · ${bytes(point.receivedBytes + point.sentBytes)} · ${point.requestCount.toLocaleString()} requests · ${point.captchaSolveCount} solves`}
      >
        <i className={`spend-fill captcha${(point.captchaCostMicrosUsd ?? 0) > 0 ? " cap" : ""}`} style={{ height: height(point.captchaCostMicrosUsd ?? 0) }} />
        <i className={`spend-fill proxy${(point.captchaCostMicrosUsd ?? 0) > 0 ? "" : " cap"}`} style={{ height: height(point.proxyCostMicrosUsd ?? 0) }} />
      </div>)}
    </div>
    <figcaption className="spend-axis">
      <span className="mono">{pointLabel(series[0]!.startAt, granularity)}</span>
      <span className="spend-legend"><span className="proxy">Proxy traffic</span><span className="captcha">CAPTCHA solving</span></span>
      <span className="mono">{pointLabel(series[series.length - 1]!.startAt, granularity)}</span>
    </figcaption>
  </figure>;
}

/* Spend against the limit, with the configured alert thresholds drawn on the
   track, so "80%" is a place on the bar rather than a number in a sentence. */
function Meter({ status }: { status: BudgetStatus }) {
  const warnAt = Math.min(100, ...status.budget.thresholds.filter((value) => value < 100));
  const tone = status.capped || status.percent >= 100 ? "fail" : status.percent >= warnAt ? "warn" : "pass";
  return <span className={`meter ${tone}`} title={`${status.percent.toFixed(1)}% of ${usd(status.budget.limitMicrosUsd)}`}>
    <i className="meter-fill" style={{ width: `${Math.min(status.percent, 100)}%` }} />
    {status.budget.thresholds.filter((value) => value < 100).map((value) => <i className="meter-tick" key={value} style={{ left: `${value}%` }} />)}
  </span>;
}

type BudgetDraft = { category: CostCategory; provider: string; cadence: BudgetCadence; limitUsd: string; startingCreditUsd: string; hardCap: boolean; enabled: boolean };
const blankBudget = (providers: string[]): BudgetDraft => ({ category: "PROXY", provider: providers[0] ?? ALL_PROVIDERS, cadence: "MONTHLY", limitUsd: "10", startingCreditUsd: "", hardCap: false, enabled: true });

export function Costs({ proxies }: { proxies: ProxyProfile[] }) {
  const confirm = useConfirm();
  const proxyProviders = useMemo<string[]>(() => [...new Set(proxies.map((proxy) => String(proxy.provider)))].sort(), [proxies]);
  const captchaProviders = captchaProviderKindSchema.options;
  const filterProviders = useMemo(
    () => scopeProviders(proxyProviders, captchaProviders),
    [proxyProviders, captchaProviders],
  );

  const [preset, setPreset] = useState<CostPeriodPreset>("TODAY");
  const [scope, setScope] = useState<CostScope>("ALL");
  const [groupBy, setGroupBy] = useState<CostGroupBy>("CATEGORY");
  const [provider, setProvider] = useState("");
  const [customStart, setCustomStart] = useState(dateInput(Date.now() - 6 * 86_400_000));
  const [customEnd, setCustomEnd] = useState(dateInput(Date.now()));
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [budgets, setBudgets] = useState<CostBudget[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationStatus | null>(null);
  const [budgetNotice, setBudgetNotice] = useState("");
  const [ledgerNotice, setLedgerNotice] = useState("");
  const [importPreview, setImportPreview] = useState<ProviderImportPreview | null>(null);
  const [manual, setManual] = useState({ provider: proxyProviders[0] ?? "", start: dateInput(Date.now() - 86_400_000), end: dateInput(Date.now()), trafficGb: "", spendUsd: "", creditUsd: "" });
  const [budget, setBudget] = useState<BudgetDraft>(() => blankBudget(proxyProviders));
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const custom = preset === "CUSTOM";
    const result = await window.copify.costs.query({
      period: { preset, startAt: custom ? new Date(`${customStart}T00:00:00`).getTime() : null, endAt: custom ? new Date(`${customEnd}T23:59:59.999`).getTime() : null, timezoneId: timezone },
      scope, groupBy, provider: provider || null,
    });
    if (result.ok) setSummary(result.value); else setLedgerNotice(result.error);
    const saved = await window.copify.costs.budgets();
    if (saved.ok) setBudgets(saved.value);
    const history = await window.copify.costs.reconciliation(scope === "CAPTCHA" ? undefined : provider || undefined);
    if (history.ok) setReconciliation(history.value);
  }, [preset, customStart, customEnd, scope, groupBy, provider]);
  useEffect(() => { void load(); return window.copify.costs.onChanged(() => void load()); }, [load]);

  /* A grouping that can only describe the excluded half renders an empty table,
     so narrowing the scope drops back to the one grouping both halves share. */
  useEffect(() => {
    const chosen = GROUPS.find((entry) => entry.value === groupBy);
    if (chosen?.scope && scope !== "ALL" && scope !== chosen.scope) setGroupBy("CATEGORY");
  }, [scope, groupBy]);
  useEffect(() => { if (provider && !filterProviders.includes(provider)) setProvider(""); }, [filterProviders, provider]);
  useEffect(() => { if (!manual.provider && proxyProviders.length) setManual((current) => ({ ...current, provider: proxyProviders[0]! })); }, [proxyProviders, manual.provider]);

  const saveManual = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await window.copify.costs.manualSnapshot({
      provider: manual.provider, intervalStartAt: new Date(`${manual.start}T00:00:00`).getTime(), intervalEndAt: new Date(`${manual.end}T23:59:59.999`).getTime(),
      usedBytes: manual.trafficGb ? Math.round(Number(manual.trafficGb) * 1_000_000_000) : null, requestCount: null,
      billedCostMicrosUsd: manual.spendUsd ? Math.round(Number(manual.spendUsd) * 1_000_000) : null,
      remainingCreditMicrosUsd: manual.creditUsd ? Math.round(Number(manual.creditUsd) * 1_000_000) : null,
    });
    setLedgerNotice(result.ok ? "Manual provider snapshot saved." : result.error);
    if (result.ok) { setManual({ ...manual, trafficGb: "", spendUsd: "", creditUsd: "" }); void load(); }
  };
  const removeManual = async (id: string) => {
    if (!await confirm({ title: "Remove this manual usage and spend snapshot?", body: "Imported provider records and remaining-credit snapshots are not changed.", confirmLabel: "Remove snapshot", danger: true })) return;
    const result = await window.copify.costs.removeManualSnapshot(id);
    setLedgerNotice(result.ok && result.value ? "Manual usage snapshot removed." : result.ok ? "That manual snapshot was already removed." : result.error);
    if (result.ok) void load();
  };
  const openImport = async () => { const result = await window.copify.costs.importOpen(provider || manual.provider); if (!result.ok) setLedgerNotice(result.error); else if (result.value) setImportPreview(result.value); };
  const setMapping = (key: keyof ProviderImportMapping, value: string | null) => {
    if (!importPreview?.mapping) return;
    void window.copify.costs.importPreview(importPreview.token, { ...importPreview.mapping, [key]: value })
      .then((result) => result.ok ? setImportPreview(result.value) : setLedgerNotice(result.error));
  };
  const commitImport = async () => {
    if (!importPreview?.mapping) return;
    const result = await window.copify.costs.importCommit(importPreview.token, importPreview.mapping);
    setLedgerNotice(result.ok ? (result.value.duplicate ? "This normalized report was already imported." : `Imported ${result.value.rowCount} confirmed rows.`) : result.error);
    if (result.ok) { setImportPreview(null); void load(); }
  };

  const budgetProviders = budget.category === "CAPTCHA" ? captchaProviders : proxyProviders;
  const editBudget = (saved: CostBudget) => {
    setEditing(saved.id);
    setBudget({
      category: saved.category, provider: saved.provider, cadence: saved.cadence,
      limitUsd: String(saved.limitMicrosUsd / 1_000_000),
      startingCreditUsd: saved.startingCreditMicrosUsd === null ? "" : String(saved.startingCreditMicrosUsd / 1_000_000),
      hardCap: saved.hardCap, enabled: saved.enabled,
    });
  };
  const removeBudget = async (saved: CostBudget) => {
    if (!await confirm({ title: `Remove the ${saved.provider} ${saved.cadence.toLowerCase()} budget?`, body: "Recorded spend is unaffected. Alerts and any hard cap stop immediately.", confirmLabel: "Remove budget", danger: true })) return;
    const result = await window.copify.costs.removeBudget(saved.id);
    setBudgetNotice(result.ok ? "Budget removed." : result.error);
    if (result.ok) { if (editing === saved.id) { setEditing(null); setBudget(blankBudget(proxyProviders)); } void load(); }
  };
  const saveBudget = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await window.copify.costs.upsertBudget({
      category: budget.category, provider: budget.provider, cadence: budget.cadence,
      limitMicrosUsd: Math.round(Number(budget.limitUsd) * 1_000_000),
      startingCreditMicrosUsd: budget.category === "PROXY" && budget.startingCreditUsd ? Math.round(Number(budget.startingCreditUsd) * 1_000_000) : null,
      timezoneId: timezone, thresholds: [50, 80, 100], hardCap: budget.category === "PROXY" && budget.hardCap, enabled: budget.enabled,
    });
    setBudgetNotice(result.ok ? "Budget saved." : result.error);
    if (result.ok) { setEditing(null); setBudget(blankBudget(proxyProviders)); void load(); }
  };

  const rowCost = (row: CostSummary["rows"][number]) => row.confirmedCostMicrosUsd ?? row.estimatedCostMicrosUsd ?? 0;
  const rows = useMemo(() => [...(summary?.rows ?? [])].sort((left, right) => rowCost(right) - rowCost(left)), [summary]);
  const peakRow = Math.max(0, ...rows.map(rowCost));
  const groupLabel = GROUPS.find((entry) => entry.value === groupBy)?.label ?? "Group";
  const statusFor = (id: string) => summary?.budgets.find((entry) => entry.budget.id === id);

  return <div className="page-stack">
    <section className="panel">
      <div className="section-title">
        <div>
          <h2>Costs & budgets</h2>
          <p className="muted">Copify estimates and provider-confirmed figures stay separate. {summary ? `${summary.period.label}: ${new Date(summary.period.startAt).toLocaleString()} – ${new Date(summary.period.endAt).toLocaleString()} · ${timezone}` : `Period timezone: ${timezone}.`}</p>
        </div>
        <button onClick={() => void load()}>Refresh</button>
      </div>
      <div className="run-form">
        <Field label="Period"><select value={preset} onChange={(event) => setPreset(event.target.value as CostPeriodPreset)}>{PERIODS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></Field>
        <Field label="Costs shown"><select value={scope} onChange={(event) => setScope(event.target.value as CostScope)}>{SCOPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></Field>
        <Field label="Provider">
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="">All providers</option>
            {scope !== "CAPTCHA" && proxyProviders.length ? <optgroup label="Proxy">{proxyProviders.map((value) => <option key={value} value={value}>{value}</option>)}</optgroup> : null}
            {scope !== "PROXY" ? <optgroup label="CAPTCHA">{captchaProviders.map((value) => <option key={value} value={value}>{value}</option>)}</optgroup> : null}
          </select>
        </Field>
        {preset === "CUSTOM" ? <>
          <Field label="Start"><input type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} /></Field>
          <Field label="End"><input type="date" value={customEnd} min={customStart} onChange={(event) => setCustomEnd(event.target.value)} /></Field>
        </> : null}
      </div>
    </section>

    {summary ? <>
      <section className="panel">
        <div className="section-title"><div><h2>Spend</h2><p className="muted">A confirmed figure replaces the estimate only where a provider report covers the whole period.</p></div></div>
        <div className="stat-grid">
          <Metric label="Total known spend" value={usd(summary.totalKnownCostMicrosUsd)} detail={summary.confirmedAuthority ? `Proxy ${AUTHORITY[summary.confirmedAuthority].toLowerCase()} + reported CAPTCHA` : "Proxy estimate + reported CAPTCHA"} />
          <Metric label="Proxy traffic" value={usd(summary.confirmedCostMicrosUsd ?? summary.estimatedCostMicrosUsd)} detail={summary.estimationCoverage === null ? "No proxied traffic" : `${(summary.estimationCoverage * 100).toFixed(1)}% of bytes priced`} />
          {/* "Unavailable" is for a cost that exists but could not be priced.
              No solves at all is a different fact and reads as an em dash. */}
          <Metric label="CAPTCHA solving" value={summary.captchaSolveCount === 0 ? "—" : usd(summary.captchaCostMicrosUsd)} detail={summary.captchaSolveCount === 0 ? "No solves in this period" : `${summary.captchaSolveCount.toLocaleString()} tokens${summary.unknownCaptchaCostCount ? ` · ${summary.unknownCaptchaCostCount.toLocaleString()} unpriced` : ""}`} />
          <Metric label="Proxy traffic used" value={bytes(summary.receivedBytes + summary.sentBytes)} detail={`${summary.requestCount.toLocaleString()} requests`} />
          <Metric label="Estimate vs confirmed" value={summary.confirmedDifferenceMicrosUsd === null ? "—" : usd(Math.abs(summary.confirmedDifferenceMicrosUsd))} detail={summary.confirmedDifferenceMicrosUsd === null ? "No comparable confirmed range" : summary.confirmedDifferenceMicrosUsd >= 0 ? "Provider billed above the estimate" : "Provider billed below the estimate"} />
          {/* confirmedDataAgeMs ages the confirmed *usage*, not the balance, so
              it cannot caption a credit figure — it read "No provider snapshot"
              directly under a credit that came from one. */}
          <Metric label="Remaining proxy credit" value={usd(summary.remainingCreditMicrosUsd)} detail={summary.remainingCreditMicrosUsd === null ? "No credit snapshot recorded" : "Latest provider or manual snapshot"} />
        </div>
        {summary.confirmedDataAgeMs !== null && summary.confirmedDataAgeMs > 86_400_000 ? <p className="warning">Provider-confirmed proxy data is more than 24 hours old. Proxy budget enforcement may be using Copify estimates.</p> : null}
        {summary.unknownCaptchaCostCount > 0 ? <p className="warning">{summary.unknownCaptchaCostCount.toLocaleString()} acquired CAPTCHA token(s) carried no provider-reported cost. They are excluded from every total and budget above.</p> : null}
        <SpendChart series={summary.series} granularity={summary.seriesGranularity} />
      </section>

      <section className="panel">
        <div className="section-title">
          <div><h2>Breakdown</h2><p className="muted">Highest cost first. Estimated prices proxy traffic; confirmed carries provider reports and CAPTCHA charges.</p></div>
          <label className="select-label">Group by
            <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as CostGroupBy)}>
              {GROUPS.filter((entry) => !entry.scope || scope === "ALL" || scope === entry.scope).map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </label>
        </div>
        {rows.length ? <div className="rows cost-rows">
          <div className="row row-head"><span>{groupLabel}</span><span>Share</span><span>Estimated</span><span>Confirmed</span></div>
          {rows.map((row) => <div className={`row cost-row ${row.category.toLowerCase()}`} key={row.id}>
            <span className="row-main">
              <span className="row-name">{row.label}{scope === "ALL" ? <span className="badge">{row.category}</span> : null}</span>
              <span className="row-meta">
                {row.receivedBytes + row.sentBytes > 0 ? `${bytes(row.receivedBytes + row.sentBytes)} · ${row.requestCount.toLocaleString()} requests · ` : ""}
                {row.captchaSolveCount ? `${row.captchaSolveCount.toLocaleString()} tokens${row.unknownCaptchaCostCount ? ` · ${row.unknownCaptchaCostCount} unpriced` : ""} · ` : ""}
                {COMPLETENESS[row.completeness]}{row.authority ? ` · ${AUTHORITY[row.authority].toLowerCase()}` : ""}
              </span>
            </span>
            <span className="share"><i style={{ width: peakRow ? `${Math.max(1, rowCost(row) / peakRow * 100)}%` : "0%" }} /></span>
            <span className="row-cell mono">{usd(row.estimatedCostMicrosUsd)}</span>
            <span className="row-cell mono">{usd(row.confirmedCostMicrosUsd)}</span>
          </div>)}
        </div> : <div className="empty">No cost-ledger activity in this period.</div>}
      </section>
    </> : <section className="panel"><div className="empty">Reading the cost ledger…</div></section>}

    <section className="panel">
      <div className="section-title"><div><h2>Spend budgets</h2><p className="muted">Proxy and CAPTCHA budgets are tracked independently. CAPTCHA budgets alert only; a proxy hard cap affects new monitor requests, never checkout browsers.</p></div></div>
      {budgets.length ? <div className="rows budget-rows">
        {budgets.map((saved) => {
          const status = statusFor(saved.id);
          return <div className="row budget-row" key={saved.id}>
            <span className="row-main">
              <span className="row-name">{saved.provider === ALL_PROVIDERS ? "All providers" : saved.provider}<span className="badge">{saved.category}</span></span>
              <span className="row-meta">{CADENCES.find((entry) => entry.value === saved.cadence)?.label.toLowerCase()} · limit {usd(saved.limitMicrosUsd)}{status ? ` · ${AUTHORITY[status.authority].toLowerCase()} · resets ${new Date(status.periodEndAt).toLocaleString()}` : " · disabled, not tracking"}{status?.capped ? " · monitor requests stopped" : ""}</span>
            </span>
            {status ? <Meter status={status} /> : <span className="meter disabled" />}
            <span className={`row-cell mono ${status && (status.capped || status.percent >= 100) ? "over-budget" : ""}`}>{status ? `${status.percent.toFixed(1)}%` : "—"}</span>
            <span className="row-cell mono">{status ? usd(status.spentMicrosUsd) : "—"}</span>
            <div className="row-actions">
              <button onClick={() => editBudget(saved)}>Edit</button>
              <button className="danger" onClick={() => void removeBudget(saved)}>Remove</button>
            </div>
          </div>;
        })}
      </div> : <div className="empty">No budget yet. One is enough to be warned before a drop weekend becomes an invoice.</div>}

      <form className="run-form" onSubmit={saveBudget}>
        <Field label="Cost category">
          <select value={budget.category} onChange={(event) => { const category = event.target.value as CostCategory; setBudget({ ...budget, category, provider: (category === "CAPTCHA" ? captchaProviders : proxyProviders)[0] ?? ALL_PROVIDERS, hardCap: false }); }}>
            <option value="PROXY">Proxy traffic</option><option value="CAPTCHA">CAPTCHA solving</option>
          </select>
        </Field>
        <Field label="Provider">
          <select value={budget.provider} onChange={(event) => setBudget({ ...budget, provider: event.target.value })}>
            <option value={ALL_PROVIDERS}>All {budget.category === "CAPTCHA" ? "CAPTCHA" : "proxy"} providers</option>
            {budgetProviders.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="Cadence"><select value={budget.cadence} onChange={(event) => setBudget({ ...budget, cadence: event.target.value as BudgetCadence })}>{CADENCES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></Field>
        <Field label="Limit (USD)"><input required type="number" min="0.000001" step="0.000001" value={budget.limitUsd} onChange={(event) => setBudget({ ...budget, limitUsd: event.target.value })} /></Field>
        {budget.category === "PROXY" ? <Field label="Starting credit (USD, optional)"><input type="number" min="0" step="0.000001" value={budget.startingCreditUsd} onChange={(event) => setBudget({ ...budget, startingCreditUsd: event.target.value })} /></Field> : null}
        <label className="check form-check">
          <input type="checkbox" disabled={budget.category === "CAPTCHA"} checked={budget.category === "PROXY" && budget.hardCap} onChange={(event) => setBudget({ ...budget, hardCap: event.target.checked })} />
          {budget.category === "CAPTCHA" ? "Hard caps are proxy-only — a CAPTCHA budget never stops checkout solving" : "Stop new provider monitor requests at 100%"}
        </label>
        <label className="check form-check"><input type="checkbox" checked={budget.enabled} onChange={(event) => setBudget({ ...budget, enabled: event.target.checked })} /> Enabled</label>
        <div className="actions">
          <button className="primary">{editing ? "Update budget" : "Create budget"}</button>
          {editing ? <button type="button" onClick={() => { setEditing(null); setBudget(blankBudget(proxyProviders)); }}>Cancel edit</button> : null}
        </div>
      </form>
      {budgetNotice ? <p className="field-note">{budgetNotice}</p> : null}
    </section>

    <section className="panel">
      <div className="section-title">
        <div><h2>Provider reconciliation</h2><p className="muted">CSV contents and local paths remain in the main process and are never stored.</p></div>
        <button onClick={() => void openImport()}>Import CSV</button>
      </div>
      {reconciliation?.connectors.length ? <div className="rows">
        {reconciliation.connectors.map((connector) => <div className="row" key={connector.provider}>
          <span className="row-main"><span className="row-name">{connector.provider}</span><span className="row-meta">{connector.unavailableReason ?? "Usage can be read directly from the provider."}</span></span>
          <span className={`state ${connector.available ? "pass" : "untested"}`}>{connector.available ? "Connected" : "Manual only"}</span>
        </div>)}
      </div> : null}

      {importPreview ? <div className="import-preview">
        <div className="section-title"><div>
          <h3>{importPreview.provider} report</h3>
          <p className="muted">{importPreview.totalRows.toLocaleString()} rows · {importPreview.rejectedRows.toLocaleString()} rejected · {importPreview.spendRowCount.toLocaleString()} with billed spend · token expires {new Date(importPreview.expiresAt).toLocaleTimeString()}</p>
        </div></div>
        {importPreview.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
        {importPreview.mapping ? <div className="run-form">
          {MAPPING_FIELDS.map((entry) => <Field key={entry.key} label={entry.label}>
            <select value={importPreview.mapping?.[entry.key] ?? ""} onChange={(event) => setMapping(entry.key, event.target.value || null)}>
              <option value="">Not mapped</option>
              {importPreview.headers.map((header) => <option key={header.id} value={header.label}>{header.label}</option>)}
            </select>
          </Field>)}
          <Field label="Traffic unit"><select value={importPreview.mapping.trafficUnit} onChange={(event) => setMapping("trafficUnit", event.target.value)}>{["BYTES", "KB", "MB", "GB"].map((unit) => <option key={unit}>{unit}</option>)}</select></Field>
        </div> : <p className="warning">Map the report fields explicitly.</p>}
        <div className="actions">
          <button className="primary" disabled={!importPreview.mapping} onClick={() => void commitImport()}>Commit normalized rows</button>
          <button onClick={() => { void window.copify.costs.importCancel(importPreview.token); setImportPreview(null); }}>Cancel</button>
        </div>
      </div> : null}

      <form className="run-form" onSubmit={saveManual}>
        <Field label="Provider"><select value={manual.provider} disabled={!proxyProviders.length} onChange={(event) => setManual({ ...manual, provider: event.target.value })}>{proxyProviders.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>
        <Field label="Range start"><input type="date" value={manual.start} max={manual.end} onChange={(event) => setManual({ ...manual, start: event.target.value })} /></Field>
        <Field label="Range end"><input type="date" value={manual.end} min={manual.start} onChange={(event) => setManual({ ...manual, end: event.target.value })} /></Field>
        <Field label="Used traffic (GB)"><input type="number" min="0" step="0.001" value={manual.trafficGb} onChange={(event) => setManual({ ...manual, trafficGb: event.target.value })} /></Field>
        <Field label="Billed spend (USD)"><input type="number" min="0" step="0.000001" value={manual.spendUsd} onChange={(event) => setManual({ ...manual, spendUsd: event.target.value })} /></Field>
        <Field label="Remaining credit (USD)"><input type="number" min="0" step="0.000001" value={manual.creditUsd} onChange={(event) => setManual({ ...manual, creditUsd: event.target.value })} /></Field>
        <button disabled={!proxyProviders.length || (!manual.trafficGb && !manual.spendUsd && !manual.creditUsd)}>Save manual snapshot</button>
      </form>

      <div className="rows">
        {reconciliation?.usage.filter((entry) => entry.authority === "MANUAL_CONFIRMED").map((entry) => <div className="row" key={entry.id}>
          <span className="row-main">
            <span className="row-name">Manual {entry.provider} snapshot</span>
            <span className="row-meta">{new Date(entry.intervalStartAt).toLocaleDateString()} – {new Date(entry.intervalEndAt).toLocaleDateString()} · {entry.receivedBytes === null ? "traffic unavailable" : bytes(entry.receivedBytes)} · recorded {new Date(entry.recordedAt).toLocaleString()}</span>
          </span>
          <span className="row-cell mono">{usd(entry.billedCostMicrosUsd)}</span>
          <div className="row-actions"><button className="danger" onClick={() => void removeManual(entry.id)}>Remove</button></div>
        </div>)}
        {reconciliation?.imports.map((batch) => <div className="row" key={batch.id}>
          <span className="row-main">
            <span className="row-name">{batch.provider} CSV import</span>
            <span className="row-meta">{batch.rowCount.toLocaleString()} rows{batch.rejectedRowCount ? ` · ${batch.rejectedRowCount.toLocaleString()} rejected` : ""} · {batch.spendRowCount ? `${batch.spendRowCount.toLocaleString()} spend values` : "no spend values"} · imported {new Date(batch.importedAt).toLocaleString()}</span>
          </span>
          <span className="row-cell mono">{usd(batch.billedCostMicrosUsd)}</span>
        </div>)}
        {!reconciliation?.usage.some((entry) => entry.authority === "MANUAL_CONFIRMED") && !reconciliation?.imports.length
          ? <div className="row"><span className="row-meta">Nothing confirmed yet, so every proxy figure above is a Copify estimate.</span></div>
          : null}
      </div>
      {ledgerNotice ? <p className="field-note">{ledgerNotice}</p> : null}
    </section>
  </div>;
}

function scopeProviders(proxyProviders: string[], captchaProviders: readonly string[]): string[] {
  return [...new Set([...proxyProviders, ...captchaProviders])];
}
