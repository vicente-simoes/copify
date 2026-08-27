import type { FailureCategory, ReliabilityRow, RunDetail, RunEvent, RunMetrics, RunSession, SessionMetrics } from "@copify/shared";

const nsToMs = (value: bigint): number => Number(value) / 1_000_000;
const at = (event: RunEvent): bigint => BigInt(event.elapsedNs);
const first = (events: RunEvent[], ...types: string[]): RunEvent | undefined => events.find((event) => types.includes(event.type));

function duration(start: RunEvent | undefined, end: RunEvent | undefined, anomalies: string[], name: string): number | null {
  if (!start || !end) return null;
  const value = at(end) - at(start);
  if (value < 0n) { anomalies.push(`${name}:reversed`); return null; }
  return nsToMs(value);
}

function pairedDuration(events: RunEvent[], starts: string[], ends: string[]): { value: number | null; incomplete: boolean } {
  const queue: bigint[] = []; let total = 0n; let pairs = 0;
  for (const event of events) {
    if (starts.includes(event.type)) queue.push(at(event));
    if (ends.includes(event.type) && queue.length) { const start = queue.shift()!; if (at(event) >= start) { total += at(event) - start; pairs += 1; } }
  }
  return { value: pairs ? nsToMs(total) : null, incomplete: queue.length > 0 };
}

function classify(session: RunSession, events: RunEvent[]): FailureCategory | null {
  const code = String(session.finalError?.code ?? first(events, "ASSIST_FAILED", "SESSION_FAILED")?.payload.code ?? "");
  if (/PROXY|NETWORK|ROUTE/.test(code)) return "NETWORK_PROXY";
  if (/PROTECTION|CHECKPOINT/.test(code) || events.some((e) => e.type === "CHECKPOINT_DETECTED" && e.payload.reason === "STOREFRONT_PROTECTION")) return "STOREFRONT_PROTECTION";
  if (/PRODUCT|VARIANT|PRICE|SOLD_OUT/.test(code)) return "PRODUCT_VARIANT";
  if (/ATC|CART/.test(code)) return "CART";
  if (/CAPTCHA/.test(code)) return "CAPTCHA";
  if (/PAYMENT|3DS/.test(code)) return "PAYMENT_HANDOFF";
  if (/CHECKOUT/.test(code)) return "CHECKOUT";
  if (/BROWSER|RUNNER|RECORDING|INTERRUPTED/.test(code)) return "BROWSER_RUNNER";
  return session.status === "FAILED" ? "UNKNOWN" : null;
}

export function deriveMetrics(detail: RunDetail): { run: RunMetrics; sessions: SessionMetrics[] } {
  const global = detail.events.filter((event) => event.runSessionId === null);
  const monitorStart = first(global, "TARGET_MONITOR_STARTED");
  const winner = first(global, "DISCOVERY_MESH_WINNER", "TARGET_VARIANT_SELECTED");
  const runAnomalies: string[] = [];
  const maximum = detail.events.reduce<bigint | null>((value, event) => value === null || at(event) > value ? at(event) : value, null);
  const sourceTimings: RunMetrics["discoverySourceTimings"] = {};
  for (const event of global.filter((item) => item.type === "DISCOVERY_SOURCE_PROBED")) {
    const source = event.payload.source as keyof typeof sourceTimings; const value = Number(event.payload.durationMs);
    if (source && Number.isFinite(value) && value >= 0) sourceTimings[source] = value;
  }
  const run: RunMetrics = {
    derivationVersion: 1, runId: detail.run.id, monitorToDetectMs: duration(monitorStart, winner, runAnomalies, "monitorToDetect"),
    totalDurationMs: maximum === null ? null : nsToMs(maximum), discoveryWinner: (winner?.payload.source as RunMetrics["discoveryWinner"]) ?? null,
    discoverySourceTimings: sourceTimings, anomalies: runAnomalies,
  };
  const sessions = detail.sessions.map((session): SessionMetrics => {
    const events = detail.events.filter((event) => event.runSessionId === session.id); const anomalies: string[] = [];
    const cart = first(events, "CART_CONFIRMED", "DIRECT_CART_VERIFIED"); const checkout = first(events, "CHECKOUT_NAVIGATION_STARTED");
    const checkpoints = pairedDuration(events, ["CHECKPOINT_DETECTED"], ["CHECKPOINT_RESUMED"]);
    const handoffs = pairedDuration(events, ["PAYMENT_HANDOFF_DETECTED", "INTERACTIVE_3DS_REQUIRED"], ["PAYMENT_HANDOFF_RETURNED"]);
    const reachedReady = Boolean(first(events, "READY_TO_CONFIRM", "PAYMENT_HANDOFF_RETURNED")); const readyToSubmit=first(events,"READY_TO_SUBMIT"); const dispatched=first(events,"PAYMENT_SUBMISSION_DISPATCHED"); const submissionResult=first(events,"CHECKOUT_SUCCESS","CHECKOUT_SLOT_RELEASED","PAYMENT_RESULT_AMBIGUOUS");
    const eligible = Boolean(first(events, "VARIANT_SELECTED"));
    const observedOutcome = detail.run.executionMode === "OBSERVATION" ? "OBSERVATION_ONLY" : session.orderIndex ? "SUCCESS" : session.executionState === "CHECKOUT_LIMIT_REACHED" ? "CHECKOUT_LIMIT_REACHED" : session.quotaOutcome === "AMBIGUOUS" ? "PAYMENT_RESULT_AMBIGUOUS" : session.status === "FAILED" ? "FAILED" : readyToSubmit ? "READY_TO_SUBMIT" : reachedReady ? "READY_TO_CONFIRM" : "ENDED_WITHOUT_READY";
    const challenges = events.filter((e) => e.type === "CAPTCHA_CHALLENGE_DETECTED");
    const completedSolves = events.filter((e) => e.type === "CAPTCHA_SOLVE_COMPLETED");
    const solveDurations = completedSolves.map((event) => Number(event.payload.durationMs)).filter((value) => Number.isFinite(value) && value >= 0);
    const costs = events.filter((e) => e.type === "CAPTCHA_TOKEN_VALIDATED").map((event) => event.payload.costMicrosUsd).filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
    return {
      derivationVersion: 1, runId: detail.run.id, runSessionId: session.id, browserProfileId: session.browserProfileId, browserProfileName: session.browserProfileName,
      proxyProfileId: session.route.kind === "proxy" ? session.route.proxyProfileId : null, proxyName: session.route.kind === "proxy" ? session.route.proxyName : "Direct", observedOutcome,
      detectToCartMs: duration(winner, cart, anomalies, "detectToCart"), cartToCheckoutMs: duration(cart, checkout, anomalies, "cartToCheckout"), human3dsDurationMs: handoffs.value, checkpointDurationMs: checkpoints.value,
      checkpointCount: events.filter((e) => e.type === "CHECKPOINT_DETECTED").length, turnstileCount: challenges.filter((e) => e.payload.kind === "TURNSTILE" || e.payload.captchaKind === "turnstile").length,
      captchaChallengeCount: challenges.length, networkErrorCount: events.filter((e) => e.type === "NETWORK_FAILED").length,
      http4xxCount: events.filter((e) => e.type === "HTTP_STATUS" && Number(e.payload.status) >= 400 && Number(e.payload.status) < 500).length,
      http5xxCount: events.filter((e) => e.type === "HTTP_STATUS" && Number(e.payload.status) >= 500).length, failureCategory: classify(session, events),
      incompleteCheckpoint: checkpoints.incomplete, incomplete3ds: handoffs.incomplete, anomalies: [...anomalies, ...(eligible ? [] : ["not-checkout-eligible"])],
      checkoutMode: session.checkoutMode, captchaStrategy: session.captchaStrategy, captchaSolveDurationMs: solveDurations.length ? solveDurations.reduce((sum, value) => sum + value, 0) : null, captchaSolveCostMicrosUsd: costs.length ? costs.reduce((sum, value) => sum + value, 0) : null, captchaFailoverCount: events.filter((e) => e.type === "CAPTCHA_FAILOVER_TRIGGERED").length,
      readyToSubmitToDispatchMs: duration(readyToSubmit,dispatched,anomalies,"readyToSubmitToDispatch"), paymentSubmissionToResultMs: duration(dispatched,submissionResult,anomalies,"paymentSubmissionToResult"), orderIndex:session.orderIndex,quotaOutcome:session.quotaOutcome,
    };
  });
  return { run, sessions };
}

export function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function reliabilityRows(metrics: SessionMetrics[], key: "profile" | "proxy"): ReliabilityRow[] {
  const groups = new Map<string, SessionMetrics[]>();
  for (const metric of metrics) { const id = key === "profile" ? metric.browserProfileId : metric.proxyProfileId ?? "direct"; groups.set(id, [...(groups.get(id) ?? []), metric]); }
  return [...groups.entries()].map(([id, rows]) => {
    const eligible = rows.filter((row) => !row.anomalies.includes("not-checkout-eligible"));
    const rate = (values: SessionMetrics[], predicate: (row: SessionMetrics) => boolean) => ({ numerator: values.filter(predicate).length, denominator: values.length, rate: values.length ? values.filter(predicate).length / values.length : null });
    const timings = rows.flatMap((row) => row.detectToCartMs === null ? [] : [row.detectToCartMs]);
    return { id, name: key === "profile" ? rows[0].browserProfileName : rows[0].proxyName ?? "Direct", attempts: rows.length, readyRate: rate(rows, (r) => r.observedOutcome === "READY_TO_CONFIRM"), failureRate: rate(rows, (r) => r.observedOutcome === "FAILED"), checkpointRate: rate(eligible, (r) => r.checkpointCount > 0), turnstileRate: rate(eligible, (r) => r.turnstileCount > 0), medianDetectToCartMs: percentile(timings, .5), p95DetectToCartMs: percentile(timings, .95) };
  });
}
