import { describe, expect, it } from "vitest";
import type { BrowserProfile, ProxyBenchmark, ProxyProfile, SessionSnapshot, ShippingProfile, Target } from "@copify/shared";
import { preflight, type PreflightInput } from "./preflight";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const profile = (over: Partial<BrowserProfile> = {}): BrowserProfile => ({
  id: id(1), name: "Home", userDataDir: "C:/x", proxyProfileId: null, shippingProfileId: null,
  driver: { kind: "NATIVE_STEALTH" }, enabled: true, createdAt: 0, updatedAt: 0, ...over,
});

const stopped = (profileId: string): SessionSnapshot => ({
  profileId, state: "STOPPED", error: null,
  route: { kind: "direct", verification: { status: "PENDING", publicIp: null, country: null, city: null, verifiedAt: null, message: null } },
  driver: null,
  updatedAt: 0,
});

const benchmark = { id: id(9), qualityScore: 90, status: "PASS" } as unknown as ProxyBenchmark;

const target = (over: Partial<Target> = {}): Target => ({
  id: id(5), name: "Box Logo", storeId: "supreme-eu", productKeywords: ["Box Logo"], negativeKeywords: [],
  preferredColors: [], sizePriority: [], currency: "EUR", maxRetailMinor: 20_000, quantity: 1,
  enabled: true, latestCheck: null, createdAt: 0, updatedAt: 0, ...over,
});

const shippingProfile = (over: Partial<ShippingProfile> = {}): ShippingProfile => ({
  id: id(7), name: "Home", country: "PT", detailsConfigured: true, complete: true, enabled: true,
  createdAt: 0, updatedAt: 0, ...over,
});

const base = (over: Partial<PreflightInput> = {}): PreflightInput => ({
  mode: "OBSERVATION",
  profiles: [profile()],
  selectedProfileIds: [id(1)],
  session: stopped,
  proxies: [],
  latestBenchmark: () => benchmark,
  shipping: [],
  target: target(),
  ...over,
});

const check = (result: ReturnType<typeof preflight>, checkId: string) =>
  result.checks.find((item) => item.id === checkId);

describe("preflight", () => {
  it("clears a well-configured observation run", () => {
    const result = preflight(base());
    expect(result.canStart).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("refuses to arm with no browser selected", () => {
    const result = preflight(base({ selectedProfileIds: [] }));
    expect(result.canStart).toBe(false);
    expect(check(result, "browsers")?.status).toBe("fail");
  });

  it("explains that an open browser cannot join a run rather than just refusing", () => {
    const result = preflight(base({ session: (profileId) => ({ ...stopped(profileId), state: "READY" }) }));
    expect(result.canStart).toBe(false);
    const stoppedCheck = check(result, "stopped");
    expect(stoppedCheck?.status).toBe("fail");
    expect(stoppedCheck?.detail).toContain("record from the first page");
  });

  it("blocks on an unusable route but only warns on an unbenchmarked one", () => {
    const proxy = { id: id(3), name: "PT ISP", enabled: false } as unknown as ProxyProfile;
    const disabled = preflight(base({ profiles: [profile({ proxyProfileId: id(3) })], proxies: [proxy] }));
    expect(disabled.canStart).toBe(false);
    expect(check(disabled, "routes")?.status).toBe("fail");

    const untested = preflight(base({ latestBenchmark: () => undefined }));
    expect(untested.canStart).toBe(true);
    expect(check(untested, "routes")?.status).toBe("warn");
  });

  it("treats a missing target as a warning when observing and a failure when assisting", () => {
    const observing = preflight(base({ target: null }));
    expect(observing.canStart).toBe(true);
    expect(check(observing, "target")?.status).toBe("warn");

    const assisting = preflight(base({ mode: "ASSISTED_CHECKOUT", target: null }));
    expect(assisting.canStart).toBe(false);
    expect(check(assisting, "target")?.status).toBe("fail");
  });

  it("requires a complete address and a price limit before assisted checkout", () => {
    const noShipping = preflight(base({ mode: "ASSISTED_CHECKOUT" }));
    expect(noShipping.canStart).toBe(false);
    expect(check(noShipping, "shipping")?.status).toBe("fail");

    const ready = preflight(base({
      mode: "ASSISTED_CHECKOUT",
      profiles: [profile({ shippingProfileId: id(7) })],
      shipping: [shippingProfile()],
    }));
    expect(ready.canStart).toBe(true);
    expect(check(ready, "price")?.status).toBe("pass");

    const noPriceLimit = preflight(base({
      mode: "ASSISTED_CHECKOUT",
      profiles: [profile({ shippingProfileId: id(7) })],
      shipping: [shippingProfile()],
      target: target({ maxRetailMinor: 0 }),
    }));
    expect(noPriceLimit.canStart).toBe(false);
    expect(check(noPriceLimit, "price")?.status).toBe("fail");
  });

  it("blocks incomplete or proxy-conflicted external CDP profiles", () => {
    const missing = preflight(base({ profiles: [profile({ driver: { kind: "EXTERNAL_CDP", endpointConfigured: false } })] }));
    expect(check(missing, "drivers")?.status).toBe("fail");
    const conflicted = preflight(base({ profiles: [profile({ driver: { kind: "EXTERNAL_CDP", endpointConfigured: true }, proxyProfileId: id(3) })] }));
    expect(check(conflicted, "drivers")?.status).toBe("fail");
  });

  it("warns that external CDP cannot add launch-time HAR or video", () => {
    const result = preflight(base({ diagnosticLevel: "DEEP_DEBUG", profiles: [profile({ driver: { kind: "EXTERNAL_CDP", endpointConfigured: true } })] }));
    expect(result.canStart).toBe(true); expect(check(result, "drivers")?.status).toBe("warn");
  });

  it("blocks a saved selection when its browser was disabled or removed", () => {
    const disabled = preflight(base({ profiles: [profile({ enabled: false })] }));
    expect(check(disabled, "browsers")?.status).toBe("fail");
    const missing = preflight(base({ selectedProfileIds: [id(99)] }));
    expect(check(missing, "browsers")?.status).toBe("fail");
  });

  it("warns when only some selected browsers can check out", () => {
    const result = preflight(base({
      mode: "ASSISTED_CHECKOUT",
      profiles: [profile({ shippingProfileId: id(7) }), profile({ id: id(2), name: "Proxy 1" })],
      selectedProfileIds: [id(1), id(2)],
      shipping: [shippingProfile()],
    }));
    expect(result.canStart).toBe(true);
    const shippingCheck = check(result, "shipping");
    expect(shippingCheck?.status).toBe("warn");
    expect(shippingCheck?.detail).toContain("Proxy 1");
  });

  it("blocks assisted checkout for a store whose adapter cannot do it", () => {
    const result = preflight(base({
      mode: "ASSISTED_CHECKOUT",
      profiles: [profile({ shippingProfileId: id(7) })],
      shipping: [shippingProfile()],
      target: target({ storeId: "general" }),
    }));
    expect(result.canStart).toBe(false);
    expect(check(result, "target")?.status).toBe("fail");
  });
});
