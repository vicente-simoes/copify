import { describe, expect, it } from "vitest";
import { createBrowserProfileSchema, runnerCommandSchema } from "./index";

describe("shared contracts", () => {
  it("validates profile input", () => {
    expect(createBrowserProfileSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(createBrowserProfileSchema.parse({ name: " Home " }).name).toBe("Home");
  });
  it("rejects malformed runner messages", () => {
    expect(runnerCommandSchema.safeParse({ type: "START", version: 2 }).success).toBe(false);
  });
});
