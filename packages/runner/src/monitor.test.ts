import { describe, expect, it } from "vitest";
import { canonicalProductImageUrl, colorFromProductImageAlt, colorFromThumbnailTitle, decideTarget, matchesTarget, parseDisplayedPrice, parseSupremeProductJson, preferredColorRank, selectPreferredVariant, storefrontProtectionBackoffMs } from "./monitor";
import type { ProductCandidate, TargetSnapshot } from "@copify/shared";

const target: TargetSnapshot = { targetId: "00000000-0000-4000-8000-000000000001", name: "Jacket", storeId: "supreme-eu", productKeywords: ["Leather Jacket", "Moto"], negativeKeywords: ["Kids"], preferredColors: ["Black", "Red"], sizePriority: ["M", "L"], currency: "GBP", maxRetailMinor: 20_000, quantity: 1, enabled: true, capturedAt: 1 };
const candidate: ProductCandidate = { name: "Leather Jacket", url: "https://eu.supreme.com/products/jacket", imageUrl: null, priceMinor: 19_900, currency: "GBP", listingOrder: 0, variants: [{ color: "Red", size: "L", available: true }, { color: "Black", size: "M", available: true }, { color: "Black", size: "S", available: true }] };

describe("Supreme EU target engine", () => {
  it("normalizes phrases, rejects negatives, and chooses ordered variants", () => {
    expect(matchesTarget("Léather — Jacket", target)).toBe(true);
    expect(matchesTarget("Kids Leather Jacket", target)).toBe(false);
    expect(selectPreferredVariant(candidate, target)).toEqual({ color: "Black", size: "M", available: true });
  });
  it("parses prices and enforces currency and max retail", () => {
    expect(parseDisplayedPrice("£199.00")).toEqual({ currency: "GBP", priceMinor: 19_900 });
    expect(decideTarget(target, [candidate]).kind).toBe("VARIANT_SELECTED");
    expect(decideTarget({ ...target, maxRetailMinor: 100 }, [candidate]).kind).toBe("PRICE_LIMIT_EXCEEDED");
    expect(decideTarget({ ...target, currency: "EUR" }, [candidate]).kind).toBe("CURRENCY_MISMATCH");
  });
  it("reads Supreme thumbnail color labels without retaining image URLs", () => {
    expect(colorFromThumbnailTitle("view Small Box Zip Up Hooded Sweatshirt - Navy (image 1 of 2)")).toBe("Navy");
    expect(colorFromThumbnailTitle("not a product image")).toBeNull();
    expect(colorFromProductImageAlt("Capital Hooded Sweatshirt - Navy", "Capital Hooded Sweatshirt")).toBe("Navy");
    expect(preferredColorRank("Navy", ["Black", "Navy"])).toBe(1);
    expect(preferredColorRank("Orange", ["Black", "Navy"])).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("parses Supreme's embedded product state without probing controls", () => {
    const parsed = parseSupremeProductJson(
      { title: "Capital Hooded Sweatshirt", color: "Navy", price: 17_800, image: "//cdn.shopify.com/navy.jpg?v=1", variants: [{ title: "Medium", public_title: "Medium", available: true }, { title: "Large", option1: "Large", available: false }] },
      { href: "https://eu.supreme.com/products/hoodie?all=1", name: "Capital Hooded Sweatshirt", color: "Navy", imageUrl: null, priceText: "€178", index: 7 },
    );
    expect(parsed).toMatchObject({ name: "Capital Hooded Sweatshirt", url: "https://eu.supreme.com/products/hoodie", imageUrl: "https://cdn.shopify.com/navy.jpg", priceMinor: 17_800, currency: "EUR", listingOrder: 7, variants: [{ color: "Navy", size: "Medium", available: true }, { color: "Navy", size: "Large", available: false }] });
  });
  it("keeps only a canonical public HTTPS product image URL", () => {
    expect(canonicalProductImageUrl("https://cdn.shopify.com/product.jpg?token=secret#fragment")).toBe("https://cdn.shopify.com/product.jpg");
    expect(canonicalProductImageUrl("http://cdn.shopify.com/product.jpg")).toBeNull();
  });
  it("uses a bounded deterministic backoff for storefront protection responses", () => {
    expect(storefrontProtectionBackoffMs("Storefront returned HTTP 429.", 1)).toBe(60_000);
    expect(storefrontProtectionBackoffMs("Storefront access challenge detected.", 3)).toBe(240_000);
    expect(storefrontProtectionBackoffMs("Storefront returned HTTP 429.", 5)).toBe(300_000);
    expect(storefrontProtectionBackoffMs("The listing did not load.", 1)).toBeNull();
  });
});
