import { describe, expect, it } from "vitest";
import { decideTarget, matchesTarget, parseDisplayedPrice, selectPreferredVariant } from "./monitor";
import type { ProductCandidate, TargetSnapshot } from "@copify/shared";

const target: TargetSnapshot = { targetId: "00000000-0000-4000-8000-000000000001", name: "Jacket", storeId: "supreme-eu", productKeywords: ["Leather Jacket", "Moto"], negativeKeywords: ["Kids"], preferredColors: ["Black", "Red"], sizePriority: ["M", "L"], currency: "GBP", maxRetailMinor: 20_000, quantity: 1, enabled: true, capturedAt: 1 };
const candidate: ProductCandidate = { name: "Leather Jacket", url: "https://eu.supreme.com/products/jacket", priceMinor: 19_900, currency: "GBP", listingOrder: 0, variants: [{ color: "Red", size: "L", available: true }, { color: "Black", size: "M", available: true }, { color: "Black", size: "S", available: true }] };

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
});
