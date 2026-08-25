import { describe, expect, it } from "vitest";
import { matchesQuery } from "./ListFilter";

describe("matchesQuery", () => {
  it("keeps every row until something is typed", () => {
    expect(matchesQuery("", "PT ISP 01")).toBe(true);
    expect(matchesQuery("   ", "PT ISP 01")).toBe(true);
  });

  it("matches any field, case- and whitespace-insensitively", () => {
    expect(matchesQuery("isp", "PT ISP 01", "residential")).toBe(true);
    expect(matchesQuery("  RESIDENTIAL  ", "PT ISP 01", "residential")).toBe(true);
    expect(matchesQuery("proxy.example:8080", "PT ISP 01", "proxy.example:8080")).toBe(true);
    expect(matchesQuery("datacenter", "PT ISP 01", "residential")).toBe(false);
  });

  it("skips absent fields rather than throwing on them", () => {
    // Country and provider are nullable on several of the rows this filters.
    expect(matchesQuery("home", "Home", null, undefined)).toBe(true);
    expect(matchesQuery("pt", "Home", null, undefined)).toBe(false);
  });
});
