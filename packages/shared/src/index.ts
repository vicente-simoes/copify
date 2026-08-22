import { z } from "zod";

export const IPC_VERSION = 2 as const;
export const DEFAULT_NETWORK_PROBE_URL = "https://ipwho.is/";

const idSchema = z.string().uuid();
const timestampSchema = z.number().int().nonnegative();

export const proxyProviderSchema = z.enum(["brightdata", "decodo", "oxylabs", "custom"]);
export const proxyTypeSchema = z.enum(["home", "datacenter", "residential-sticky", "isp-static"]);
export const proxyProtocolSchema = z.enum(["http", "https", "socks5"]);
export type ProxyProtocol = z.infer<typeof proxyProtocolSchema>;

export const proxyProfileSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  provider: proxyProviderSchema,
  type: proxyTypeSchema,
  protocol: proxyProtocolSchema,
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  expectedCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable(),
  expectedCity: z.string().trim().min(1).max(80).nullable(),
  usernameConfigured: z.boolean(),
  passwordConfigured: z.boolean(),
  enabled: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});
export type ProxyProfile = z.infer<typeof proxyProfileSchema>;

const optionalCredentialSchema = z.string().min(1).max(512).optional();
const credentialUpdateSchema = z.union([z.string().min(1).max(512), z.null()]).optional();
const nullableCountrySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter country code.").nullable().optional();
const nullableCitySchema = z.string().trim().min(1).max(80).nullable().optional();

export const createProxyProfileSchema = z.object({
  name: z.string().trim().min(1, "A proxy name is required.").max(80),
  provider: proxyProviderSchema.default("custom"),
  type: proxyTypeSchema.default("residential-sticky"),
  protocol: proxyProtocolSchema.default("http"),
  host: z.string().trim().min(1, "A proxy host is required.").max(253),
  port: z.coerce.number().int().min(1).max(65_535),
  username: optionalCredentialSchema,
  password: optionalCredentialSchema,
  expectedCountry: nullableCountrySchema,
  expectedCity: nullableCitySchema,
  enabled: z.boolean().default(true)
});
export type CreateProxyProfileInput = z.input<typeof createProxyProfileSchema>;

export const updateProxyProfileSchema = z.object({
  name: z.string().trim().min(1, "A proxy name is required.").max(80).optional(),
  provider: proxyProviderSchema.optional(),
  type: proxyTypeSchema.optional(),
  protocol: proxyProtocolSchema.optional(),
  host: z.string().trim().min(1, "A proxy host is required.").max(253).optional(),
  port: z.coerce.number().int().min(1).max(65_535).optional(),
  username: credentialUpdateSchema,
  password: credentialUpdateSchema,
  expectedCountry: nullableCountrySchema,
  expectedCity: nullableCitySchema,
  enabled: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, { message: "Provide at least one field to update." });
export type UpdateProxyProfileInput = z.input<typeof updateProxyProfileSchema>;

export const browserProfileSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  userDataDir: z.string().min(1),
  proxyProfileId: idSchema.nullable(),
  shippingProfileId: idSchema.nullable(),
  enabled: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});
export type BrowserProfile = z.infer<typeof browserProfileSchema>;

export const createBrowserProfileSchema = z.object({
  name: z.string().trim().min(1, "A profile name is required.").max(80),
  enabled: z.boolean().default(true)
});
export type CreateBrowserProfileInput = z.input<typeof createBrowserProfileSchema>;

export const updateBrowserProfileSchema = z.object({
  name: z.string().trim().min(1, "A profile name is required.").max(80).optional(),
  enabled: z.boolean().optional(),
  proxyProfileId: idSchema.nullable().optional()
}).refine((value) => value.name !== undefined || value.enabled !== undefined || value.proxyProfileId !== undefined, {
  message: "Provide at least one field to update."
});
export type UpdateBrowserProfileInput = z.input<typeof updateBrowserProfileSchema>;

export const routeVerificationSchema = z.object({
  status: z.enum(["PENDING", "VERIFIED", "WARNING", "FAILED"]),
  publicIp: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  verifiedAt: timestampSchema.nullable(),
  message: z.string().nullable()
});
export type RouteVerification = z.infer<typeof routeVerificationSchema>;

export const sessionRouteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct"), verification: routeVerificationSchema }),
  z.object({ kind: z.literal("proxy"), proxyProfileId: idSchema, proxyName: z.string(), protocol: proxyProtocolSchema, verification: routeVerificationSchema })
]);
export type SessionRoute = z.infer<typeof sessionRouteSchema>;

export const sessionStateSchema = z.enum(["STOPPED", "STARTING", "READY", "STOPPING", "CRASHED", "ERROR"]);
export type SessionState = z.infer<typeof sessionStateSchema>;

export const sessionErrorCodeSchema = z.enum([
  "BROWSER_START_FAILED", "PROXY_CONNECTION_FAILED", "PROXY_AUTH_FAILED", "SECRET_STORAGE_UNAVAILABLE", "RUNNER_CRASHED", "INVALID_COMMAND", "UNKNOWN"
]);
export const sessionErrorSchema = z.object({ code: sessionErrorCodeSchema, message: z.string() });
export type SessionError = z.infer<typeof sessionErrorSchema>;

export const sessionSnapshotSchema = z.object({
  profileId: idSchema,
  state: sessionStateSchema,
  error: sessionErrorSchema.nullable(),
  route: sessionRouteSchema,
  updatedAt: timestampSchema
});
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;

export const runnerProxySchema = z.object({
  proxyProfileId: idSchema,
  proxyName: z.string(),
  protocol: proxyProtocolSchema,
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  expectedCountry: z.string().nullable(),
  expectedCity: z.string().nullable()
});
export type RunnerProxy = z.infer<typeof runnerProxySchema>;

export const runnerCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("START"), version: z.literal(IPC_VERSION), profileId: idSchema, userDataDir: z.string().min(1), proxy: runnerProxySchema.nullable(), probeUrl: z.string().url() }),
  z.object({ type: z.literal("STOP"), version: z.literal(IPC_VERSION) })
]);
export type RunnerCommand = z.infer<typeof runnerCommandSchema>;

export const runnerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("READY"), version: z.literal(IPC_VERSION), profileId: idSchema, route: sessionRouteSchema }),
  z.object({ type: z.literal("STOPPED"), version: z.literal(IPC_VERSION), profileId: idSchema }),
  z.object({ type: z.literal("ERROR"), version: z.literal(IPC_VERSION), profileId: idSchema.nullable(), code: sessionErrorCodeSchema.exclude(["RUNNER_CRASHED", "INVALID_COMMAND", "SECRET_STORAGE_UNAVAILABLE"]), message: z.string() })
]);
export type RunnerEvent = z.infer<typeof runnerEventSchema>;

export const networkProbeSettingsSchema = z.object({
  probeUrl: z.string().url().refine((value) => new URL(value).protocol === "https:", "The probe URL must use HTTPS.")
});
export type NetworkProbeSettings = z.infer<typeof networkProbeSettingsSchema>;

export const benchmarkStatusSchema = z.enum(["PASS", "WARN", "FAIL"]);
export type BenchmarkStatus = z.infer<typeof benchmarkStatusSchema>;
export const proxyBenchmarkSchema = z.object({
  id: idSchema,
  routeKind: z.enum(["direct", "proxy"]),
  proxyProfileId: idSchema.nullable(),
  probeUrl: z.string().url(),
  startedAt: timestampSchema,
  completedAt: timestampSchema,
  attempts: z.number().int().min(1),
  successes: z.number().int().min(0),
  publicIp: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  connectLatencyMs: z.number().nonnegative().nullable(),
  medianLatencyMs: z.number().nonnegative().nullable(),
  jitterMs: z.number().nonnegative().nullable(),
  failureRate: z.number().min(0).max(1),
  ipStable: z.boolean(),
  qualityScore: z.number().int().min(0).max(100),
  status: benchmarkStatusSchema,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  samples: z.array(z.number().nonnegative())
});
export type ProxyBenchmark = z.infer<typeof proxyBenchmarkSchema>;

export const profileIpc = { list: "profiles:list", create: "profiles:create", update: "profiles:update", remove: "profiles:remove" } as const;
export const proxyIpc = { list: "proxies:list", create: "proxies:create", update: "proxies:update", remove: "proxies:remove", test: "proxies:test", benchmarks: "proxies:benchmarks" } as const;
export const settingsIpc = { getNetworkProbe: "settings:get-network-probe", updateNetworkProbe: "settings:update-network-probe" } as const;
export const sessionIpc = { list: "sessions:list", open: "sessions:open", close: "sessions:close", restart: "sessions:restart", openAll: "sessions:open-all", closeAll: "sessions:close-all", changed: "sessions:changed" } as const;

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function defaultRoute(): SessionRoute {
  return { kind: "direct", verification: { status: "PENDING", publicIp: null, country: null, city: null, verifiedAt: null, message: null } };
}
