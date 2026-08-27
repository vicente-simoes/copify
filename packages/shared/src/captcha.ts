import { z } from "zod";

export const captchaKindSchema = z.enum(["TURNSTILE", "RECAPTCHA_V2", "RECAPTCHA_V3", "HCAPTCHA", "DATADOME", "AWS_WAF", "FUNCAPTCHA", "GEETEST_V3", "GEETEST_V4"]);
export type CaptchaKind = z.infer<typeof captchaKindSchema>;
export const captchaStrategySchema = z.enum(["MANUAL_HARVESTER", "API_SOLVER", "API_WITH_FALLBACK"]);
export type CaptchaStrategy = z.infer<typeof captchaStrategySchema>;
export const targetCaptchaStrategySchema = z.enum(["INHERIT_APP", ...captchaStrategySchema.options]);
export type TargetCaptchaStrategy = z.infer<typeof targetCaptchaStrategySchema>;
export const captchaStrategyOverrideSchema = z.enum(["INHERIT_TARGET", ...captchaStrategySchema.options]);
export type CaptchaStrategyOverride = z.infer<typeof captchaStrategyOverrideSchema>;
export const captchaAppModeSchema = z.enum(["manual_only", "api_only", "api_with_fallback"]);
export type CaptchaAppMode = z.infer<typeof captchaAppModeSchema>;
export const captchaProviderKindSchema = z.enum(["CAPSOLVER", "CUSTOM_ASYNC", "CUSTOM_FAST_TOKEN"]);
export type CaptchaProviderKind = z.infer<typeof captchaProviderKindSchema>;
export const captchaFailureCodeSchema = z.enum(["AUTH_INVALID", "INSUFFICIENT_CREDIT", "TIMEOUT", "SERVICE_UNAVAILABLE", "RATE_LIMITED", "UNSUPPORTED_CHALLENGE", "INVALID_RESPONSE", "INVALID_TOKEN", "CANCELLED", "UNKNOWN"]);
export type CaptchaFailureCode = z.infer<typeof captchaFailureCodeSchema>;
export const captchaCostAuthoritySchema = z.enum(["PROVIDER_REPORTED", "UNAVAILABLE"]);

const endpointSchema = z.string().trim().url().max(2_048).superRefine((value, context) => {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Use HTTPS, or loopback HTTP in development." });
  if (url.username || url.password || url.search || url.hash) context.addIssue({ code: z.ZodIssueCode.custom, message: "Endpoints cannot contain credentials, query parameters, or fragments." });
});

export const captchaProviderConfigSchema = z.object({
  kind: captchaProviderKindSchema,
  label: z.string().trim().min(1).max(80),
  endpoint: endpointSchema.nullable(),
  apiKeyConfigured: z.boolean(),
  enabled: z.boolean(),
  lastDiagnostic: z.object({ provider: captchaProviderKindSchema, status: z.enum(["CONNECTED", "AUTH_INVALID", "INSUFFICIENT_CREDIT", "UNAVAILABLE", "INVALID_RESPONSE", "NOT_CONFIGURED"]), balanceMicrosUsd: z.number().int().nonnegative().nullable(), checkedAt: z.number().int().nonnegative(), message: z.string().max(240) }).nullable().default(null),
  updatedAt: z.number().int().nonnegative(),
}).superRefine((value, context) => {
  if (value.kind !== "CAPSOLVER" && !value.endpoint) context.addIssue({ code: z.ZodIssueCode.custom, message: "Custom providers require an endpoint.", path: ["endpoint"] });
});
export type CaptchaProviderConfig = z.infer<typeof captchaProviderConfigSchema>;
export const upsertCaptchaProviderSchema = z.object({
  kind: captchaProviderKindSchema,
  label: z.string().trim().min(1).max(80),
  endpoint: endpointSchema.nullable().optional().default(null),
  apiKey: z.union([z.string().trim().min(1).max(1_024), z.null()]).optional(),
  enabled: z.boolean().default(true),
});
export type UpsertCaptchaProviderInput = z.input<typeof upsertCaptchaProviderSchema>;

export const captchaSettingsSchema = z.object({
  appMode: captchaAppModeSchema,
  activeProvider: captchaProviderKindSchema.nullable(),
  solveTimeoutMs: z.number().int().min(5_000).max(120_000),
  fallbackAfterMs: z.number().int().min(1_000).max(30_000),
  providers: z.array(captchaProviderConfigSchema).max(10),
});
export type CaptchaSettings = z.infer<typeof captchaSettingsSchema>;
export const updateCaptchaSettingsSchema = captchaSettingsSchema.pick({ appMode: true, activeProvider: true, solveTimeoutMs: true, fallbackAfterMs: true });
export type UpdateCaptchaSettingsInput = z.input<typeof updateCaptchaSettingsSchema>;
export function defaultCaptchaSettings(): CaptchaSettings { return { appMode: "manual_only", activeProvider: null, solveTimeoutMs: 30_000, fallbackAfterMs: 5_000, providers: [] }; }

export const captchaProviderDiagnosticSchema = z.object({
  provider: captchaProviderKindSchema,
  status: z.enum(["CONNECTED", "AUTH_INVALID", "INSUFFICIENT_CREDIT", "UNAVAILABLE", "INVALID_RESPONSE", "NOT_CONFIGURED"]),
  balanceMicrosUsd: z.number().int().nonnegative().nullable(),
  checkedAt: z.number().int().nonnegative(),
  message: z.string().max(240),
});
export type CaptchaProviderDiagnostic = z.infer<typeof captchaProviderDiagnosticSchema>;
export const captchaProviderSnapshotSchema = z.object({ kind: captchaProviderKindSchema, label: z.string().min(1).max(80) }).nullable();
export type CaptchaProviderSnapshot = z.infer<typeof captchaProviderSnapshotSchema>;

export const captchaLabFixtureSchema = z.enum(["RECAPTCHA_V2", "RECAPTCHA_V3", "TURNSTILE", "GEETEST_V4"]);
export type CaptchaLabFixture = z.infer<typeof captchaLabFixtureSchema>;
export const CAPTCHA_LAB_FIXTURES: Record<CaptchaLabFixture, { label: string; url: string }> = {
  RECAPTCHA_V2: { label: "reCAPTCHA v2", url: "https://www.google.com/recaptcha/api2/demo" },
  RECAPTCHA_V3: { label: "reCAPTCHA v3", url: "https://recaptcha-demo.appspot.com/recaptcha-v3-request-scores.php" },
  TURNSTILE: { label: "Cloudflare Turnstile", url: "https://clifford.io/demo/cloudflare-turnstile" },
  GEETEST_V4: { label: "GeeTest v4 (official slide demo)", url: "https://gt4.geetest.com/demov4/slide-float-en.html" },
};
export const startCaptchaLabSchema = z.object({
  browserProfileId: z.string().uuid(),
  fixture: captchaLabFixtureSchema,
  strategy: captchaStrategySchema,
});
export type StartCaptchaLabInput = z.input<typeof startCaptchaLabSchema>;
export const captchaLabEventSchema = z.object({
  type: z.string().min(1).max(80),
  at: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
});
export type CaptchaLabEvent = z.infer<typeof captchaLabEventSchema>;
export const captchaLabStatusSchema = z.object({
  state: z.enum(["IDLE", "STARTING", "READY", "SOLVING", "PASSED", "FAILED", "STOPPING"]),
  browserProfileId: z.string().uuid().nullable(),
  fixture: captchaLabFixtureSchema.nullable(),
  strategy: captchaStrategySchema.nullable(),
  provider: captchaProviderSnapshotSchema,
  message: z.string().max(500).nullable(),
  startedAt: z.number().int().nonnegative().nullable(),
  events: z.array(captchaLabEventSchema).max(200),
});
export type CaptchaLabStatus = z.infer<typeof captchaLabStatusSchema>;
export function idleCaptchaLabStatus(): CaptchaLabStatus { return { state: "IDLE", browserProfileId: null, fixture: null, strategy: null, provider: null, message: null, startedAt: null, events: [] }; }

export const captchaChallengeSchema = z.object({
  kind: captchaKindSchema,
  websiteUrl: z.string().url(),
  siteKey: z.string().max(1_024),
  action: z.string().max(256).nullable(),
  cData: z.string().max(4_096).nullable(),
  chlPageData: z.string().max(16_384).nullable(),
  invisible: z.boolean(),
  captchaUrl: z.string().url().max(16_384).nullable().optional(),
  userAgent: z.string().max(1_024).nullable().optional(),
  subdomain: z.string().max(253).nullable().optional(),
  blob: z.string().max(32_768).nullable().optional(),
  gt: z.string().max(4_096).nullable().optional(),
  geetestChallenge: z.string().max(8_192).nullable().optional(),
  captchaId: z.string().max(4_096).nullable().optional(),
  riskType: z.string().max(512).nullable().optional(),
  awsKey: z.string().max(16_384).nullable().optional(),
  awsIv: z.string().max(16_384).nullable().optional(),
  awsContext: z.string().max(32_768).nullable().optional(),
  awsChallengeJs: z.string().url().max(16_384).nullable().optional(),
  awsApiJs: z.string().url().max(16_384).nullable().optional(),
  awsProblemUrl: z.string().url().max(16_384).nullable().optional(),
  awsApiKey: z.string().max(16_384).nullable().optional(),
  awsExistingToken: z.string().max(32_768).nullable().optional(),
});
export type CaptchaChallenge = z.infer<typeof captchaChallengeSchema>;
export const runCaptchaOverrideSchema = z.object({ browserProfileId: z.string().uuid(), captchaStrategy: captchaStrategyOverrideSchema });
export type RunCaptchaOverride = z.infer<typeof runCaptchaOverrideSchema>;

export function appModeStrategy(mode: CaptchaAppMode): CaptchaStrategy { return mode === "api_only" ? "API_SOLVER" : mode === "api_with_fallback" ? "API_WITH_FALLBACK" : "MANUAL_HARVESTER"; }
export function resolveCaptchaStrategy(input: { runOverride?: CaptchaStrategyOverride; profileOverride?: CaptchaStrategyOverride; targetStrategy?: TargetCaptchaStrategy; appMode: CaptchaAppMode }): CaptchaStrategy {
  if (input.runOverride && input.runOverride !== "INHERIT_TARGET") return input.runOverride;
  if (input.profileOverride && input.profileOverride !== "INHERIT_TARGET") return input.profileOverride;
  if (input.targetStrategy && input.targetStrategy !== "INHERIT_APP") return input.targetStrategy;
  return appModeStrategy(input.appMode);
}

export const captchaIpc = {
  settings: "captcha:settings", updateSettings: "captcha:update-settings", upsertProvider: "captcha:upsert-provider", removeProvider: "captcha:remove-provider", diagnose: "captcha:diagnose", changed: "captcha:changed",
  labStatus: "captcha:lab-status", labStart: "captcha:lab-start", labStop: "captcha:lab-stop", labChanged: "captcha:lab-changed",
} as const;
