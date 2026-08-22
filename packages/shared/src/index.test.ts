import { describe, expect, it } from "vitest";
import { createBrowserProfileSchema, createProxyProfileSchema, createRunSchema, networkProbeSettingsSchema, runnerCommandSchema, updateProxyProfileSchema } from "./index";

describe("shared contracts", () => {
  it("validates profile input", () => {
    expect(createBrowserProfileSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(createBrowserProfileSchema.parse({ name: " Home " }).name).toBe("Home");
  });
  it("rejects malformed runner messages", () => {
    expect(runnerCommandSchema.safeParse({ type: "START", version: 1 }).success).toBe(false);
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
});
