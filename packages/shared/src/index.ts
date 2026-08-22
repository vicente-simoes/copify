import { z } from "zod";

export const IPC_VERSION = 4 as const;
export const SCHEMA_VERSION = 4 as const;
export const DEFAULT_NETWORK_PROBE_URL = "https://ipwho.is/";

const idSchema = z.string().uuid();
const timestampSchema = z.number().int().nonnegative();
const jsonRecordSchema = z.record(z.string(), z.unknown());
export const STORE_SUPREME_EU = "supreme-eu" as const;

const priorityListSchema = z.array(z.string().trim().min(1).max(120)).max(40);
export const targetCurrencySchema = z.enum(["EUR", "GBP", "USD"]);
export const targetSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(120), storeId: z.literal(STORE_SUPREME_EU), productKeywords: priorityListSchema.min(1), negativeKeywords: priorityListSchema,
  preferredColors: priorityListSchema, sizePriority: priorityListSchema, currency: targetCurrencySchema, maxRetailMinor: z.number().int().min(0), quantity: z.number().int().min(1).max(10), enabled: z.boolean(),
  latestCheck: z.lazy(() => targetCheckSchema).nullable(), createdAt: timestampSchema, updatedAt: timestampSchema
});
export type Target = z.infer<typeof targetSchema>;
export const createTargetSchema = z.object({ name: z.string().trim().min(1).max(120), storeId: z.literal(STORE_SUPREME_EU).default(STORE_SUPREME_EU), productKeywords: priorityListSchema.min(1), negativeKeywords: priorityListSchema.default([]), preferredColors: priorityListSchema.default([]), sizePriority: priorityListSchema.default([]), currency: targetCurrencySchema.default("EUR"), maxRetailMinor: z.coerce.number().int().min(0), quantity: z.coerce.number().int().min(1).max(10).default(1), enabled: z.boolean().default(true) });
export type CreateTargetInput = z.input<typeof createTargetSchema>;
export const updateTargetSchema = createTargetSchema.partial().refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
export type UpdateTargetInput = z.input<typeof updateTargetSchema>;
export const productVariantSchema = z.object({ color: z.string().min(1).max(120), size: z.string().min(1).max(80), available: z.boolean() });
export type ProductVariant = z.infer<typeof productVariantSchema>;
export const productCandidateSchema = z.object({ name: z.string().min(1).max(300), url: z.string().url(), priceMinor: z.number().int().min(0).nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(), variants: z.array(productVariantSchema), listingOrder: z.number().int().min(0) });
export type ProductCandidate = z.infer<typeof productCandidateSchema>;
export const targetDecisionSchema = z.object({ kind: z.enum(["NO_MATCH", "MATCHED", "VARIANT_SELECTED", "PRICE_LIMIT_EXCEEDED", "CURRENCY_MISMATCH", "NO_ACCEPTABLE_VARIANT", "ERROR"]), message: z.string().max(500), candidate: productCandidateSchema.nullable(), selectedVariant: productVariantSchema.nullable() });
export type TargetDecision = z.infer<typeof targetDecisionSchema>;
export const targetCheckSchema = z.object({ id: idSchema, targetId: idSchema, checkedAt: timestampSchema, status: z.enum(["SUCCESS", "ERROR"]), decision: targetDecisionSchema, candidateCount: z.number().int().min(0), errorMessage: z.string().nullable() });
export type TargetCheck = z.infer<typeof targetCheckSchema>;
export const targetSnapshotSchema = targetSchema.omit({ id: true, latestCheck: true, createdAt: true, updatedAt: true }).extend({ targetId: idSchema, capturedAt: timestampSchema });
export type TargetSnapshot = z.infer<typeof targetSnapshotSchema>;

export const proxyProviderSchema = z.enum(["brightdata", "decodo", "oxylabs", "custom"]);
export const proxyTypeSchema = z.enum(["home", "datacenter", "residential-sticky", "isp-static"]);
export const proxyProtocolSchema = z.enum(["http", "https", "socks5"]);
export type ProxyProtocol = z.infer<typeof proxyProtocolSchema>;

export const proxyProfileSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(80), provider: proxyProviderSchema, type: proxyTypeSchema, protocol: proxyProtocolSchema,
  host: z.string().trim().min(1).max(253), port: z.number().int().min(1).max(65_535), expectedCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable(), expectedCity: z.string().trim().min(1).max(80).nullable(),
  usernameConfigured: z.boolean(), passwordConfigured: z.boolean(), enabled: z.boolean(), createdAt: timestampSchema, updatedAt: timestampSchema
});
export type ProxyProfile = z.infer<typeof proxyProfileSchema>;

const optionalCredentialSchema = z.string().min(1).max(512).optional();
const credentialUpdateSchema = z.union([z.string().min(1).max(512), z.null()]).optional();
const nullableCountrySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter country code.").nullable().optional();
const nullableCitySchema = z.string().trim().min(1).max(80).nullable().optional();

export const createProxyProfileSchema = z.object({ name: z.string().trim().min(1, "A proxy name is required.").max(80), provider: proxyProviderSchema.default("custom"), type: proxyTypeSchema.default("residential-sticky"), protocol: proxyProtocolSchema.default("http"), host: z.string().trim().min(1, "A proxy host is required.").max(253), port: z.coerce.number().int().min(1).max(65_535), username: optionalCredentialSchema, password: optionalCredentialSchema, expectedCountry: nullableCountrySchema, expectedCity: nullableCitySchema, enabled: z.boolean().default(true) });
export type CreateProxyProfileInput = z.input<typeof createProxyProfileSchema>;
export const updateProxyProfileSchema = z.object({ name: z.string().trim().min(1, "A proxy name is required.").max(80).optional(), provider: proxyProviderSchema.optional(), type: proxyTypeSchema.optional(), protocol: proxyProtocolSchema.optional(), host: z.string().trim().min(1, "A proxy host is required.").max(253).optional(), port: z.coerce.number().int().min(1).max(65_535).optional(), username: credentialUpdateSchema, password: credentialUpdateSchema, expectedCountry: nullableCountrySchema, expectedCity: nullableCitySchema, enabled: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0, { message: "Provide at least one field to update." });
export type UpdateProxyProfileInput = z.input<typeof updateProxyProfileSchema>;

export const browserProfileSchema = z.object({ id: idSchema, name: z.string().trim().min(1).max(80), userDataDir: z.string().min(1), proxyProfileId: idSchema.nullable(), shippingProfileId: idSchema.nullable(), enabled: z.boolean(), createdAt: timestampSchema, updatedAt: timestampSchema });
export type BrowserProfile = z.infer<typeof browserProfileSchema>;
export const createBrowserProfileSchema = z.object({ name: z.string().trim().min(1, "A profile name is required.").max(80), enabled: z.boolean().default(true) });
export type CreateBrowserProfileInput = z.input<typeof createBrowserProfileSchema>;
export const updateBrowserProfileSchema = z.object({ name: z.string().trim().min(1, "A profile name is required.").max(80).optional(), enabled: z.boolean().optional(), proxyProfileId: idSchema.nullable().optional() }).refine((value) => value.name !== undefined || value.enabled !== undefined || value.proxyProfileId !== undefined, { message: "Provide at least one field to update." });
export type UpdateBrowserProfileInput = z.input<typeof updateBrowserProfileSchema>;

export const routeVerificationSchema = z.object({ status: z.enum(["PENDING", "VERIFIED", "WARNING", "FAILED"]), publicIp: z.string().nullable(), country: z.string().nullable(), city: z.string().nullable(), verifiedAt: timestampSchema.nullable(), message: z.string().nullable() });
export type RouteVerification = z.infer<typeof routeVerificationSchema>;
export const sessionRouteSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("direct"), verification: routeVerificationSchema }), z.object({ kind: z.literal("proxy"), proxyProfileId: idSchema, proxyName: z.string(), protocol: proxyProtocolSchema, verification: routeVerificationSchema })]);
export type SessionRoute = z.infer<typeof sessionRouteSchema>;
export const sessionStateSchema = z.enum(["STOPPED", "STARTING", "READY", "STOPPING", "CRASHED", "ERROR"]);
export type SessionState = z.infer<typeof sessionStateSchema>;
export const sessionErrorCodeSchema = z.enum(["BROWSER_START_FAILED", "PROXY_CONNECTION_FAILED", "PROXY_AUTH_FAILED", "SECRET_STORAGE_UNAVAILABLE", "RUNNER_CRASHED", "RUN_INTERRUPTED", "INVALID_COMMAND", "RECORDING_FAILED", "UNKNOWN"]);
export const sessionErrorSchema = z.object({ code: sessionErrorCodeSchema, message: z.string() });
export type SessionError = z.infer<typeof sessionErrorSchema>;
export const sessionSnapshotSchema = z.object({ profileId: idSchema, state: sessionStateSchema, error: sessionErrorSchema.nullable(), route: sessionRouteSchema, updatedAt: timestampSchema });
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;

export const runnerProxySchema = z.object({ proxyProfileId: idSchema, proxyName: z.string(), protocol: proxyProtocolSchema, host: z.string().min(1), port: z.number().int().min(1).max(65_535), username: z.string().min(1).optional(), password: z.string().min(1).optional(), expectedCountry: z.string().nullable(), expectedCity: z.string().nullable() });
export type RunnerProxy = z.infer<typeof runnerProxySchema>;

export const diagnosticLevelSchema = z.enum(["NORMAL", "DIAGNOSTIC", "DEEP_DEBUG"]);
export type DiagnosticLevel = z.infer<typeof diagnosticLevelSchema>;
export const runStatusSchema = z.enum(["STARTING", "RECORDING", "COMPLETED", "FAILED"]);
export type RunStatus = z.infer<typeof runStatusSchema>;
export const runSessionStatusSchema = z.enum(["STARTING", "RECORDING", "ENDED", "FAILED"]);
export type RunSessionStatus = z.infer<typeof runSessionStatusSchema>;
export const runArtifactKindSchema = z.enum(["SCREENSHOT", "TRACE", "HAR", "VIDEO", "MANIFEST"]);
export type RunArtifactKind = z.infer<typeof runArtifactKindSchema>;
export const runEnvironmentSchema = z.object({ appVersion: z.string(), schemaVersion: z.number().int(), osVersion: z.string(), chromeVersion: z.string().nullable(), playwrightVersion: z.string(), capturedAt: timestampSchema });
export type RunEnvironment = z.infer<typeof runEnvironmentSchema>;
export const runSchema = z.object({ id: idSchema, name: z.string().min(1).max(120), diagnosticLevel: diagnosticLevelSchema, status: runStatusSchema, startedAt: timestampSchema, endedAt: timestampSchema.nullable(), environment: runEnvironmentSchema, targetSnapshot: targetSnapshotSchema.nullable(), createdAt: timestampSchema, updatedAt: timestampSchema });
export type Run = z.infer<typeof runSchema>;
export const runSessionSchema = z.object({ id: idSchema, runId: idSchema, browserProfileId: idSchema, browserProfileName: z.string(), route: sessionRouteSchema, status: runSessionStatusSchema, startedAt: timestampSchema, endedAt: timestampSchema.nullable(), finalError: sessionErrorSchema.nullable() });
export type RunSession = z.infer<typeof runSessionSchema>;
export const runEventSchema = z.object({ id: idSchema, runId: idSchema, runSessionId: idSchema.nullable(), wallTimeMs: timestampSchema, elapsedNs: z.string().regex(/^\d+$/), type: z.string().min(1).max(80), stateBefore: z.string().nullable(), stateAfter: z.string().nullable(), payload: jsonRecordSchema });
export type RunEvent = z.infer<typeof runEventSchema>;
export const runArtifactSchema = z.object({ id: idSchema, runId: idSchema, runSessionId: idSchema, kind: runArtifactKindSchema, relativePath: z.string().min(1).max(512), sensitive: z.boolean(), createdAt: timestampSchema });
export type RunArtifact = z.infer<typeof runArtifactSchema>;
export const runDetailSchema = z.object({ run: runSchema, sessions: z.array(runSessionSchema), events: z.array(runEventSchema), artifacts: z.array(runArtifactSchema) });
export type RunDetail = z.infer<typeof runDetailSchema>;
export const createRunSchema = z.object({ name: z.string().trim().min(1).max(120), diagnosticLevel: diagnosticLevelSchema, profileIds: z.array(idSchema).min(1).max(20).refine((ids) => new Set(ids).size === ids.length, "Each profile may only be selected once."), targetId: idSchema.nullable().default(null), deepDebugAcknowledged: z.boolean().default(false) }).superRefine((value, context) => { if (value.diagnosticLevel === "DEEP_DEBUG" && !value.deepDebugAcknowledged) context.addIssue({ code: z.ZodIssueCode.custom, message: "Deep Debug requires acknowledgement because HAR and video can contain sensitive browser state.", path: ["deepDebugAcknowledged"] }); });
export type CreateRunInput = z.input<typeof createRunSchema>;
export const runnerRecordingSchema = z.object({ runId: idSchema, runSessionId: idSchema, diagnosticLevel: diagnosticLevelSchema, artifactDir: z.string().min(1), startedAt: timestampSchema });
export type RunnerRecording = z.infer<typeof runnerRecordingSchema>;

export const runnerCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("START"), version: z.literal(IPC_VERSION), profileId: idSchema, userDataDir: z.string().min(1), proxy: runnerProxySchema.nullable(), probeUrl: z.string().url(), recording: runnerRecordingSchema.nullable() }),
  z.object({ type: z.literal("END_RUN"), version: z.literal(IPC_VERSION), runSessionId: idSchema }),
  z.object({ type: z.literal("STOP"), version: z.literal(IPC_VERSION) })
]);
export type RunnerCommand = z.infer<typeof runnerCommandSchema>;
export const runnerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("READY"), version: z.literal(IPC_VERSION), profileId: idSchema, route: sessionRouteSchema }),
  z.object({ type: z.literal("STOPPED"), version: z.literal(IPC_VERSION), profileId: idSchema }),
  z.object({ type: z.literal("ERROR"), version: z.literal(IPC_VERSION), profileId: idSchema.nullable(), code: sessionErrorCodeSchema.exclude(["RUNNER_CRASHED", "INVALID_COMMAND", "SECRET_STORAGE_UNAVAILABLE"]), message: z.string() }),
  z.object({ type: z.literal("RUN_EVENT"), version: z.literal(IPC_VERSION), profileId: idSchema, event: runEventSchema }),
  z.object({ type: z.literal("RUN_ARTIFACT"), version: z.literal(IPC_VERSION), profileId: idSchema, artifact: runArtifactSchema }),
  z.object({ type: z.literal("RUN_ENDED"), version: z.literal(IPC_VERSION), profileId: idSchema, runSessionId: idSchema })
]);
export type RunnerEvent = z.infer<typeof runnerEventSchema>;

export const monitorCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("START_MONITOR"), version: z.literal(IPC_VERSION), runId: idSchema, target: targetSnapshotSchema }),
  z.object({ type: z.literal("TEST_TARGET"), version: z.literal(IPC_VERSION), target: targetSnapshotSchema }),
  z.object({ type: z.literal("STOP_MONITOR"), version: z.literal(IPC_VERSION) })
]);
export type MonitorCommand = z.infer<typeof monitorCommandSchema>;
export const monitorEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MONITOR_EVENT"), version: z.literal(IPC_VERSION), runId: idSchema.nullable(), eventType: z.string().min(1).max(80), check: targetCheckSchema.nullable() }),
  z.object({ type: z.literal("MONITOR_TEST_RESULT"), version: z.literal(IPC_VERSION), check: targetCheckSchema }),
  z.object({ type: z.literal("MONITOR_STOPPED"), version: z.literal(IPC_VERSION), runId: idSchema.nullable() })
]);
export type MonitorEvent = z.infer<typeof monitorEventSchema>;

export const networkProbeSettingsSchema = z.object({ probeUrl: z.string().url().refine((value) => new URL(value).protocol === "https:", "The probe URL must use HTTPS.") });
export type NetworkProbeSettings = z.infer<typeof networkProbeSettingsSchema>;
export const benchmarkStatusSchema = z.enum(["PASS", "WARN", "FAIL"]);
export type BenchmarkStatus = z.infer<typeof benchmarkStatusSchema>;
export const proxyBenchmarkSchema = z.object({ id: idSchema, routeKind: z.enum(["direct", "proxy"]), proxyProfileId: idSchema.nullable(), probeUrl: z.string().url(), startedAt: timestampSchema, completedAt: timestampSchema, attempts: z.number().int().min(1), successes: z.number().int().min(0), publicIp: z.string().nullable(), country: z.string().nullable(), city: z.string().nullable(), connectLatencyMs: z.number().nonnegative().nullable(), medianLatencyMs: z.number().nonnegative().nullable(), jitterMs: z.number().nonnegative().nullable(), failureRate: z.number().min(0).max(1), ipStable: z.boolean(), qualityScore: z.number().int().min(0).max(100), status: benchmarkStatusSchema, errorCode: z.string().nullable(), errorMessage: z.string().nullable(), samples: z.array(z.number().nonnegative()) });
export type ProxyBenchmark = z.infer<typeof proxyBenchmarkSchema>;

export const profileIpc = { list: "profiles:list", create: "profiles:create", update: "profiles:update", remove: "profiles:remove" } as const;
export const targetIpc = { list: "targets:list", create: "targets:create", update: "targets:update", remove: "targets:remove", test: "targets:test", changed: "targets:changed" } as const;
export const proxyIpc = { list: "proxies:list", create: "proxies:create", update: "proxies:update", remove: "proxies:remove", test: "proxies:test", benchmarks: "proxies:benchmarks" } as const;
export const settingsIpc = { getNetworkProbe: "settings:get-network-probe", updateNetworkProbe: "settings:update-network-probe" } as const;
export const sessionIpc = { list: "sessions:list", open: "sessions:open", close: "sessions:close", restart: "sessions:restart", openAll: "sessions:open-all", closeAll: "sessions:close-all", changed: "sessions:changed" } as const;
export const runIpc = { list: "runs:list", get: "runs:get", start: "runs:start", end: "runs:end", remove: "runs:remove", changed: "runs:changed" } as const;
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };
export function defaultRoute(): SessionRoute { return { kind: "direct", verification: { status: "PENDING", publicIp: null, country: null, city: null, verifiedAt: null, message: null } }; }
