import { EventEmitter } from "node:events";
import { fork, type ChildProcess } from "node:child_process";
import {
  DEFAULT_NETWORK_PROBE_URL, IPC_VERSION, defaultRoute, runnerEventSchema,
  type BrowserDriverMetadata, type BrowserProfile, type CheckoutMode, type PaymentCardSecret, type PaymentProfileSnapshot, type ProductCandidate, type ProductVariant, type ProfileCoherenceSummary, type PurchaseMode, type RunnerBrowserDriver, type RunnerCommand, type RunnerEvent, type RunnerProxy, type RunnerRecording, type RunnerShipping, type SessionError, type SessionRoute, type SessionSnapshot
} from "@copify/shared";

export type RunnerChild = Pick<ChildProcess, "send" | "kill" | "on" | "once" | "removeAllListeners">;
export type SessionLaunchSpec = { profile: BrowserProfile; driver: RunnerBrowserDriver; proxy: RunnerProxy | null; probeUrl: string; recording: RunnerRecording | null; background?: boolean };
export type RunnerFactory = (spec: SessionLaunchSpec) => RunnerChild;
type ActiveRunner = { child: RunnerChild; expectedStop: boolean };

export class SessionOrchestrator extends EventEmitter {
  private readonly sessions = new Map<string, SessionSnapshot>();
  private readonly runners = new Map<string, ActiveRunner>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly pendingCartActions = new Map<string, "CHECK_CART" | "EMPTY_CART">();

  constructor(private readonly createRunner: RunnerFactory) { super(); }
  list(): SessionSnapshot[] { return [...this.sessions.values()].sort((a, b) => a.profileId.localeCompare(b.profileId)); }
  snapshot(profileId: string): SessionSnapshot { return this.sessions.get(profileId) ?? { profileId, state: "STOPPED", error: null, route: defaultRoute(), coherence: null, driver: null, updatedAt: Date.now() }; }

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
      this.send(child, { type: "START", version: IPC_VERSION, profileId: spec.profile.id, userDataDir: spec.profile.userDataDir, driver: spec.driver, proxy: spec.proxy, probeUrl: spec.probeUrl, recording: spec.recording, background: spec.background ?? false });
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
  assist(profileId: string, runId: string, runSessionId: string, candidate: ProductCandidate, variant: ProductVariant, priceConstraint: { currency: "EUR" | "GBP" | "USD"; maxRetailMinor: number }, shipping: RunnerShipping, execution: { checkoutMode: CheckoutMode; purchaseMode: PurchaseMode; paymentProfile: PaymentProfileSnapshot }): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "ASSIST_TARGET", version: IPC_VERSION, runId, runSessionId, candidate, variant, quantity: 1, priceConstraint, shipping, ...execution }); }
  resumeAssist(profileId: string, runId: string, runSessionId: string): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "RESUME_ASSIST", version: IPC_VERSION, runId, runSessionId }); }
  retryCaptcha(profileId: string, runId: string, runSessionId: string): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "RETRY_CAPTCHA", version: IPC_VERSION, runId, runSessionId }); }
  testCaptcha(profileId: string, runId: string, runSessionId: string, fixture: "RECAPTCHA_V2" | "RECAPTCHA_V3" | "TURNSTILE" | "GEETEST_V4"): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "TEST_CAPTCHA", version: IPC_VERSION, runId, runSessionId, fixture }); }
  provideCaptchaCredential(profileId: string, requestId: string, credential: Extract<RunnerCommand, { type: "CAPTCHA_CREDENTIAL_RESPONSE" }>["credential"], failure: Extract<RunnerCommand, { type: "CAPTCHA_CREDENTIAL_RESPONSE" }>["failure"]): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "CAPTCHA_CREDENTIAL_RESPONSE", version: IPC_VERSION, requestId, credential, failure }); }
  providePaymentSecret(profileId: string, requestId: string, secret: PaymentCardSecret | null, failure: Extract<RunnerCommand, { type: "PAYMENT_SECRET_RESPONSE" }>["failure"]): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "PAYMENT_SECRET_RESPONSE", version: IPC_VERSION, requestId, secret, failure }); }
  grantCheckoutSlot(profileId: string, requestId: string, reservationId: string | null, limit: Extract<RunnerCommand, { type: "CHECKOUT_SLOT_GRANTED" }>["limit"]): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "CHECKOUT_SLOT_GRANTED", version: IPC_VERSION, requestId, reservationId, limit }); }
  denyCheckoutSlot(profileId: string, requestId: string, succeeded: number, limit: number): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "CHECKOUT_SLOT_DENIED", version: IPC_VERSION, requestId, succeeded, limit }); }
  recordCheckoutSuccess(profileId: string, requestId: string, orderIndex: number): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "CHECKOUT_SUCCESS_RECORDED", version: IPC_VERSION, requestId, orderIndex }); }
  pauseAutomation(profileId: string, until: number): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "PAUSE_AUTOMATION", version: IPC_VERSION, until }); }
  resumeAutomation(profileId: string): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "RESUME_AUTOMATION", version: IPC_VERSION }); }
  grantClipboardLease(profileId: string, requestId: string): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "CLIPBOARD_LEASE_GRANTED", version: IPC_VERSION, requestId }); }
  denyClipboardLease(profileId: string, requestId: string, reason: "CLIPBOARD_NOT_EMPTY" | "CLIPBOARD_UNAVAILABLE" | "QUEUE_TIMEOUT" | "SESSION_ENDED"): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "CLIPBOARD_LEASE_DENIED", version: IPC_VERSION, requestId, reason }); }
  checkCart(profileId: string): void { this.pendingCartActions.set(profileId, "CHECK_CART"); this.dispatchCartAction(profileId); }
  emptyCart(profileId: string): void { this.pendingCartActions.set(profileId, "EMPTY_CART"); this.dispatchCartAction(profileId); }
  openWarmDestination(profileId: string, url: string): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "OPEN_WARM_DESTINATION", version: IPC_VERSION, url }); }
  focusAssistPage(profileId: string): void { const active = this.runners.get(profileId); if (active) this.send(active.child, { type: "FOCUS_ASSIST_PAGE", version: IPC_VERSION }); }

  private onRunnerMessage(profileId: string, message: unknown): void {
    const parsed = runnerEventSchema.safeParse(message); if (!parsed.success || (parsed.data.profileId !== null && parsed.data.profileId !== profileId)) return;
    const event: RunnerEvent = parsed.data;
    if (event.type === "READY") { this.setState(profileId, "READY", null, event.route, event.driver, event.coherence); this.dispatchCartAction(profileId); }
    if (event.type === "STOPPED") this.setState(profileId, "STOPPED");
    if (event.type === "ERROR") this.setState(profileId, "ERROR", { code: event.code, message: event.message });
    if (event.type === "RUN_EVENT" || event.type === "RUN_ARTIFACT" || event.type === "RUN_ENDED" || event.type === "NETWORK_USAGE" || event.type === "PAYMENT_HANDOFF" || event.type === "CART_STATUS" || event.type === "HEALTH" || event.type === "CLIPBOARD_LEASE_REQUEST" || event.type === "CLIPBOARD_LEASE_RELEASE" || event.type === "CAPTCHA_CREDENTIAL_REQUEST" || event.type === "PAYMENT_SECRET_REQUEST" || event.type === "CHECKOUT_SLOT_REQUEST" || event.type === "PAYMENT_SUBMISSION_RESULT" || event.type === "CAPTCHA_LAB_RESULT") this.emit("runner-event", event);
  }

  private onRunnerExit(profileId: string, active: ActiveRunner): void {
    if (this.runners.get(profileId) !== active) return; this.runners.delete(profileId); active.child.removeAllListeners(); const current = this.snapshot(profileId);
    if (active.expectedStop || current.state === "STOPPED") this.setState(profileId, "STOPPED"); else if (current.state !== "ERROR") this.setState(profileId, "CRASHED", { code: "RUNNER_CRASHED", message: "The isolated browser runner exited unexpectedly." });
  }

  private setState(profileId: string, state: SessionSnapshot["state"], error: SessionError | null = null, route?: SessionRoute, driver?: BrowserDriverMetadata | null, coherence?: ProfileCoherenceSummary | null): void {
    const current = this.snapshot(profileId); const snapshot: SessionSnapshot = { profileId, state, error, route: route ?? current.route, coherence: coherence === undefined ? current.coherence : coherence, driver: driver === undefined ? current.driver : driver, updatedAt: Date.now() }; this.sessions.set(profileId, snapshot); this.emit("changed", snapshot);
  }
  private send(child: RunnerChild, command: RunnerCommand): void { child.send(command, (error) => { if (error) child.kill(); }); }
  private dispatchCartAction(profileId: string): void { const active = this.runners.get(profileId); const action = this.pendingCartActions.get(profileId); if (!active || this.snapshot(profileId).state !== "READY" || !action) return; this.pendingCartActions.delete(profileId); this.send(active.child, { type: action, version: IPC_VERSION, profileId }); }
  private async waitForStopped(profileId: string): Promise<void> { if (!this.runners.has(profileId)) return; await new Promise<void>((resolve) => { const listener = (snapshot: SessionSnapshot) => { if (snapshot.profileId === profileId && !this.runners.has(profileId)) { this.off("changed", listener); resolve(); } }; this.on("changed", listener); }); }
  private enqueue(profileId: string, task: () => Promise<void>): Promise<void> { const previous = this.queues.get(profileId) ?? Promise.resolve(); const next = previous.catch(() => undefined).then(task); const tracked = next.finally(() => { if (this.queues.get(profileId) === tracked) this.queues.delete(profileId); }); this.queues.set(profileId, tracked); return tracked; }
}

export function nodeRunnerFactory(runnerPath: string): RunnerFactory { return () => fork(runnerPath, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] }); }
function toLaunchSpec(input: BrowserProfile | SessionLaunchSpec): SessionLaunchSpec {
  if ("profile" in input) return input;
  if (input.driver.kind !== "NATIVE_STEALTH") throw new Error("External CDP profiles require a resolved encrypted endpoint.");
  return { profile: input, driver: { kind: "NATIVE_STEALTH" }, proxy: null, probeUrl: DEFAULT_NETWORK_PROBE_URL, recording: null, background: false };
}
function routeFor(proxy: RunnerProxy | null): SessionRoute { return proxy ? { kind: "proxy", proxyProfileId: proxy.proxyProfileId, proxyName: proxy.proxyName, protocol: proxy.protocol, verification: defaultRoute().verification } : defaultRoute(); }
