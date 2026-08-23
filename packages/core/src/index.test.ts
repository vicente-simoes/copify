import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IPC_VERSION, type BrowserProfile, type RunnerCommand } from "@copify/shared";
import { SessionOrchestrator, type RunnerChild } from "./index";

class FakeRunner extends EventEmitter {
  readonly commands: RunnerCommand[] = [];
  send(command: RunnerCommand, callback?: (error: Error | null) => void): boolean { this.commands.push(command); callback?.(null); return true; }
  kill(): boolean { this.emit("exit", 0); return true; }
}

function profile(): BrowserProfile {
  const id = randomUUID();
  return { id, name: "Test", userDataDir: `C:/profiles/${id}`, proxyProfileId: null, shippingProfileId: null, driver: { kind: "NATIVE_STEALTH" }, enabled: true, createdAt: 1, updatedAt: 1 };
}
const driver = { kind: "NATIVE_STEALTH" as const, ownsBrowser: true, browserVersion: "Chrome/1", stealthStatus: "PASS" as const, capabilities: { managedProxy: true, launchHarVideo: true } };

describe("SessionOrchestrator", () => {
  it("keeps each runner isolated and marks an unexpected exit as crashed", async () => {
    const runners: FakeRunner[] = [];
    const orchestrator = new SessionOrchestrator(() => {
      const runner = new FakeRunner(); runners.push(runner); return runner as unknown as RunnerChild;
    });
    const first = profile(); const second = profile();
    await Promise.all([orchestrator.open(first), orchestrator.open(second)]);
    expect(runners).toHaveLength(2);
    runners[0].emit("message", { type: "READY", version: IPC_VERSION, profileId: first.id, driver, route: { kind: "direct", verification: { status: "VERIFIED", publicIp: "203.0.113.1", country: "PT", city: "Lisbon", verifiedAt: 1, message: null } } });
    runners[1].emit("message", { type: "READY", version: IPC_VERSION, profileId: second.id, driver, route: { kind: "direct", verification: { status: "VERIFIED", publicIp: "203.0.113.2", country: "PT", city: "Lisbon", verifiedAt: 1, message: null } } });
    expect(orchestrator.snapshot(first.id).state).toBe("READY");
    runners[0].emit("exit", 1);
    expect(orchestrator.snapshot(first.id).state).toBe("CRASHED");
    expect(orchestrator.snapshot(second.id).state).toBe("READY");
  });

  it("sends an optional proxy only to its assigned runner", async () => {
    const runners: FakeRunner[] = [];
    const orchestrator = new SessionOrchestrator(() => { const runner = new FakeRunner(); runners.push(runner); return runner as unknown as RunnerChild; });
    const assigned = profile();
    await orchestrator.open({ profile: assigned, driver: { kind: "NATIVE_STEALTH" }, probeUrl: "https://ipwho.is/", recording: null, proxy: { proxyProfileId: randomUUID(), proxyName: "PT ISP", protocol: "http", host: "proxy.example", port: 8080, expectedCountry: "PT", expectedCity: "Lisbon" } });
    expect(runners[0].commands[0]).toMatchObject({ type: "START", driver: { kind: "NATIVE_STEALTH" }, proxy: { proxyName: "PT ISP", host: "proxy.example" } });
  });

  it("forwards an end-recording command only to the selected runner", async () => {
    const runners: FakeRunner[] = []; const orchestrator = new SessionOrchestrator(() => { const runner = new FakeRunner(); runners.push(runner); return runner as unknown as RunnerChild; });
    const selected = profile(); await orchestrator.open(selected); const runSessionId = randomUUID(); orchestrator.endRun(selected.id, runSessionId);
    expect(runners[0].commands.at(-1)).toMatchObject({ type: "END_RUN", runSessionId });
  });

  it("pauses and resumes automated navigation without closing the browser", async () => {
    const runners: FakeRunner[] = []; const orchestrator = new SessionOrchestrator(() => { const runner = new FakeRunner(); runners.push(runner); return runner as unknown as RunnerChild; });
    const selected = profile(); await orchestrator.open(selected);
    orchestrator.pauseAutomation(selected.id, 123_456); orchestrator.resumeAutomation(selected.id);
    expect(runners[0].commands.slice(-2)).toEqual([{ type: "PAUSE_AUTOMATION", version: IPC_VERSION, until: 123_456 }, { type: "RESUME_AUTOMATION", version: IPC_VERSION }]);
  });

  it("forwards clipboard lease events and sends responses only to their runner", async () => {
    const runners: FakeRunner[] = []; const orchestrator = new SessionOrchestrator(() => { const runner = new FakeRunner(); runners.push(runner); return runner as unknown as RunnerChild; });
    const selected = profile(); await orchestrator.open(selected); const requestId = randomUUID(); const received: unknown[] = [];
    orchestrator.on("runner-event", (event) => received.push(event));
    runners[0].emit("message", { type: "CLIPBOARD_LEASE_REQUEST", version: IPC_VERSION, profileId: selected.id, requestId, value: "shipping" });
    expect(received).toHaveLength(1);
    orchestrator.grantClipboardLease(selected.id, requestId);
    orchestrator.denyClipboardLease(selected.id, requestId, "CLIPBOARD_NOT_EMPTY");
    expect(runners[0].commands.slice(-2)).toEqual([
      { type: "CLIPBOARD_LEASE_GRANTED", version: IPC_VERSION, requestId },
      { type: "CLIPBOARD_LEASE_DENIED", version: IPC_VERSION, requestId, reason: "CLIPBOARD_NOT_EMPTY" },
    ]);
  });

  it("does not launch disabled or already starting profiles twice", async () => {
    const runners: FakeRunner[] = [];
    const orchestrator = new SessionOrchestrator(() => { const runner = new FakeRunner(); runners.push(runner); return runner as unknown as RunnerChild; });
    const disabled = { ...profile(), enabled: false };
    await orchestrator.open(disabled);
    expect(orchestrator.snapshot(disabled.id)).toMatchObject({ state: "ERROR", error: { code: "INVALID_COMMAND" } });
    const enabled = profile();
    await Promise.all([orchestrator.open(enabled), orchestrator.open(enabled)]);
    expect(runners).toHaveLength(1);
  });

  it("keeps a runner launch error visible after that runner exits", async () => {
    const runners: FakeRunner[] = [];
    const orchestrator = new SessionOrchestrator(() => { const runner = new FakeRunner(); runners.push(runner); return runner as unknown as RunnerChild; });
    const selected = profile(); await orchestrator.open(selected);
    runners[0].emit("message", { type: "ERROR", version: IPC_VERSION, profileId: selected.id, code: "BROWSER_START_FAILED", message: "Native Chrome closed before Copify could attach." });
    runners[0].emit("exit", 1);
    expect(orchestrator.snapshot(selected.id)).toMatchObject({ state: "ERROR", error: { code: "BROWSER_START_FAILED" } });
  });
});
