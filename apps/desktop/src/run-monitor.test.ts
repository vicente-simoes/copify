import { describe, expect, it } from "vitest";
import { canStartTargetMonitor } from "./run-monitor";

describe("canStartTargetMonitor", () => {
  it("waits for a browser session to be ready", () => {
    expect(canStartTargetMonitor(true, false, false, "STARTING")).toBe(false);
    expect(canStartTargetMonitor(true, false, false, "ERROR")).toBe(false);
    expect(canStartTargetMonitor(true, false, false, "CRASHED")).toBe(false);
  });

  it("starts once the first session is ready", () => {
    expect(canStartTargetMonitor(true, false, false, "READY")).toBe(true);
  });

  it("does not duplicate or start monitoring after the run ends", () => {
    expect(canStartTargetMonitor(true, true, false, "READY")).toBe(false);
    expect(canStartTargetMonitor(true, false, true, "READY")).toBe(false);
    expect(canStartTargetMonitor(false, false, false, "READY")).toBe(false);
  });
});
