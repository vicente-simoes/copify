import { Readable, Transform } from "node:stream";
import { HttpCrawler } from "@crawlee/http";
import { Configuration, type BaseHttpClient, type HttpRequest, type HttpResponse, type ResponseTypes, type StreamingHttpResponse } from "@crawlee/core";
import { Agent, ProxyAgent, Socks5ProxyAgent, fetch, type Dispatcher } from "undici";
import { getStoreManifest, type MonitorPolicy, type MonitorRoute, type ProductCandidate, type ProductVariant, type TargetDecision, type TargetSnapshot } from "@copify/shared";

export const MAX_MONITOR_BODY_BYTES = 2 * 1024 * 1024;
export const MONITOR_TIMEOUT_MS = 10_000;
export const ROUTE_UNHEALTHY_MS = 5 * 60_000;
export const SERVICE_COOLDOWN_MS = 60_000;
export const PROTECTION_INITIAL_COOLDOWN_MS = 15 * 60_000;
export const PROTECTION_MAX_COOLDOWN_MS = 6 * 60 * 60_000;

type Headers = Record<string, string | string[] | undefined>;
export type MonitorResponse = { status: number; body: unknown; bytes: number; latencyMs: number; endpoint: string; retryAfterMs: number | null };
export interface MonitorTransport { get(endpoint: string, route: MonitorRoute): Promise<MonitorResponse>; }
export interface HttpStoreAdapter { locateProducts(target: TargetSnapshot): Promise<{ candidates: ProductCandidate[]; response: MonitorResponse }>; }

export class MonitorRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number | null = null, readonly retryAfterMs: number | null = null) { super(message); }
}
export class MonitorPollError extends Error { constructor(readonly route: MonitorRoute, readonly reason: unknown) { super(reason instanceof Error ? reason.message : "Monitor poll failed."); } }
export function normalizeMatch(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " "); }
export function matchesTarget(name: string, target: Pick<TargetSnapshot, "productKeywords" | "negativeKeywords">): boolean { const normalized = normalizeMatch(name); return target.productKeywords.some((keyword) => normalized.includes(normalizeMatch(keyword))) && !target.negativeKeywords.some((keyword) => normalized.includes(normalizeMatch(keyword))); }
export function selectPreferredVariant(candidate: ProductCandidate, target: Pick<TargetSnapshot, "preferredColors" | "sizePriority">): ProductVariant | null {
  const acceptable = candidate.variants.filter((variant) => variant.available && (!target.preferredColors.length || target.preferredColors.some((value) => normalizeMatch(value) === normalizeMatch(variant.color))) && (!target.sizePriority.length || target.sizePriority.some((value) => normalizeMatch(value) === normalizeMatch(variant.size))));
  const rank = (value: string, wanted: string[]) => { const index = wanted.findIndex((item) => normalizeMatch(item) === normalizeMatch(value)); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  return acceptable.sort((left, right) => rank(left.color, target.preferredColors) - rank(right.color, target.preferredColors) || rank(left.size, target.sizePriority) - rank(right.size, target.sizePriority))[0] ?? null;
}
export function decideTarget(target: TargetSnapshot, candidates: ProductCandidate[]): TargetDecision {
  const matched = candidates.filter((candidate) => matchesTarget(candidate.name, target)).sort((a, b) => a.listingOrder - b.listingOrder); if (!matched.length) return { kind: "NO_MATCH", message: "No configured product phrase was found.", candidate: null, selectedVariant: null };
  const candidate = matched[0]; if (!candidate.currency || candidate.priceMinor === null) return { kind: "ERROR", message: "The matching product did not expose a readable price.", candidate, selectedVariant: null }; if (candidate.currency !== target.currency) return { kind: "CURRENCY_MISMATCH", message: `Expected ${target.currency}, found ${candidate.currency}.`, candidate, selectedVariant: null }; if (candidate.priceMinor > target.maxRetailMinor) return { kind: "PRICE_LIMIT_EXCEEDED", message: `Detected price exceeds the configured ${target.currency} limit.`, candidate, selectedVariant: null };
  const selectedVariant = selectPreferredVariant(candidate, target); return selectedVariant ? { kind: "VARIANT_SELECTED", message: "An acceptable product variant was found.", candidate, selectedVariant } : { kind: "NO_ACCEPTABLE_VARIANT", message: "The matching product has no available preferred variant.", candidate, selectedVariant: null };
}
function decimalId(value: unknown): string | null { if (typeof value === "string" && /^\d{1,32}$/.test(value)) return value; if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value); return null; }
function priceMinor(value: unknown): number | null { const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value; return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : null; }
function imageUrl(value: unknown): string | null { const candidate = typeof value === "string" ? value : value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).src === "string" ? String((value as Record<string, unknown>).src) : null; if (!candidate) return null; try { const url = new URL(candidate.startsWith("//") ? `https:${candidate}` : candidate, "https://eu.supreme.com"); url.search = ""; url.hash = ""; return url.protocol === "https:" ? url.toString() : null; } catch { return null; } }
export function parseShopifyProducts(value: unknown, target: TargetSnapshot): ProductCandidate[] {
  const rawProducts = value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as Record<string, unknown>).products) ? (value as Record<string, unknown>).products as unknown[] : Array.isArray(value) ? value : [value];
  return rawProducts.flatMap((item, listingOrder): ProductCandidate[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []; const product = item as Record<string, unknown>; const name = typeof product.title === "string" ? product.title.trim() : ""; const handle = typeof product.handle === "string" ? product.handle.trim() : ""; if (!name || !handle) return [];
    const productColor = typeof product.color === "string" && product.color.trim() ? product.color.trim() : "Default";
    const variants = (Array.isArray(product.variants) ? product.variants : []).flatMap((item): ProductVariant[] => { if (!item || typeof item !== "object" || Array.isArray(item)) return []; const variant = item as Record<string, unknown>; const id = decimalId(variant.id); if (!id) return []; const title = [variant.public_title, variant.option1, variant.title].find((value): value is string => typeof value === "string" && Boolean(value.trim())) ?? "Default"; const color = typeof variant.option2 === "string" && variant.option2.trim() ? variant.option2.trim() : productColor; return [{ id, color, size: title.trim(), available: variant.available === true }]; });
    const firstPrice = variants.length && Array.isArray(product.variants) && product.variants[0] && typeof product.variants[0] === "object" ? priceMinor((product.variants[0] as Record<string, unknown>).price) : null; const url = new URL(`/products/${encodeURIComponent(handle)}`, "https://eu.supreme.com").toString();
    return [{ name, url, imageUrl: imageUrl(product.image) ?? (Array.isArray(product.images) ? imageUrl(product.images[0]) : null), priceMinor: priceMinor(product.price) ?? firstPrice, currency: target.currency, variants, listingOrder }];
  });
}
export function assertMonitorPolicy(target: TargetSnapshot, policy: MonitorPolicy): void { const required = getStoreManifest(target.storeId)?.monitorPolicy; if (!required) throw new MonitorRequestError("MONITOR_ENDPOINT_UNSUPPORTED", "MONITOR_ENDPOINT_UNSUPPORTED"); if (policy.endpoint !== required.endpoint) throw new MonitorRequestError("Monitor endpoint does not match the store manifest.", "INVALID_MONITOR_POLICY"); if (required.access === "PUBLIC" && policy.pollIntervalMs < required.minimumPollIntervalMs) throw new MonitorRequestError(`Public monitor interval cannot be below ${required.minimumPollIntervalMs} ms.`, "INVALID_MONITOR_POLICY"); }
export function protectionCooldownMs(count: number, retryAfterMs: number | null = null): number { return Math.max(retryAfterMs ?? 0, Math.min(PROTECTION_INITIAL_COOLDOWN_MS * (2 ** Math.max(0, count - 1)), PROTECTION_MAX_COOLDOWN_MS)); }
export function parseRetryAfter(value: string | string[] | undefined, now = Date.now()): number | null { const raw = Array.isArray(value) ? value[0] : value; if (!raw) return null; if (/^\d+$/.test(raw.trim())) return Number(raw.trim()) * 1_000; const date = Date.parse(raw); return Number.isFinite(date) ? Math.max(0, date - now) : null; }

export class MonitorConnectionPool {
  private index = 0; private readonly unhealthyUntil = new Map<string, number>(); readonly routes: MonitorRoute[];
  constructor(routes: MonitorRoute[]) { this.routes = routes.length ? routes : [{ kind: "DIRECT", id: "direct" }]; }
  acquire(now = Date.now()): MonitorRoute { const healthy = this.routes.filter((route) => (this.unhealthyUntil.get(route.id) ?? 0) <= now); if (!healthy.length) throw new MonitorRequestError("Every configured monitor route is temporarily unhealthy.", "NO_HEALTHY_ROUTES"); const route = healthy[this.index % healthy.length]; this.index = (this.index + 1) % Number.MAX_SAFE_INTEGER; return route; }
  markUnhealthy(route: MonitorRoute, until: number): void { this.unhealthyUntil.set(route.id, until); }
  healthyCount(now = Date.now()): number { return this.routes.filter((route) => (this.unhealthyUntil.get(route.id) ?? 0) <= now).length; }
}
class SizeLimit extends Transform { private bytes = 0; _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void { this.bytes += chunk.length; callback(this.bytes > MAX_MONITOR_BODY_BYTES ? new MonitorRequestError("Monitor response exceeded the size limit.", "MONITOR_RESPONSE_TOO_LARGE") : null, chunk); } }

export class StandardHttpClient implements BaseHttpClient {
  private readonly dispatchers = new Map<string, Dispatcher>();
  async sendRequest<T extends keyof ResponseTypes = "text">(request: HttpRequest<T>): Promise<HttpResponse<T>> { const streamed = await this.stream(request as HttpRequest); const chunks: Buffer[] = []; for await (const chunk of streamed.stream) chunks.push(Buffer.from(chunk)); const buffer = Buffer.concat(chunks); const body = (request.responseType === "buffer" ? buffer : request.responseType === "json" ? JSON.parse(buffer.toString("utf8")) : buffer.toString(request.encoding ?? "utf8")) as ResponseTypes[T]; return { ...streamed, request, body } as unknown as HttpResponse<T>; }
  async stream(request: HttpRequest): Promise<StreamingHttpResponse> {
    let url = new URL(request.url); const origin = url.origin; const redirects: URL[] = []; let response: Awaited<ReturnType<typeof fetch>> | undefined; const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), request.timeout && "request" in request.timeout ? request.timeout.request : MONITOR_TIMEOUT_MS);
    try { const safeHeaders = Object.fromEntries(Object.entries(request.headers ?? {}).flatMap(([name, value]) => value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]])); for (let count = 0; count <= 3; count += 1) { response = await fetch(url, { method: request.method ?? "GET", headers: safeHeaders, redirect: "manual", signal: request.signal ?? controller.signal, dispatcher: this.dispatcher(request.proxyUrl) }); if (![301, 302, 303, 307, 308].includes(response.status)) break; const location = response.headers.get("location"); if (!location) break; const next = new URL(location, url); if (next.origin !== origin) throw new MonitorRequestError("Cross-origin monitor redirects are not allowed.", "MONITOR_REDIRECT_REJECTED"); redirects.push(next); url = next; } if (!response) throw new MonitorRequestError("The monitor received no response.", "MONITOR_CONNECTION_FAILED"); const headers = Object.fromEntries(response.headers.entries()); const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""; let replacement: string | null = response.status === 304 ? "null" : null; if (response.status !== 304 && !contentType.includes("application/json")) { const body = await response.text(); if (Buffer.byteLength(body) > MAX_MONITOR_BODY_BYTES) throw new MonitorRequestError("Monitor response exceeded the size limit.", "MONITOR_RESPONSE_TOO_LARGE"); if ([403, 429, 503].includes(response.status)) replacement = "{}"; else if (/captcha|access denied|security[ -]check|verify you are human|just a moment/i.test(body)) throw new MonitorRequestError("Storefront access challenge detected.", "STOREFRONT_PROTECTION"); else if (response.status < 400) throw new MonitorRequestError("MONITOR_ENDPOINT_UNSUPPORTED", "MONITOR_ENDPOINT_UNSUPPORTED"); else replacement = "{}"; } if (replacement !== null) headers["content-type"] = "application/json"; const source = replacement !== null ? Readable.from([replacement]) : response.body ? Readable.fromWeb(response.body as never) : Readable.from([]); const stream = source.pipe(new SizeLimit()); return { request, stream, redirectUrls: redirects, url: url.toString(), statusCode: response.status, statusMessage: response.statusText, headers, trailers: {}, complete: true, downloadProgress: { percent: 0, transferred: 0 }, uploadProgress: { percent: 1, transferred: 0 } }; } catch (error) { if (error instanceof MonitorRequestError) throw error; throw new MonitorRequestError(error instanceof Error ? error.message : "Monitor connection failed.", "MONITOR_CONNECTION_FAILED"); } finally { clearTimeout(timeout); }
  }
  private dispatcher(proxyUrl?: string): Dispatcher { const key = proxyUrl ?? "direct"; const existing = this.dispatchers.get(key); if (existing) return existing; const value: Dispatcher = !proxyUrl ? new Agent({ connections: 1 }) : proxyUrl.startsWith("socks") ? new Socks5ProxyAgent(proxyUrl) : new ProxyAgent(proxyUrl); this.dispatchers.set(key, value); return value; }
}
function proxyUrl(route: MonitorRoute): string | undefined { if (route.kind === "DIRECT") return undefined; const url = new URL(`${route.protocol}://${route.host}:${route.port}`); if (route.username) url.username = route.username; if (route.password) url.password = route.password; return url.toString(); }

export class CrawleeJsonTransport implements MonitorTransport {
  private readonly client = new StandardHttpClient(); private readonly cache = new Map<string, { etag?: string; modified?: string; body: unknown }>();
  private readonly configuration = new Configuration({ persistStorage: false, purgeOnStart: false, storageClientOptions: { persistStorage: false } });
  async get(endpoint: string, route: MonitorRoute): Promise<MonitorResponse> {
    const cached = this.cache.get(endpoint); const started = Date.now(); let result: MonitorResponse | undefined; let failure: Error | undefined;
    const crawler = new HttpCrawler({
      httpClient: this.client,
      maxConcurrency: 1,
      minConcurrency: 1,
      maxRequestRetries: 0,
      maxSessionRotations: 0,
      retryOnBlocked: false,
      useSessionPool: false,
      maxRequestsPerCrawl: 1,
      navigationTimeoutSecs: 10,
      ignoreHttpErrorStatusCodes: [403, 429, 503],
      preNavigationHooks: [(_ctx, options) => {
        options.proxyUrl = proxyUrl(route);
        options.useHeaderGenerator = true;
        options.headers = {
          Accept: "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Sec-CH-UA": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          "Sec-CH-UA-Mobile": "?0",
          "Sec-CH-UA-Platform": '"Windows"',
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
          "Accept-Language": "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
          ...(cached?.modified ? { "If-Modified-Since": cached.modified } : {})
        };
        options.followRedirect = true;
        options.maxRedirects = 3;
      }],
      requestHandler: async ({ response, json, body }) => {
        const status = response.statusCode ?? 0;
        const headers = response.headers as Headers;
        const bytes = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(typeof body === "string" ? body : JSON.stringify(json ?? body));
        const retryAfterMs = parseRetryAfter(headers["retry-after"]);
        if (status === 304 && cached) result = { status, body: cached.body, bytes: 0, latencyMs: Date.now() - started, endpoint, retryAfterMs };
        else {
          const parsed = json ?? (Buffer.isBuffer(body) ? JSON.parse(body.toString("utf8")) : JSON.parse(String(body)));
          this.cache.set(endpoint, { etag: header(headers.etag), modified: header(headers["last-modified"]), body: parsed });
          result = { status, body: parsed, bytes, latencyMs: Date.now() - started, endpoint, retryAfterMs };
        }
      },
      failedRequestHandler: async (_ctx, error) => {
        failure = error instanceof Error ? error : new Error(String(error));
      }
    }, this.configuration);
    await crawler.run([{ url: endpoint, uniqueKey: `${endpoint}:${Date.now()}:${Math.random()}`, headers: { Accept: "application/json" } }]); if (failure) throw failure; if (!result) throw new MonitorRequestError("MONITOR_ENDPOINT_UNSUPPORTED", "MONITOR_ENDPOINT_UNSUPPORTED"); return result;
  }
}
function header(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }

export class SupremeHttpAdapter implements HttpStoreAdapter {
  constructor(private readonly transport: MonitorTransport, private readonly route: MonitorRoute, private readonly policy: MonitorPolicy) {}
  async locateProducts(target: TargetSnapshot): Promise<{ candidates: ProductCandidate[]; response: MonitorResponse }> {
    const response = await this.transport.get(this.policy.endpoint, this.route); if (response.status === 403 || response.status === 429) throw new MonitorRequestError(`Storefront returned HTTP ${response.status}.`, "STOREFRONT_PROTECTION", response.status, response.retryAfterMs); if (response.status === 503) throw new MonitorRequestError("Storefront returned HTTP 503.", "STORE_UNAVAILABLE", 503, Math.max(SERVICE_COOLDOWN_MS, response.retryAfterMs ?? 0)); if (response.status >= 400 && response.status !== 304) throw new MonitorRequestError(`Storefront returned HTTP ${response.status}.`, "MONITOR_ENDPOINT_UNSUPPORTED", response.status);
    let candidates = parseShopifyProducts(response.body, target).filter((candidate) => matchesTarget(candidate.name, target)); for (const candidate of candidates.filter((item) => !item.variants.length).slice(0, 3)) { const detail = await this.transport.get(`${candidate.url}.js`, this.route); const parsed = parseShopifyProducts(detail.body, target)[0]; if (parsed) candidates = candidates.map((item) => item.url === candidate.url ? { ...parsed, listingOrder: item.listingOrder } : item); } return { candidates, response };
  }
}

export class HttpStoreMonitor {
  constructor(private readonly transport: MonitorTransport) {}
  async poll(target: TargetSnapshot, policy: MonitorPolicy, routes: MonitorConnectionPool): Promise<{ decision: TargetDecision; candidates: ProductCandidate[]; response: MonitorResponse; route: MonitorRoute }> {
    assertMonitorPolicy(target, policy); const route = routes.acquire(); try { const { candidates, response } = await new SupremeHttpAdapter(this.transport, route, policy).locateProducts(target); return { decision: decideTarget(target, candidates), candidates, response, route }; } catch (error) { throw new MonitorPollError(route, error); }
  }
}
