import { describe, expect, it } from "vitest";
import { HttpStoreMonitor, MonitorConnectionPool, MonitorRequestError, SupremeHttpAdapter, assertMonitorPolicy, decideTarget, effectiveRouteCooldown, isProtectionHtml, parseRetryAfter, parseShopifyProducts, parseSupremeHtmlProducts, selectPreferredVariant, shouldCoolRouteForProtection, shouldReuseMonitorConnection } from "./http-monitor";
import { DEFAULT_MONITOR_BEHAVIOR, type MonitorPolicy, type ProductCandidate, type TargetSnapshot } from "@copify/shared";

const target: TargetSnapshot = { targetId: "00000000-0000-4000-8000-000000000001", name: "Jacket", storeId: "supreme-eu", productKeywords: ["Leather Jacket"], negativeKeywords: ["Kids"], directProductUrl: null, preferredColors: ["Black", "Red"], sizePriority: ["M", "L"], currency: "EUR", maxRetailMinor: 20_000, quantity: 1, enabled: true, capturedAt: 1 };
const candidate: ProductCandidate = { name: "Leather Jacket", url: "https://eu.supreme.com/products/jacket", imageUrl: null, priceMinor: 19_900, currency: "EUR", listingOrder: 0, variants: [{ id: "1", color: "Red", size: "L", available: true }, { id: "2", color: "Black", size: "M", available: true }] };
const policy = (over: Partial<MonitorPolicy> = {}): MonitorPolicy => ({ ...DEFAULT_MONITOR_BEHAVIOR, access: "PUBLIC", recommendedPollIntervalMs: 1_000, endpoint: "https://eu.supreme.com/collections/all", ...over });

describe("HTTP monitor domain", () => {
  it("parses decimal variant IDs and selects the configured priority", () => {
    const parsed = parseShopifyProducts({ products: [{ title: "Leather Jacket", handle: "leather-jacket", image: { src: "https://cdn.shopify.com/a.jpg?v=1" }, variants: [{ id: 123456, option1: "M", option2: "Black", available: true, price: "19900" }] }] }, target);
    expect(parsed[0]).toMatchObject({ name: "Leather Jacket", priceMinor: 19_900, variants: [{ id: "123456", color: "Black", size: "M", available: true }] });
    expect(selectPreferredVariant(candidate, target)?.id).toBe("2"); expect(decideTarget(target, [candidate]).kind).toBe("VARIANT_SELECTED");
  });
  it("parses Supreme catalog and product HTML JSON without loading page assets", () => {
    const product = { title: "Leather Jacket", handle: "leather-jacket", color: "Black", price: 19_900, variants: [{ id: 123456, option1: "M", available: true, price: 19_900 }] };
    expect(parseSupremeHtmlProducts(`<html><script id="products-json" type="application/json">${JSON.stringify([product])}</script></html>`, target)[0]).toMatchObject({ name: "Leather Jacket", variants: [{ id: "123456", color: "Black" }] });
    expect(parseSupremeHtmlProducts(`<script type='application/json' id='product-leather-jacket-json'>${JSON.stringify(product)}</script>`, target)).toHaveLength(1);
    expect(isProtectionHtml('<script>const captchaProvider = "shopify"</script><main>Products</main>')).toBe(false);
    expect(isProtectionHtml("<title>Access denied</title><p>Your request was blocked.</p>")).toBe(true);
  });
  it("discovers through collection HTML once, then polls only matching product HTML", async () => {
    const product = { title: "Leather Jacket", handle: "leather-jacket", color: "Black", price: 19_900, variants: [{ id: 123456, option1: "M", available: false, price: 19_900 }] };
    const calls: string[] = [];
    const adapter = new SupremeHttpAdapter({ get: async (endpoint) => { calls.push(endpoint); const body = calls.length === 1 ? `<script id="products-json" type="application/json">${JSON.stringify([product])}</script>` : `<script id="product-leather-jacket-json" type="application/json">${JSON.stringify({ ...product, variants: [{ ...product.variants[0], available: true }] })}</script>`; return { status: 200, body, bytes: body.length, sentBytes: 100, requestCount: 1, latencyMs: 5, endpoint, retryAfterMs: null }; } }, { kind: "DIRECT", id: "direct" }, policy());
    expect((await adapter.locateProducts(target)).candidates[0]?.variants[0]?.available).toBe(false);
    expect((await adapter.locateProducts(target)).candidates[0]?.variants[0]?.available).toBe(true);
    expect(calls).toEqual([policy().endpoint, "https://eu.supreme.com/products/leather-jacket"]);
  });
  it("polls an explicit product URL directly instead of the collection catalog", async () => {
    const product = { title: "Leather Jacket", handle: "leather-jacket", color: "Black", price: 19_900, variants: [{ id: 123456, option1: "M", available: true, price: 19_900 }] };
    const directUrl = "https://eu.supreme.com/products/leather-jacket?all=1";
    const calls: string[] = [];
    const adapter = new SupremeHttpAdapter({ get: async (endpoint) => {
      calls.push(endpoint); const body = `<script type='application/json' id='product-leather-jacket-json'>${JSON.stringify(product)}</script>`;
      return { status: 200, body, bytes: body.length, sentBytes: 100, requestCount: 1, latencyMs: 5, endpoint, retryAfterMs: null };
    } }, { kind: "DIRECT", id: "direct" }, policy());
    const directTarget = { ...target, directProductUrl: directUrl };
    expect((await adapter.locateProducts(directTarget)).candidates[0]).toMatchObject({ name: "Leather Jacket", url: "https://eu.supreme.com/products/leather-jacket" });
    await adapter.locateProducts(directTarget);
    expect(calls).toEqual([directUrl, directUrl]);
  });
  it("allows user cadence below the recommendation but enforces the manifest endpoint", () => {
    expect(() => assertMonitorPolicy(target, policy({ pollIntervalMs: 200 }))).not.toThrow();
    expect(() => assertMonitorPolicy(target, policy({ endpoint: "https://example.com/products.json" }))).toThrow(/manifest/);
  });
  it("round-robins healthy routes and never adds direct to a configured pool", () => {
    const routes = [{ kind: "PROXY", id: "00000000-0000-4000-8000-000000000002", proxyType: "residential-sticky", protocol: "http", host: "127.0.0.1", port: 8001 }, { kind: "PROXY", id: "00000000-0000-4000-8000-000000000003", proxyType: "residential-sticky", protocol: "http", host: "127.0.0.1", port: 8002 }] as const;
    const pool = new MonitorConnectionPool([...routes]); expect(pool.acquire(1).id).toBe(routes[0].id); const second = pool.acquire(1); expect(second.id).toBe(routes[1].id); pool.markUnhealthy(second, 100); expect(pool.acquire(2).id).toBe(routes[0].id); expect(new MonitorConnectionPool([]).acquire().kind).toBe("DIRECT");
  });
  it("keeps a rotating gateway available after four sticky routes are cooled", () => {
    const routes = [
      ...[1, 2, 3, 4].map((port, index) => ({ kind: "PROXY" as const, id: `00000000-0000-4000-8000-00000000000${index + 2}`, proxyType: "residential-sticky" as const, protocol: "http" as const, host: "127.0.0.1", port: 8_000 + port })),
      { kind: "PROXY" as const, id: "00000000-0000-4000-8000-000000000006", proxyType: "residential-rotating" as const, protocol: "http" as const, host: "127.0.0.1", port: 8_005 },
    ];
    const pool = new MonitorConnectionPool(routes);
    expect(Array.from({ length: 5 }, () => pool.acquire(1).id)).toEqual(routes.map((route) => route.id));
    routes.slice(0, 4).forEach((route) => pool.markUnhealthy(route, 1_000));
    expect(pool.healthyCount(2)).toBe(1);
    expect(pool.acquire(2)).toMatchObject({ id: routes[4].id, proxyType: "residential-rotating" });
    expect(shouldCoolRouteForProtection(routes[4])).toBe(false);
  });
  it("parses Retry-After", () => {
    expect(parseRetryAfter("120", 0)).toBe(120_000);
  });
  it("keeps rotating gateways healthy on protection and cools sticky routes", () => {
    const rotating = { kind: "PROXY", id: "00000000-0000-4000-8000-000000000002", proxyType: "residential-rotating", protocol: "http", host: "proxy", port: 1 } as const;
    const sticky = { ...rotating, proxyType: "residential-sticky" as const };
    expect(shouldCoolRouteForProtection(rotating)).toBe(false); expect(shouldCoolRouteForProtection(sticky)).toBe(true);
    expect(shouldReuseMonitorConnection(rotating)).toBe(false); expect(shouldReuseMonitorConnection(sticky)).toBe(true);
    expect(effectiveRouteCooldown(policy(), 900_000)).toBe(900_000); expect(effectiveRouteCooldown(policy({ honorRetryAfter: false }), 900_000)).toBe(300_000);
  });
  it("captures route context upon a protection response", async () => {
    let calls = 0;
    const monitor = new HttpStoreMonitor({ get: async () => { calls += 1; throw new MonitorRequestError("protected", "STOREFRONT_PROTECTION", 429, 900_000); } });
    const pool = new MonitorConnectionPool([
      { kind: "PROXY", id: "00000000-0000-4000-8000-000000000002", proxyType: "residential-sticky", protocol: "http", host: "127.0.0.1", port: 8001 },
      { kind: "PROXY", id: "00000000-0000-4000-8000-000000000003", proxyType: "residential-sticky", protocol: "http", host: "127.0.0.1", port: 8002 }
    ]);
    await expect(monitor.poll(target, policy(), pool)).rejects.toMatchObject({ route: { port: 8001 }, reason: { code: "STOREFRONT_PROTECTION", status: 429 } });
    expect(calls).toBe(1);
  });
});
