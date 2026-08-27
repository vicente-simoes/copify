import type { CaptchaChallenge, CaptchaFailureCode, CaptchaProviderKind } from "@copify/shared";

export type CaptchaCredentialLease = { kind: CaptchaProviderKind; endpoint: string | null; apiKey: string };
export type CaptchaSolveResult = { token: string; costMicrosUsd: number | null; costAuthority: "PROVIDER_REPORTED" | "UNAVAILABLE" };
export type CaptchaBalanceResult = { balanceMicrosUsd: number };

export class CaptchaProviderError extends Error {
  constructor(readonly code: CaptchaFailureCode, message: string) { super(message); this.name = "CaptchaProviderError"; }
}

const CAPSOLVER_BASE = "https://api.capsolver.com";

export async function solveCaptcha(challenge: CaptchaChallenge, credential: CaptchaCredentialLease, timeoutMs: number, externalSignal?: AbortSignal): Promise<CaptchaSolveResult> {
  if (credential.kind === "CAPSOLVER" && challenge.kind === "HCAPTCHA") throw new CaptchaProviderError("UNSUPPORTED_CHALLENGE", "CapSolver does not advertise an hCaptcha task type.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs); timeout.unref?.();
  const abort = (): void => controller.abort(externalSignal?.reason ?? "cancelled");
  externalSignal?.addEventListener("abort", abort, { once: true });
  try {
    if (credential.kind === "CUSTOM_FAST_TOKEN") return await solveFast(challenge, credential, controller.signal);
    if (credential.kind === "CAPSOLVER" && (challenge.kind === "RECAPTCHA_V2" || challenge.kind === "RECAPTCHA_V3")) return await solveCapSolverToken(challenge, credential, controller.signal);
    return await solveAsync(challenge, credential, controller.signal);
  } catch (error) {
    if (error instanceof CaptchaProviderError) throw error;
    if (controller.signal.aborted) throw new CaptchaProviderError(controller.signal.reason === "timeout" ? "TIMEOUT" : "CANCELLED", controller.signal.reason === "timeout" ? "The solver timed out." : "The solver request was cancelled.");
    throw new CaptchaProviderError("SERVICE_UNAVAILABLE", "The solver provider is unavailable.");
  } finally {
    clearTimeout(timeout); externalSignal?.removeEventListener("abort", abort);
  }
}

export async function diagnoseCaptchaProvider(credential: CaptchaCredentialLease, timeoutMs = 10_000): Promise<CaptchaBalanceResult> {
  if (credential.kind !== "CAPSOLVER") {
    if (credential.kind === "CUSTOM_FAST_TOKEN") {
      const response = await requestJson(credential.endpoint!, { apiKey: credential.apiKey, diagnostic: { operation: "balance" } }, AbortSignal.timeout(timeoutMs));
      const balance = moneyMicros(response.balance ?? response.balanceUsd);
      if (balance === null) throw new CaptchaProviderError("INVALID_RESPONSE", "The custom diagnostic response did not include a numeric balance.");
      return { balanceMicrosUsd: balance };
    }
  }
  const base = providerBase(credential);
  const response = await requestJson(`${base}/getBalance`, { clientKey: credential.apiKey }, AbortSignal.timeout(timeoutMs));
  assertProviderSuccess(response);
  const balance = moneyMicros(response.balance);
  if (balance === null) throw new CaptchaProviderError("INVALID_RESPONSE", "The provider returned an invalid balance.");
  return { balanceMicrosUsd: balance };
}

async function solveFast(challenge: CaptchaChallenge, credential: CaptchaCredentialLease, signal: AbortSignal): Promise<CaptchaSolveResult> {
  const response = await requestJson(credential.endpoint!, { apiKey: credential.apiKey, challenge: providerChallenge(challenge) }, signal);
  assertProviderSuccess(response);
  return normalizeToken(response.token ?? response.solution?.token ?? response.solution?.gRecaptchaResponse, response.costMicrosUsd, response.cost);
}

async function solveCapSolverToken(challenge: CaptchaChallenge, credential: CaptchaCredentialLease, signal: AbortSignal): Promise<CaptchaSolveResult> {
  const response = await requestJson(`${providerBase(credential)}/getToken`, { clientKey: credential.apiKey, task: capSolverTask(challenge) }, signal);
  assertProviderSuccess(response);
  return normalizeToken(response.token ?? response.solution?.token ?? response.solution?.gRecaptchaResponse, response.costMicrosUsd, response.cost);
}

async function solveAsync(challenge: CaptchaChallenge, credential: CaptchaCredentialLease, signal: AbortSignal): Promise<CaptchaSolveResult> {
  const base = providerBase(credential);
  const task = capSolverTask(challenge);
  const created = await requestJson(`${base}/createTask`, { clientKey: credential.apiKey, task }, signal);
  assertProviderSuccess(created);
  const taskId = created.taskId;
  if (typeof taskId !== "string" && typeof taskId !== "number") throw new CaptchaProviderError("INVALID_RESPONSE", "The provider did not return a task ID.");
  for (;;) {
    await wait(750, signal);
    const response = await requestJson(`${base}/getTaskResult`, { clientKey: credential.apiKey, taskId }, signal);
    assertProviderSuccess(response);
    if (response.status === "processing" || response.status === "idle") continue;
    if (response.status !== "ready") throw new CaptchaProviderError("INVALID_RESPONSE", "The provider returned an unknown task status.");
    return normalizeToken(response.solution?.token ?? response.solution?.gRecaptchaResponse, response.costMicrosUsd, response.cost);
  }
}

function providerBase(credential: CaptchaCredentialLease): string {
  const value = (credential.endpoint ?? CAPSOLVER_BASE).replace(/\/+$/, "");
  return value.replace(/\/(createTask|getTaskResult|getBalance)$/i, "");
}

function providerChallenge(challenge: CaptchaChallenge): Record<string, unknown> {
  return { kind: challenge.kind, websiteURL: challenge.websiteUrl, websiteKey: challenge.siteKey, action: challenge.action, cData: challenge.cData, chlPageData: challenge.chlPageData, invisible: challenge.invisible };
}

function capSolverTask(challenge: CaptchaChallenge): Record<string, unknown> {
  if (challenge.kind === "HCAPTCHA") throw new CaptchaProviderError("UNSUPPORTED_CHALLENGE", "This provider does not support hCaptcha.");
  if (challenge.kind === "TURNSTILE") return compact({ type: "AntiTurnstileTaskProxyLess", websiteURL: challenge.websiteUrl, websiteKey: challenge.siteKey, metadata: compact({ action: challenge.action, cdata: challenge.cData, chlPageData: challenge.chlPageData }) });
  return compact({ type: challenge.kind === "RECAPTCHA_V3" ? "ReCaptchaV3TaskProxyLess" : "ReCaptchaV2TaskProxyLess", websiteURL: challenge.websiteUrl, websiteKey: challenge.siteKey, pageAction: challenge.action, isInvisible: challenge.invisible });
}

function compact(value: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && (!(typeof item === "object") || Object.keys(item as object).length > 0))); }

async function requestJson(url: string, body: unknown, signal: AbortSignal): Promise<Record<string, any>> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal, redirect: "error", credentials: "omit" });
  if (response.status === 401 || response.status === 403) throw new CaptchaProviderError("AUTH_INVALID", "The solver rejected the configured credential.");
  if (response.status === 402) throw new CaptchaProviderError("INSUFFICIENT_CREDIT", "The solver account has insufficient credit.");
  if (response.status === 429) throw new CaptchaProviderError("RATE_LIMITED", "The solver rate limit was reached.");
  if (!response.ok) throw new CaptchaProviderError(response.status >= 500 ? "SERVICE_UNAVAILABLE" : "INVALID_RESPONSE", "The solver returned an unsuccessful response.");
  const text = await response.text();
  try { const parsed = JSON.parse(text); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); return parsed; }
  catch { throw new CaptchaProviderError("INVALID_RESPONSE", "The solver returned malformed JSON."); }
}

function assertProviderSuccess(response: Record<string, any>): void {
  if (!response.errorId && !response.errorCode && response.success !== false) return;
  const code = String(response.errorCode ?? response.code ?? "").toUpperCase();
  if (/KEY|AUTH|TOKEN_EXPIRED/.test(code)) throw new CaptchaProviderError("AUTH_INVALID", "The solver rejected the configured credential.");
  if (/BALANCE|CREDIT|FUNDS|ZERO_CAPTCHA_FILESIZE/.test(code)) throw new CaptchaProviderError("INSUFFICIENT_CREDIT", "The solver account has insufficient credit.");
  if (/RATE|TOO_MANY/.test(code)) throw new CaptchaProviderError("RATE_LIMITED", "The solver rate limit was reached.");
  if (/UNSUPPORTED|TASK_NOT_SUPPORTED/.test(code)) throw new CaptchaProviderError("UNSUPPORTED_CHALLENGE", "The solver does not support this challenge.");
  throw new CaptchaProviderError("UNKNOWN", "The solver reported a task failure.");
}

function normalizeToken(value: unknown, micros: unknown, dollars: unknown): CaptchaSolveResult {
  if (typeof value !== "string" || !value.trim()) throw new CaptchaProviderError("INVALID_RESPONSE", "The provider response did not contain a token.");
  const direct = integerMicros(micros); const converted = direct ?? moneyMicros(dollars);
  return { token: value, costMicrosUsd: converted, costAuthority: converted === null ? "UNAVAILABLE" : "PROVIDER_REPORTED" };
}

function integerMicros(value: unknown): number | null { const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN; return Number.isSafeInteger(number) && number >= 0 ? number : null; }
function moneyMicros(value: unknown): number | null { const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN; return Number.isFinite(number) && number >= 0 ? Math.round(number * 1_000_000) : null; }
function wait(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { const abort = (): void => { clearTimeout(timer); reject(signal.reason); }; const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms); if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); }); }
