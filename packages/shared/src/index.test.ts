import { describe, expect, it } from "vitest";
import { IPC_VERSION, createBrowserProfileSchema, createProxyProfileSchema, createRunSchema, createRunSetupSchema, createShippingProfileSchema, createTargetSchema, externalCdpEndpointSchema, getStoreManifest, getStoreShippingDestinations, isKnownStore, isMonitorable, listStoreManifests, networkProbeSettingsSchema, runExecutionStateSchema, runnerCommandSchema, runnerEventSchema, storeManifestSchema, supportsAssistedCheckout, updateBrowserProfileSchema, updateProxyProfileSchema, updateShippingProfileSchema } from "./index";

describe("store registry", () => {
  it("exposes well-formed manifests for every registered store", () => {
    const manifests = listStoreManifests();
    expect(manifests.length).toBeGreaterThan(0);
    for (const manifest of manifests) expect(storeManifestSchema.safeParse(manifest).success).toBe(true);
  });
  it("reports capabilities so the UI never hardcodes a store", () => {
    expect(isMonitorable("supreme-eu")).toBe(true);
    expect(supportsAssistedCheckout("supreme-eu")).toBe(true);
    expect(getStoreManifest("supreme-eu")?.variants.sizes).toMatchObject({ kind: "enum" });
  });
  it("provides Supreme checkout's selectable shipping destinations", () => {
    const destinations = getStoreShippingDestinations("supreme-eu");
    expect(destinations.find((destination) => destination.country === "PT")).toMatchObject({ label: "Portugal" });
    expect(destinations.find((destination) => destination.country === "PT")?.regions).toContain("Lisbon");
    expect(getStoreShippingDestinations("general")).toEqual([]);
  });
  it("treats a store without an adapter as unmonitorable rather than unknown", () => {
    expect(isKnownStore("general")).toBe(true);
    expect(isMonitorable("general")).toBe(false);
    expect(supportsAssistedCheckout("general")).toBe(false);
    expect(getStoreManifest("general")?.variants.sizes).toMatchObject({ kind: "freeform" });
  });
  it("rejects ids that are not in the registry", () => {
    expect(isKnownStore("not-a-store")).toBe(false);
    expect(isMonitorable("not-a-store")).toBe(false);
    expect(getStoreManifest("not-a-store")).toBeUndefined();
  });
});

describe("shared contracts", () => {
  it("validates profile input", () => {
    expect(createBrowserProfileSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(createBrowserProfileSchema.parse({ name: " Home " })).toMatchObject({ name: "Home", driver: { kind: "NATIVE_STEALTH" } });
  });
  it("rejects malformed runner messages", () => {
    expect(runnerCommandSchema.safeParse({ type: "START", version: 1 }).success).toBe(false);
  });
  it("validates clipboard leases without accepting oversized or mismatched IPC versions", () => {
    const profileId = "00000000-0000-4000-8000-000000000001"; const requestId = "00000000-0000-4000-8000-000000000002";
    expect(runnerEventSchema.safeParse({ type: "CLIPBOARD_LEASE_REQUEST", version: IPC_VERSION, profileId, requestId, value: "1 Main St" }).success).toBe(true);
    expect(runnerEventSchema.safeParse({ type: "CLIPBOARD_LEASE_REQUEST", version: IPC_VERSION, profileId, requestId, value: "x".repeat(513) }).success).toBe(false);
    expect(runnerCommandSchema.safeParse({ type: "CLIPBOARD_LEASE_GRANTED", version: IPC_VERSION - 1, requestId }).success).toBe(false);
    expect(runnerCommandSchema.safeParse({ type: "CLIPBOARD_LEASE_DENIED", version: IPC_VERSION, requestId, reason: "CLIPBOARD_NOT_EMPTY" }).success).toBe(true);
  });
  it("validates optional proxy configuration and credential updates", () => {
    expect(createProxyProfileSchema.parse({ name: "PT ISP", host: "proxy.example", port: 8080 }).protocol).toBe("http");
    expect(updateProxyProfileSchema.parse({ username: null })).toEqual({ username: null });
    expect(networkProbeSettingsSchema.safeParse({ probeUrl: "http://localhost" }).success).toBe(false);
  });
  it("requires explicit acknowledgement before Deep Debug recording", () => {
    const profileId = "00000000-0000-4000-8000-000000000001";
    expect(createRunSchema.safeParse({ name: "Safe run", diagnosticLevel: "DEEP_DEBUG", profileIds: [profileId] }).success).toBe(false);
    expect(createRunSchema.parse({ name: "Safe run", diagnosticLevel: "DEEP_DEBUG", profileIds: [profileId], deepDebugAcknowledged: true })).toMatchObject({ diagnosticLevel: "DEEP_DEBUG" });
  });
  it("validates a Supreme EU target and optional run target selection", () => {
    expect(createTargetSchema.safeParse({ name: "Bad", productKeywords: [], maxRetailMinor: 1 }).success).toBe(false);
    expect(createTargetSchema.parse({ name: "Jacket", productKeywords: ["Leather Jacket"], maxRetailMinor: 20_000 })).toMatchObject({ storeId: "general", currency: "EUR", quantity: 1 });
    expect(createTargetSchema.parse({ name: "Jacket", storeId: "supreme-eu", productKeywords: ["Leather Jacket"], maxRetailMinor: 20_000 })).toMatchObject({ storeId: "supreme-eu" });
    expect(createTargetSchema.safeParse({ name: "Jacket", storeId: "", productKeywords: ["Leather Jacket"], maxRetailMinor: 20_000 }).success).toBe(false);
    const profileId = "00000000-0000-4000-8000-000000000001";
    expect(createRunSchema.parse({ name: "Observe", diagnosticLevel: "NORMAL", profileIds: [profileId] }).targetId).toBeNull();
    expect(createRunSetupSchema.parse({ name: "Sneakers", diagnosticLevel: "NORMAL", executionMode: "ASSISTED_CHECKOUT", profileIds: [profileId], targetId: null })).toMatchObject({ name: "Sneakers", profileIds: [profileId] });
  });
  it("requires a target for assisted checkout and validates encrypted shipping input", () => {
    const profileId = "00000000-0000-4000-8000-000000000001"; const targetId = "00000000-0000-4000-8000-000000000002";
    expect(createRunSchema.safeParse({ name: "Assist", diagnosticLevel: "NORMAL", executionMode: "ASSISTED_CHECKOUT", profileIds: [profileId], targetId: null }).success).toBe(false);
    expect(createRunSchema.parse({ name: "Assist", diagnosticLevel: "NORMAL", executionMode: "ASSISTED_CHECKOUT", profileIds: [profileId], targetId }).executionMode).toBe("ASSISTED_CHECKOUT");
    expect(createShippingProfileSchema.parse({ name: "Home", details: { fullName: "Ada Lovelace", email: "ada@example.com", phone: "+351 1", address1: "1 Main St", postalCode: "1000", city: "Lisbon", country: "pt" } }).details.country).toBe("PT");
    expect(updateShippingProfileSchema.parse({ details: null })).toEqual({ details: null });
  });
  it("records the terminal assisted-checkout handoff as ready to confirm", () => {
    expect(runExecutionStateSchema.parse("READY_TO_CONFIRM")).toBe("READY_TO_CONFIRM");
  });
  it("accepts only local external CDP endpoints and defaults profiles to Native Stealth", () => {
    expect(createBrowserProfileSchema.parse({ name: "Home" }).driver).toEqual({ kind: "NATIVE_STEALTH" });
    expect(externalCdpEndpointSchema.parse("http://127.0.0.1:9222/devtools/browser/token")).toContain("127.0.0.1");
    expect(externalCdpEndpointSchema.safeParse("ws://localhost:9222/devtools/browser/token").success).toBe(true);
    expect(externalCdpEndpointSchema.safeParse("https://remote.example/devtools").success).toBe(false);
    expect(externalCdpEndpointSchema.safeParse("http://user:password@127.0.0.1:9222").success).toBe(false);
    expect(updateBrowserProfileSchema.parse({ driver: { kind: "EXTERNAL_CDP", endpoint: null } })).toMatchObject({ driver: { kind: "EXTERNAL_CDP", endpoint: null } });
  });
});
