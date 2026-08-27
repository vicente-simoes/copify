import { useCallback, useEffect, useState } from "react";
import { defaultCaptchaSettings, type CaptchaProviderKind, type CaptchaSettings } from "@copify/shared";
import { Field } from "../ui/primitives";

const PROVIDERS: { kind: CaptchaProviderKind; label: string; custom: boolean }[] = [
  { kind: "CAPSOLVER", label: "CapSolver", custom: false },
  { kind: "CUSTOM_ASYNC", label: "Custom async", custom: true },
  { kind: "CUSTOM_FAST_TOKEN", label: "Custom fast token", custom: true },
];

export function CaptchaSettingsPage({ busy }: { busy: boolean }) {
  const [settings, setSettings] = useState<CaptchaSettings>(defaultCaptchaSettings());
  const [kind, setKind] = useState<CaptchaProviderKind>("CAPSOLVER");
  const [label, setLabel] = useState("CapSolver"); const [endpoint, setEndpoint] = useState(""); const [apiKey, setApiKey] = useState(""); const [notice, setNotice] = useState(""); const [working, setWorking] = useState(false);
  const load = useCallback(async () => { const result = await window.copify.captcha.settings(); if (result.ok) setSettings(result.value); else setNotice(result.error); }, []);
  useEffect(() => { void load(); return window.copify.captcha.onChanged(() => void load()); }, [load]);
  useEffect(() => { const provider = settings.providers.find((entry) => entry.kind === kind); const descriptor = PROVIDERS.find((entry) => entry.kind === kind)!; setLabel(provider?.label ?? descriptor.label); setEndpoint(provider?.endpoint ?? ""); setApiKey(""); }, [kind, settings.providers]);
  const execute = async (action: () => Promise<{ ok: true; value: CaptchaSettings } | { ok: false; error: string }>, success: string) => { setWorking(true); setNotice(""); try { const result = await action(); if (result.ok) { setSettings(result.value); setNotice(success); } else setNotice(result.error); } finally { setWorking(false); } };
  const saveGeneral = () => void execute(() => window.copify.captcha.updateSettings({ appMode: settings.appMode, activeProvider: settings.activeProvider, solveTimeoutMs: settings.solveTimeoutMs, fallbackAfterMs: settings.fallbackAfterMs }), "CAPTCHA defaults saved.");
  const saveProvider = () => void execute(() => window.copify.captcha.upsertProvider({ kind, label, endpoint: endpoint || null, apiKey: apiKey || undefined, enabled: true }), `${label} saved.`);
  const configured = settings.providers.find((entry) => entry.kind === kind);
  const disabled = busy || working;
  return <div className="page-stack">
    <section className="panel">
      <div className="section-title"><div><h2>CAPTCHA strategy</h2><p className="muted">Defaults are snapshotted before runners start. Local Harvester uses the original checkout page.</p></div><button disabled={disabled} onClick={saveGeneral}>Save</button></div>
      <div className="run-form">
        <Field label="App mode"><select value={settings.appMode} onChange={(event) => setSettings({ ...settings, appMode: event.target.value as CaptchaSettings["appMode"] })}><option value="manual_only">Manual only</option><option value="api_only">API only</option><option value="api_with_fallback">API with local fallback</option></select></Field>
        <Field label="Active provider"><select value={settings.activeProvider ?? ""} onChange={(event) => setSettings({ ...settings, activeProvider: (event.target.value || null) as CaptchaProviderKind | null })}><option value="">None</option>{settings.providers.filter((provider) => provider.enabled).map((provider) => <option key={provider.kind} value={provider.kind}>{provider.label}</option>)}</select></Field>
        <Field label="API-only timeout (ms)"><input type="number" min={5000} max={120000} value={settings.solveTimeoutMs} onChange={(event) => setSettings({ ...settings, solveTimeoutMs: Number(event.target.value) })} /></Field>
        <Field label="Fallback threshold (ms)"><input type="number" min={1000} max={30000} value={settings.fallbackAfterMs} onChange={(event) => setSettings({ ...settings, fallbackAfterMs: Number(event.target.value) })} /></Field>
      </div>
    </section>
    <section className="panel">
      <div className="section-title"><div><h2>Solver provider</h2><p className="muted">Keys are encrypted with the operating system credential service. Saving an empty key preserves the current one.</p></div></div>
      <div className="run-form">
        <Field label="Adapter"><select value={kind} onChange={(event) => setKind(event.target.value as CaptchaProviderKind)}>{PROVIDERS.map((provider) => <option key={provider.kind} value={provider.kind}>{provider.label}</option>)}</select></Field>
        <Field label="Label"><input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} /></Field>
        {kind !== "CAPSOLVER" ? <Field label="HTTPS endpoint"><input value={endpoint} placeholder="https://solver.example/api" onChange={(event) => setEndpoint(event.target.value)} /></Field> : null}
        <Field label={configured?.apiKeyConfigured ? "Replace API key" : "API key"}><input type="password" value={apiKey} autoComplete="off" onChange={(event) => setApiKey(event.target.value)} /></Field>
        <button disabled={disabled || !label.trim() || (kind !== "CAPSOLVER" && !endpoint.trim())} onClick={saveProvider}>Save provider</button>
      </div>
      {configured ? <div className="rows"><div className="row"><span className="row-main"><span className="row-name">{configured.label}</span><span className="row-meta">{configured.apiKeyConfigured ? "API key configured" : "No API key"}{configured.lastDiagnostic ? ` · ${configured.lastDiagnostic.status.toLowerCase().replaceAll("_", " ")} · ${configured.lastDiagnostic.message}` : " · not tested"}</span></span><div className="row-actions"><button disabled={disabled || !configured.apiKeyConfigured} onClick={() => void execute(() => window.copify.captcha.upsertProvider({ kind, label, endpoint: endpoint || null, apiKey: null, enabled: true }), "API key removed.")}>Remove key</button><button disabled={disabled || !configured.apiKeyConfigured} onClick={() => { setWorking(true); void window.copify.captcha.diagnose(kind).then((result) => { setNotice(result.ok ? `${result.value.message}${result.value.balanceMicrosUsd === null ? "" : ` Balance $${(result.value.balanceMicrosUsd / 1_000_000).toFixed(2)}.`}` : result.error); void load(); }).finally(() => setWorking(false)); }}>Test connection & balance</button><button className="danger" disabled={disabled} onClick={() => void execute(() => window.copify.captcha.removeProvider(kind), "Provider removed.")}>Remove provider</button></div></div></div> : null}
      {notice ? <p className="field-note">{notice}</p> : null}
    </section>
  </div>;
}
