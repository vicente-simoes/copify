import { useCallback, useEffect, useState } from "react";
import { CAPTCHA_LAB_FIXTURES, defaultCaptchaSettings, idleCaptchaLabStatus, type BrowserProfile, type CaptchaLabFixture, type CaptchaLabStatus, type CaptchaProviderDiagnostic, type CaptchaProviderKind, type CaptchaSettings, type CaptchaStrategy, type SessionSnapshot } from "@copify/shared";
import { Field } from "../ui/primitives";

const PROVIDERS: { kind: CaptchaProviderKind; label: string; custom: boolean }[] = [
  { kind: "CAPSOLVER", label: "CapSolver", custom: false },
  { kind: "CUSTOM_ASYNC", label: "Custom async", custom: true },
  { kind: "CUSTOM_FAST_TOKEN", label: "Custom fast token", custom: true },
];

/* The diagnostic is the one thing on this page that says whether a drop-day
   solve will work at all, so it reads as a state dot like every other status in
   the app rather than as lowercased prose appended to the row meta. */
const DIAGNOSTIC_TONE: Record<CaptchaProviderDiagnostic["status"], string> = {
  CONNECTED: "pass",
  INSUFFICIENT_CREDIT: "warn",
  AUTH_INVALID: "fail",
  UNAVAILABLE: "fail",
  INVALID_RESPONSE: "fail",
  NOT_CONFIGURED: "untested",
};

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

export function CaptchaSettingsPage({ busy, profiles, sessions, developmentMode }: { busy: boolean; profiles: BrowserProfile[]; sessions: Record<string, SessionSnapshot>; developmentMode: boolean }) {
  const [settings, setSettings] = useState<CaptchaSettings>(defaultCaptchaSettings());
  const [kind, setKind] = useState<CaptchaProviderKind>("CAPSOLVER");
  const [label, setLabel] = useState("CapSolver"); const [endpoint, setEndpoint] = useState(""); const [apiKey, setApiKey] = useState(""); const [notice, setNotice] = useState(""); const [working, setWorking] = useState(false);
  const [lab, setLab] = useState<CaptchaLabStatus>(idleCaptchaLabStatus()); const [labProfileId, setLabProfileId] = useState(""); const [labFixture, setLabFixture] = useState<CaptchaLabFixture>("RECAPTCHA_V2"); const [labStrategy, setLabStrategy] = useState<CaptchaStrategy>("MANUAL_HARVESTER");
  const load = useCallback(async () => { const result = await window.copify.captcha.settings(); if (result.ok) setSettings(result.value); else setNotice(result.error); }, []);
  useEffect(() => { void load(); return window.copify.captcha.onChanged(() => void load()); }, [load]);
  useEffect(() => { const provider = settings.providers.find((entry) => entry.kind === kind); const descriptor = PROVIDERS.find((entry) => entry.kind === kind)!; setLabel(provider?.label ?? descriptor.label); setEndpoint(provider?.endpoint ?? ""); setApiKey(""); }, [kind, settings.providers]);
  useEffect(() => { if (!developmentMode) return; void window.copify.captcha.labStatus().then((result) => { if (result.ok) setLab(result.value); }); return window.copify.captcha.onLabChanged(setLab); }, [developmentMode]);
  useEffect(() => { if (!labProfileId) setLabProfileId(profiles.find((profile) => profile.enabled)?.id ?? ""); }, [labProfileId, profiles]);
  const execute = async (action: () => Promise<{ ok: true; value: CaptchaSettings } | { ok: false; error: string }>, success: string) => { setWorking(true); setNotice(""); try { const result = await action(); if (result.ok) { setSettings(result.value); setNotice(success); } else setNotice(result.error); } finally { setWorking(false); } };
  const saveGeneral = () => void execute(() => window.copify.captcha.updateSettings({ appMode: settings.appMode, activeProvider: settings.activeProvider, solveTimeoutMs: settings.solveTimeoutMs, fallbackAfterMs: settings.fallbackAfterMs }), "CAPTCHA defaults saved.");
  const saveProvider = () => void execute(() => window.copify.captcha.upsertProvider({ kind, label, endpoint: endpoint || null, apiKey: apiKey || undefined, enabled: true }), `${label} saved.`);
  const configured = settings.providers.find((entry) => entry.kind === kind);
  const diagnostic = configured?.lastDiagnostic ?? null;
  const disabled = busy || working;

  // Which of the three timing fields actually govern behavior depends entirely
  // on the app mode, so the inapplicable ones are inert rather than merely
  // ignored at runtime.
  const usesSolver = settings.appMode !== "manual_only";
  const usesFallback = settings.appMode === "api_with_fallback";
  const activeLabel = settings.providers.find((entry) => entry.kind === settings.activeProvider)?.label ?? null;
  const effective = settings.appMode === "manual_only"
    ? "Local Harvester opens on the challenged checkout page. No solver provider is contacted."
    : settings.appMode === "api_only"
      ? `${activeLabel ?? "No provider"} solves within ${settings.solveTimeoutMs.toLocaleString()} ms, then reports a typed failure. The Harvester never opens.`
      : `${activeLabel ?? "No provider"} solves first; the Harvester takes the same challenge after ${settings.fallbackAfterMs.toLocaleString()} ms or immediately on a provider error.`;

  return <div className="page-stack">
    <section className="panel">
      <div className="section-title"><div><h2>CAPTCHA strategy</h2><p className="muted">Defaults are snapshotted before runners start. Local Harvester uses the original checkout page.</p></div><button disabled={disabled} onClick={saveGeneral}>Save</button></div>
      <div className="run-form">
        <Field label="App mode"><select disabled={disabled} value={settings.appMode} onChange={(event) => setSettings({ ...settings, appMode: event.target.value as CaptchaSettings["appMode"] })}><option value="manual_only">Manual only</option><option value="api_only">API only</option><option value="api_with_fallback">API with local fallback</option></select></Field>
        <Field label="Active provider">
          <select disabled={disabled} value={settings.activeProvider ?? ""} onChange={(event) => setSettings({ ...settings, activeProvider: (event.target.value || null) as CaptchaProviderKind | null })}><option value="">None</option>{settings.providers.filter((provider) => provider.enabled).map((provider) => <option key={provider.kind} value={provider.kind}>{provider.label}</option>)}</select>
          {!usesSolver ? <p className="field-note">Saved for later. Manual only never contacts it.</p> : null}
        </Field>
        <Field label="API-only timeout (ms)">
          <input type="number" min={5000} max={120000} disabled={disabled || !usesSolver} value={settings.solveTimeoutMs} onChange={(event) => setSettings({ ...settings, solveTimeoutMs: Number(event.target.value) })} />
          {!usesSolver ? <p className="field-note">Applies to the API modes.</p> : null}
        </Field>
        <Field label="Fallback threshold (ms)">
          <input type="number" min={1000} max={30000} disabled={disabled || !usesFallback} value={settings.fallbackAfterMs} onChange={(event) => setSettings({ ...settings, fallbackAfterMs: Number(event.target.value) })} />
          {!usesFallback ? <p className="field-note">Applies to API with local fallback.</p> : null}
        </Field>
        {usesSolver && !settings.activeProvider ? <p className="warning">This mode needs a solver provider. Configure one below, or a challenged session will fail instead of solving.</p> : null}
      </div>
      <div className="rows"><div className="row"><span className="row-main"><span className="row-name">Effective strategy</span><span className="row-meta">{effective}</span></span></div></div>
    </section>
    <section className="panel">
      <div className="section-title"><div><h2>Solver provider</h2><p className="muted">Keys are encrypted with the operating system credential service. Saving an empty key preserves the current one.</p></div></div>
      <div className="run-form">
        <Field label="Adapter"><select disabled={disabled} value={kind} onChange={(event) => setKind(event.target.value as CaptchaProviderKind)}>{PROVIDERS.map((provider) => <option key={provider.kind} value={provider.kind}>{provider.label}</option>)}</select></Field>
        <Field label="Label"><input value={label} maxLength={80} disabled={disabled} onChange={(event) => setLabel(event.target.value)} /></Field>
        {kind !== "CAPSOLVER" ? <Field label="HTTPS endpoint"><input value={endpoint} disabled={disabled} placeholder="https://solver.example/api" onChange={(event) => setEndpoint(event.target.value)} /></Field> : null}
        <Field label={configured?.apiKeyConfigured ? "Replace API key" : "API key"}><input type="password" value={apiKey} autoComplete="off" disabled={disabled} onChange={(event) => setApiKey(event.target.value)} /></Field>
        <button disabled={disabled || !label.trim() || (kind !== "CAPSOLVER" && !endpoint.trim())} onClick={saveProvider}>Save provider</button>
      </div>
      {configured ? <div className="rows"><div className="row provider-row">
        <span className="row-main">
          <span className="row-name">{configured.label}{settings.activeProvider === configured.kind ? <span className="badge">Active</span> : null}</span>
          <span className="row-meta">{configured.apiKeyConfigured ? "API key configured" : "No API key"}{diagnostic?.balanceMicrosUsd == null ? "" : ` · Balance ${usd(diagnostic.balanceMicrosUsd)}`}{diagnostic ? ` · checked ${new Date(diagnostic.checkedAt).toLocaleTimeString()}` : ""}</span>
          {diagnostic && diagnostic.status !== "CONNECTED" ? <span className="row-meta error-detail">{diagnostic.message}</span> : null}
        </span>
        <span className={`state ${diagnostic ? DIAGNOSTIC_TONE[diagnostic.status] : "untested"}`}>{diagnostic ? diagnostic.status.replaceAll("_", " ") : "Not tested"}</span>
        <div className="row-actions"><button disabled={disabled || !configured.apiKeyConfigured} onClick={() => void execute(() => window.copify.captcha.upsertProvider({ kind, label, endpoint: endpoint || null, apiKey: null, enabled: true }), "API key removed.")}>Remove key</button><button disabled={disabled || !configured.apiKeyConfigured} onClick={() => { setWorking(true); void window.copify.captcha.diagnose(kind).then((result) => { setNotice(result.ok ? `${result.value.message}${result.value.balanceMicrosUsd === null ? "" : ` Balance ${usd(result.value.balanceMicrosUsd)}.`}` : result.error); void load(); }).finally(() => setWorking(false)); }}>Test connection & balance</button><button className="danger" disabled={disabled} onClick={() => void execute(() => window.copify.captcha.removeProvider(kind), "Provider removed.")}>Remove provider</button></div>
      </div></div> : null}
      {notice ? <p className="field-note">{notice}</p> : null}
    </section>
    {developmentMode ? <section className="panel">
      <div className="section-title"><div><h2>CAPTCHA Test Lab</h2><p className="muted">Development only. Runs the production resolver against exact allow-listed public fixtures; no target, cart, shipping, or payment flow is used.</p></div><span className={`state ${lab.state.toLowerCase()}`}>{lab.state}</span></div>
      <div className="run-form">
        <Field label="Browser"><select value={labProfileId} disabled={lab.state !== "IDLE"} onChange={(event) => setLabProfileId(event.target.value)}><option value="">Select browser</option>{profiles.filter((profile) => profile.enabled).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{sessions[profile.id]?.state && sessions[profile.id].state !== "STOPPED" ? ` · ${sessions[profile.id].state.toLowerCase()}` : ""}</option>)}</select></Field>
        <Field label="Fixture">
          <select value={labFixture} disabled={lab.state !== "IDLE"} onChange={(event) => setLabFixture(event.target.value as CaptchaLabFixture)}>{Object.entries(CAPTCHA_LAB_FIXTURES).map(([value, fixture]) => <option key={value} value={value}>{fixture.label}</option>)}</select>
          <p className="field-note mono">{CAPTCHA_LAB_FIXTURES[labFixture].url}</p>
        </Field>
        <Field label="Strategy"><select value={labStrategy} disabled={lab.state !== "IDLE"} onChange={(event) => setLabStrategy(event.target.value as CaptchaStrategy)}><option value="MANUAL_HARVESTER">Local Harvester</option><option value="API_SOLVER">API only</option><option value="API_WITH_FALLBACK">API with fallback</option></select></Field>
      </div>
      <div className="actions">{lab.state === "IDLE" ? <button className="primary" disabled={busy || working || !labProfileId || (sessions[labProfileId]?.state ?? "STOPPED") !== "STOPPED"} onClick={() => { setWorking(true); setNotice(""); void window.copify.captcha.startLab({ browserProfileId: labProfileId, fixture: labFixture, strategy: labStrategy }).then((result) => { if (!result.ok) setNotice(result.error); }).finally(() => setWorking(false)); }}>Start test</button> : <button className="danger" disabled={working || lab.state === "STOPPING"} onClick={() => { setWorking(true); void window.copify.captcha.stopLab().finally(() => setWorking(false)); }}>Stop and close browser</button>}</div>
      {lab.message ? <p className={`field-note ${lab.state === "FAILED" ? "warning" : ""}`}>{lab.message}</p> : null}
      {lab.events.length ? <details className="event-log-panel" open><summary>Sanitized event log · {lab.events.length}</summary><div className="rows">{lab.events.map((event, index) => <div className="row" key={`${event.at}-${index}`}><span className="row-main"><span className="row-name">{event.type}</span><span className="row-meta">{Object.entries(event.payload).filter(([key]) => ["kind","strategy","providerLabel","attempt","durationMs","normalizedFailure","failureDetail","outcome","reason"].includes(key)).map(([key, value]) => `${key}=${String(value)}`).join(" · ")}</span></span></div>)}</div></details> : null}
    </section> : null}
  </div>;
}
