import { describe, expect, it } from "vitest";
import { contrastRatio, themeVariables } from "./theme";

/* Only the pure halves are covered here: the rest of theme.ts resolves tokens
   through the DOM, and the suite runs in node. */

describe("contrastRatio", () => {
  it("spans the WCAG range and is order-independent", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#3ecf8e", "#3ecf8e")).toBeCloseTo(1, 5);
  });

  it("agrees with the published AA boundary", () => {
    // #767676 is the darkest grey that still clears 4.5:1 on white.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
  });

  it("scores the shipped palettes as readable", () => {
    expect(contrastRatio("#e8e8ea", "#0a0a0b")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#16161a", "#f7f7f8")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("themeVariables", () => {
  it("emits nothing for an untouched theme so the shipped tokens still apply", () => {
    expect(themeVariables({ accent: null, background: null, foreground: null, contrast: null })).toEqual({});
  });

  it("emits only the overridden properties, including a zeroed contrast step", () => {
    expect(themeVariables({ accent: "#ff0000", background: null, foreground: null, contrast: 0.7 }))
      .toEqual({ "--accent": "#ff0000", "--contrast": "0.7" });
  });
});
