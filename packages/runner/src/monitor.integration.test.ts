import { createServer } from "node:http";
import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CrawleeJsonTransport, parseSupremeHtmlProducts } from "./http-monitor";

const enabled = process.env.COPIFY_MONITOR_SMOKE === "1";
describe.skipIf(!enabled)("authorized/local HTTP monitor smoke", () => {
  let endpoint = ""; let close: (() => Promise<void>) | undefined; let proxyClose: (() => Promise<void>) | undefined; let proxyPort = 0; let requests = 0; let proxyConnections = 0;
  beforeAll(async () => {
    const server = createServer((request, response) => { requests += 1; if (request.url === "/challenge") { response.writeHead(429, { "Content-Type": "text/html", "Retry-After": "900" }); response.end("<!doctype html><title>Just a moment</title>"); return; } if (request.url === "/catalog") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end('<!doctype html><script id="products-json" type="application/json">[]</script>'); return; } if (request.headers["if-none-match"] === '"fixture-1"') { response.writeHead(304, { ETag: '"fixture-1"' }); response.end(); return; } response.writeHead(200, { "Content-Type": "application/json", ETag: '"fixture-1"' }); response.end(JSON.stringify({ products: [] })); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start."); endpoint = `http://127.0.0.1:${address.port}/products.json`; close = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const proxy = createServer(); proxy.on("connect", (request, client, head) => { proxyConnections += 1; const [host, rawPort] = (request.url ?? "").split(":"); const upstream = connect(Number(rawPort), host, () => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) upstream.write(head); upstream.pipe(client); client.pipe(upstream); }); upstream.on("error", () => client.destroy()); });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve)); const proxyAddress = proxy.address(); if (!proxyAddress || typeof proxyAddress === "string") throw new Error("Proxy fixture did not start."); proxyPort = proxyAddress.port; proxyClose = () => new Promise((resolve, reject) => { proxy.closeAllConnections(); proxy.close((error) => error ? reject(error) : resolve()); });
  });
  afterAll(async () => { await proxyClose?.(); await close?.(); });
  it("parses JSON and reuses cached data after a conditional 304", async () => { const transport = new CrawleeJsonTransport(); const first = await transport.get(endpoint, { kind: "DIRECT", id: "direct" }, 10_000); const second = await transport.get(endpoint, { kind: "DIRECT", id: "direct" }, 10_000); expect(first.body).toEqual({ products: [] }); expect(second.status).toBe(304); expect(second.bytes).toBe(0); expect(requests).toBe(2); }, 20_000);
  it("routes a scheduled request through the configured proxy", async () => { const transport = new CrawleeJsonTransport(); const response = await transport.get(endpoint, { kind: "PROXY", id: "00000000-0000-4000-8000-000000000001", proxyType: "residential-sticky", protocol: "http", host: "127.0.0.1", port: proxyPort }, 10_000); expect(response.status).toBe(200); expect(proxyConnections).toBeGreaterThan(0); }, 15_000);
  it("returns supported storefront HTML as text", async () => { const response = await new CrawleeJsonTransport().get(new URL("/catalog", endpoint).toString(), { kind: "DIRECT", id: "direct" }, 10_000); expect(response.body).toContain('id="products-json"'); }, 15_000);
  it("preserves HTML protection status and Retry-After without parsing the challenge", async () => { const response = await new CrawleeJsonTransport().get(new URL("/challenge", endpoint).toString(), { kind: "DIRECT", id: "direct" }, 10_000); expect(response).toMatchObject({ status: 429, retryAfterMs: 900_000, body: {} }); }, 15_000);
});

describe.skipIf(process.env.COPIFY_SUPREME_LIVE !== "1")("Supreme public HTML monitor smoke", () => {
  it("retrieves and parses the supported collection page", async () => {
    const response = await new CrawleeJsonTransport().get("https://eu.supreme.com/collections/all", { kind: "DIRECT", id: "direct" }, 20_000);
    const products = parseSupremeHtmlProducts(response.body, { targetId: "00000000-0000-4000-8000-000000000001", name: "Live smoke", storeId: "supreme-eu", productKeywords: ["a"], negativeKeywords: [], preferredColors: [], sizePriority: [], currency: "EUR", maxRetailMinor: 1_000_000, quantity: 1, enabled: true, capturedAt: 1 });
    expect(response.status).toBe(200); expect(response.bytes).toBeLessThan(200_000); expect(products.length).toBeGreaterThan(0); expect(products.some((product) => product.variants.length > 0)).toBe(true);
  }, 30_000);
});
