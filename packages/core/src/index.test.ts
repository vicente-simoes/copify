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
  return { id, name: "Test", userDataDir: `C:/profiles/${id}`, proxyProfileId: null, shippingProfileId: null, enabled: true, createdAt: 1, updatedAt: 1 };
}

describe("SessionOrchestrator", () => {
  it("keeps each runner isolated and marks an unexpected exit as crashed", async () => {
    const runners: FakeRunner[] = [];
    const orchestrator = new SessionOrchestrator(() => {
      const runner = new FakeRunner(); runners.push(runner); return runner as unknown as RunnerChild;
    });
    const first = profile(); const second = profile();
    await Promise.all([orchestrator.open(first), orchestrator.open(second)]);
    expect(runners).toHaveLength(2);
    runners[0].emit("message", { type: "READY", version: IPC_VERSION, profileId: first.id, route: { kind: "direct", verification: { status: "VERIFIED", publicIp: "203.0.113.1", country: "PT", city: "Lisbon", verifiedAt: 1, message: null } } });
    runners[1].emit("message", { type: "READY", version: IPC_VERSION, profileId: second.id, route: { kind: "direct", verification: { status: "VERIFIED", publicIp: "203.0.113.2", country: "PT", city: "Lisbon", verifiedAt: 1, message: null } } });
    expect(orchestrator.snapshot(first.id).state).toBe("READY");
    runners[0].emit("exit", 1);
    expect(orchestrator.snapshot(first.id).state).toBe("CRASHED");
    expect(orchestrator.snapshot(second.id).state).toBe("READY");
  });

  it("sends an optional proxy only to its assigned runner", async () => {
    const runners: FakeRunner[] = [];
    const orchestrator = new SessionOrchestrator(() => { const runner = new FakeRunner(); runners.push(runner); return runner as unknown as RunnerChild; });
    const assigned = profile();
    await orchestrator.open({ profile: assigned, probeUrl: "https://ipwho.is/", recording: null, proxy: { proxyProfileId: randomUUID(), proxyName: "PT ISP", protocol: "http", host: "proxy.example", port: 8080, expectedCountry: "PT", expectedCity: "Lisbon" } });
    expect(runners[0].commands[0]).toMatchObject({ type: "START", proxy: { proxyName: "PT ISP", host: "proxy.example" } });
  });

  it("forwards an end-recording command only to the selected runner", async () => {
    const runners: FakeRunner[] = []; const orchestrator = new SessionOrchestrator(() => { const runner = new FakeRunner(); runners.push(runner); return runner as unknown as RunnerChild; });
    const selected = profile(); await orchestrator.open(selected); const runSessionId = randomUUID(); orchestrator.endRun(selected.id, runSessionId);
    expect(runners[0].commands.at(-1)).toMatchObject({ type: "END_RUN", runSessionId });
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
});
