import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CaptchaChallenge } from "@copify/shared";
import { diagnoseCaptchaProvider, solveCaptcha } from "./captcha-providers";

const challenge: CaptchaChallenge = { kind: "TURNSTILE", websiteUrl: "https://shop.example/checkout", siteKey: "site-key", action: "checkout", cData: null, chlPageData: null, invisible: false };

describe("CAPTCHA provider adapters", () => {
  let server: Server; let base = ""; let polls = 0; let immediateCreate = false; let lastCreateTask: Record<string, any> | null = null; let readySolution: Record<string, string> = { token: "solved" };
  beforeAll(async () => {
    server = createServer((request, response) => {
      const send = (status: number, value: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(typeof value === "string" ? value : JSON.stringify(value)); };
      if (request.url === "/createTask") {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          lastCreateTask = JSON.parse(body) as Record<string, any>;
          send(200, immediateCreate ? { errorId: 0, status: "ready", solution: { gRecaptchaResponse: "ready-immediately" }, cost: "0.001" } : { errorId: 0, taskId: "task-1" });
        });
        return;
      }
      if (request.url === "/getTaskResult") return send(200, ++polls === 1 ? { errorId: 0, status: "processing" } : { errorId: 0, status: "ready", solution: readySolution, cost: "0.0025" });
      if (request.url === "/getBalance") return send(200, { errorId: 0, balance: 4.25 });
      if (request.url === "/fast") return send(200, { token: "fast-token", costMicrosUsd: 17 });
      if (request.url === "/auth") return send(401, {});
      if (request.url === "/credit") return send(402, {});
      if (request.url === "/rate") return send(429, {});
      if (request.url === "/bad") return send(400, { errorCode: "ERROR_TASK_NOT_SUPPORTED", errorDescription: "secret-value-that-must-not-be-used" });
      if (request.url === "/malformed") return send(200, "not-json");
      if (request.url === "/hang") return;
      send(404, {});
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Stub failed to start."); base = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });

  it("polls asynchronous tasks and normalizes provider-reported USD cost", async () => {
    const result = await solveCaptcha(challenge, { kind: "CAPSOLVER", endpoint: base, apiKey: "secret" }, 5_000);
    expect(result).toEqual({ token: "solved", solution: { token: "solved" }, costMicrosUsd: 2_500, costAuthority: "PROVIDER_REPORTED" });
  });

  it("supports the normalized direct-token contract", async () => {
    await expect(solveCaptcha(challenge, { kind: "CUSTOM_FAST_TOKEN", endpoint: `${base}/fast`, apiKey: "secret" }, 5_000)).resolves.toEqual({ token: "fast-token", solution: { token: "fast-token" }, costMicrosUsd: 17, costAuthority: "PROVIDER_REPORTED" });
  });

  it("accepts a reCAPTCHA token returned immediately from task creation", async () => {
    immediateCreate = true;
    try {
      const result = await solveCaptcha({ ...challenge, kind: "RECAPTCHA_V3", action: "checkout", invisible: true }, { kind: "CAPSOLVER", endpoint: base, apiKey: "secret" }, 5_000);
      expect(result).toEqual({ token: "ready-immediately", solution: { gRecaptchaResponse: "ready-immediately" }, costMicrosUsd: 1_000, costAuthority: "PROVIDER_REPORTED" });
      expect(lastCreateTask?.task).toEqual({ type: "ReCaptchaV3TaskProxyLess", websiteURL: challenge.websiteUrl, websiteKey: challenge.siteKey, pageAction: "checkout" });
    } finally { immediateCreate = false; }
  });

  it("normalizes diagnostics, HTTP failures, malformed bodies, timeout, and cancellation", async () => {
    await expect(diagnoseCaptchaProvider({ kind: "CAPSOLVER", endpoint: base, apiKey: "secret" })).resolves.toEqual({ balanceMicrosUsd: 4_250_000 });
    for (const [path, code] of [["auth", "AUTH_INVALID"], ["credit", "INSUFFICIENT_CREDIT"], ["rate", "RATE_LIMITED"], ["malformed", "INVALID_RESPONSE"]] as const) {
      await expect(solveCaptcha(challenge, { kind: "CUSTOM_FAST_TOKEN", endpoint: `${base}/${path}`, apiKey: "secret" }, 5_000)).rejects.toMatchObject({ code });
    }
    await expect(solveCaptcha(challenge, { kind: "CUSTOM_FAST_TOKEN", endpoint: `${base}/bad`, apiKey: "secret" }, 5_000)).rejects.toMatchObject({ code: "INVALID_RESPONSE", message: "The solver returned HTTP 400: ERROR_TASK_NOT_SUPPORTED" });
    await expect(solveCaptcha(challenge, { kind: "CUSTOM_FAST_TOKEN", endpoint: `${base}/hang`, apiKey: "secret" }, 10)).rejects.toMatchObject({ code: "TIMEOUT" });
    const controller = new AbortController(); const pending = solveCaptcha(challenge, { kind: "CUSTOM_FAST_TOKEN", endpoint: `${base}/hang`, apiKey: "secret" }, 5_000, controller.signal); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("returns typed unsupported for CapSolver hCaptcha without making a request", async () => {
    const hcaptcha = { ...challenge, kind: "HCAPTCHA" as const };
    await expect(solveCaptcha(hcaptcha, { kind: "CAPSOLVER", endpoint: base, apiKey: "secret" }, 5_000)).rejects.toMatchObject({ code: "UNSUPPORTED_CHALLENGE" });
  });

  it("maps DataDome, AWS WAF, FunCaptcha, and GeeTest tasks and structured solutions", async () => {
    const credential = { kind: "CAPSOLVER" as const, endpoint: base, apiKey: "secret" };
    const proxy = { protocol: "http" as const, host: "proxy.example", port: 8080, username: "user", password: "pass" };
    const baseChallenge = { ...challenge, siteKey: "public-key" };

    readySolution = { cookie: "datadome=cookie-value" }; polls = 1;
    await expect(solveCaptcha({ ...baseChallenge, kind: "DATADOME", captchaUrl: "https://geo.captcha-delivery.com/captcha/?t=fe", userAgent: "Browser UA" }, credential, 5_000, undefined, { proxy, userAgent: "Browser UA" })).resolves.toMatchObject({ token: "datadome=cookie-value" });
    expect(lastCreateTask?.task).toEqual({ type: "DatadomeSliderTask", websiteURL: challenge.websiteUrl, captchaUrl: "https://geo.captcha-delivery.com/captcha/?t=fe", userAgent: "Browser UA", proxy: "http://user:pass@proxy.example:8080" });

    readySolution = { cookie: "aws-waf-token=aws-value" }; polls = 1;
    await solveCaptcha({ ...baseChallenge, kind: "AWS_WAF", siteKey: "", awsKey: "key", awsIv: "iv", awsContext: "context" }, credential, 5_000, undefined, {});
    expect(lastCreateTask?.task).toEqual({ type: "AntiAwsWafTaskProxyLess", websiteURL: challenge.websiteUrl, awsKey: "key", awsIv: "iv", awsContext: "context" });

    readySolution = { token: "arkose-token" }; polls = 1;
    await solveCaptcha({ ...baseChallenge, kind: "FUNCAPTCHA", subdomain: "client-api.arkoselabs.com", blob: "blob-value" }, { ...credential, kind: "CUSTOM_ASYNC" }, 5_000);
    expect(lastCreateTask?.task).toEqual({ type: "FunCaptchaTaskProxyLess", websiteURL: challenge.websiteUrl, websitePublicKey: "public-key", funcaptchaApiJSSubdomain: "client-api.arkoselabs.com", data: JSON.stringify({ blob: "blob-value" }) });

    readySolution = { challenge: "new-challenge", validate: "validate", seccode: "seccode" }; polls = 1;
    const v3 = await solveCaptcha({ ...baseChallenge, kind: "GEETEST_V3", gt: "gt", geetestChallenge: "old-challenge" }, credential, 5_000);
    expect(v3.solution).toEqual(readySolution);
    expect(lastCreateTask?.task).toEqual({ type: "GeeTestTaskProxyLess", websiteURL: challenge.websiteUrl, gt: "gt", challenge: "old-challenge" });

    readySolution = { captcha_id: "id", captcha_output: "output", gen_time: "time", lot_number: "lot", pass_token: "pass", risk_type: "slide" }; polls = 1;
    const v4 = await solveCaptcha({ ...baseChallenge, kind: "GEETEST_V4", captchaId: "id", riskType: "slide" }, credential, 5_000);
    expect(v4.solution).toEqual(readySolution);
    expect(lastCreateTask?.task).toEqual({ type: "GeeTestTaskProxyLess", websiteURL: challenge.websiteUrl, captchaId: "id", riskType: "slide" });
    readySolution = { token: "solved" };
  });

  it("fails fast when CapSolver does not advertise the requested challenge type", async () => {
    const credential = { kind: "CAPSOLVER" as const, endpoint: base, apiKey: "secret" };
    await expect(solveCaptcha({ ...challenge, kind: "FUNCAPTCHA" }, credential, 5_000)).rejects.toMatchObject({ code: "UNSUPPORTED_CHALLENGE" });
    await expect(solveCaptcha({ ...challenge, kind: "HCAPTCHA" }, credential, 5_000)).rejects.toMatchObject({ code: "UNSUPPORTED_CHALLENGE" });
  });
});
