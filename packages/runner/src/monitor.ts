import { randomUUID } from "node:crypto";
import {
  IPC_VERSION, monitorCommandSchema, type BrowserHealthSnapshot, type MonitorEvent, type MonitorFailureCode, type MonitorPolicy,
  type MonitorRoute, type MonitorRouteAction, type MonitorRuntimeState, type NetworkUsageCounter, type TargetCheck, type TargetSnapshot
} from "@copify/shared";
import { CrawleeJsonTransport, HttpStoreMonitor, MonitorConnectionPool, MonitorPollError, MonitorRequestError, assertMonitorPolicy, effectiveRouteCooldown, shouldCoolRouteForProtection } from "./http-monitor";

let timer: NodeJS.Timeout | undefined;
let turboTimer: NodeJS.Timeout | undefined;
let running = false;
let stopping = false;
let pausedState: Extract<MonitorRuntimeState, "SERVICE_COOLDOWN" | "POOL_EXHAUSTED"> | null = null;
let activeRunId: string | null = null;
let activeTarget: TargetSnapshot | null = null;
let activePolicy: MonitorPolicy | null = null;
let pool: MonitorConnectionPool | null = null;
let turbo = false;
let fastEndsAt: number | null = null;
let startedAt = 0;
let startedMono = process.hrtime.bigint();
let requestCount = 0;
let forbiddenCount = 0;
let rateLimitedCount = 0;
let challengeCount = 0;
let bytesReceived = 0;
let bytesSent = 0;
let lastStatus: number | null = null;
let lastLatency: number | null = null;
let lastErrorCode: MonitorFailureCode | null = null;
let nextPollAt: number | null = null;
const routeUsage = new Map<string, NetworkUsageCounter>();
const transport = new CrawleeJsonTransport();
const httpMonitor = new HttpStoreMonitor(transport);

function send(value: MonitorEvent): void { process.send?.(value); }
function sanitize(value: string): string { return value.replace(/https?:\/\/[^\s?]+\?[^\s]+/gi, "[URL query redacted]").replace(/(authorization|cookie|password|token|secret)\s*[:=]\s*[^\s;,&]+/gi, "$1=[REDACTED]").slice(0, 500); }
function activeInterval(policy: MonitorPolicy): number { return turbo ? policy.fastPollIntervalMs : policy.pollIntervalMs; }
function runtimeState(): MonitorRuntimeState { return stopping || !activeRunId ? "STOPPED" : pausedState ?? (turbo ? "TURBO" : "STANDBY"); }
function emitRuntime(): void {
  send({ type: "MONITOR_RUNTIME", version: IPC_VERSION, status: { runId: activeRunId, storeId: activeTarget?.storeId ?? null, state: runtimeState(), activeIntervalMs: activePolicy ? activeInterval(activePolicy) : null, fastEndsAt, nextPollAt, configuredRouteCount: pool?.routes.length ?? 0, healthyRouteCount: pool?.healthyCount() ?? 0, lastErrorCode, sources: [], updatedAt: Date.now() } });
}
function recordUsage(route: MonitorRoute, received: number, sent: number, requests: number, discoverySource: import("@copify/shared").DiscoverySource | null = null): void {
  const key = `${discoverySource ?? "all"}:${route.id}`; const current = routeUsage.get(key) ?? { receivedBytes: 0, sentBytes: 0, requestCount: 0, completeness: "PARTIAL" as const };
  const next = { ...current, receivedBytes: current.receivedBytes + received, sentBytes: current.sentBytes + sent, requestCount: current.requestCount + requests };
  routeUsage.set(key, next); bytesReceived += received; bytesSent += sent;
  if (activeRunId) send({ type: "MONITOR_USAGE", version: IPC_VERSION, runId: activeRunId, routeId: route.id, discoverySource, usage: next });
}
function failureCode(error: MonitorRequestError | null, reason: unknown): MonitorFailureCode {
  if (error?.code === "PROXY_AUTH_FAILED" || error?.status === 407) return "PROXY_AUTH_FAILED";
  if (error?.code === "STOREFRONT_PROTECTION") return "STOREFRONT_PROTECTION";
  if (error?.code === "STOREFRONT_SERVICE_UNAVAILABLE" || error?.status === 503) return "STOREFRONT_SERVICE_UNAVAILABLE";
  if (error?.code === "NO_HEALTHY_ROUTES") return "NO_HEALTHY_ROUTES";
  if (error?.code === "INVALID_MONITOR_POLICY") return "INVALID_MONITOR_POLICY";
  if (error?.code === "MONITOR_ENDPOINT_UNSUPPORTED") return "MONITOR_ENDPOINT_UNSUPPORTED";
  if (error?.code === "MONITOR_RESPONSE_TOO_LARGE") return "MONITOR_RESPONSE_TOO_LARGE";
  if (error?.code === "MONITOR_CONNECTION_FAILED" || /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|fetch failed|aborted/i.test(reason instanceof Error ? reason.message : "")) return "PROXY_TRANSPORT_FAILED";
  return "UNKNOWN";
}
type CheckResult = { check: TargetCheck; retryNow: boolean; cooldownMs: number | null; diagnostics: import("./http-monitor").DiscoveryDiagnostic[] };
async function check(target: TargetSnapshot, policy: MonitorPolicy, routes: MonitorConnectionPool): Promise<CheckResult> {
  let route: MonitorRoute | undefined;
  try {
    assertMonitorPolicy(target, policy); const result = await httpMonitor.poll(target, policy, routes, turbo); route = result.route;
    const { candidates, response, decision, diagnostics } = result; requestCount += response.requestCount; recordUsage(route, response.bytes, response.sentBytes, response.requestCount, diagnostics.find((item) => item.type === "DISCOVERY_MESH_WINNER")?.source ?? null); lastStatus = response.status; lastLatency = response.latencyMs; lastErrorCode = null;
    return { check: { id: randomUUID(), targetId: target.targetId, checkedAt: Date.now(), status: decision.kind === "ERROR" ? "ERROR" : "SUCCESS", decision, candidateCount: candidates.length, errorMessage: decision.kind === "ERROR" ? decision.message : null, errorCode: null, routeId: route.id, routeAction: "NONE" }, retryNow: false, cooldownMs: null, diagnostics };
  } catch (caught) {
    if (caught instanceof MonitorPollError) route = caught.route;
    const reason = caught instanceof MonitorPollError ? caught.reason : caught;
    const requestError = reason instanceof MonitorRequestError ? reason : null;
    if (route && requestError?.response) { requestCount += requestError.response.requestCount; recordUsage(route, requestError.response.bytes, requestError.response.sentBytes, requestError.response.requestCount); }
    const code = failureCode(requestError, reason); lastErrorCode = code; lastStatus = requestError?.status ?? null; lastLatency = requestError?.response?.latencyMs ?? null;
    if (requestError?.status === 403) forbiddenCount += 1;
    if (requestError?.status === 429) rateLimitedCount += 1;
    if (code === "STOREFRONT_PROTECTION" && requestError?.status === null) challengeCount += 1;
    let action: MonitorRouteAction = "NONE"; let retryNow = false; let cooldownMs: number | null = null;
    if (route && code === "STOREFRONT_PROTECTION") {
      if (!shouldCoolRouteForProtection(route)) action = "ROTATING_GATEWAY_RETAINED";
      else {
        const routeCooldown = effectiveRouteCooldown(policy, requestError?.retryAfterMs ?? null); routes.markUnhealthy(route, Date.now() + routeCooldown); action = routes.healthyCount() ? "ROUTE_COOLED" : "POOL_EXHAUSTED";
        retryNow = policy.rotateOnProtection && routes.healthyCount() > 0;
        if (!policy.rotateOnProtection) cooldownMs = routeCooldown;
      }
    } else if (route && (code === "PROXY_TRANSPORT_FAILED" || code === "PROXY_AUTH_FAILED" || code === "MONITOR_CONNECTION_FAILED")) {
      routes.markUnhealthy(route, Date.now() + policy.routeUnhealthyMs); action = routes.healthyCount() ? "ROUTE_COOLED" : "POOL_EXHAUSTED"; retryNow = routes.healthyCount() > 0;
    } else if (code === "STOREFRONT_SERVICE_UNAVAILABLE") {
      action = "MONITOR_COOLDOWN"; cooldownMs = Math.max(policy.serviceCooldownMs, policy.honorRetryAfter ? requestError?.retryAfterMs ?? 0 : 0);
    }
    let effectiveCode = code;
    if (route && routes.healthyCount() === 0 && action === "POOL_EXHAUSTED") effectiveCode = "NO_HEALTHY_ROUTES";
    const errorMessage = sanitize(reason instanceof Error ? reason.message : "The HTTP monitor failed.");
    return { check: { id: randomUUID(), targetId: target.targetId, checkedAt: Date.now(), status: "ERROR", decision: { kind: "ERROR", message: "The storefront catalog could not be checked.", candidate: null, selectedVariant: null }, candidateCount: 0, errorMessage, retryAfterMs: requestError?.retryAfterMs ?? null, errorCode: effectiveCode, routeId: route?.id ?? null, routeAction: action }, retryNow, cooldownMs, diagnostics: [] };
  }
}
function eventType(check: TargetCheck): string { return check.status === "ERROR" ? check.errorCode === "NO_HEALTHY_ROUTES" ? "NO_HEALTHY_ROUTES" : "TARGET_MONITOR_FAILED" : check.decision.kind === "VARIANT_SELECTED" ? "TARGET_VARIANT_SELECTED" : check.decision.kind === "PRICE_LIMIT_EXCEEDED" ? "PRICE_LIMIT_EXCEEDED" : check.decision.kind === "CURRENCY_MISMATCH" ? "CURRENCY_MISMATCH" : "TARGET_POLLED"; }
async function poll(runId: string, target: TargetSnapshot, policy: MonitorPolicy, routes: MonitorConnectionPool): Promise<TargetCheck | undefined> {
  if (running || stopping || pausedState) return; running = true; let latest: TargetCheck | undefined;
  try {
    const limit = Math.max(1, routes.routes.length); for (let attempt = 0; attempt < limit; attempt += 1) {
      const result = await check(target, policy, routes); latest = result.check; send({ type: "MONITOR_EVENT", version: IPC_VERSION, runId, eventType: eventType(result.check), check: result.check });
      for (const diagnostic of result.diagnostics) send({ type: "MONITOR_DISCOVERY_EVENT", version: IPC_VERSION, runId, event: { ...diagnostic, elapsedNs: (process.hrtime.bigint() - startedMono).toString() } });
      if (result.check.errorCode === "NO_HEALTHY_ROUTES") { enterCooldown("POOL_EXHAUSTED", Math.max(1_000, (routes.nextHealthyAt() ?? Date.now() + policy.routeUnhealthyMs) - Date.now())); break; }
      if (result.cooldownMs) { enterCooldown("SERVICE_COOLDOWN", result.cooldownMs); break; }
      if (!result.retryNow) break;
    }
    emitHealth(runId, policy, routes); return latest;
  } finally { running = false; emitRuntime(); }
}
function clearPollTimer(): void { if (timer) clearTimeout(timer); timer = undefined; nextPollAt = null; }
function schedule(runId: string, target: TargetSnapshot, policy: MonitorPolicy, routes: MonitorConnectionPool, delay = activeInterval(policy)): void {
  if (stopping || pausedState) return; clearPollTimer(); nextPollAt = Date.now() + delay; emitRuntime(); timer = setTimeout(async () => { timer = undefined; nextPollAt = null; await poll(runId, target, policy, routes); if (!stopping && !pausedState) schedule(runId, target, policy, routes); }, delay);
}
function enterCooldown(state: "SERVICE_COOLDOWN" | "POOL_EXHAUSTED", durationMs: number): void {
  if (!activeRunId || !activeTarget || !activePolicy || !pool) return; clearPollTimer(); pausedState = state; nextPollAt = Date.now() + durationMs; emitRuntime();
  timer = setTimeout(() => { timer = undefined; pausedState = null; nextPollAt = null; if (!stopping && activeRunId && activeTarget && activePolicy && pool) schedule(activeRunId, activeTarget, activePolicy, pool, 0); }, durationMs);
}
function setTurbo(enabled: boolean): void {
  if (!activeRunId || !activeTarget || !activePolicy || !pool || stopping) return; if (turboTimer) clearTimeout(turboTimer); turboTimer = undefined; turbo = enabled; fastEndsAt = enabled ? Date.now() + activePolicy.fastPollDurationMinutes * 60_000 : null;
  if (enabled && fastEndsAt) turboTimer = setTimeout(() => setTurbo(false), Math.max(0, fastEndsAt - Date.now()));
  if (!pausedState) schedule(activeRunId, activeTarget, activePolicy, pool, enabled ? 0 : activePolicy.pollIntervalMs); else emitRuntime();
}
function emitHealth(runId: string | null, policy: MonitorPolicy, routes: MonitorConnectionPool): void {
  const elapsedMinutes = Math.max((Date.now() - startedAt) / 60_000, 1 / 60); const endpoint = new URL(policy.endpoint); endpoint.search = "";
  const health: Omit<BrowserHealthSnapshot, "id" | "subjectKind" | "subjectId" | "runId"> = { capturedAt: Date.now(), navigatorWebdriver: null, browserVersion: null, driverKind: null, stealthStatus: null, profileAgeMs: null, cookieCount: null, requestCount, requestsPerMinute: requestCount / elapsedMinutes, navigationCount: 0, navigationsPerMinute: 0, atcAttempts: 0, forbiddenCount, rateLimitedCount, challengeCount, checkoutFailures: 0, averagePageLoadMs: lastLatency, monitorTransport: "HTTP", monitorEndpoint: endpoint.toString(), configuredRouteCount: routes.routes.length, healthyRouteCount: routes.healthyCount(), pollIntervalMs: activeInterval(policy), lastHttpStatus: lastStatus, lastResponseLatencyMs: lastLatency, bytesReceived, nextPollAt, circuit: null };
  send({ type: "MONITOR_HEALTH", version: IPC_VERSION, runId, health });
}
function stop(): void {
  stopping = true; clearPollTimer(); if (turboTimer) clearTimeout(turboTimer); turboTimer = undefined; turbo = false; fastEndsAt = null;
  if (activePolicy && pool) emitHealth(activeRunId, activePolicy, pool); const runId = activeRunId; activeRunId = null; activeTarget = null; activePolicy = null; pool = null; pausedState = null; emitRuntime(); send({ type: "MONITOR_STOPPED", version: IPC_VERSION, runId });
}
process.on("message", async (value: unknown) => {
  const parsed = monitorCommandSchema.safeParse(value); if (!parsed.success) return; const command = parsed.data;
  if (command.type === "TEST_TARGET") { startedAt = Date.now(); const routes = new MonitorConnectionPool(command.routes); const result = await check(command.target, command.policy, routes); emitHealth(null, command.policy, routes); send({ type: "MONITOR_TEST_RESULT", version: IPC_VERSION, check: result.check }); return; }
  if (command.type === "START_MONITOR") { if (timer || running || activeRunId) return; assertMonitorPolicy(command.target, command.policy); activeRunId = command.runId; activeTarget = command.target; activePolicy = command.policy; pool = new MonitorConnectionPool(command.routes); stopping = false; pausedState = null; turbo = false; fastEndsAt = null; startedAt = Date.now(); startedMono = process.hrtime.bigint(); requestCount = forbiddenCount = rateLimitedCount = challengeCount = bytesReceived = bytesSent = 0; routeUsage.clear(); send({ type: "MONITOR_EVENT", version: IPC_VERSION, runId: command.runId, eventType: "TARGET_MONITOR_STARTED", check: null }); emitRuntime(); schedule(command.runId, command.target, command.policy, pool, command.policy.immediateFirstPoll ? 0 : command.policy.pollIntervalMs); return; }
  if (command.type === "SET_MONITOR_TURBO") { setTurbo(command.enabled); return; }
  if (command.type === "PAUSE_MONITOR") { enterCooldown("SERVICE_COOLDOWN", Math.max(0, command.until - Date.now())); return; }
  if (command.type === "RESUME_MONITOR") { if (!activeRunId || !activeTarget || !activePolicy || !pool) return; pausedState = null; schedule(activeRunId, activeTarget, activePolicy, pool, 0); return; }
  if (command.type === "STOP_MONITOR") stop();
});

export { MonitorConnectionPool, assertMonitorPolicy, canonicalProductUrl, decideTarget, effectiveRouteCooldown, matchesTarget, normalizeMatch, parsePredictiveProductUrls, parseRetryAfter, parseShopifyProducts, parseShopifySitemap, selectPreferredVariant, shouldCoolRouteForProtection, validateDiscoveryHandlers } from "./http-monitor";
