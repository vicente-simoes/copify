import { describe, expect, it } from "vitest";
import { captchaProviderConfigSchema, resolveCaptchaStrategy, type CaptchaAppMode, type CaptchaStrategyOverride, type TargetCaptchaStrategy } from "./captcha";

describe("CAPTCHA strategy resolution", () => {
  it("exhaustively applies run, profile, target, then app precedence", () => {
    const overrides: CaptchaStrategyOverride[] = ["INHERIT_TARGET", "MANUAL_HARVESTER", "API_SOLVER", "API_WITH_FALLBACK"];
    const targets: TargetCaptchaStrategy[] = ["INHERIT_APP", "MANUAL_HARVESTER", "API_SOLVER", "API_WITH_FALLBACK"];
    const modes: CaptchaAppMode[] = ["manual_only", "api_only", "api_with_fallback"];
    const app = { manual_only: "MANUAL_HARVESTER", api_only: "API_SOLVER", api_with_fallback: "API_WITH_FALLBACK" } as const;
    for (const runOverride of overrides) for (const profileOverride of overrides) for (const targetStrategy of targets) for (const appMode of modes) {
      const expected = runOverride !== "INHERIT_TARGET" ? runOverride : profileOverride !== "INHERIT_TARGET" ? profileOverride : targetStrategy !== "INHERIT_APP" ? targetStrategy : app[appMode];
      expect(resolveCaptchaStrategy({ runOverride, profileOverride, targetStrategy, appMode })).toBe(expected);
    }
  });

  it("accepts only sanitized custom endpoints", () => {
    const base = { kind: "CUSTOM_ASYNC", label: "Local", apiKeyConfigured: false, enabled: true, lastDiagnostic: null, updatedAt: 1 } as const;
    expect(captchaProviderConfigSchema.safeParse({ ...base, endpoint: "https://solver.example/api" }).success).toBe(true);
    expect(captchaProviderConfigSchema.safeParse({ ...base, endpoint: "http://127.0.0.1:8080/api" }).success).toBe(true);
    for (const endpoint of ["http://solver.example/api", "https://user:pass@solver.example/api", "https://solver.example/api?q=secret", "https://solver.example/api#secret"]) expect(captchaProviderConfigSchema.safeParse({ ...base, endpoint }).success).toBe(false);
  });
});
