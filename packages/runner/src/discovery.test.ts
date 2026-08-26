import { describe, expect, it } from "vitest";
import { canonicalProductUrl, parsePredictiveProductUrls, parseShopifySitemap, validateDiscoveryHandlers } from "./http-monitor";

describe("discovery mesh helpers", () => {
  it("parses sitemap indexes, products, metadata, and same-origin canonical URLs", () => {
    const parsed = parseShopifySitemap(`<sitemapindex><sitemap><loc>https://eu.supreme.com/sitemap_products_1.xml</loc></sitemap></sitemapindex><urlset><url><loc>https://eu.supreme.com/products/air-max?x=1</loc><lastmod>2026-08-26</lastmod><image:title>Air Max</image:title></url></urlset>`);
    expect(parsed.nested).toEqual(["https://eu.supreme.com/sitemap_products_1.xml"]); expect(parsed.products[0]).toMatchObject({ canonicalUrl: "https://eu.supreme.com/products/air-max", productHandle: "air-max", titleHints: ["Air Max"] });
  });
  it("encodes predictive results as canonical same-origin product URLs", () => { expect(parsePredictiveProductUrls({ resources: { results: { products: [{ handle: "air max" }, { url: "https://evil.test/products/x" }] } } })).toEqual(["https://eu.supreme.com/products/air%20max"]); expect(canonicalProductUrl("/collections/all")).toBeNull(); });
  it("reports missing handler registrations", () => { expect(validateDiscoveryHandlers([{ kind: "collection", handlerId: "missing", cadence: "active-interval", maxResponseBytes: 1024 }], "supreme-product-page-v1")).toEqual(["missing"]); });
});
