import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { score, toPlaywrightProxy } from "./network";

describe("network benchmark scoring", () => {
  it("weights reliability above latency and returns a transparent 0-100 score", () => {
    expect(score(7, 150, 20, true)).toBe(100);
    expect(score(0, null, null, false)).toBe(0);
    expect(score(4, 1_000, 250, false)).toBeLessThan(50);
  });

  it("formats all supported proxy routes without credentials in direct sessions", () => {
    const config = toPlaywrightProxy({ proxyProfileId: randomUUID(), proxyName: "PT ISP", protocol: "socks5", host: "proxy.example", port: 1080, username: "user", password: "secret", expectedCountry: "PT", expectedCity: null });
    expect(config).toEqual({ server: "socks5://proxy.example:1080", username: "user", password: "secret" });
  });
});
