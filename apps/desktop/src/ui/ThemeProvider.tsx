import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultThemeOverrides, type AppearanceSettings, type ResolvedTheme, type ThemeOverrides } from "@copify/shared";
import { applyTheme, chromeColors, readMirror, resolveTheme, writeMirror } from "./theme";

type AppearanceContextValue = {
  settings: AppearanceSettings;
  /* The theme actually on screen. Under System this follows the OS. */
  theme: ResolvedTheme;
  error: string;
  update: (patch: Partial<AppearanceSettings>) => void;
  updateOverrides: (patch: Partial<ThemeOverrides>) => void;
  resetOverrides: () => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

/* Dragging a slider must not write a row per frame; the applied look is
   immediate and the database catches up once the hand stops. */
const PERSIST_DEBOUNCE_MS = 250;

export function ThemeProvider({ initial, children }: { initial?: AppearanceSettings; children: ReactNode }) {
  const [settings, setSettings] = useState<AppearanceSettings>(() => initial ?? readMirror());
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolveTheme((initial ?? readMirror()).mode));
  const [error, setError] = useState("");
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { setTheme(resolveTheme(settings.mode)); }, [settings.mode]);

  useEffect(() => {
    if (settings.mode !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(query.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [settings.mode]);

  /* One place paints: a manual change, an OS flip and the database reconcile
     all land here, so the OS-drawn window controls can never fall behind. */
  useEffect(() => {
    applyTheme(document.documentElement, theme, settings.themes[theme], settings.density);
    void window.copify.settings.applyChrome(chromeColors());
  }, [settings, theme]);

  useEffect(() => {
    void window.copify.settings.getAppearance().then((result) => { if (result.ok) { setSettings(result.value); writeMirror(result.value); } });
  }, []);

  useEffect(() => () => clearTimeout(persistTimer.current), []);

  const commit = useCallback((next: AppearanceSettings) => {
    setSettings(next);
    writeMirror(next);
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void window.copify.settings.updateAppearance(next).then((result) => setError(result.ok ? "" : result.error));
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  const update = useCallback((patch: Partial<AppearanceSettings>) => commit({ ...settings, ...patch }), [commit, settings]);
  const updateOverrides = useCallback((patch: Partial<ThemeOverrides>) => {
    commit({ ...settings, themes: { ...settings.themes, [theme]: { ...settings.themes[theme], ...patch } } });
  }, [commit, settings, theme]);
  const resetOverrides = useCallback(() => {
    commit({ ...settings, themes: { ...settings.themes, [theme]: defaultThemeOverrides() } });
  }, [commit, settings, theme]);

  const value = useMemo(
    () => ({ settings, theme, error, update, updateOverrides, resetOverrides }),
    [settings, theme, error, update, updateOverrides, resetOverrides]
  );
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance requires ThemeProvider.");
  return value;
}
