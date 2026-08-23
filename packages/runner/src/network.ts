import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium, type BrowserContext } from "rebrowser-playwright";
import { type ProxyBenchmark, type RunnerProxy, type SessionRoute } from "@copify/shared";

type ProbePayload = { ip?: string; country?: string; country_code?: string; city?: string; success?: boolean };
type Sample = { latencyMs: number; connectLatencyMs: number | null; payload: ProbePayload };

export async function verifyRoute(context: BrowserContext, proxy: RunnerProxy | null, probeUrl: string): Promise<SessionRoute> {
  const base = proxy ? { kind: "proxy" as const, proxyProfileId: proxy.proxyProfileId, proxyName: proxy.proxyName, protocol: proxy.protocol } : { kind: "direct" as const };
  let page;
  try {
    page = await context.newPage(); const response = await page.goto(probeUrl, { waitUntil: "domcontentloaded", timeout: 10_000 }); const payload = parsePayload(await response?.text());
    if (!payload?.ip) throw new Error("Invalid route probe response.");
    const country = payload.country_code ?? payload.country ?? null; const city = payload.city ?? null;
    const countryMismatch = Boolean(proxy?.expectedCountry && country?.toUpperCase() !== proxy.expectedCountry.toUpperCase());
    const cityMismatch = Boolean(proxy?.expectedCity && city && normalize(city) !== normalize(proxy.expectedCity));
    return { ...base, verification: { status: countryMismatch ? "FAILED" : cityMismatch ? "WARNING" : "VERIFIED", publicIp: payload.ip, country, city, verifiedAt: Date.now(), message: countryMismatch ? `Expected ${proxy?.expectedCountry}; the route reported ${country ?? "an unknown country"}.` : cityMismatch ? `Expected ${proxy?.expectedCity}; the route reported ${city}.` : null } };
  } catch {
    return { ...base, verification: { status: "FAILED", publicIp: null, country: null, city: null, verifiedAt: Date.now(), message: "Route verification could not reach the configured HTTPS probe." } };
  } finally { await page?.close().catch(() => undefined); }
}

export async function benchmarkRoute(proxy: RunnerProxy | null, probeUrl: string): Promise<ProxyBenchmark> {
  const startedAt = Date.now(); const samples: Sample[] = []; let lastError: unknown;
  try {
    const browser = await chromium.launch({ headless: true, executablePath: findChromeExecutable(), ignoreDefaultArgs: ["--enable-automation", "--no-sandbox"], proxy: proxy ? toPlaywrightProxy(proxy) : undefined });
    try { const context = await browser.newContext(); for (let index = 0; index < 7; index += 1) { try { samples.push(await probe(context, probeUrl)); } catch (error) { lastError = error; } } await context.close(); } finally { await browser.close(); }
  } catch (error) { lastError = error; }
  const successful = samples.filter((sample) => Boolean(sample.payload.ip)); const values = successful.map((sample) => sample.latencyMs); const ips = new Set(successful.map((sample) => sample.payload.ip)); const first = successful[0]?.payload;
  const medianLatencyMs = values.length ? median(values) : null; const jitterMs = values.length ? standardDeviation(values) : null; const connectLatencyMs = successful.find((sample) => sample.connectLatencyMs !== null)?.connectLatencyMs ?? null;
  const ipStable = successful.length > 0 && ips.size === 1; const failureRate = (7 - successful.length) / 7; const qualityScore = score(successful.length, medianLatencyMs, jitterMs, ipStable);
  const mismatch = Boolean(proxy?.expectedCountry && first && (first.country_code ?? first.country)?.toUpperCase() !== proxy.expectedCountry.toUpperCase()); const cityMismatch = Boolean(proxy?.expectedCity && first?.city && normalize(first.city) !== normalize(proxy.expectedCity));
  const errorCode = successful.length === 0 ? classifyNetworkError(lastError) : mismatch ? "EXPECTED_COUNTRY_MISMATCH" : null;
  const errorMessage = successful.length === 0 ? networkMessage(errorCode ?? "PROBE_FAILED") : mismatch ? `Expected ${proxy?.expectedCountry}; the route reported ${first?.country_code ?? first?.country ?? "an unknown country"}.` : cityMismatch ? `Expected ${proxy?.expectedCity}; the route reported ${first?.city}.` : null;
  const status = successful.length === 0 || mismatch || qualityScore < 50 ? "FAIL" : cityMismatch || qualityScore < 75 ? "WARN" : "PASS";
  return { id: randomUUID(), routeKind: proxy ? "proxy" : "direct", proxyProfileId: proxy?.proxyProfileId ?? null, probeUrl, startedAt, completedAt: Date.now(), attempts: 7, successes: successful.length, publicIp: first?.ip ?? null, country: first?.country_code ?? first?.country ?? null, city: first?.city ?? null, connectLatencyMs, medianLatencyMs, jitterMs, failureRate, ipStable, qualityScore, status, errorCode, errorMessage, samples: values };
}

export function toPlaywrightProxy(proxy: RunnerProxy): { server: string; username?: string; password?: string } { return { server: `${proxy.protocol}://${proxy.host}:${proxy.port}`, ...(proxy.username ? { username: proxy.username } : {}), ...(proxy.password ? { password: proxy.password } : {}) }; }
export function score(successes: number, medianLatencyMs: number | null, jitterMs: number | null, ipStable: boolean): number { if (successes === 0 || medianLatencyMs === null || jitterMs === null) return 0; return Math.round((successes / 7) * 100 * 0.5 + normalized(medianLatencyMs, 150, 1_000) * 0.2 + normalized(jitterMs, 20, 250) * 0.15 + (ipStable ? 100 : 0) * 0.15); }
export function findChromeExecutable(): string | undefined { if (process.platform !== "win32") return undefined; const programFiles = process.env.ProgramFiles ?? "C:\\Program Files"; const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"; const localAppData = process.env.LOCALAPPDATA; return [`${programFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`, localAppData && `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`].filter((candidate): candidate is string => Boolean(candidate)).find(existsSync); }

async function probe(context: BrowserContext, probeUrl: string): Promise<Sample> { const page = await context.newPage(); const started = performance.now(); try { const response = await page.goto(probeUrl, { waitUntil: "domcontentloaded", timeout: 10_000 }); const payload = parsePayload(await response?.text()); if (!payload?.ip) throw new Error("Invalid route probe response."); const timing = await page.evaluate(() => { const navigation = performance.getEntriesByType("navigation").at(-1) as PerformanceNavigationTiming | undefined; return navigation && navigation.connectEnd > navigation.connectStart ? navigation.connectEnd - navigation.connectStart : null; }); return { latencyMs: performance.now() - started, connectLatencyMs: timing, payload }; } finally { await page.close().catch(() => undefined); } }
function parsePayload(value: string | undefined): ProbePayload | null { if (!value) return null; try { const parsed = JSON.parse(value) as ProbePayload; return parsed.success === false ? null : parsed; } catch { return null; } }
function normalized(value: number, best: number, worst: number): number { return Math.max(0, Math.min(100, ((worst - value) / (worst - best)) * 100)); }
function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function standardDeviation(values: number[]): number { const mean = values.reduce((sum, value) => sum + value, 0) / values.length; return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length); }
function normalize(value: string): string { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
function classifyNetworkError(error: unknown): string { const message = error instanceof Error ? error.message : ""; return /407|proxy auth/i.test(message) ? "PROXY_AUTH_FAILED" : /proxy|tunnel/i.test(message) ? "PROXY_CONNECTION_FAILED" : /timeout/i.test(message) ? "PROBE_TIMEOUT" : "PROBE_FAILED"; }
function networkMessage(code: string): string { return code === "PROXY_AUTH_FAILED" ? "The proxy rejected its credentials." : code === "PROXY_CONNECTION_FAILED" ? "The proxy could not be reached." : code === "PROBE_TIMEOUT" ? "The HTTPS probe timed out." : "The route probe failed."; }
