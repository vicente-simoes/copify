import type { CaptchaChallenge, CaptchaFailureCode, CaptchaProviderKind } from "@copify/shared";

export type CaptchaCredentialLease = { kind: CaptchaProviderKind; endpoint: string | null; apiKey: string };
export type CaptchaSolverContext = { proxy?: { protocol: "http" | "https" | "socks5"; host: string; port: number; username?: string; password?: string } | null; userAgent?: string | null };
export type CaptchaSolveResult = { token: string; solution: Record<string, string>; costMicrosUsd: number | null; costAuthority: "PROVIDER_REPORTED" | "UNAVAILABLE" };
export type CaptchaBalanceResult = { balanceMicrosUsd: number };

export class CaptchaProviderError extends Error {
  constructor(readonly code: CaptchaFailureCode, message: string) { super(message); this.name = "CaptchaProviderError"; }
}

const CAPSOLVER_BASE = "https://api.capsolver.com";

export async function solveCaptcha(challenge: CaptchaChallenge, credential: CaptchaCredentialLease, timeoutMs: number, externalSignal?: AbortSignal, context: CaptchaSolverContext = {}): Promise<CaptchaSolveResult> {
  if (credential.kind === "CAPSOLVER" && challenge.kind === "HCAPTCHA") throw new CaptchaProviderError("UNSUPPORTED_CHALLENGE", "CapSolver does not advertise an hCaptcha task type.");
  if (credential.kind === "CAPSOLVER" && challenge.kind === "FUNCAPTCHA") throw new CaptchaProviderError("UNSUPPORTED_CHALLENGE", "CapSolver does not currently document an Arkose Labs FunCaptcha API task type.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs); timeout.unref?.();
  const abort = (): void => controller.abort(externalSignal?.reason ?? "cancelled");
  externalSignal?.addEventListener("abort", abort, { once: true });
  try {
    if (credential.kind === "CUSTOM_FAST_TOKEN") return await solveFast(challenge, credential, controller.signal);
    return await solveAsync(challenge, credential, controller.signal, context);
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
  return normalizeSolution(challenge, response.solution ?? response, response.costMicrosUsd, response.cost);
}

async function solveAsync(challenge: CaptchaChallenge, credential: CaptchaCredentialLease, signal: AbortSignal, context: CaptchaSolverContext): Promise<CaptchaSolveResult> {
  const base = providerBase(credential);
  const task = capSolverTask(challenge, context);
  const created = await requestJson(`${base}/createTask`, { clientKey: credential.apiKey, task }, signal);
  assertProviderSuccess(created);
  if (created.solution || created.token) return normalizeSolution(challenge, created.solution ?? created, created.costMicrosUsd, created.cost);
  const taskId = created.taskId;
  if (typeof taskId !== "string" && typeof taskId !== "number") throw new CaptchaProviderError("INVALID_RESPONSE", "The provider did not return a task ID.");
  for (;;) {
    await wait(750, signal);
    const response = await requestJson(`${base}/getTaskResult`, { clientKey: credential.apiKey, taskId }, signal);
    assertProviderSuccess(response);
    if (response.status === "processing" || response.status === "idle") continue;
    if (response.status !== "ready") throw new CaptchaProviderError("INVALID_RESPONSE", "The provider returned an unknown task status.");
    return normalizeSolution(challenge, response.solution, response.costMicrosUsd, response.cost);
  }
}

function providerBase(credential: CaptchaCredentialLease): string {
  const value = (credential.endpoint ?? CAPSOLVER_BASE).replace(/\/+$/, "");
  return value.replace(/\/(createTask|getTaskResult|getBalance)$/i, "");
}

function providerChallenge(challenge: CaptchaChallenge): Record<string, unknown> {
  return compact({
    kind: challenge.kind, websiteURL: challenge.websiteUrl, websiteKey: challenge.siteKey, action: challenge.action,
    cData: challenge.cData, chlPageData: challenge.chlPageData, invisible: challenge.invisible,
    captchaUrl: challenge.captchaUrl, userAgent: challenge.userAgent, subdomain: challenge.subdomain, blob: challenge.blob,
    gt: challenge.gt, challenge: challenge.geetestChallenge, captchaId: challenge.captchaId, riskType: challenge.riskType,
    awsKey: challenge.awsKey, awsIv: challenge.awsIv, awsContext: challenge.awsContext, awsChallengeJS: challenge.awsChallengeJs,
    awsApiJs: challenge.awsApiJs, awsProblemUrl: challenge.awsProblemUrl, awsApiKey: challenge.awsApiKey, awsExistingToken: challenge.awsExistingToken,
  });
}

function capSolverTask(challenge: CaptchaChallenge, context: CaptchaSolverContext): Record<string, unknown> {
  if (challenge.kind === "HCAPTCHA") throw new CaptchaProviderError("UNSUPPORTED_CHALLENGE", "This provider does not support hCaptcha.");
  if (challenge.kind === "TURNSTILE") {
    requireSiteKey(challenge);
    return compact({ type: "AntiTurnstileTaskProxyLess", websiteURL: challenge.websiteUrl, websiteKey: challenge.siteKey, metadata: compact({ action: challenge.action, cdata: challenge.cData, chlPageData: challenge.chlPageData }) });
  }
  if (challenge.kind === "RECAPTCHA_V3") {
    requireSiteKey(challenge);
    return compact({ type: "ReCaptchaV3TaskProxyLess", websiteURL: challenge.websiteUrl, websiteKey: challenge.siteKey, pageAction: challenge.action });
  }
  if (challenge.kind === "DATADOME") {
    if (!challenge.captchaUrl) throw new CaptchaProviderError("INVALID_RESPONSE", "The DataDome challenge URL was not detected.");
    try { if (new URL(challenge.captchaUrl).searchParams.get("t") === "bv") throw new CaptchaProviderError("SERVICE_UNAVAILABLE", "DataDome marked the current route as banned; rotate the browser route before retrying."); } catch (error) { if (error instanceof CaptchaProviderError) throw error; }
    if (!context.proxy) throw new CaptchaProviderError("UNSUPPORTED_CHALLENGE", "DataDome solving requires the browser's proxy route.");
    const userAgent = challenge.userAgent ?? context.userAgent;
    if (!userAgent) throw new CaptchaProviderError("INVALID_RESPONSE", "The DataDome browser user agent was not detected.");
    return { type: "DatadomeSliderTask", websiteURL: challenge.websiteUrl, captchaUrl: challenge.captchaUrl, userAgent, proxy: formatProxy(context.proxy) };
  }
  if (challenge.kind === "AWS_WAF") return compact({
    type: context.proxy ? "AntiAwsWafTask" : "AntiAwsWafTaskProxyLess", websiteURL: challenge.websiteUrl,
    proxy: context.proxy ? formatProxy(context.proxy) : null, awsKey: challenge.awsKey, awsIv: challenge.awsIv,
    awsContext: challenge.awsContext, awsChallengeJS: challenge.awsChallengeJs, awsApiJs: challenge.awsApiJs,
    awsProblemUrl: challenge.awsProblemUrl, awsApiKey: challenge.awsApiKey, awsExistingToken: challenge.awsExistingToken,
  });
  if (challenge.kind === "FUNCAPTCHA") {
    if (!challenge.siteKey) throw new CaptchaProviderError("INVALID_RESPONSE", "The Arkose Labs public key was not detected.");
    return compact({ type: "FunCaptchaTaskProxyLess", websiteURL: challenge.websiteUrl, websitePublicKey: challenge.siteKey, funcaptchaApiJSSubdomain: challenge.subdomain, data: challenge.blob ? JSON.stringify({ blob: challenge.blob }) : null });
  }
  if (challenge.kind === "GEETEST_V3") {
    if (!challenge.gt || !challenge.geetestChallenge) throw new CaptchaProviderError("INVALID_RESPONSE", "The GeeTest v3 gt/challenge values were not detected.");
    return compact({ type: "GeeTestTaskProxyLess", websiteURL: challenge.websiteUrl, gt: challenge.gt, challenge: challenge.geetestChallenge, geetestApiServerSubdomain: challenge.subdomain });
  }
  if (challenge.kind === "GEETEST_V4") {
    if (!challenge.captchaId) throw new CaptchaProviderError("INVALID_RESPONSE", "The GeeTest v4 captcha ID was not detected.");
    return compact({ type: "GeeTestTaskProxyLess", websiteURL: challenge.websiteUrl, captchaId: challenge.captchaId, riskType: challenge.riskType });
  }
  requireSiteKey(challenge);
  return compact({ type: "ReCaptchaV2TaskProxyLess", websiteURL: challenge.websiteUrl, websiteKey: challenge.siteKey, pageAction: challenge.action, isInvisible: challenge.invisible });
}

function requireSiteKey(challenge: CaptchaChallenge): void { if (!challenge.siteKey) throw new CaptchaProviderError("INVALID_RESPONSE", "The CAPTCHA site key was not detected."); }

function formatProxy(proxy: NonNullable<CaptchaSolverContext["proxy"]>): string {
  const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? "")}@` : "";
  return `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`;
}

function compact(value: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && (!(typeof item === "object") || Object.keys(item as object).length > 0))); }

async function requestJson(url: string, body: unknown, signal: AbortSignal): Promise<Record<string, any>> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal, redirect: "error", credentials: "omit" });
  const text = await response.text();
  let parsed: Record<string, any> | null = null;
  try { const value = JSON.parse(text); if (value && typeof value === "object" && !Array.isArray(value)) parsed = value; } catch {}
  if (response.status === 401 || response.status === 403) throw new CaptchaProviderError("AUTH_INVALID", "The solver rejected the configured credential.");
  if (response.status === 402) throw new CaptchaProviderError("INSUFFICIENT_CREDIT", "The solver account has insufficient credit.");
  if (response.status === 429) throw new CaptchaProviderError("RATE_LIMITED", "The solver rate limit was reached.");
  if (!response.ok) {
    const providerDetail = safeProviderDetail(parsed?.errorCode ?? parsed?.errorDescription ?? parsed?.message);
    throw new CaptchaProviderError(response.status >= 500 ? "SERVICE_UNAVAILABLE" : "INVALID_RESPONSE", `The solver returned HTTP ${response.status}${providerDetail ? `: ${providerDetail}` : "."}`);
  }
  if (!parsed) throw new CaptchaProviderError("INVALID_RESPONSE", "The solver returned malformed JSON.");
  return parsed;
}

function safeProviderDetail(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/[\r\n\t]+/g, " ").replace(/[^\x20-\x7E]/g, "").trim().slice(0, 160);
  if (/^[A-Z][A-Z0-9_:-]{0,79}$/.test(normalized)) return normalized;
  return normalized.replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]");
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

function normalizeSolution(challenge: CaptchaChallenge, raw: unknown, micros: unknown, dollars: unknown): CaptchaSolveResult {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const solution = Object.fromEntries(Object.entries(source).filter(([, value]) => typeof value === "string" && value.length > 0)) as Record<string, string>;
  const token = solution.token ?? solution.gRecaptchaResponse ?? solution.cookie ?? "";
  if (challenge.kind === "GEETEST_V3" && !(solution.challenge && solution.validate && solution.seccode)) throw new CaptchaProviderError("INVALID_RESPONSE", "The provider response did not contain a complete GeeTest v3 solution.");
  if (challenge.kind === "GEETEST_V4" && !(solution.captcha_id && solution.captcha_output && solution.gen_time && solution.lot_number && solution.pass_token)) throw new CaptchaProviderError("INVALID_RESPONSE", "The provider response did not contain a complete GeeTest v4 solution.");
  if (!token && challenge.kind !== "GEETEST_V3" && challenge.kind !== "GEETEST_V4") throw new CaptchaProviderError("INVALID_RESPONSE", "The provider response did not contain a token or cookie.");
  const direct = integerMicros(micros); const converted = direct ?? moneyMicros(dollars);
  return { token, solution, costMicrosUsd: converted, costAuthority: converted === null ? "UNAVAILABLE" : "PROVIDER_REPORTED" };
}

function integerMicros(value: unknown): number | null { const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN; return Number.isSafeInteger(number) && number >= 0 ? number : null; }
function moneyMicros(value: unknown): number | null { const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN; return Number.isFinite(number) && number >= 0 ? Math.round(number * 1_000_000) : null; }
function wait(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { const abort = (): void => { clearTimeout(timer); reject(signal.reason); }; const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms); if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); }); }
