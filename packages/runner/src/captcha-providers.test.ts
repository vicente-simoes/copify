import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CaptchaChallenge } from "@copify/shared";
import { diagnoseCaptchaProvider, solveCaptcha } from "./captcha-providers";

const challenge: CaptchaChallenge = { kind: "TURNSTILE", websiteUrl: "https://shop.example/checkout", siteKey: "site-key", action: "checkout", cData: null, chlPageData: null, invisible: false };

describe("CAPTCHA provider adapters", () => {
  let server: Server; let base = ""; let polls = 0;
  beforeAll(async () => {
    server = createServer((request, response) => {
      const send = (status: number, value: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(typeof value === "string" ? value : JSON.stringify(value)); };
      if (request.url === "/createTask") return send(200, { errorId: 0, taskId: "task-1" });
      if (request.url === "/getTaskResult") return send(200, ++polls === 1 ? { errorId: 0, status: "processing" } : { errorId: 0, status: "ready", solution: { token: "solved" }, cost: "0.0025" });
      if (request.url === "/getBalance") return send(200, { errorId: 0, balance: 4.25 });
      if (request.url === "/getToken") return send(200, { errorId: 0, solution: { gRecaptchaResponse: "low-latency" } });
      if (request.url === "/fast") return send(200, { token: "fast-token", costMicrosUsd: 17 });
      if (request.url === "/auth") return send(401, {});
      if (request.url === "/credit") return send(402, {});
      if (request.url === "/rate") return send(429, {});
      if (request.url === "/malformed") return send(200, "not-json");
      if (request.url === "/hang") return;
      send(404, {});
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Stub failed to start."); base = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });

  it("polls asynchronous tasks and normalizes provider-reported USD cost", async () => {
    const result = await solveCaptcha(challenge, { kind: "CAPSOLVER", endpoint: base, apiKey: "secret" }, 5_000);
    expect(result).toEqual({ token: "solved", costMicrosUsd: 2_500, costAuthority: "PROVIDER_REPORTED" });
  });

  it("supports the normalized direct-token contract", async () => {
    await expect(solveCaptcha(challenge, { kind: "CUSTOM_FAST_TOKEN", endpoint: `${base}/fast`, apiKey: "secret" }, 5_000)).resolves.toEqual({ token: "fast-token", costMicrosUsd: 17, costAuthority: "PROVIDER_REPORTED" });
  });

  it("uses CapSolver's low-latency token endpoint for reCAPTCHA", async () => {
    const result = await solveCaptcha({ ...challenge, kind: "RECAPTCHA_V3", action: "checkout", invisible: true }, { kind: "CAPSOLVER", endpoint: base, apiKey: "secret" }, 5_000);
    expect(result).toMatchObject({ token: "low-latency", costMicrosUsd: null, costAuthority: "UNAVAILABLE" });
  });

  it("normalizes diagnostics, HTTP failures, malformed bodies, timeout, and cancellation", async () => {
    await expect(diagnoseCaptchaProvider({ kind: "CAPSOLVER", endpoint: base, apiKey: "secret" })).resolves.toEqual({ balanceMicrosUsd: 4_250_000 });
    for (const [path, code] of [["auth", "AUTH_INVALID"], ["credit", "INSUFFICIENT_CREDIT"], ["rate", "RATE_LIMITED"], ["malformed", "INVALID_RESPONSE"]] as const) {
      await expect(solveCaptcha(challenge, { kind: "CUSTOM_FAST_TOKEN", endpoint: `${base}/${path}`, apiKey: "secret" }, 5_000)).rejects.toMatchObject({ code });
    }
    await expect(solveCaptcha(challenge, { kind: "CUSTOM_FAST_TOKEN", endpoint: `${base}/hang`, apiKey: "secret" }, 10)).rejects.toMatchObject({ code: "TIMEOUT" });
    const controller = new AbortController(); const pending = solveCaptcha(challenge, { kind: "CUSTOM_FAST_TOKEN", endpoint: `${base}/hang`, apiKey: "secret" }, 5_000, controller.signal); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("returns typed unsupported for CapSolver hCaptcha without making a request", async () => {
    const hcaptcha = { ...challenge, kind: "HCAPTCHA" as const };
    await expect(solveCaptcha(hcaptcha, { kind: "CAPSOLVER", endpoint: base, apiKey: "secret" }, 5_000)).rejects.toMatchObject({ code: "UNSUPPORTED_CHALLENGE" });
  });
});
