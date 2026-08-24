import { describe, expect, it } from "vitest";
import { formatProxyUrl, parseProxyUrl } from "./proxy-url";

describe("proxy URL import", () => {
  it("parses a DataImpulse URL and decodes credentials", () => {
    expect(parseProxyUrl("http://user%40pt:p%3Aass@gw.dataimpulse.com:10001")).toEqual({ protocol: "http", host: "gw.dataimpulse.com", port: 10001, username: "user@pt", password: "p:ass", provider: "dataimpulse" });
  });

  it("rejects incomplete and unsafe URL shapes without echoing secrets", () => {
    for (const value of ["secret", "ftp://u:p@example.com:21", "http://u@example.com:80", "http://u:p@example.com:80/path", "http://u:p@example.com"]) {
      expect(() => parseProxyUrl(value)).toThrow();
      try { parseProxyUrl(value); } catch (error) { expect(String(error)).not.toContain("u:p"); }
    }
  });

  it("formats credentials using URL encoding", () => {
    expect(formatProxyUrl("https", "proxy.example", 8443, "user@pt", "p:ass")).toBe("https://user%40pt:p%3Aass@proxy.example:8443");
  });
});
