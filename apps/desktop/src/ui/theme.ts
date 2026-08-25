import { appearanceSettingsSchema, defaultAppearanceSettings, type AppearanceSettings, type ChromeColors, type Density, type ResolvedTheme, type ThemeMode, type ThemeOverrides } from "@copify/shared";

/* The theme is applied by writing at most four custom properties; tokens.css
   derives every surface and text step from them. The mirror exists because the
   database read is asynchronous and a light theme cannot afford a dark frame. */

export const APPEARANCE_MIRROR_KEY = "copify.appearance";

export function systemTheme(): ResolvedTheme { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
export function resolveTheme(mode: ThemeMode): ResolvedTheme { return mode === "system" ? systemTheme() : mode; }

export function readMirror(): AppearanceSettings {
  try {
    const raw = window.localStorage.getItem(APPEARANCE_MIRROR_KEY);
    return raw ? appearanceSettingsSchema.parse(JSON.parse(raw)) : defaultAppearanceSettings();
  } catch { return defaultAppearanceSettings(); }
}

export function writeMirror(settings: AppearanceSettings): void {
  try { window.localStorage.setItem(APPEARANCE_MIRROR_KEY, JSON.stringify(settings)); } catch { /* a full or blocked store only costs the next boot a frame */ }
}

/* An unset override removes the property rather than writing today's hex, so a
   later change to the shipped palette still reaches anyone who never customised. */
export function themeVariables(overrides: ThemeOverrides): Record<string, string> {
  const variables: Record<string, string> = {};
  if (overrides.background) variables["--theme-bg"] = overrides.background;
  if (overrides.foreground) variables["--theme-fg"] = overrides.foreground;
  if (overrides.accent) variables["--accent"] = overrides.accent;
  if (overrides.contrast !== null) variables["--contrast"] = String(overrides.contrast);
  return variables;
}

const THEME_PROPERTIES = ["--theme-bg", "--theme-fg", "--accent", "--contrast"] as const;

export function applyTheme(element: HTMLElement, theme: ResolvedTheme, overrides: ThemeOverrides, density: Density): void {
  element.dataset.theme = theme;
  element.dataset.density = density;
  element.classList.add("theme-scope");
  const variables = themeVariables(overrides);
  for (const property of THEME_PROPERTIES) {
    const value = variables[property];
    if (value === undefined) element.style.removeProperty(property); else element.style.setProperty(property, value);
  }
}

export function bootTheme(): AppearanceSettings {
  const settings = readMirror();
  const theme = resolveTheme(settings.mode);
  applyTheme(document.documentElement, theme, settings.themes[theme], settings.density);
  return settings;
}

/* A custom property computes to its token stream, so reading --bg gives back
   the literal color-mix() text. A probe on a real colour property makes
   Chromium resolve it for us. Requires a body, so never call this before mount. */
let probe: HTMLSpanElement | undefined;

export function resolveToken(name: string): string {
  if (!probe) {
    probe = document.createElement("span");
    probe.style.cssText = "position:fixed;left:-9999px;top:0;width:0;height:0;pointer-events:none";
    document.body.append(probe);
  }
  probe.style.color = `var(${name})`;
  return toHex(getComputedStyle(probe).color);
}

/* A token derived with color-mix() computes to oklab(), not rgb(), and the
   titlebar overlay only takes hex. Painting it settles every colour space into
   the same eight bits per channel instead of parsing three notations. */
let paint: CanvasRenderingContext2D | null | undefined;

export function toHex(color: string): string {
  if (paint === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    paint = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!paint) return "#000000";
  paint.fillStyle = "#000000";
  paint.fillStyle = color;
  paint.fillRect(0, 0, 1, 1);
  const [red, green, blue] = paint.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function chromeColors(): ChromeColors { return { backgroundColor: resolveToken("--bg"), symbolColor: resolveToken("--fg-muted") }; }

/* Measures a theme without waiting for it to be the one on screen. The host
   carries its own scope and overrides, so this does not depend on <html> having
   been updated first — child effects run before their parent's, and Appearance
   would otherwise read the previous theme's tokens on every change. */
export function measureTheme(theme: ResolvedTheme, overrides: ThemeOverrides, names: readonly string[]): Record<string, string> {
  const host = document.createElement("div");
  host.className = "theme-scope";
  host.dataset.theme = theme;
  host.style.cssText = "position:fixed;left:-9999px;top:0;width:0;height:0;pointer-events:none";
  for (const [property, value] of Object.entries(themeVariables(overrides))) host.style.setProperty(property, value);
  const span = document.createElement("span");
  host.append(span);
  document.body.append(host);
  try {
    const measured: Record<string, string> = {};
    for (const name of names) {
      span.style.color = `var(${name})`;
      measured[name] = toHex(getComputedStyle(span).color);
    }
    return measured;
  } finally { host.remove(); }
}

/* WCAG 2.1 relative luminance. The ratio is what decides whether a colour the
   operator picked is still readable once the ramp has derived everything else. */
function channelLuminance(value: number): number {
  const sRGB = value / 255;
  return sRGB <= 0.03928 ? sRGB / 12.92 : ((sRGB + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channelLuminance(red) + 0.7152 * channelLuminance(green) + 0.0722 * channelLuminance(blue);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}
