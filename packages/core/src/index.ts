import { EventEmitter } from "node:events";
import { fork, type ChildProcess } from "node:child_process";
import type { BrowserProfile, RunnerCommand, RunnerEvent, SessionError, SessionSnapshot } from "@copify/shared";
import { IPC_VERSION, runnerEventSchema } from "@copify/shared";

export type RunnerChild = Pick<ChildProcess, "send" | "kill" | "on" | "once" | "removeAllListeners">;
export type RunnerFactory = (profile: BrowserProfile) => RunnerChild;

type ActiveRunner = { child: RunnerChild; expectedStop: boolean };

export class SessionOrchestrator extends EventEmitter {
  private readonly sessions = new Map<string, SessionSnapshot>();
  private readonly runners = new Map<string, ActiveRunner>();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly createRunner: RunnerFactory) { super(); }

  list(): SessionSnapshot[] {
    return [...this.sessions.values()].sort((a, b) => a.profileId.localeCompare(b.profileId));
  }

  snapshot(profileId: string): SessionSnapshot {
    return this.sessions.get(profileId) ?? { profileId, state: "STOPPED", error: null, updatedAt: Date.now() };
  }

  async open(profile: BrowserProfile): Promise<void> {
    await this.enqueue(profile.id, async () => {
      const current = this.snapshot(profile.id);
      if (current.state === "READY" || current.state === "STARTING") return;
      if (!profile.enabled) {
        this.setState(profile.id, "ERROR", { code: "INVALID_COMMAND", message: "Disabled profiles cannot be opened." });
        return;
      }
      this.setState(profile.id, "STARTING");
      const child = this.createRunner(profile);
      const active: ActiveRunner = { child, expectedStop: false };
      this.runners.set(profile.id, active);
      child.on("message", (message) => this.onRunnerMessage(profile.id, message));
      child.once("exit", () => this.onRunnerExit(profile.id, active));
      this.send(child, { type: "START", version: IPC_VERSION, profileId: profile.id, userDataDir: profile.userDataDir });
    });
  }

  async close(profileId: string): Promise<void> {
    await this.enqueue(profileId, async () => {
      const active = this.runners.get(profileId);
      if (!active) {
        this.setState(profileId, "STOPPED");
        return;
      }
      active.expectedStop = true;
      this.setState(profileId, "STOPPING");
      this.send(active.child, { type: "STOP", version: IPC_VERSION });
      // The runner normally exits after closing Chrome. Avoid leaking an orphaned child.
      setTimeout(() => {
        if (this.runners.get(profileId) === active) active.child.kill();
      }, 8_000).unref();
    });
  }

  async restart(profile: BrowserProfile): Promise<void> {
    await this.close(profile.id);
    await this.waitForStopped(profile.id);
    await this.open(profile);
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.runners.keys()].map((profileId) => this.close(profileId)));
  }

  private onRunnerMessage(profileId: string, message: unknown): void {
    const parsed = runnerEventSchema.safeParse(message);
    if (!parsed.success || parsed.data.profileId !== null && parsed.data.profileId !== profileId) return;
    const event: RunnerEvent = parsed.data;
    if (event.type === "READY") this.setState(profileId, "READY");
    if (event.type === "STOPPED") this.setState(profileId, "STOPPED");
    if (event.type === "ERROR") this.setState(profileId, "ERROR", { code: event.code, message: event.message });
  }

  private onRunnerExit(profileId: string, active: ActiveRunner): void {
    if (this.runners.get(profileId) !== active) return;
    this.runners.delete(profileId);
    active.child.removeAllListeners();
    const current = this.snapshot(profileId);
    if (active.expectedStop || current.state === "STOPPED") this.setState(profileId, "STOPPED");
    else this.setState(profileId, "CRASHED", { code: "RUNNER_CRASHED", message: "The isolated browser runner exited unexpectedly." });
  }

  private setState(profileId: string, state: SessionSnapshot["state"], error: SessionError | null = null): void {
    const snapshot: SessionSnapshot = { profileId, state, error, updatedAt: Date.now() };
    this.sessions.set(profileId, snapshot);
    this.emit("changed", snapshot);
  }

  private send(child: RunnerChild, command: RunnerCommand): void {
    child.send(command, (error) => {
      if (error) child.kill();
    });
  }

  private async waitForStopped(profileId: string): Promise<void> {
    if (!this.runners.has(profileId)) return;
    await new Promise<void>((resolve) => {
      const listener = (snapshot: SessionSnapshot) => {
        if (snapshot.profileId === profileId && !this.runners.has(profileId)) {
          this.off("changed", listener);
          resolve();
        }
      };
      this.on("changed", listener);
    });
  }

  private enqueue(profileId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(profileId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    const tracked = next.finally(() => {
      if (this.queues.get(profileId) === tracked) this.queues.delete(profileId);
    });
    this.queues.set(profileId, tracked);
    return tracked;
  }
}

export function nodeRunnerFactory(runnerPath: string): RunnerFactory {
  return () => fork(runnerPath, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
}
