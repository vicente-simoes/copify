import { describe, expect, it } from "vitest";
import type { RunnerProxy } from "@copify/shared";
import { acceptLanguageForLocale, coherenceFromIdentity, externalCoherence, localeForCountry, parseGeoIdentity, validTimezone } from "./coherence";

const proxy: RunnerProxy = {
  proxyProfileId: "00000000-0000-4000-8000-000000000001", proxyName: "PT sticky", protocol: "http",
  host: "proxy.invalid", port: 8080, username: "private-user", password: "private-pass", expectedCountry: "PT", expectedCity: "Lisbon",
};

describe("profile coherence", () => {
  it("parses a complete Portuguese GeoIP response and derives launch policy", () => {
    const identity = parseGeoIdentity({ ip: "203.0.113.4", country_code: "PT", city: "Lisbon", region: "Lisbon", latitude: 38.7223, longitude: -9.1393, timezone: { id: "Europe/Lisbon" } }, 123);
    const result = coherenceFromIdentity(identity, proxy);
    expect(result.identity).toMatchObject({ publicIp: "203.0.113.4", country: "PT", timezoneId: "Europe/Lisbon", resolvedAt: 123 });
    expect(result.summary).toMatchObject({ status: "VERIFIED", locale: "pt-PT", geolocationApplied: true, webRtcPolicy: "DISABLE_NON_PROXIED_UDP" });
    expect(result.launch).toMatchObject({ locale: "pt-PT", timezoneId: "Europe/Lisbon", geolocation: { latitude: 38.7223, longitude: -9.1393 } });
  });

  it("validates locale and IANA timezone inputs", () => {
    expect(localeForCountry("pt")).toBe("pt-PT");
    expect(acceptLanguageForLocale("pt-PT")).toBe("pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7");
    expect(validTimezone("Europe/Lisbon")).toBe("Europe/Lisbon");
    expect(validTimezone("Portugal/Nowhere")).toBeNull();
  });

  it("warns and applies every independently verified field", () => {
    const result = coherenceFromIdentity(parseGeoIdentity({ ip: "203.0.113.5", country_code: "ES", city: "Madrid", latitude: 40.4, longitude: -3.7, timezone: "invalid" }), proxy);
    expect(result.summary.status).toBe("WARNING");
    expect(result.summary.message).toContain("Expected PT");
    expect(result.launch).toMatchObject({ locale: "es-ES", geolocation: { latitude: 40.4, longitude: -3.7 } });
    expect(result.launch).not.toHaveProperty("timezoneId");
  });

  it("sanitizes incomplete and externally managed snapshots", () => {
    const result = coherenceFromIdentity(parseGeoIdentity({ ip: "203.0.113.6", country_code: "PT" }), proxy);
    expect(result.summary.status).toBe("WARNING");
    expect(result.summary.message).toContain("timezone");
    expect(JSON.stringify(result)).not.toContain("private-pass");
    expect(externalCoherence("en-GB", "Europe/London")).toMatchObject({ status: "EXTERNAL", source: "EXTERNAL_BROWSER", geolocationApplied: false });
  });
});
