import { describe, expect, it } from "vitest";
import { HttpStoreMonitor, MonitorConnectionPool, MonitorRequestError, assertMonitorPolicy, decideTarget, parseRetryAfter, parseShopifyProducts, protectionCooldownMs, selectPreferredVariant } from "./http-monitor";
import type { ProductCandidate, TargetSnapshot } from "@copify/shared";

const target: TargetSnapshot = { targetId: "00000000-0000-4000-8000-000000000001", name: "Jacket", storeId: "supreme-eu", productKeywords: ["Leather Jacket"], negativeKeywords: ["Kids"], preferredColors: ["Black", "Red"], sizePriority: ["M", "L"], currency: "EUR", maxRetailMinor: 20_000, quantity: 1, enabled: true, capturedAt: 1 };
const candidate: ProductCandidate = { name: "Leather Jacket", url: "https://eu.supreme.com/products/jacket", imageUrl: null, priceMinor: 19_900, currency: "EUR", listingOrder: 0, variants: [{ id: "1", color: "Red", size: "L", available: true }, { id: "2", color: "Black", size: "M", available: true }] };

describe("HTTP monitor domain", () => {
  it("parses decimal variant IDs and selects the configured priority", () => {
    const parsed = parseShopifyProducts({ products: [{ title: "Leather Jacket", handle: "leather-jacket", image: { src: "https://cdn.shopify.com/a.jpg?v=1" }, variants: [{ id: 123456, option1: "M", option2: "Black", available: true, price: "19900" }] }] }, target);
    expect(parsed[0]).toMatchObject({ name: "Leather Jacket", priceMinor: 19_900, variants: [{ id: "123456", color: "Black", size: "M", available: true }] });
    expect(selectPreferredVariant(candidate, target)?.id).toBe("2"); expect(decideTarget(target, [candidate]).kind).toBe("VARIANT_SELECTED");
  });
  it("hard-enforces the public Supreme cadence and manifest endpoint", () => {
    expect(() => assertMonitorPolicy(target, { access: "PUBLIC", pollIntervalMs: 999, endpoint: "https://eu.supreme.com/collections/all/products.json?limit=250&page=1" })).toThrow(/cannot be below/);
    expect(() => assertMonitorPolicy(target, { access: "PUBLIC", pollIntervalMs: 1_000, endpoint: "https://example.com/products.json" })).toThrow(/manifest/);
    expect(() => assertMonitorPolicy(target, { access: "PUBLIC", pollIntervalMs: 1_000, endpoint: "https://eu.supreme.com/collections/all/products.json?limit=250&page=1" })).not.toThrow();
  });
  it("round-robins healthy routes and never adds direct to a configured pool", () => {
    const routes = [{ kind: "PROXY", id: "00000000-0000-4000-8000-000000000002", protocol: "http", host: "127.0.0.1", port: 8001 }, { kind: "PROXY", id: "00000000-0000-4000-8000-000000000003", protocol: "http", host: "127.0.0.1", port: 8002 }] as const;
    const pool = new MonitorConnectionPool([...routes]); expect(pool.acquire(1).id).toBe(routes[0].id); const second = pool.acquire(1); expect(second.id).toBe(routes[1].id); pool.markUnhealthy(second, 100); expect(pool.acquire(2).id).toBe(routes[0].id); expect(new MonitorConnectionPool([]).acquire().kind).toBe("DIRECT");
  });
  it("uses long bounded protection cooldowns and Retry-After", () => {
    expect(protectionCooldownMs(1)).toBe(15 * 60_000); expect(protectionCooldownMs(10)).toBe(6 * 60 * 60_000); expect(protectionCooldownMs(1, 2 * 60 * 60_000)).toBe(2 * 60 * 60_000); expect(parseRetryAfter("120", 0)).toBe(120_000);
  });
  it("captures route context upon a protection response", async () => {
    let calls = 0;
    const monitor = new HttpStoreMonitor({ get: async () => { calls += 1; throw new MonitorRequestError("protected", "STOREFRONT_PROTECTION", 429, 900_000); } });
    const pool = new MonitorConnectionPool([
      { kind: "PROXY", id: "00000000-0000-4000-8000-000000000002", protocol: "http", host: "127.0.0.1", port: 8001 },
      { kind: "PROXY", id: "00000000-0000-4000-8000-000000000003", protocol: "http", host: "127.0.0.1", port: 8002 }
    ]);
    await expect(monitor.poll(target, { access: "PUBLIC", pollIntervalMs: 1_000, endpoint: "https://eu.supreme.com/collections/all/products.json?limit=250&page=1" }, pool)).rejects.toMatchObject({ route: { port: 8001 }, reason: { code: "STOREFRONT_PROTECTION", status: 429 } });
    expect(calls).toBe(1);
  });
});
