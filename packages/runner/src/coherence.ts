import { Agent, ProxyAgent, Socks5ProxyAgent, fetch, type Dispatcher } from "undici";
import type { GeoIdentitySnapshot, ProfileCoherenceSummary, RunnerProxy } from "@copify/shared";

export type NativeCoherenceOptions = {
  locale?: string;
  timezoneId?: string;
  geolocation?: { latitude: number; longitude: number };
  acceptLanguage?: string;
  webRtcPolicy: "default_public_interface_only" | "disable_non_proxied_udp";
};

export type ResolvedCoherence = { identity: GeoIdentitySnapshot; summary: ProfileCoherenceSummary; launch: NativeCoherenceOptions };

const LOCALES: Record<string, string> = {
  AT: "de-AT", BE: "nl-BE", BG: "bg-BG", CH: "de-CH", CY: "el-CY", CZ: "cs-CZ", DE: "de-DE", DK: "da-DK",
  EE: "et-EE", ES: "es-ES", FI: "fi-FI", FR: "fr-FR", GB: "en-GB", GR: "el-GR", HR: "hr-HR", HU: "hu-HU",
  IE: "en-IE", IT: "it-IT", LT: "lt-LT", LU: "fr-LU", LV: "lv-LV", MT: "en-MT", NL: "nl-NL", PL: "pl-PL",
  PT: "pt-PT", RO: "ro-RO", SE: "sv-SE", SI: "sl-SI", SK: "sk-SK", US: "en-US", CA: "en-CA"
};

export function localeForCountry(country: string | null): string | null { return country ? LOCALES[country.toUpperCase()] ?? null : null; }
export function acceptLanguageForLocale(locale: string): string { const language = locale.split("-")[0]; return `${locale},${language};q=0.9,en-US;q=0.8,en;q=0.7`; }
export function validTimezone(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return value; } catch { return null; }
}

export function parseGeoIdentity(value: unknown, resolvedAt = Date.now()): GeoIdentitySnapshot {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const timezone = record.timezone && typeof record.timezone === "object" && !Array.isArray(record.timezone) ? (record.timezone as Record<string, unknown>).id : record.timezone;
  const number = (candidate: unknown, min: number, max: number) => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= min && candidate <= max ? candidate : null;
  const text = (candidate: unknown) => typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
  return {
    publicIp: text(record.ip), country: text(record.country_code) ?? text(record.country), city: text(record.city), region: text(record.region) ?? text(record.region_name),
    latitude: number(record.latitude, -90, 90), longitude: number(record.longitude, -180, 180), timezoneId: validTimezone(timezone), resolvedAt
  };
}

export function coherenceFromIdentity(identity: GeoIdentitySnapshot, proxy: RunnerProxy | null): ResolvedCoherence {
  const country = identity.country?.toUpperCase() ?? null; const locale = localeForCountry(country);
  const issues: string[] = [];
  if (!identity.publicIp) issues.push("The route probe did not return a public IP.");
  if (!country) issues.push("Country was unavailable.");
  if (!locale) issues.push("Locale could not be derived from the route country.");
  if (!identity.timezoneId) issues.push("A valid IANA timezone was unavailable.");
  if (identity.latitude === null || identity.longitude === null) issues.push("Approximate coordinates were unavailable.");
  if (proxy?.expectedCountry && country !== proxy.expectedCountry.toUpperCase()) issues.push(`Expected ${proxy.expectedCountry.toUpperCase()}, but the route reported ${country ?? "unknown"}.`);
  if (proxy?.expectedCity && identity.city && normalize(identity.city) !== normalize(proxy.expectedCity)) issues.push(`Expected ${proxy.expectedCity}, but the route reported ${identity.city}.`);
  const webRtcPolicy = proxy ? "disable_non_proxied_udp" as const : "default_public_interface_only" as const;
  const launch: NativeCoherenceOptions = {
    ...(locale ? { locale, acceptLanguage: acceptLanguageForLocale(locale) } : {}),
    ...(identity.timezoneId ? { timezoneId: identity.timezoneId } : {}),
    ...(identity.latitude !== null && identity.longitude !== null ? { geolocation: { latitude: identity.latitude, longitude: identity.longitude } } : {}),
    webRtcPolicy
  };
  return {
    identity,
    launch,
    summary: {
      status: issues.length ? "WARNING" : "VERIFIED", country, city: identity.city, locale, timezoneId: identity.timezoneId,
      geolocationApplied: Boolean(launch.geolocation), webRtcPolicy: proxy ? "DISABLE_NON_PROXIED_UDP" : "DEFAULT_PUBLIC_INTERFACE_ONLY",
      source: "ROUTE_PROBE", resolvedAt: identity.resolvedAt, message: issues.length ? issues.join(" ") : null
    }
  };
}

export async function resolveNetworkCoherence(proxy: RunnerProxy | null, probeUrl: string): Promise<ResolvedCoherence> {
  const dispatcher = dispatcherFor(proxy); const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(probeUrl, { dispatcher, signal: controller.signal, headers: { Accept: "application/json" }, redirect: "error" });
    if (!response.ok) throw new Error(`Route probe returned HTTP ${response.status}.`);
    return coherenceFromIdentity(parseGeoIdentity(await response.json()), proxy);
  } catch (error) {
    const identity = parseGeoIdentity(null);
    const fallback = coherenceFromIdentity(identity, proxy);
    fallback.summary.message = `Coherence preflight failed: ${safeMessage(error)}`;
    return fallback;
  } finally { clearTimeout(timeout); await dispatcher.close().catch(() => dispatcher.destroy()); }
}

export function externalCoherence(locale: string | null, timezoneId: string | null): ProfileCoherenceSummary {
  const complete = Boolean(locale && timezoneId);
  return { status: "EXTERNAL", country: null, city: null, locale, timezoneId, geolocationApplied: false, webRtcPolicy: "EXTERNAL_UNMANAGED", source: "EXTERNAL_BROWSER", resolvedAt: Date.now(), message: complete ? "The external browser owns route and identity settings." : "The external browser owns identity settings and did not expose a complete locale/timezone snapshot." };
}

function dispatcherFor(proxy: RunnerProxy | null): Dispatcher {
  if (!proxy) return new Agent({ connections: 1 });
  const url = new URL(`${proxy.protocol}://${proxy.host}:${proxy.port}`); if (proxy.username) url.username = proxy.username; if (proxy.password) url.password = proxy.password;
  return proxy.protocol === "socks5" ? new Socks5ProxyAgent(url.toString()) : new ProxyAgent(url.toString());
}
function normalize(value: string): string { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
function safeMessage(error: unknown): string { const value = error instanceof Error ? error.message : "Route probe unavailable."; return value.replace(/(?:https?|socks5):\/\/[^\s]+/gi, "[redacted route]").slice(0, 240); }
