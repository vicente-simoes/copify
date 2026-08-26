import { Readable, Transform } from "node:stream";
import { HttpCrawler } from "@crawlee/http";
import { Configuration, type BaseHttpClient, type HttpRequest, type HttpResponse, type ResponseTypes, type StreamingHttpResponse } from "@crawlee/core";
import { Agent, ProxyAgent, Socks5ProxyAgent, fetch, type Dispatcher } from "undici";
import { getStoreManifest, type DiscoverySource, type DiscoverySourceDescriptor, type MonitorPolicy, type MonitorRoute, type ProductCandidate, type ProductVariant, type TargetDecision, type TargetSnapshot } from "@copify/shared";

export const MAX_MONITOR_BODY_BYTES = 2 * 1024 * 1024;

type Headers = Record<string, string | string[] | undefined>;
export type MonitorResponse = { status: number; body: unknown; bytes: number; sentBytes: number; requestCount: number; latencyMs: number; endpoint: string; retryAfterMs: number | null };
export interface MonitorTransport { get(endpoint: string, route: MonitorRoute, requestTimeoutMs: number, maxResponseBytes?: number): Promise<MonitorResponse>; }
export interface HttpStoreAdapter { locateProducts(target: TargetSnapshot): Promise<{ candidates: ProductCandidate[]; response: MonitorResponse }>; }

export class MonitorRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number | null = null, readonly retryAfterMs: number | null = null, readonly response: MonitorResponse | null = null) { super(message); }
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
  // Supreme exposes colourways as separate catalog records with the same title.
  // Select across every compatible record so a sold-out early colour cannot hide a
  // later preferred colour with an available size.
  const rank = (value: string, wanted: string[]) => { const index = wanted.findIndex((item) => normalizeMatch(item) === normalizeMatch(value)); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  const available = matched
    .filter((item) => item.currency === target.currency && item.priceMinor !== null && item.priceMinor <= target.maxRetailMinor)
    .flatMap((item) => { const selectedVariant = selectPreferredVariant(item, target); return selectedVariant ? [{ candidate: item, selectedVariant }] : []; })
    .sort((left, right) => rank(left.selectedVariant.color, target.preferredColors) - rank(right.selectedVariant.color, target.preferredColors) || rank(left.selectedVariant.size, target.sizePriority) - rank(right.selectedVariant.size, target.sizePriority) || left.candidate.listingOrder - right.candidate.listingOrder);
  const selected = available[0]; return selected ? { kind: "VARIANT_SELECTED", message: "An acceptable product variant was found.", candidate: selected.candidate, selectedVariant: selected.selectedVariant } : { kind: "NO_ACCEPTABLE_VARIANT", message: "The matching product has no available preferred variant.", candidate, selectedVariant: null };
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
function inlineJson(html: string, id: string | RegExp): unknown | null {
  const idPattern = typeof id === "string" ? id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : id.source;
  const match = html.match(new RegExp(`<script\\b(?=[^>]*\\bid=["']${idPattern}["'])[^>]*>([\\s\\S]*?)<\\/script>`, "i"));
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch { return null; }
}
export function parseSupremeHtmlProducts(value: unknown, target: TargetSnapshot): ProductCandidate[] {
  if (typeof value !== "string") return [];
  const catalog = inlineJson(value, "products-json");
  if (catalog !== null) return parseShopifyProducts(catalog, target);
  const product = inlineJson(value, /product-[^"']+-json/);
  return product === null ? [] : parseShopifyProducts(product, target);
}
export function assertMonitorPolicy(target: TargetSnapshot, policy: MonitorPolicy): void { const required = getStoreManifest(target.storeId)?.monitoring; if (!required) throw new MonitorRequestError("MONITOR_ENDPOINT_UNSUPPORTED", "MONITOR_ENDPOINT_UNSUPPORTED"); if (policy.endpoint !== required.endpoint || policy.access !== required.access) throw new MonitorRequestError("Monitor endpoint or access does not match the store manifest.", "INVALID_MONITOR_POLICY"); }
export function parseRetryAfter(value: string | string[] | undefined, now = Date.now()): number | null { const raw = Array.isArray(value) ? value[0] : value; if (!raw) return null; if (/^\d+$/.test(raw.trim())) return Number(raw.trim()) * 1_000; const date = Date.parse(raw); return Number.isFinite(date) ? Math.max(0, date - now) : null; }
export function shouldCoolRouteForProtection(route: MonitorRoute): boolean { return route.kind !== "PROXY" || route.proxyType !== "residential-rotating"; }
export function shouldReuseMonitorConnection(route: MonitorRoute): boolean { return route.kind !== "PROXY" || route.proxyType !== "residential-rotating"; }
export function effectiveRouteCooldown(policy: MonitorPolicy, retryAfterMs: number | null): number { return Math.max(policy.routeUnhealthyMs, policy.honorRetryAfter ? retryAfterMs ?? 0 : 0); }
export function isProtectionHtml(body: string): boolean { return /<title[^>]*>\s*(?:access denied|just a moment|security check)|you do not have permission to access|your request was blocked|verify (?:that )?you are human/i.test(body); }

export class MonitorConnectionPool {
  private index = 0; private readonly unhealthyUntil = new Map<string, number>(); private readonly budgetBlocked = new Set<string>(); readonly routes: MonitorRoute[];
  constructor(routes: MonitorRoute[]) { this.routes = routes.length ? routes : [{ kind: "DIRECT", id: "direct" }]; }
  available(now = Date.now()): MonitorRoute[] { return this.routes.filter((route) => !this.budgetBlocked.has(route.id) && (this.unhealthyUntil.get(route.id) ?? 0) <= now); }
  acquire(now = Date.now()): MonitorRoute { const healthy = this.available(now); if (!healthy.length) throw new MonitorRequestError(this.budgetBlocked.size ? "Every configured monitor route is blocked by a provider budget." : "Every configured monitor route is temporarily unhealthy.", this.budgetBlocked.size ? "BUDGET_CAPPED" : "NO_HEALTHY_ROUTES"); const route = healthy[this.index % healthy.length]; this.index = (this.index + 1) % Number.MAX_SAFE_INTEGER; return route; }
  setBudgetBlocked(routeIds:string[]):void { this.budgetBlocked.clear(); for(const id of routeIds)this.budgetBlocked.add(id); }
  allBudgetBlocked():boolean { return this.routes.length>0&&this.routes.every((route)=>this.budgetBlocked.has(route.id)); }
  markUnhealthy(route: MonitorRoute, until: number): void { this.unhealthyUntil.set(route.id, until); }
  healthyCount(now = Date.now()): number { return this.available(now).length; }
  nextHealthyAt(): number | null { const values = [...this.unhealthyUntil.values()].filter((value) => value > Date.now()); return values.length ? Math.min(...values) : null; }
}
class SizeLimit extends Transform { private bytes = 0; _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void { this.bytes += chunk.length; callback(this.bytes > MAX_MONITOR_BODY_BYTES ? new MonitorRequestError("Monitor response exceeded the size limit.", "MONITOR_RESPONSE_TOO_LARGE") : null, chunk); } }

export class StandardHttpClient implements BaseHttpClient {
  private readonly dispatchers = new Map<string, Dispatcher>();
  private readonly rotatingProxyUrls = new Set<string>();
  setProxyRotation(proxyUrl: string | undefined, rotating: boolean): void { if (!proxyUrl) return; if (rotating) this.rotatingProxyUrls.add(proxyUrl); else this.rotatingProxyUrls.delete(proxyUrl); }
  async sendRequest<T extends keyof ResponseTypes = "text">(request: HttpRequest<T>): Promise<HttpResponse<T>> { const streamed = await this.stream(request as HttpRequest); const chunks: Buffer[] = []; for await (const chunk of streamed.stream) chunks.push(Buffer.from(chunk)); const buffer = Buffer.concat(chunks); const body = (request.responseType === "buffer" ? buffer : request.responseType === "json" ? JSON.parse(buffer.toString("utf8")) : buffer.toString(request.encoding ?? "utf8")) as ResponseTypes[T]; return { ...streamed, request, body } as unknown as HttpResponse<T>; }
  async stream(request: HttpRequest): Promise<StreamingHttpResponse> {
    let url = new URL(request.url); const origin = url.origin; const redirects: URL[] = []; let response: Awaited<ReturnType<typeof fetch>> | undefined; const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), request.timeout && "request" in request.timeout ? request.timeout.request : 10_000); const resolved = this.dispatcher(request.proxyUrl); let streamOwnsDispatcher = false;
    try { const safeHeaders = Object.fromEntries(Object.entries(request.headers ?? {}).flatMap(([name, value]) => value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]])); for (let count = 0; count <= 3; count += 1) { response = await fetch(url, { method: request.method ?? "GET", headers: safeHeaders, redirect: "manual", signal: request.signal ?? controller.signal, dispatcher: resolved.value }); if (![301, 302, 303, 307, 308].includes(response.status)) break; const location = response.headers.get("location"); if (!location) break; const next = new URL(location, url); if (next.origin !== origin) throw new MonitorRequestError("Cross-origin monitor redirects are not allowed.", "MONITOR_REDIRECT_REJECTED"); redirects.push(next); url = next; } if (!response) throw new MonitorRequestError("The monitor received no response.", "MONITOR_CONNECTION_FAILED"); const headers = Object.fromEntries(response.headers.entries()); const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""; let replacement: string | null = response.status === 304 ? "null" : null; let replacementIsJson = response.status === 304; if (response.status !== 304 && !contentType.includes("application/json")) { const body = await response.text(); if (Buffer.byteLength(body) > MAX_MONITOR_BODY_BYTES) throw new MonitorRequestError("Monitor response exceeded the size limit.", "MONITOR_RESPONSE_TOO_LARGE"); if ([403, 429, 503].includes(response.status)) { replacement = "{}"; replacementIsJson = true; } else if (isProtectionHtml(body)) throw new MonitorRequestError("Storefront access challenge detected.", "STOREFRONT_PROTECTION"); else if (response.status < 400 && contentType.includes("text/html")) replacement = body; else if (response.status < 400) throw new MonitorRequestError("MONITOR_ENDPOINT_UNSUPPORTED", "MONITOR_ENDPOINT_UNSUPPORTED"); else { replacement = "{}"; replacementIsJson = true; } } if (replacementIsJson) headers["content-type"] = "application/json"; const source = replacement !== null ? Readable.from([replacement]) : response.body ? Readable.fromWeb(response.body as never) : Readable.from([]); const stream = source.pipe(new SizeLimit()); if (resolved.disposable) { streamOwnsDispatcher = true; let disposed = false; const dispose = () => { if (disposed) return; disposed = true; void resolved.value.close().catch(() => resolved.value.destroy()); }; stream.once("end", dispose); stream.once("error", dispose); stream.once("close", dispose); } return { request, stream, redirectUrls: redirects, url: url.toString(), statusCode: response.status, statusMessage: response.statusText, headers, trailers: {}, complete: true, downloadProgress: { percent: 0, transferred: 0 }, uploadProgress: { percent: 1, transferred: 0 } }; } catch (error) { if (error instanceof MonitorRequestError) throw error; throw new MonitorRequestError(error instanceof Error ? error.message : "Monitor connection failed.", "MONITOR_CONNECTION_FAILED"); } finally { clearTimeout(timeout); if (resolved.disposable && !streamOwnsDispatcher) resolved.value.destroy(); }
  }
  private dispatcher(proxyUrl?: string): { value: Dispatcher; disposable: boolean } { const key = proxyUrl ?? "direct"; const rotating = Boolean(proxyUrl && this.rotatingProxyUrls.has(proxyUrl)); if (!rotating) { const existing = this.dispatchers.get(key); if (existing) return { value: existing, disposable: false }; } const value: Dispatcher = !proxyUrl ? new Agent({ connections: 1 }) : proxyUrl.startsWith("socks") ? new Socks5ProxyAgent(proxyUrl) : new ProxyAgent(proxyUrl); if (!rotating) this.dispatchers.set(key, value); return { value, disposable: rotating }; }
}
function proxyUrl(route: MonitorRoute): string | undefined { if (route.kind === "DIRECT") return undefined; const url = new URL(`${route.protocol}://${route.host}:${route.port}`); if (route.username) url.username = route.username; if (route.password) url.password = route.password; return url.toString(); }

export class CrawleeJsonTransport implements MonitorTransport {
  private readonly client = new StandardHttpClient(); private readonly cache = new Map<string, { etag?: string; modified?: string; body: unknown }>();
  private readonly configuration = new Configuration({ persistStorage: false, purgeOnStart: false, storageClientOptions: { persistStorage: false } });
  async get(endpoint: string, route: MonitorRoute, requestTimeoutMs: number, maxResponseBytes = MAX_MONITOR_BODY_BYTES): Promise<MonitorResponse> {
    const cacheKey = `${route.id}:${endpoint}`; const cached = this.cache.get(cacheKey); const started = Date.now(); let result: MonitorResponse | undefined; let failure: Error | undefined; let sentBytes = 0; const routeProxyUrl = proxyUrl(route); this.client.setProxyRotation(routeProxyUrl, !shouldReuseMonitorConnection(route));
    const crawler = new HttpCrawler({
      httpClient: this.client,
      maxConcurrency: 1,
      minConcurrency: 1,
      maxRequestRetries: 0,
      maxSessionRotations: 0,
      retryOnBlocked: false,
      useSessionPool: false,
      maxRequestsPerCrawl: 1,
      navigationTimeoutSecs: Math.ceil(requestTimeoutMs / 1_000),
      ignoreHttpErrorStatusCodes: [403, 429, 503],
      preNavigationHooks: [(_ctx, options) => {
        options.proxyUrl = routeProxyUrl;
        options.useHeaderGenerator = true;
        options.headers = {
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Sec-CH-UA": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          "Sec-CH-UA-Mobile": "?0",
          "Sec-CH-UA-Platform": '"Windows"',
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
          "Accept-Language": "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "Accept-Encoding": "br, gzip, deflate",
          ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
          ...(cached?.modified ? { "If-Modified-Since": cached.modified } : {})
        };
        sentBytes = Buffer.byteLength(endpoint) + Object.entries(options.headers).reduce((sum, [name, value]) => sum + Buffer.byteLength(name) + Buffer.byteLength(String(value)), 0);
        options.followRedirect = true;
        options.maxRedirects = 3;
      }],
      requestHandler: async ({ response, json, body }) => {
        const status = response.statusCode ?? 0;
        const headers = response.headers as Headers;
        const decodedBytes = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(typeof body === "string" ? body : JSON.stringify(json ?? body));
        const contentLength = header(headers["content-length"]); const bytes = contentLength && /^\d+$/.test(contentLength) ? Number(contentLength) : decodedBytes;
        const retryAfterMs = parseRetryAfter(headers["retry-after"]);
        if (status === 304 && cached) result = { status, body: cached.body, bytes: 0, sentBytes, requestCount: 1, latencyMs: Date.now() - started, endpoint, retryAfterMs };
        else {
          const raw = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
          const contentType = header(headers["content-type"])?.toLowerCase() ?? "";
          const parsed = contentType.includes("application/json") ? json ?? JSON.parse(raw) : raw;
          this.cache.set(cacheKey, { etag: header(headers.etag), modified: header(headers["last-modified"]), body: parsed });
          result = { status, body: parsed, bytes, sentBytes, requestCount: 1, latencyMs: Date.now() - started, endpoint, retryAfterMs };
        }
      },
      failedRequestHandler: async (_ctx, error) => {
        failure = error instanceof Error ? error : new Error(String(error));
      }
    }, this.configuration);
    await crawler.run([{ url: endpoint, uniqueKey: `${endpoint}:${Date.now()}:${Math.random()}` }]); if (failure) throw failure; if (!result) throw new MonitorRequestError("MONITOR_ENDPOINT_UNSUPPORTED", "MONITOR_ENDPOINT_UNSUPPORTED"); if (result.bytes > maxResponseBytes) throw new MonitorRequestError("Monitor response exceeded the source size limit.", "MONITOR_RESPONSE_TOO_LARGE", result.status, null, result); return result;
  }
}
function header(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }

export class SupremeHttpAdapter implements HttpStoreAdapter {
  private knownCandidates: ProductCandidate[] = [];
  private lastDiscoveryAt = 0;
  private static readonly DISCOVERY_REFRESH_MS = 60_000;
  constructor(private readonly transport: MonitorTransport, private readonly route: MonitorRoute, private readonly policy: MonitorPolicy) {}
  async locateProducts(target: TargetSnapshot): Promise<{ candidates: ProductCandidate[]; response: MonitorResponse }> {
    if (target.directProductUrl) {
      const response = await this.checkedGet(target.directProductUrl);
      const candidates = parseSupremeHtmlProducts(response.body, target).filter((candidate) => matchesTarget(candidate.name, target));
      return { candidates: this.preferredColorCandidates(candidates, target), response };
    }
    if (!this.knownCandidates.length || Date.now() - this.lastDiscoveryAt >= SupremeHttpAdapter.DISCOVERY_REFRESH_MS) {
      const response = await this.checkedGet(this.policy.endpoint);
      const candidates = parseSupremeHtmlProducts(response.body, target).filter((candidate) => matchesTarget(candidate.name, target));
      this.knownCandidates = this.preferredColorCandidates(candidates, target); this.lastDiscoveryAt = Date.now();
      return { candidates: this.knownCandidates, response };
    }
    const responses: MonitorResponse[] = []; const refreshed: ProductCandidate[] = [];
    for (const candidate of this.knownCandidates) {
      const response = await this.checkedGet(candidate.url); responses.push(response);
      const parsed = parseSupremeHtmlProducts(response.body, target)[0]; if (parsed) refreshed.push({ ...parsed, listingOrder: candidate.listingOrder });
    }
    if (refreshed.length) this.knownCandidates = refreshed;
    return { candidates: this.knownCandidates, response: combineResponses(responses, this.policy.endpoint) };
  }
  private preferredColorCandidates(candidates: ProductCandidate[], target: TargetSnapshot): ProductCandidate[] {
    if (!target.preferredColors.length) return candidates;
    const filtered = candidates.filter((candidate) => candidate.variants.some((variant) => target.preferredColors.some((color) => normalizeMatch(color) === normalizeMatch(variant.color))));
    return filtered.length ? filtered : candidates;
  }
  private async checkedGet(endpoint: string): Promise<MonitorResponse> {
    const response = await this.transport.get(endpoint, this.route, this.policy.requestTimeoutMs); if (response.status === 407) throw new MonitorRequestError("Proxy authentication failed.", "PROXY_AUTH_FAILED", 407, null, response); if (response.status === 403 || response.status === 429) throw new MonitorRequestError(`Storefront returned HTTP ${response.status}.`, "STOREFRONT_PROTECTION", response.status, response.retryAfterMs, response); if (response.status === 503) throw new MonitorRequestError("Storefront returned HTTP 503.", "STOREFRONT_SERVICE_UNAVAILABLE", 503, response.retryAfterMs, response); if (response.status >= 400 && response.status !== 304) throw new MonitorRequestError(`Storefront returned HTTP ${response.status}.`, "MONITOR_ENDPOINT_UNSUPPORTED", response.status, null, response); return response;
  }
}

function combineResponses(responses: MonitorResponse[], endpoint: string): MonitorResponse {
  if (!responses.length) throw new MonitorRequestError("The storefront returned no product detail responses.", "MONITOR_ENDPOINT_UNSUPPORTED");
  const latest = responses[responses.length - 1];
  return { ...latest, endpoint, bytes: responses.reduce((sum, item) => sum + item.bytes, 0), sentBytes: responses.reduce((sum, item) => sum + item.sentBytes, 0), requestCount: responses.reduce((sum, item) => sum + item.requestCount, 0), latencyMs: responses.reduce((sum, item) => sum + item.latencyMs, 0) };
}

export type DiscoveryDiagnostic = { type: "DISCOVERY_SOURCE_PROBED" | "DISCOVERY_SOURCE_UNAVAILABLE" | "DISCOVERY_CANDIDATE_FOUND" | "DISCOVERY_CANDIDATE_HYDRATED" | "DISCOVERY_MESH_WINNER"; source: DiscoverySource; routeId: string; payload: Record<string, unknown> };
export type SitemapCandidate = { canonicalUrl: string; productHandle: string | null; titleHints: string[]; modifiedAt: number | null };
const REGISTERED_DISCOVERY_HANDLERS = new Set(["supreme-product-page-v1", "supreme-collection-v1", "shopify-sitemap-v1", "shopify-predictive-search-v1"]);
export function validateDiscoveryHandlers(descriptors: DiscoverySourceDescriptor[], hydrationHandlerId: string): string[] {
  return [...new Set([...descriptors.map((source) => source.handlerId), hydrationHandlerId])].filter((id) => !REGISTERED_DISCOVERY_HANDLERS.has(id));
}
export function canonicalProductUrl(value: string, origin = "https://eu.supreme.com"): string | null {
  try { const url = new URL(value, origin); if (url.protocol !== "https:" || url.origin !== new URL(origin).origin || !url.pathname.includes("/products/")) return null; url.search = ""; url.hash = ""; return url.toString(); } catch { return null; }
}
export function parseShopifySitemap(value: unknown, origin = "https://eu.supreme.com"): { nested: string[]; products: SitemapCandidate[] } {
  if (typeof value !== "string") return { nested: [], products: [] }; const nested: string[] = []; const products: SitemapCandidate[] = [];
  for (const block of value.match(/<(?:sitemap|url)\b[\s\S]*?<\/(?:sitemap|url)>/gi) ?? []) {
    const location = block.match(/<loc[^>]*>([\s\S]*?)<\/loc>/i)?.[1]?.trim().replaceAll("&amp;", "&"); if (!location) continue;
    if (/sitemap/i.test(block.slice(0, 20)) || /sitemap.*\.xml/i.test(location)) { try { const url = new URL(location, origin); if (url.origin === new URL(origin).origin) nested.push(url.toString()); } catch { /* ignored */ } continue; }
    const canonicalUrl = canonicalProductUrl(location, origin); if (!canonicalUrl) continue; const handle = new URL(canonicalUrl).pathname.split("/products/")[1]?.split("/")[0] ?? null;
    const titleHints = [...block.matchAll(/<image:(?:title|caption)[^>]*>([\s\S]*?)<\/image:(?:title|caption)>/gi)].map((match) => match[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim()).filter(Boolean);
    const modified = block.match(/<lastmod[^>]*>([\s\S]*?)<\/lastmod>/i)?.[1]?.trim(); const parsed = modified ? Date.parse(modified) : NaN;
    products.push({ canonicalUrl, productHandle: handle, titleHints, modifiedAt: Number.isFinite(parsed) ? parsed : null });
  }
  return { nested: [...new Set(nested)], products: [...new Map(products.map((item) => [item.canonicalUrl, item])).values()] };
}
export function parsePredictiveProductUrls(value: unknown, origin = "https://eu.supreme.com"): string[] {
  const products = value && typeof value === "object" && !Array.isArray(value) ? (value as any).resources?.results?.products : null;
  if (!Array.isArray(products)) return []; return [...new Set(products.flatMap((product) => { const raw = product?.url ?? (product?.handle ? `/products/${product.handle}` : null); const url = typeof raw === "string" ? canonicalProductUrl(raw, origin) : null; return url ? [url] : []; }))];
}

class DiscoveryMesh {
  private readonly seen = new Set<string>(); private sequence = 0; private lastSitemapAt = 0;
  private readonly backoff = new Map<DiscoverySource, { until: number; attempts: number }>();
  constructor(private readonly transport: MonitorTransport, private readonly policy: MonitorPolicy) {}
  async poll(target: TargetSnapshot, routes: MonitorConnectionPool, turbo = false): Promise<{ decision: TargetDecision; candidates: ProductCandidate[]; response: MonitorResponse; route: MonitorRoute; diagnostics: DiscoveryDiagnostic[] }> {
    const manifest = getStoreManifest(target.storeId); const monitoring = manifest?.monitoring; if (!monitoring) throw new MonitorRequestError("Monitoring is unsupported.", "MONITOR_ENDPOINT_UNSUPPORTED");
    const missing = validateDiscoveryHandlers(monitoring.sources, monitoring.hydrationHandlerId); if (missing.length) throw new MonitorRequestError(`Discovery handlers are unavailable: ${missing.join(", ")}`, "MONITOR_ENDPOINT_UNSUPPORTED");
    const descriptors = target.directProductUrl ? monitoring.sources.filter((source) => source.kind === "direct-product") : monitoring.sources.filter((source) => source.kind !== "direct-product");
    const due = descriptors.filter((source) => (this.backoff.get(source.kind)?.until ?? 0) <= Date.now() && (source.cadence !== "adaptive-sitemap" || Date.now() - this.lastSitemapAt >= (turbo ? 5_000 : 30_000))); if (due.some((source) => source.kind === "product-sitemap")) this.lastSitemapAt = Date.now();
    const availableRoutes=routes.available(); if(!availableRoutes.length)routes.acquire();
    const allocation = new Map(due.map((source, index) => [source.kind, availableRoutes[index % availableRoutes.length]!]));
    const diagnostics: DiscoveryDiagnostic[] = []; const responses: MonitorResponse[] = []; const allCandidates: ProductCandidate[] = []; const failures: unknown[] = [];
    const probeSource = async (source: DiscoverySourceDescriptor) => {
      const route = allocation.get(source.kind)!; const started = Date.now();
      try {
        const candidates = await this.sourceCandidates(source, target, route, diagnostics, responses); this.backoff.delete(source.kind); allCandidates.push(...candidates); const decision = decideTarget(target, candidates);
        diagnostics.push({ type: "DISCOVERY_SOURCE_PROBED", source: source.kind, routeId: route.id, payload: { durationMs: Date.now() - started, responseBytes: responses.at(-1)?.bytes ?? 0, candidateCount: candidates.length, statusClass: responses.at(-1) ? Math.floor(responses.at(-1)!.status / 100) : null } });
        if (decision.kind !== "VARIANT_SELECTED" || !decision.candidate || !decision.selectedVariant) throw new Error("NO_VERIFIED_MATCH");
        const key = `${decision.candidate.url}:${decision.selectedVariant.id}`; if (this.seen.has(key)) throw new Error("DUPLICATE_WINNER"); this.seen.add(key); this.sequence += 1;
        diagnostics.push({ type: "DISCOVERY_MESH_WINNER", source: source.kind, routeId: route.id, payload: { sequence: this.sequence, variantId: decision.selectedVariant.id, verifiedElapsedNs: (BigInt(Date.now()) * 1_000_000n).toString() } }); return { decision, route };
      } catch (error) { if (!/NO_VERIFIED_MATCH|DUPLICATE_WINNER/.test(error instanceof Error ? error.message : "")) { failures.push(error); const previous = this.backoff.get(source.kind)?.attempts ?? 0; const protection = error instanceof MonitorRequestError && (error.status === 403 || error.status === 429); const delay = protection ? Math.min(600_000, (error.retryAfterMs ?? 60_000) * 2 ** previous) : Math.min(300_000, 5_000 * 2 ** previous); const backoffUntil = Date.now() + delay; this.backoff.set(source.kind, { until: backoffUntil, attempts: previous + 1 }); diagnostics.push({ type: "DISCOVERY_SOURCE_UNAVAILABLE", source: source.kind, routeId: route.id, payload: { reasonCode: error instanceof MonitorRequestError ? error.code : "SOURCE_FAILED", backoffUntil } }); } throw error; }
    };
    // Simultaneous probes sharing a route can trip storefront protection before the
    // reliable collection endpoint is read. Preserve the race across distinct routes,
    // but serialize a reused route (including Direct) with collection first.
    const tasks = routes.routes.length < due.length
      ? [(async () => {
        let lastError: unknown = new Error("NO_VERIFIED_MATCH");
        for (const source of due) {
          try { return await probeSource(source); } catch (error) { lastError = error; }
        }
        throw lastError;
      })()]
      : due.map((source) => probeSource(source));
    let winner: { decision: TargetDecision; route: MonitorRoute } | null = null; try { winner = await Promise.any(tasks); } catch { await Promise.allSettled(tasks); }
    if (!winner && failures.length === due.length && failures.length) throw failures[0];
    const response = responses.length ? combineResponses(responses, monitoring.endpoint) : { status: 200, body: null, bytes: 0, sentBytes: 0, requestCount: 0, latencyMs: 0, endpoint: monitoring.endpoint, retryAfterMs: null };
    const route = winner?.route ?? allocation.values().next().value ?? routes.acquire(); return { decision: winner?.decision ?? decideTarget(target, allCandidates), candidates: allCandidates, response, route, diagnostics };
  }
  private async sourceCandidates(source: DiscoverySourceDescriptor, target: TargetSnapshot, route: MonitorRoute, diagnostics: DiscoveryDiagnostic[], responses: MonitorResponse[]): Promise<ProductCandidate[]> {
    const origin = new URL(this.policy.endpoint).origin; const get = async (url: string) => { const response = await this.transport.get(url, route, this.policy.requestTimeoutMs, source.maxResponseBytes); responses.push(response); if (response.status >= 400 && response.status !== 304) throw new MonitorRequestError(`Discovery source returned ${response.status}.`, "STOREFRONT_PROTECTION", response.status, response.retryAfterMs, response); return response; };
    if (source.kind === "direct-product" || source.kind === "collection") { const url = source.kind === "direct-product" ? target.directProductUrl! : new URL(source.pathTemplate ?? "/collections/all", origin).toString(); const response = await get(url); return parseSupremeHtmlProducts(response.body, target); }
    let urls: string[] = [];
    if (source.kind === "predictive-search") { for (const phrase of target.productKeywords.slice(0, 3)) { const url = new URL(source.pathTemplate ?? "/search/suggest.json", origin); url.searchParams.set("q", phrase); url.searchParams.set("resources[type]", "product"); urls.push(...parsePredictiveProductUrls((await get(url.toString())).body, origin)); } }
    if (source.kind === "product-sitemap") { const root = parseShopifySitemap((await get(new URL(source.pathTemplate ?? "/sitemap.xml", origin).toString())).body, origin); let products = root.products; for (const nested of root.nested.slice(0, 20)) products.push(...parseShopifySitemap((await get(nested)).body, origin).products); urls = products.filter((item) => item.titleHints.some((hint) => matchesTarget(hint, target)) || item.productHandle && matchesTarget(item.productHandle, target)).map((item) => item.canonicalUrl); }
    const hydrated: ProductCandidate[] = []; for (const url of [...new Set(urls)].slice(0, 20)) { diagnostics.push({ type: "DISCOVERY_CANDIDATE_FOUND", source: source.kind, routeId: route.id, payload: { candidateKey: url } }); const started = Date.now(); const parsed = parseSupremeHtmlProducts((await get(url)).body, target); hydrated.push(...parsed); diagnostics.push({ type: "DISCOVERY_CANDIDATE_HYDRATED", source: source.kind, routeId: route.id, payload: { candidateKey: url, accepted: parsed.length > 0, durationMs: Date.now() - started } }); } return hydrated;
  }
}

export class HttpStoreMonitor {
  private readonly adapters = new Map<string, SupremeHttpAdapter>();
  private readonly meshes = new Map<string, DiscoveryMesh>();
  constructor(private readonly transport: MonitorTransport) {}
  async poll(target: TargetSnapshot, policy: MonitorPolicy, routes: MonitorConnectionPool, turbo = false): Promise<{ decision: TargetDecision; candidates: ProductCandidate[]; response: MonitorResponse; route: MonitorRoute; diagnostics: DiscoveryDiagnostic[] }> {
    assertMonitorPolicy(target, policy); const route = routes.acquire(); try { const key = `${target.targetId}:${target.capturedAt}`; let mesh = this.meshes.get(key); if (!mesh) { mesh = new DiscoveryMesh(this.transport, policy); this.meshes.set(key, mesh); } return await mesh.poll(target, routes, turbo); } catch (error) { throw new MonitorPollError(route, error); }
  }
}
