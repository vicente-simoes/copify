import { useEffect, useState } from "react";
import { densitySchema, type Density, type ResolvedTheme, type ThemeMode, type ThemeOverrides } from "@copify/shared";
import { useAppearance } from "../ui/ThemeProvider";
import { contrastRatio, measureTheme, resolveToken, systemTheme, themeVariables } from "../ui/theme";

/* Appearance applies as you change it. The Monitor tab stages its values behind
   a Save button because a running monitor snapshots them; a theme has no such
   moment, and the app itself is the preview — staging it would make the whole
   screen lie until the button was pressed. */

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const CONTRAST_MIN = 0.7;
const CONTRAST_MAX = 1.4;

const DENSITIES: { id: Density; label: string }[] = [
  { id: "comfortable", label: "Comfortable" },
  { id: "compact", label: "Compact" },
];

/* Every pair the derived ramp can break. Text is held to WCAG AA (4.5); the
   accent is a dot and a 2px rule, so it is judged as a graphic (3.0). */
const READABILITY = [
  { name: "Body text", foreground: "--fg", background: "--surface", minimum: 4.5 },
  { name: "Muted text", foreground: "--fg-muted", background: "--surface", minimum: 4.5 },
  { name: "Primary action", foreground: "--primary-fg", background: "--primary-bg", minimum: 4.5 },
  { name: "Accent", foreground: "--accent", background: "--surface", minimum: 3 },
] as const;

const READABILITY_TOKENS = [...new Set(READABILITY.flatMap((pair) => [pair.foreground, pair.background]))];

function Readability({ theme, overrides }: { theme: ResolvedTheme; overrides: ThemeOverrides }) {
  const [tokens, setTokens] = useState<Record<string, string>>({});
  useEffect(() => { setTokens(measureTheme(theme, overrides, READABILITY_TOKENS)); }, [theme, overrides]);

  const checks = READABILITY.map((pair) => {
    const foreground = tokens[pair.foreground];
    const background = tokens[pair.background];
    const ratio = foreground && background ? contrastRatio(foreground, background) : null;
    return { ...pair, ratio, passes: ratio === null || ratio >= pair.minimum };
  });
  const failing = checks.filter((check) => !check.passes).length;

  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <h2>Readability</h2>
          <p className="muted">
            {failing === 0
              ? "Every derived pair meets its contrast minimum."
              : `${failing} ${failing === 1 ? "pair falls" : "pairs fall"} below the minimum. Copify will still apply these colours.`}
          </p>
        </div>
      </div>
      <div className="rows">
        {checks.map((check) => (
          <div className="row" key={check.name}>
            <div className="row-main">
              <span className="row-name">{check.name}</span>
              <span className="row-meta">Needs {check.minimum.toFixed(1)}:1</span>
            </div>
            <span className={`state ${check.passes ? "pass" : "warn"}`}>{check.passes ? "PASS" : "LOW"}</span>
            <span className="row-cell mono">{check.ratio === null ? "—" : `${check.ratio.toFixed(2)}:1`}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ThemeCard({ mode, label, selected, overrides, onSelect }: { mode: ThemeMode; label: string; selected: boolean; overrides: ThemeOverrides; onSelect: () => void }) {
  const painted: ResolvedTheme = mode === "system" ? systemTheme() : mode;
  return (
    <div className="theme-card-slot">
      <button
        type="button"
        className={`theme-card theme-scope ${selected ? "active" : ""}`}
        data-theme={painted}
        style={themeVariables(overrides) as React.CSSProperties}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="theme-card-titlebar"><i /><i /></span>
        <span className="theme-card-body">
          <span className="theme-card-sidebar"><i className="on" /><i /><i /><i /></span>
          <span className="theme-card-well"><i /><i /><i /></span>
        </span>
      </button>
      <span className="theme-card-label">{label}</span>
    </div>
  );
}

function ColorRow({ name, meta, token, value, onChange, onReset }: { name: string; meta: string; token: string; value: string | null; onChange: (value: string) => void; onReset: () => void }) {
  /* With no override the picker still has to open on something, so it opens on
     whatever the built-in palette resolved to. */
  const resolved = value ?? resolveToken(token);
  return (
    <div className="row">
      <div className="row-main">
        <span className="row-name">{name}</span>
        <span className="row-meta">{meta}</span>
      </div>
      {value ? <button className="ghost" onClick={onReset}>Reset</button> : null}
      <label className="color-swatch" style={{ background: resolved }}>
        <input type="color" value={resolved} onChange={(event) => onChange(event.target.value)} aria-label={name} />
      </label>
      <span className="row-cell mono">{resolved.toUpperCase()}</span>
    </div>
  );
}

export function Appearance() {
  const { settings, theme, error, update, updateOverrides, resetOverrides } = useAppearance();
  const overrides = settings.themes[theme];
  const customised = overrides.accent !== null || overrides.background !== null || overrides.foreground !== null || overrides.contrast !== null;
  const contrast = overrides.contrast ?? 1;

  return (
    <>
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Theme</h2>
            <p className="muted">System follows the Windows colour mode.</p>
          </div>
        </div>
        <div className="theme-cards">
          {MODES.map((entry) => (
            <ThemeCard
              key={entry.id}
              mode={entry.id}
              label={entry.label}
              selected={settings.mode === entry.id}
              overrides={settings.themes[entry.id === "system" ? systemTheme() : entry.id]}
              onSelect={() => update({ mode: entry.id })}
            />
          ))}
        </div>
        <div className="rows">
          <div className="row">
            <div className="row-main">
              <span className="row-name">Density</span>
              <span className="row-meta">Row heights, control heights, and padding. Text size does not change.</span>
            </div>
            <select
              className="row-select"
              value={settings.density}
              onChange={(event) => update({ density: densitySchema.parse(event.target.value) })}
              aria-label="Density"
            >
              {DENSITIES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Colours</h2>
            <p className="muted">Editing the {theme} theme. Surfaces and borders are derived from the background and foreground.</p>
          </div>
          {customised ? <button onClick={resetOverrides}>Reset to default</button> : null}
        </div>
        <div className="rows">
          <ColorRow
            name="Accent" meta="State only — ready, pass, and the active sidebar item." token="--accent"
            value={overrides.accent} onChange={(accent) => updateOverrides({ accent })} onReset={() => updateOverrides({ accent: null })}
          />
          <ColorRow
            name="Background" meta="The chrome behind the titlebar and sidebar." token="--bg"
            value={overrides.background} onChange={(background) => updateOverrides({ background })} onReset={() => updateOverrides({ background: null })}
          />
          <ColorRow
            name="Foreground" meta="Body text. Muted and dim text fall back from it." token="--fg"
            value={overrides.foreground} onChange={(foreground) => updateOverrides({ foreground })} onReset={() => updateOverrides({ foreground: null })}
          />
          <div className="row">
            <div className="row-main">
              <span className="row-name">Contrast</span>
              <span className="row-meta">How far the surfaces and borders separate from the background.</span>
            </div>
            {overrides.contrast !== null ? <button className="ghost" onClick={() => updateOverrides({ contrast: null })}>Reset</button> : null}
            <input
              className="slider" type="range" min={CONTRAST_MIN} max={CONTRAST_MAX} step={0.05} value={contrast}
              onChange={(event) => updateOverrides({ contrast: Number(event.target.value) })} aria-label="Contrast"
            />
            <span className="row-cell mono">{Math.round(contrast * 100)}</span>
          </div>
        </div>
        {error ? <p className="field-note warning">{error}</p> : null}
      </section>

      <Readability theme={theme} overrides={overrides} />
    </>
  );
}
