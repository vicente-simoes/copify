import { EventEmitter } from "node:events";
import { fork, type ChildProcess } from "node:child_process";
import {
  DEFAULT_NETWORK_PROBE_URL, IPC_VERSION, defaultRoute, runnerEventSchema,
  type BrowserProfile, type ProductCandidate, type ProductVariant, type RunnerCommand, type RunnerEvent, type RunnerProxy, type RunnerRecording, type RunnerShipping, type SessionError, type SessionRoute, type SessionSnapshot
} from "@copify/shared";

export type RunnerChild = Pick<ChildProcess, "send" | "kill" | "on" | "once" | "removeAllListeners">;
export type SessionLaunchSpec = { profile: BrowserProfile; proxy: RunnerProxy | null; probeUrl: string; recording: RunnerRecording | null };
export type RunnerFactory = (spec: SessionLaunchSpec) => RunnerChild;
type ActiveRunner = { child: RunnerChild; expectedStop: boolean };

export class SessionOrchestrator extends EventEmitter {
  private readonly sessions = new Map<string, SessionSnapshot>();
  private readonly runners = new Map<string, ActiveRunner>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly pendingCartActions = new Map<string, "CHECK_CART" | "EMPTY_CART">();

  constructor(private readonly createRunner: RunnerFactory) { super(); }
  list(): SessionSnapshot[] { return [...this.sessions.values()].sort((a, b) => a.profileId.localeCompare(b.profileId)); }
  snapshot(profileId: string): SessionSnapshot { return this.sessions.get(profileId) ?? { profileId, state: "STOPPED", error: null, route: defaultRoute(), updatedAt: Date.now() }; }

  async open(input: BrowserProfile | SessionLaunchSpec): Promise<void> {
    const spec = toLaunchSpec(input);
    await this.enqueue(spec.profile.id, async () => {
      const current = this.snapshot(spec.profile.id);
      if (current.state === "READY" || current.state === "STARTING") return;
      if (!spec.profile.enabled) { this.setState(spec.profile.id, "ERROR", { code: "INVALID_COMMAND", message: "Disabled profiles cannot be opened." }); return; }
      const route = routeFor(spec.proxy);
      this.setState(spec.profile.id, "STARTING", null, route);
      const child = this.createRunner(spec); const active: ActiveRunner = { child, expectedStop: false }; this.runners.set(spec.profile.id, active);
      child.on("message", (message) => this.onRunnerMessage(spec.profile.id, message)); child.once("exit", () => this.onRunnerExit(spec.profile.id, active));
      this.send(child, { type: "START", version: IPC_VERSION, profileId: spec.profile.id, userDataDir: spec.profile.userDataDir, launchMode: spec.profile.launchMode, proxy: spec.proxy, probeUrl: spec.probeUrl, recording: spec.recording });
    });
  }

  async close(profileId: string): Promise<void> {
    await this.enqueue(profileId, async () => {
      const active = this.runners.get(profileId); if (!active) { this.setState(profileId, "STOPPED"); return; }
      active.expectedStop = true; this.setState(profileId, "STOPPING"); this.send(active.child, { type: "STOP", version: IPC_VERSION });
      setTimeout(() => { if (this.runners.get(profileId) === active) active.child.kill(); }, 8_000).unref();
    });
  }

  async restart(input: BrowserProfile | SessionLaunchSpec): Promise<void> { const spec = toLaunchSpec(input); await this.close(spec.profile.id); await this.waitForStopped(spec.profile.id); await this.open(spec); }
  async shutdown(): Promise<void> { await Promise.all([...this.runners.keys()].map((profileId) => this.close(profileId))); }
  isActive(profileId: string): boolean { return this.runners.has(profileId); }
  fail(profileId: string, error: SessionError): void { this.setState(profileId, "ERROR", error); }
  endRun(profileId: string, runSessionId: string): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "END_RUN", version: IPC_VERSION, runSessionId }); }
  assist(profileId: string, runId: string, runSessionId: string, candidate: ProductCandidate, variant: ProductVariant, quantity: number, shipping: RunnerShipping): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "ASSIST_TARGET", version: IPC_VERSION, runId, runSessionId, candidate, variant, quantity, shipping }); }
  resumeAssist(profileId: string, runId: string, runSessionId: string): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "RESUME_ASSIST", version: IPC_VERSION, runId, runSessionId }); }
  checkCart(profileId: string): void { this.pendingCartActions.set(profileId, "CHECK_CART"); this.dispatchCartAction(profileId); }
  emptyCart(profileId: string): void { this.pendingCartActions.set(profileId, "EMPTY_CART"); this.dispatchCartAction(profileId); }

  private onRunnerMessage(profileId: string, message: unknown): void {
    const parsed = runnerEventSchema.safeParse(message); if (!parsed.success || (parsed.data.profileId !== null && parsed.data.profileId !== profileId)) return;
    const event: RunnerEvent = parsed.data;
    if (event.type === "READY") { this.setState(profileId, "READY", null, event.route); this.dispatchCartAction(profileId); }
    if (event.type === "STOPPED") this.setState(profileId, "STOPPED");
    if (event.type === "ERROR") this.setState(profileId, "ERROR", { code: event.code, message: event.message });
    if (event.type === "RUN_EVENT" || event.type === "RUN_ARTIFACT" || event.type === "RUN_ENDED" || event.type === "CART_STATUS") this.emit("runner-event", event);
  }

  private onRunnerExit(profileId: string, active: ActiveRunner): void {
    if (this.runners.get(profileId) !== active) return; this.runners.delete(profileId); active.child.removeAllListeners(); const current = this.snapshot(profileId);
    if (active.expectedStop || current.state === "STOPPED") this.setState(profileId, "STOPPED"); else if (current.state !== "ERROR") this.setState(profileId, "CRASHED", { code: "RUNNER_CRASHED", message: "The isolated browser runner exited unexpectedly." });
  }

  private setState(profileId: string, state: SessionSnapshot["state"], error: SessionError | null = null, route?: SessionRoute): void {
    const snapshot: SessionSnapshot = { profileId, state, error, route: route ?? this.snapshot(profileId).route, updatedAt: Date.now() }; this.sessions.set(profileId, snapshot); this.emit("changed", snapshot);
  }
  private send(child: RunnerChild, command: RunnerCommand): void { child.send(command, (error) => { if (error) child.kill(); }); }
  private dispatchCartAction(profileId: string): void { const active = this.runners.get(profileId); const action = this.pendingCartActions.get(profileId); if (!active || this.snapshot(profileId).state !== "READY" || !action) return; this.pendingCartActions.delete(profileId); this.send(active.child, { type: action, version: IPC_VERSION, profileId }); }
  private async waitForStopped(profileId: string): Promise<void> { if (!this.runners.has(profileId)) return; await new Promise<void>((resolve) => { const listener = (snapshot: SessionSnapshot) => { if (snapshot.profileId === profileId && !this.runners.has(profileId)) { this.off("changed", listener); resolve(); } }; this.on("changed", listener); }); }
  private enqueue(profileId: string, task: () => Promise<void>): Promise<void> { const previous = this.queues.get(profileId) ?? Promise.resolve(); const next = previous.catch(() => undefined).then(task); const tracked = next.finally(() => { if (this.queues.get(profileId) === tracked) this.queues.delete(profileId); }); this.queues.set(profileId, tracked); return tracked; }
}

export function nodeRunnerFactory(runnerPath: string): RunnerFactory { return () => fork(runnerPath, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] }); }
function toLaunchSpec(input: BrowserProfile | SessionLaunchSpec): SessionLaunchSpec { return "profile" in input ? input : { profile: input, proxy: null, probeUrl: DEFAULT_NETWORK_PROBE_URL, recording: null }; }
function routeFor(proxy: RunnerProxy | null): SessionRoute { return proxy ? { kind: "proxy", proxyProfileId: proxy.proxyProfileId, proxyName: proxy.proxyName, protocol: proxy.protocol, verification: defaultRoute().verification } : defaultRoute(); }
