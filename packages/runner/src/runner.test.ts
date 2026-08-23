import { describe, expect, it } from "vitest";
import { isColorThumbnailTitle, parseShopifyCart, sanitizeText, shippingCountryNames, splitShippingName, withChromeTranslationDisabled } from "./runner";

describe("runner recording redaction", () => {
  it("removes credential-like headers and query values before event persistence", () => {
    const value = sanitizeText("Authorization: Bearer secret-value cookie=session-value https://example.test/?token=abc123");
    expect(value).not.toContain("secret-value");
    expect(value).not.toContain("session-value");
    expect(value).not.toContain("abc123");
    expect(value).toContain("[REDACTED]");
  });
  it("recognizes Supreme EU's visible color-thumbnail label", () => {
    expect(isColorThumbnailTitle("view Small Box Zip Up Hooded Sweatshirt - Navy (image 1 of 2)", "Navy")).toBe(true);
    expect(isColorThumbnailTitle("view Small Box Zip Up Hooded Sweatshirt - Navy (image 2 of 2)", "Navy")).toBe(false);
    expect(isColorThumbnailTitle("view Small Box Zip Up Hooded Sweatshirt - Navy (image 1 of 2)", "Black")).toBe(false);
  });
  it("maps shipping country codes and splits checkout names", () => {
    expect(shippingCountryNames("pt")).toContain("Portugal");
    expect(splitShippingName("Vicente Simões")).toEqual({ firstName: "Vicente", lastName: "Simões" });
  });
  it("keeps existing Chrome preferences while disabling the translate offer", () => {
    expect(withChromeTranslationDisabled({ homepage: "https://example.test", translate: { enabled: true, blocked: ["example.test"] } })).toEqual({ homepage: "https://example.test", translate: { enabled: false, blocked: ["example.test"] } });
  });
  it("reads Shopify cart JSON without navigating the assisted browser tab", () => {
    expect(parseShopifyCart({ item_count: 0, items: [] }, "Capital Hooded Sweatshirt")).toEqual({ state: "EMPTY" });
    expect(parseShopifyCart({ item_count: 1, items: [{ product_title: "Capital Hooded Sweatshirt", title: "Capital Hooded Sweatshirt - Black" }] }, "Capital Hooded Sweatshirt")).toEqual({ state: "ITEMS", itemCount: 1, hasTarget: true });
    expect(parseShopifyCart({ item_count: "1", items: [] }, "Capital Hooded Sweatshirt")).toBeNull();
  });
});
