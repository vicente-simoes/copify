import { randomUUID } from "node:crypto";
import { IPC_VERSION, monitorCommandSchema, type BrowserHealthSnapshot, type MonitorEvent, type MonitorPolicy, type TargetCheck, type TargetSnapshot } from "@copify/shared";
import { CrawleeJsonTransport, HttpStoreMonitor, MonitorConnectionPool, MonitorPollError, MonitorRequestError, ROUTE_UNHEALTHY_MS, assertMonitorPolicy } from "./http-monitor";

let timer: NodeJS.Timeout | undefined; let running = false; let stopping = false; let paused = false; let activeRunId: string | null = null; let activeTarget: TargetSnapshot | null = null; let activePolicy: MonitorPolicy | null = null; let pool: MonitorConnectionPool | null = null; let startedAt = 0; let requestCount = 0; let forbiddenCount = 0; let rateLimitedCount = 0; let challengeCount = 0; let bytesReceived = 0; let lastStatus: number | null = null; let lastLatency: number | null = null; let nextPollAt: number | null = null;
const transport = new CrawleeJsonTransport();
const httpMonitor = new HttpStoreMonitor(transport);

function send(value: MonitorEvent): void { process.send?.(value); }
function sanitize(value: string): string { return value.replace(/https?:\/\/[^\s?]+\?[^\s]+/gi, "[URL query redacted]").replace(/(authorization|cookie|password|token|secret)\s*[:=]\s*[^\s;,&]+/gi, "$1=[REDACTED]").slice(0, 500); }
async function check(target: TargetSnapshot, policy: MonitorPolicy, routes: MonitorConnectionPool): Promise<TargetCheck> {
  let route: ReturnType<MonitorConnectionPool["acquire"]> | undefined;
  try {
    assertMonitorPolicy(target, policy); requestCount += 1; const result = await httpMonitor.poll(target, policy, routes); route = result.route; const { candidates, response, decision } = result; bytesReceived += response.bytes; lastStatus = response.status; lastLatency = response.latencyMs;
    return { id: randomUUID(), targetId: target.targetId, checkedAt: Date.now(), status: decision.kind === "ERROR" ? "ERROR" : "SUCCESS", decision, candidateCount: candidates.length, errorMessage: decision.kind === "ERROR" ? decision.message : null };
  } catch (error) {
    if (error instanceof MonitorPollError) route = error.route;
    const reason = error instanceof MonitorPollError ? error.reason : error;
    const requestError = reason instanceof MonitorRequestError ? reason : null;
    lastStatus = requestError?.status ?? null;
    if (requestError?.status === 403) forbiddenCount += 1;
    if (requestError?.status === 429) rateLimitedCount += 1;
    if (requestError?.code === "STOREFRONT_PROTECTION" && requestError.status === null) challengeCount += 1;
    if (route && (requestError?.status === 403 || requestError?.status === 429 || requestError?.code === "STOREFRONT_PROTECTION" || requestError?.code === "MONITOR_CONNECTION_FAILED" || requestError?.code === "STORE_UNAVAILABLE" || /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(error instanceof Error ? error.message : ""))) {
      routes.markUnhealthy(route, Date.now() + ROUTE_UNHEALTHY_MS);
    }
    const allUnhealthy = routes.healthyCount() === 0;
    const errorMessage = sanitize(reason instanceof Error ? reason.message : "The HTTP monitor failed.");
    return {
      id: randomUUID(),
      targetId: target.targetId,
      checkedAt: Date.now(),
      status: "ERROR",
      decision: { kind: "ERROR", message: "The storefront JSON feed could not be checked.", candidate: null, selectedVariant: null },
      candidateCount: 0,
      errorMessage: allUnhealthy ? errorMessage : `${errorMessage} (Route marked unhealthy; rotating in pool).`,
      retryAfterMs: allUnhealthy ? (requestError?.retryAfterMs ?? null) : null
    };
  }
}
async function poll(runId: string, target: TargetSnapshot, policy: MonitorPolicy, routes: MonitorConnectionPool): Promise<TargetCheck | undefined> {
  if (running || stopping || paused) return; running = true;
  try { const value = await check(target, policy, routes); send({ type: "MONITOR_EVENT", version: IPC_VERSION, runId, eventType: value.status === "ERROR" ? "TARGET_MONITOR_FAILED" : value.decision.kind === "VARIANT_SELECTED" ? "TARGET_VARIANT_SELECTED" : value.decision.kind === "PRICE_LIMIT_EXCEEDED" ? "PRICE_LIMIT_EXCEEDED" : value.decision.kind === "CURRENCY_MISMATCH" ? "CURRENCY_MISMATCH" : "TARGET_POLLED", check: value }); emitHealth(runId, policy, routes); return value; } finally { running = false; }
}
function schedule(runId: string, target: TargetSnapshot, policy: MonitorPolicy, routes: MonitorConnectionPool, delay = policy.pollIntervalMs): void { if (stopping || paused) return; nextPollAt = Date.now() + delay; timer = setTimeout(async () => { timer = undefined; nextPollAt = null; await poll(runId, target, policy, routes); if (!stopping && !paused) schedule(runId, target, policy, routes); }, delay); }
function emitHealth(runId: string | null, policy: MonitorPolicy, routes: MonitorConnectionPool): void {
  const elapsedMinutes = Math.max((Date.now() - startedAt) / 60_000, 1 / 60); const endpoint = new URL(policy.endpoint); endpoint.search = ""; const health: Omit<BrowserHealthSnapshot, "id" | "subjectKind" | "subjectId" | "runId"> = { capturedAt: Date.now(), navigatorWebdriver: null, browserVersion: null, driverKind: null, stealthStatus: null, profileAgeMs: null, cookieCount: null, requestCount, requestsPerMinute: requestCount / elapsedMinutes, navigationCount: 0, navigationsPerMinute: 0, atcAttempts: 0, forbiddenCount, rateLimitedCount, challengeCount, checkoutFailures: 0, averagePageLoadMs: lastLatency, monitorTransport: "HTTP", monitorEndpoint: endpoint.toString(), configuredRouteCount: routes.routes.length, healthyRouteCount: routes.healthyCount(), pollIntervalMs: policy.pollIntervalMs, lastHttpStatus: lastStatus, lastResponseLatencyMs: lastLatency, bytesReceived, nextPollAt, circuit: null };
  send({ type: "MONITOR_HEALTH", version: IPC_VERSION, runId, health });
}
process.on("message", async (value: unknown) => {
  const parsed = monitorCommandSchema.safeParse(value); if (!parsed.success) return; const command = parsed.data;
  if (command.type === "TEST_TARGET") { startedAt = Date.now(); const routes = new MonitorConnectionPool(command.routes); const result = await check(command.target, command.policy, routes); emitHealth(null, command.policy, routes); send({ type: "MONITOR_TEST_RESULT", version: IPC_VERSION, check: result }); return; }
  if (command.type === "START_MONITOR") { if (timer || running) return; assertMonitorPolicy(command.target, command.policy); activeRunId = command.runId; activeTarget = command.target; activePolicy = command.policy; pool = new MonitorConnectionPool(command.routes); stopping = false; paused = false; startedAt = Date.now(); requestCount = forbiddenCount = rateLimitedCount = challengeCount = bytesReceived = 0; send({ type: "MONITOR_EVENT", version: IPC_VERSION, runId: command.runId, eventType: "TARGET_MONITOR_STARTED", check: null }); await poll(command.runId, command.target, command.policy, pool); if (!stopping && !paused) schedule(command.runId, command.target, command.policy, pool); return; }
  if (command.type === "PAUSE_MONITOR") { paused = true; if (timer) clearTimeout(timer); timer = undefined; nextPollAt = command.until; send({ type: "MONITOR_EVENT", version: IPC_VERSION, runId: activeRunId, eventType: "TARGET_MONITOR_PAUSED", check: null }); return; }
  if (command.type === "RESUME_MONITOR") { if (!activeRunId || !activeTarget || !activePolicy || !pool || !paused) return; paused = false; send({ type: "MONITOR_EVENT", version: IPC_VERSION, runId: activeRunId, eventType: "TARGET_MONITOR_RESUMED", check: null }); schedule(activeRunId, activeTarget, activePolicy, pool, 0); return; }
  if (command.type === "STOP_MONITOR") { stopping = true; if (timer) clearTimeout(timer); timer = undefined; if (activePolicy && pool) emitHealth(activeRunId, activePolicy, pool); send({ type: "MONITOR_STOPPED", version: IPC_VERSION, runId: activeRunId }); activeRunId = null; activeTarget = null; activePolicy = null; pool = null; }
});

export { MonitorConnectionPool, assertMonitorPolicy, decideTarget, matchesTarget, normalizeMatch, parseRetryAfter, parseShopifyProducts, protectionCooldownMs, selectPreferredVariant } from "./http-monitor";
