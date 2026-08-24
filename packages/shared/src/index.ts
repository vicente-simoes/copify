import { z } from "zod";
import { STORE_GENERAL, storeCurrencySchema } from "./stores";

export * from "./stores";

export const IPC_VERSION = 14 as const;
export const SCHEMA_VERSION = 12 as const;
export const DEFAULT_NETWORK_PROBE_URL = "https://ipwho.is/";

const idSchema = z.string().uuid();
const timestampSchema = z.number().int().nonnegative();
const jsonRecordSchema = z.record(z.string(), z.unknown());
export const storeIdSchema = z.string().trim().min(1).max(64);
export type StoreId = z.infer<typeof storeIdSchema>;

const priorityListSchema = z.array(z.string().trim().min(1).max(120)).max(40);
export const targetCurrencySchema = storeCurrencySchema;
export const targetSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(120), storeId: storeIdSchema, productKeywords: priorityListSchema.min(1), negativeKeywords: priorityListSchema,
  preferredColors: priorityListSchema, sizePriority: priorityListSchema, currency: targetCurrencySchema, maxRetailMinor: z.number().int().min(0), quantity: z.number().int().min(1).max(10), enabled: z.boolean(),
  latestCheck: z.lazy(() => targetCheckSchema).nullable(), createdAt: timestampSchema, updatedAt: timestampSchema
});
export type Target = z.infer<typeof targetSchema>;
export const createTargetSchema = z.object({ name: z.string().trim().min(1).max(120), storeId: storeIdSchema.default(STORE_GENERAL), productKeywords: priorityListSchema.min(1), negativeKeywords: priorityListSchema.default([]), preferredColors: priorityListSchema.default([]), sizePriority: priorityListSchema.default([]), currency: targetCurrencySchema.default("EUR"), maxRetailMinor: z.coerce.number().int().min(0), quantity: z.coerce.number().int().min(1).max(10).default(1), enabled: z.boolean().default(true) });
export type CreateTargetInput = z.input<typeof createTargetSchema>;
export const updateTargetSchema = createTargetSchema.partial().refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
export type UpdateTargetInput = z.input<typeof updateTargetSchema>;
export const productVariantSchema = z.object({ id: z.string().regex(/^\d{1,32}$/, "Variant IDs must be decimal strings."), color: z.string().min(1).max(120), size: z.string().min(1).max(80), available: z.boolean() });
export type ProductVariant = z.infer<typeof productVariantSchema>;
export const productCandidateSchema = z.object({ name: z.string().min(1).max(300), url: z.string().url(), imageUrl: z.string().url().nullable().default(null), priceMinor: z.number().int().min(0).nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(), variants: z.array(productVariantSchema), listingOrder: z.number().int().min(0) });
export type ProductCandidate = z.infer<typeof productCandidateSchema>;
export const targetDecisionSchema = z.object({ kind: z.enum(["NO_MATCH", "MATCHED", "VARIANT_SELECTED", "PRICE_LIMIT_EXCEEDED", "CURRENCY_MISMATCH", "NO_ACCEPTABLE_VARIANT", "ERROR"]), message: z.string().max(500), candidate: productCandidateSchema.nullable(), selectedVariant: productVariantSchema.nullable() });
export type TargetDecision = z.infer<typeof targetDecisionSchema>;
export const monitorFailureCodeSchema = z.enum(["PROXY_TRANSPORT_FAILED", "PROXY_AUTH_FAILED", "STOREFRONT_PROTECTION", "STOREFRONT_SERVICE_UNAVAILABLE", "NO_HEALTHY_ROUTES", "MONITOR_ENDPOINT_UNSUPPORTED", "INVALID_MONITOR_POLICY", "MONITOR_RESPONSE_TOO_LARGE", "MONITOR_CONNECTION_FAILED", "UNKNOWN"]);
export type MonitorFailureCode = z.infer<typeof monitorFailureCodeSchema>;
export const monitorRouteActionSchema = z.enum(["NONE", "ROTATING_GATEWAY_RETAINED", "ROUTE_COOLED", "ROTATED", "MONITOR_COOLDOWN", "POOL_EXHAUSTED"]);
export type MonitorRouteAction = z.infer<typeof monitorRouteActionSchema>;
export const targetCheckSchema = z.object({
  id: idSchema, targetId: idSchema, checkedAt: timestampSchema, status: z.enum(["SUCCESS", "ERROR"]), decision: targetDecisionSchema,
  candidateCount: z.number().int().min(0), errorMessage: z.string().nullable(), retryAfterMs: z.number().int().nonnegative().nullable().optional(),
  errorCode: monitorFailureCodeSchema.nullable().optional(), routeId: z.string().min(1).max(120).nullable().optional(), routeAction: monitorRouteActionSchema.optional()
});
export type TargetCheck = z.infer<typeof targetCheckSchema>;
export const targetSnapshotSchema = targetSchema.omit({ id: true, latestCheck: true, createdAt: true, updatedAt: true }).extend({ targetId: idSchema, capturedAt: timestampSchema });
export type TargetSnapshot = z.infer<typeof targetSnapshotSchema>;

export const proxyProviderSchema = z.enum(["brightdata", "dataimpulse", "decodo", "oxylabs", "custom"]);
export type ProxyProvider = z.infer<typeof proxyProviderSchema>;
export const proxyTypeSchema = z.enum(["home", "datacenter", "residential-sticky", "residential-rotating", "isp-static"]);
export type ProxyType = z.infer<typeof proxyTypeSchema>;
export const proxyProtocolSchema = z.enum(["http", "https", "socks5"]);
export type ProxyProtocol = z.infer<typeof proxyProtocolSchema>;
const costPerGbMicrosUsdSchema = z.number().int().min(0).max(1_000_000_000).nullable();

export const proxyProfileSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(80), provider: proxyProviderSchema, type: proxyTypeSchema, protocol: proxyProtocolSchema,
  host: z.string().trim().min(1).max(253), port: z.number().int().min(1).max(65_535), expectedCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable(), expectedCity: z.string().trim().min(1).max(80).nullable(), costPerGbMicrosUsd: costPerGbMicrosUsdSchema,
  usernameConfigured: z.boolean(), passwordConfigured: z.boolean(), enabled: z.boolean(), createdAt: timestampSchema, updatedAt: timestampSchema
});
export type ProxyProfile = z.infer<typeof proxyProfileSchema>;

const optionalCredentialSchema = z.string().min(1).max(512).optional();
const credentialUpdateSchema = z.union([z.string().min(1).max(512), z.null()]).optional();
const nullableCountrySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter country code.").nullable().optional();
const nullableCitySchema = z.string().trim().min(1).max(80).nullable().optional();

export const createProxyProfileSchema = z.object({ name: z.string().trim().min(1, "A proxy name is required.").max(80), provider: proxyProviderSchema.default("custom"), type: proxyTypeSchema.default("residential-sticky"), protocol: proxyProtocolSchema.default("http"), host: z.string().trim().min(1, "A proxy host is required.").max(253), port: z.coerce.number().int().min(1).max(65_535), username: optionalCredentialSchema, password: optionalCredentialSchema, expectedCountry: nullableCountrySchema, expectedCity: nullableCitySchema, costPerGbMicrosUsd: costPerGbMicrosUsdSchema.optional().default(null), enabled: z.boolean().default(true) });
export type CreateProxyProfileInput = z.input<typeof createProxyProfileSchema>;
export const updateProxyProfileSchema = z.object({ name: z.string().trim().min(1, "A proxy name is required.").max(80).optional(), provider: proxyProviderSchema.optional(), type: proxyTypeSchema.optional(), protocol: proxyProtocolSchema.optional(), host: z.string().trim().min(1, "A proxy host is required.").max(253).optional(), port: z.coerce.number().int().min(1).max(65_535).optional(), username: credentialUpdateSchema, password: credentialUpdateSchema, expectedCountry: nullableCountrySchema, expectedCity: nullableCitySchema, costPerGbMicrosUsd: costPerGbMicrosUsdSchema.optional(), enabled: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0, { message: "Provide at least one field to update." });
export type UpdateProxyProfileInput = z.input<typeof updateProxyProfileSchema>;

const shippingDetailsSchema = z.object({
  fullName: z.string().trim().min(1).max(160), email: z.string().trim().email().max(254), phone: z.string().trim().min(3).max(60),
  address1: z.string().trim().min(1).max(160), address2: z.string().trim().max(160).optional(), postalCode: z.string().trim().min(1).max(40),
  city: z.string().trim().min(1).max(100), region: z.string().trim().max(100).optional(), country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)
});
export type ShippingDetails = z.infer<typeof shippingDetailsSchema>;
export const shippingProfileSchema = z.object({ id: idSchema, name: z.string().trim().min(1).max(80), country: z.string().regex(/^[A-Z]{2}$/).nullable(), detailsConfigured: z.boolean(), complete: z.boolean(), enabled: z.boolean(), createdAt: timestampSchema, updatedAt: timestampSchema });
export type ShippingProfile = z.infer<typeof shippingProfileSchema>;
export const createShippingProfileSchema = z.object({ name: z.string().trim().min(1).max(80), details: shippingDetailsSchema, enabled: z.boolean().default(true) });
export type CreateShippingProfileInput = z.input<typeof createShippingProfileSchema>;
export const updateShippingProfileSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), details: shippingDetailsSchema.nullable().optional(), enabled: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
export type UpdateShippingProfileInput = z.input<typeof updateShippingProfileSchema>;
export const shippingProfileSnapshotSchema = z.object({ shippingProfileId: idSchema.nullable(), name: z.string().nullable(), country: z.string().regex(/^[A-Z]{2}$/).nullable(), complete: z.boolean() });
export type ShippingProfileSnapshot = z.infer<typeof shippingProfileSnapshotSchema>;

export const browserDriverKindSchema = z.enum(["NATIVE_STEALTH", "EXTERNAL_CDP"]);
export type BrowserDriverKind = z.infer<typeof browserDriverKindSchema>;
export const externalCdpEndpointSchema = z.string().trim().min(1).max(2_048).superRefine((value, context) => {
  try {
    const url = new URL(value);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Use an HTTP or WebSocket CDP endpoint." });
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase())) context.addIssue({ code: z.ZodIssueCode.custom, message: "The external CDP endpoint must use the local loopback interface." });
    if (url.username || url.password) context.addIssue({ code: z.ZodIssueCode.custom, message: "Do not place credentials in the endpoint authority." });
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid local CDP endpoint URL." });
  }
});
export const browserDriverConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NATIVE_STEALTH") }),
  z.object({ kind: z.literal("EXTERNAL_CDP"), endpointConfigured: z.boolean() }),
]);
export type BrowserDriverConfig = z.infer<typeof browserDriverConfigSchema>;
export const browserDriverInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NATIVE_STEALTH") }),
  z.object({ kind: z.literal("EXTERNAL_CDP"), endpoint: externalCdpEndpointSchema.nullable().optional() }),
]);
export type BrowserDriverInput = z.input<typeof browserDriverInputSchema>;
export const browserProfileSchema = z.object({ id: idSchema, name: z.string().trim().min(1).max(80), userDataDir: z.string().min(1), proxyProfileId: idSchema.nullable(), shippingProfileId: idSchema.nullable(), driver: browserDriverConfigSchema.default({ kind: "NATIVE_STEALTH" }), enabled: z.boolean(), createdAt: timestampSchema, updatedAt: timestampSchema });
export type BrowserProfile = z.infer<typeof browserProfileSchema>;
export const createBrowserProfileSchema = z.object({ name: z.string().trim().min(1, "A profile name is required.").max(80), driver: browserDriverInputSchema.default({ kind: "NATIVE_STEALTH" }), enabled: z.boolean().default(true) });
export type CreateBrowserProfileInput = z.input<typeof createBrowserProfileSchema>;
export const updateBrowserProfileSchema = z.object({ name: z.string().trim().min(1, "A profile name is required.").max(80).optional(), enabled: z.boolean().optional(), driver: browserDriverInputSchema.optional(), proxyProfileId: idSchema.nullable().optional(), shippingProfileId: idSchema.nullable().optional() }).refine((value) => value.name !== undefined || value.enabled !== undefined || value.driver !== undefined || value.proxyProfileId !== undefined || value.shippingProfileId !== undefined, { message: "Provide at least one field to update." });
export type UpdateBrowserProfileInput = z.input<typeof updateBrowserProfileSchema>;

export const routeVerificationSchema = z.object({ status: z.enum(["PENDING", "VERIFIED", "WARNING", "FAILED"]), publicIp: z.string().nullable(), country: z.string().nullable(), city: z.string().nullable(), verifiedAt: timestampSchema.nullable(), message: z.string().nullable() });
export type RouteVerification = z.infer<typeof routeVerificationSchema>;
export const geoIdentitySnapshotSchema = z.object({
  publicIp: z.string().nullable(), country: z.string().nullable(), city: z.string().nullable(), region: z.string().nullable(),
  latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable(), timezoneId: z.string().nullable(), resolvedAt: timestampSchema
});
export type GeoIdentitySnapshot = z.infer<typeof geoIdentitySnapshotSchema>;
export const coherenceStatusSchema = z.enum(["PENDING", "VERIFIED", "WARNING", "EXTERNAL"]);
export type CoherenceStatus = z.infer<typeof coherenceStatusSchema>;
export const webRtcPolicySchema = z.enum(["DEFAULT_PUBLIC_INTERFACE_ONLY", "DISABLE_NON_PROXIED_UDP", "EXTERNAL_UNMANAGED"]);
export const profileCoherenceSummarySchema = z.object({
  status: coherenceStatusSchema, country: z.string().nullable(), city: z.string().nullable(), locale: z.string().nullable(), timezoneId: z.string().nullable(),
  geolocationApplied: z.boolean(), webRtcPolicy: webRtcPolicySchema, source: z.enum(["ROUTE_PROBE", "EXTERNAL_BROWSER", "NONE"]), resolvedAt: timestampSchema.nullable(), message: z.string().nullable()
});
export type ProfileCoherenceSummary = z.infer<typeof profileCoherenceSummarySchema>;
export const sessionRouteSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("direct"), verification: routeVerificationSchema }), z.object({ kind: z.literal("proxy"), proxyProfileId: idSchema, proxyName: z.string(), protocol: proxyProtocolSchema, verification: routeVerificationSchema })]);
export type SessionRoute = z.infer<typeof sessionRouteSchema>;
export const sessionStateSchema = z.enum(["STOPPED", "STARTING", "READY", "STOPPING", "CRASHED", "ERROR"]);
export type SessionState = z.infer<typeof sessionStateSchema>;
export const sessionErrorCodeSchema = z.enum(["BROWSER_START_FAILED", "PROXY_CONNECTION_FAILED", "PROXY_AUTH_FAILED", "SECRET_STORAGE_UNAVAILABLE", "INVALID_DRIVER_ENDPOINT", "EXTERNAL_CDP_CONNECTION_FAILED", "DRIVER_CAPABILITY_UNAVAILABLE", "STEALTH_VERIFICATION_FAILED", "RUNNER_CRASHED", "RUN_INTERRUPTED", "INVALID_COMMAND", "RECORDING_FAILED", "NAVIGATION_TIMEOUT", "STORE_UNAVAILABLE", "VARIANT_NOT_AVAILABLE", "ATC_FAILED", "CHECKOUT_NAV_FAILED", "CHECKPOINT_DETECTED", "UNKNOWN"]);
export const sessionErrorSchema = z.object({ code: sessionErrorCodeSchema, message: z.string() });
export type SessionError = z.infer<typeof sessionErrorSchema>;
export const driverStealthStatusSchema = z.enum(["PASS", "FAIL", "EXTERNAL", "UNKNOWN"]);
export const browserDriverMetadataSchema = z.object({ kind: browserDriverKindSchema, ownsBrowser: z.boolean(), browserVersion: z.string().nullable(), stealthStatus: driverStealthStatusSchema, capabilities: z.object({ managedProxy: z.boolean(), launchHarVideo: z.boolean() }) });
export type BrowserDriverMetadata = z.infer<typeof browserDriverMetadataSchema>;
export const sessionSnapshotSchema = z.object({ profileId: idSchema, state: sessionStateSchema, error: sessionErrorSchema.nullable(), route: sessionRouteSchema, coherence: profileCoherenceSummarySchema.nullable().optional(), driver: browserDriverMetadataSchema.nullable().default(null), updatedAt: timestampSchema });
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;
export const cartStatusSchema = z.object({ profileId: idSchema, status: z.enum(["UNKNOWN", "CHECKING", "EMPTY", "ITEMS", "ERROR"]), itemCount: z.number().int().min(0).nullable(), checkedAt: timestampSchema.nullable(), message: z.string().nullable() });
export type CartStatus = z.infer<typeof cartStatusSchema>;

/** A privacy-safe operational snapshot for either a checkout browser or the shared watcher. */
export const healthSubjectKindSchema = z.enum(["CHECKOUT", "WATCHER"]);
export type HealthSubjectKind = z.infer<typeof healthSubjectKindSchema>;
export const circuitStateSchema = z.object({
  state: z.enum(["CLOSED", "OPEN"]),
  consecutiveProtectionSignals: z.number().int().min(0),
  reopenAt: timestampSchema.nullable(),
});
export type CircuitState = z.infer<typeof circuitStateSchema>;
export const browserHealthSnapshotSchema = z.object({
  id: idSchema,
  subjectKind: healthSubjectKindSchema,
  subjectId: z.string().trim().min(1).max(120),
  runId: idSchema.nullable(),
  capturedAt: timestampSchema,
  navigatorWebdriver: z.boolean().nullable(),
  browserVersion: z.string().nullable(),
  driverKind: browserDriverKindSchema.nullable().default(null),
  stealthStatus: driverStealthStatusSchema.nullable().default(null),
  profileAgeMs: z.number().int().nonnegative().nullable(),
  cookieCount: z.number().int().nonnegative().nullable(),
  requestCount: z.number().int().nonnegative(),
  requestsPerMinute: z.number().nonnegative(),
  navigationCount: z.number().int().nonnegative(),
  navigationsPerMinute: z.number().nonnegative(),
  atcAttempts: z.number().int().nonnegative(),
  forbiddenCount: z.number().int().nonnegative(),
  rateLimitedCount: z.number().int().nonnegative(),
  challengeCount: z.number().int().nonnegative(),
  checkoutFailures: z.number().int().nonnegative(),
  averagePageLoadMs: z.number().nonnegative().nullable(),
  monitorTransport: z.enum(["HTTP"]).nullable().optional(),
  monitorEndpoint: z.string().url().nullable().optional(),
  configuredRouteCount: z.number().int().nonnegative().nullable().optional(),
  healthyRouteCount: z.number().int().nonnegative().nullable().optional(),
  pollIntervalMs: z.number().int().min(200).nullable().optional(),
  lastHttpStatus: z.number().int().min(100).max(599).nullable().optional(),
  lastResponseLatencyMs: z.number().nonnegative().nullable().optional(),
  bytesReceived: z.number().int().nonnegative().nullable().optional(),
  nextPollAt: timestampSchema.nullable().optional(),
  coherence: profileCoherenceSummarySchema.nullable().optional(),
  circuit: circuitStateSchema.nullable(),
});
export type BrowserHealthSnapshot = z.infer<typeof browserHealthSnapshotSchema>;
export const browserHealthDetailSchema = z.object({ latest: browserHealthSnapshotSchema.nullable(), recent: z.array(browserHealthSnapshotSchema) });
export type BrowserHealthDetail = z.infer<typeof browserHealthDetailSchema>;

export const profileWarmStatusSchema = z.enum(["IN_PROGRESS", "READY", "REVIEW"]);
export const profileWarmStateSchema = z.object({
  id: idSchema, browserProfileId: idSchema, storeId: storeIdSchema, status: profileWarmStatusSchema,
  storefrontReady: z.boolean(), googleReady: z.boolean(), shopPayReady: z.boolean(),
  storefrontCompletedAt: timestampSchema.nullable(), googleCompletedAt: timestampSchema.nullable(), shopPayCompletedAt: timestampSchema.nullable(),
  proxyProfileId: idSchema.nullable(), driverKind: browserDriverKindSchema, routePublicIp: z.string().nullable(), routeCountry: z.string().nullable(),
  startedAt: timestampSchema, completedAt: timestampSchema.nullable(), updatedAt: timestampSchema
});
export type ProfileWarmState = z.infer<typeof profileWarmStateSchema>;
export const updateProfileWarmStateSchema = z.object({ storefrontReady: z.boolean(), googleReady: z.boolean(), shopPayReady: z.boolean() });
export type UpdateProfileWarmStateInput = z.infer<typeof updateProfileWarmStateSchema>;
export const warmDestinationSchema = z.enum(["STOREFRONT", "GOOGLE", "SHOP_PAY"]);
export type WarmDestination = z.infer<typeof warmDestinationSchema>;

export const runnerProxySchema = z.object({ proxyProfileId: idSchema, proxyName: z.string(), protocol: proxyProtocolSchema, host: z.string().min(1), port: z.number().int().min(1).max(65_535), username: z.string().min(1).optional(), password: z.string().min(1).optional(), expectedCountry: z.string().nullable(), expectedCity: z.string().nullable() });
export type RunnerProxy = z.infer<typeof runnerProxySchema>;
export const monitorRouteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DIRECT"), id: z.literal("direct") }),
  z.object({ kind: z.literal("PROXY"), id: idSchema, proxyType: proxyTypeSchema, protocol: proxyProtocolSchema, host: z.string().min(1), port: z.number().int().min(1).max(65_535), username: z.string().min(1).optional(), password: z.string().min(1).optional() }),
]);
export type MonitorRoute = z.infer<typeof monitorRouteSchema>;
export const DEFAULT_MONITOR_BEHAVIOR = {
  pollIntervalMs: 2_000, fastPollIntervalMs: 500, fastPollDurationMinutes: 5, requestTimeoutMs: 10_000,
  immediateFirstPoll: true, routeUnhealthyMs: 5 * 60_000, rotateOnProtection: true, serviceCooldownMs: 10_000, honorRetryAfter: true
} as const;
export const monitorBehaviorSchema = z.object({
  pollIntervalMs: z.number().int().min(200).max(60_000),
  fastPollIntervalMs: z.number().int().min(200).max(5_000),
  fastPollDurationMinutes: z.number().int().min(1).max(60),
  requestTimeoutMs: z.number().int().min(1_000).max(30_000),
  immediateFirstPoll: z.boolean(),
  routeUnhealthyMs: z.number().int().min(5_000).max(30 * 60_000),
  rotateOnProtection: z.boolean(),
  serviceCooldownMs: z.number().int().min(1_000).max(60_000),
  honorRetryAfter: z.boolean(),
});
export type MonitorBehavior = z.infer<typeof monitorBehaviorSchema>;
export const monitorBehaviorOverrideSchema = monitorBehaviorSchema.partial();
export type MonitorBehaviorOverride = z.infer<typeof monitorBehaviorOverrideSchema>;
export const monitorSettingsSchema = z.object({
  proxyProfileIds: z.array(idSchema).max(50).refine((ids) => new Set(ids).size === ids.length, "Monitor routes must be unique."),
  defaults: monitorBehaviorSchema,
  stores: z.record(storeIdSchema, monitorBehaviorOverrideSchema),
});
export type MonitorSettings = z.infer<typeof monitorSettingsSchema>;
export const monitorPolicySchema = monitorBehaviorSchema.extend({
  access: z.enum(["PUBLIC", "AUTHORIZED", "LOCAL"]), endpoint: z.string().url(), recommendedPollIntervalMs: z.number().int().min(200)
});
export type MonitorPolicy = z.infer<typeof monitorPolicySchema>;
export const monitorRuntimeStateSchema = z.enum(["STANDBY", "TURBO", "SERVICE_COOLDOWN", "POOL_EXHAUSTED", "STOPPED"]);
export type MonitorRuntimeState = z.infer<typeof monitorRuntimeStateSchema>;
export const monitorRuntimeStatusSchema = z.object({
  runId: idSchema.nullable(), storeId: storeIdSchema.nullable(), state: monitorRuntimeStateSchema,
  activeIntervalMs: z.number().int().min(200).nullable(), fastEndsAt: timestampSchema.nullable(), nextPollAt: timestampSchema.nullable(),
  configuredRouteCount: z.number().int().nonnegative(), healthyRouteCount: z.number().int().nonnegative(),
  lastErrorCode: monitorFailureCodeSchema.nullable(), updatedAt: timestampSchema,
});
export type MonitorRuntimeStatus = z.infer<typeof monitorRuntimeStatusSchema>;
export function defaultMonitorSettings(proxyProfileIds: string[] = []): MonitorSettings {
  return { proxyProfileIds, defaults: { ...DEFAULT_MONITOR_BEHAVIOR }, stores: {} };
}
export function resolveMonitorBehavior(settings: MonitorSettings, storeId: string): MonitorBehavior {
  return monitorBehaviorSchema.parse({ ...settings.defaults, ...(settings.stores[storeId] ?? {}) });
}

export const networkUsageCompletenessSchema = z.enum(["EXACT", "PARTIAL", "UNSUPPORTED"]);
export type NetworkUsageCompleteness = z.infer<typeof networkUsageCompletenessSchema>;
export const networkUsageSourceSchema = z.enum(["MONITOR", "BROWSER"]);
export type NetworkUsageSource = z.infer<typeof networkUsageSourceSchema>;
export const networkUsageCounterSchema = z.object({ receivedBytes: z.number().int().nonnegative(), sentBytes: z.number().int().nonnegative(), requestCount: z.number().int().nonnegative(), completeness: networkUsageCompletenessSchema });
export type NetworkUsageCounter = z.infer<typeof networkUsageCounterSchema>;
export const runNetworkUsageSchema = networkUsageCounterSchema.extend({
  id: idSchema, runId: idSchema, usageKey: z.string().min(1).max(160), source: networkUsageSourceSchema,
  runSessionId: idSchema.nullable(), storeId: storeIdSchema.nullable(), proxyProfileId: idSchema.nullable(), proxyName: z.string().max(80).nullable(),
  costPerGbMicrosUsd: costPerGbMicrosUsdSchema, estimatedCostMicrosUsd: z.number().int().nonnegative().nullable(), updatedAt: timestampSchema,
});
export type RunNetworkUsage = z.infer<typeof runNetworkUsageSchema>;
export const networkUsageTotalsSchema = networkUsageCounterSchema.extend({ estimatedCostMicrosUsd: z.number().int().nonnegative().nullable() });
export type NetworkUsageTotals = z.infer<typeof networkUsageTotalsSchema>;
export function estimateProxyCostMicrosUsd(receivedBytes: number, sentBytes: number, costPerGbMicrosUsd: number | null): number | null {
  if (costPerGbMicrosUsd === null) return null;
  return Math.round(((receivedBytes + sentBytes) * costPerGbMicrosUsd) / 1_000_000_000);
}
export const runnerShippingSchema = shippingDetailsSchema;
export type RunnerShipping = z.infer<typeof runnerShippingSchema>;

export const runnerBrowserDriverSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NATIVE_STEALTH") }),
  z.object({ kind: z.literal("EXTERNAL_CDP"), endpoint: externalCdpEndpointSchema }),
]);
export type RunnerBrowserDriver = z.infer<typeof runnerBrowserDriverSchema>;

export const diagnosticLevelSchema = z.enum(["NORMAL", "DIAGNOSTIC", "DEEP_DEBUG"]);
export type DiagnosticLevel = z.infer<typeof diagnosticLevelSchema>;
export const runExecutionModeSchema = z.enum(["OBSERVATION", "ASSISTED_CHECKOUT"]);
export type RunExecutionMode = z.infer<typeof runExecutionModeSchema>;
export const runExecutionStateSchema = z.enum(["OBSERVING", "WAITING_FOR_TARGET", "PRODUCT_OPEN", "VARIANT_SELECTED", "CARTING", "CARTED", "CHECKOUT", "CHECKPOINT", "CHECKOUT_HANDOFF", "READY_TO_CONFIRM", "FAILED", "ENDED"]);
export type RunExecutionState = z.infer<typeof runExecutionStateSchema>;
export const runStatusSchema = z.enum(["STARTING", "RECORDING", "COMPLETED", "FAILED"]);
export type RunStatus = z.infer<typeof runStatusSchema>;
export const runSessionStatusSchema = z.enum(["STARTING", "RECORDING", "ENDED", "FAILED"]);
export type RunSessionStatus = z.infer<typeof runSessionStatusSchema>;
export const runArtifactKindSchema = z.enum(["SCREENSHOT", "TRACE", "HAR", "VIDEO", "MANIFEST"]);
export type RunArtifactKind = z.infer<typeof runArtifactKindSchema>;
export const runEnvironmentSchema = z.object({ appVersion: z.string(), schemaVersion: z.number().int(), osVersion: z.string(), chromeVersion: z.string().nullable(), playwrightVersion: z.string(), capturedAt: timestampSchema });
export type RunEnvironment = z.infer<typeof runEnvironmentSchema>;
export const runSchema = z.object({ id: idSchema, name: z.string().min(1).max(120), diagnosticLevel: diagnosticLevelSchema, executionMode: runExecutionModeSchema.default("OBSERVATION"), status: runStatusSchema, startedAt: timestampSchema, endedAt: timestampSchema.nullable(), environment: runEnvironmentSchema, targetSnapshot: targetSnapshotSchema.nullable(), createdAt: timestampSchema, updatedAt: timestampSchema });
export type Run = z.infer<typeof runSchema>;
export const runSessionSchema = z.object({ id: idSchema, runId: idSchema, browserProfileId: idSchema, browserProfileName: z.string(), route: sessionRouteSchema, shippingProfile: shippingProfileSnapshotSchema.default({ shippingProfileId: null, name: null, country: null, complete: false }), assistedEligible: z.boolean().default(false), executionState: runExecutionStateSchema.default("OBSERVING"), checkpointReason: z.string().nullable().default(null), status: runSessionStatusSchema, startedAt: timestampSchema, endedAt: timestampSchema.nullable(), finalError: sessionErrorSchema.nullable() });
export type RunSession = z.infer<typeof runSessionSchema>;
export const runEventSchema = z.object({ id: idSchema, runId: idSchema, runSessionId: idSchema.nullable(), wallTimeMs: timestampSchema, elapsedNs: z.string().regex(/^\d+$/), type: z.string().min(1).max(80), stateBefore: z.string().nullable(), stateAfter: z.string().nullable(), payload: jsonRecordSchema });
export type RunEvent = z.infer<typeof runEventSchema>;
export const runArtifactSchema = z.object({ id: idSchema, runId: idSchema, runSessionId: idSchema, kind: runArtifactKindSchema, relativePath: z.string().min(1).max(512), sensitive: z.boolean(), createdAt: timestampSchema });
export type RunArtifact = z.infer<typeof runArtifactSchema>;
export const runDetailSchema = z.object({ run: runSchema, sessions: z.array(runSessionSchema), events: z.array(runEventSchema), artifacts: z.array(runArtifactSchema) });
export type RunDetail = z.infer<typeof runDetailSchema>;
export const createRunSchema = z.object({ name: z.string().trim().min(1).max(120), diagnosticLevel: diagnosticLevelSchema, executionMode: runExecutionModeSchema.default("OBSERVATION"), profileIds: z.array(idSchema).min(1).max(20).refine((ids) => new Set(ids).size === ids.length, "Each profile may only be selected once."), targetId: idSchema.nullable().default(null), deepDebugAcknowledged: z.boolean().default(false) }).superRefine((value, context) => { if (value.diagnosticLevel === "DEEP_DEBUG" && !value.deepDebugAcknowledged) context.addIssue({ code: z.ZodIssueCode.custom, message: "Deep Debug requires acknowledgement because HAR and video can contain sensitive browser state.", path: ["deepDebugAcknowledged"] }); if (value.executionMode === "ASSISTED_CHECKOUT" && !value.targetId) context.addIssue({ code: z.ZodIssueCode.custom, message: "Assisted checkout requires a target.", path: ["targetId"] }); });
export type CreateRunInput = z.input<typeof createRunSchema>;
export const runSetupSchema = z.object({ id: idSchema, name: z.string().trim().min(1).max(120), diagnosticLevel: diagnosticLevelSchema, executionMode: runExecutionModeSchema, profileIds: z.array(idSchema).min(1).max(20).refine((ids) => new Set(ids).size === ids.length, "Each profile may only be selected once."), targetId: idSchema.nullable(), createdAt: timestampSchema, updatedAt: timestampSchema });
export type RunSetup = z.infer<typeof runSetupSchema>;
export const createRunSetupSchema = runSetupSchema.pick({ name: true, diagnosticLevel: true, executionMode: true, profileIds: true, targetId: true });
export type CreateRunSetupInput = z.input<typeof createRunSetupSchema>;
export const runnerRecordingSchema = z.object({ runId: idSchema, runSessionId: idSchema, diagnosticLevel: diagnosticLevelSchema, assisted: z.boolean().default(false), artifactDir: z.string().min(1), startedAt: timestampSchema });
export type RunnerRecording = z.infer<typeof runnerRecordingSchema>;

export const clipboardLeaseDenialReasonSchema = z.enum(["CLIPBOARD_NOT_EMPTY", "CLIPBOARD_UNAVAILABLE", "QUEUE_TIMEOUT", "SESSION_ENDED"]);
export type ClipboardLeaseDenialReason = z.infer<typeof clipboardLeaseDenialReasonSchema>;

export const runnerCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("START"), version: z.literal(IPC_VERSION), profileId: idSchema, userDataDir: z.string().min(1), driver: runnerBrowserDriverSchema, proxy: runnerProxySchema.nullable(), probeUrl: z.string().url(), recording: runnerRecordingSchema.nullable() }),
  z.object({ type: z.literal("END_RUN"), version: z.literal(IPC_VERSION), runSessionId: idSchema }),
  z.object({ type: z.literal("ASSIST_TARGET"), version: z.literal(IPC_VERSION), runId: idSchema, runSessionId: idSchema, candidate: productCandidateSchema, variant: productVariantSchema, quantity: z.number().int().min(1).max(10), priceConstraint: z.object({ currency: targetCurrencySchema, maxRetailMinor: z.number().int().nonnegative() }), shipping: runnerShippingSchema }),
  z.object({ type: z.literal("RESUME_ASSIST"), version: z.literal(IPC_VERSION), runId: idSchema, runSessionId: idSchema }),
  z.object({ type: z.literal("CHECK_CART"), version: z.literal(IPC_VERSION), profileId: idSchema }),
  z.object({ type: z.literal("EMPTY_CART"), version: z.literal(IPC_VERSION), profileId: idSchema }),
  z.object({ type: z.literal("OPEN_WARM_DESTINATION"), version: z.literal(IPC_VERSION), url: z.string().url() }),
  z.object({ type: z.literal("PAUSE_AUTOMATION"), version: z.literal(IPC_VERSION), until: timestampSchema }),
  z.object({ type: z.literal("RESUME_AUTOMATION"), version: z.literal(IPC_VERSION) }),
  z.object({ type: z.literal("CLIPBOARD_LEASE_GRANTED"), version: z.literal(IPC_VERSION), requestId: idSchema }),
  z.object({ type: z.literal("CLIPBOARD_LEASE_DENIED"), version: z.literal(IPC_VERSION), requestId: idSchema, reason: clipboardLeaseDenialReasonSchema }),
  z.object({ type: z.literal("STOP"), version: z.literal(IPC_VERSION) })
]);
export type RunnerCommand = z.infer<typeof runnerCommandSchema>;
export const runnerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("READY"), version: z.literal(IPC_VERSION), profileId: idSchema, route: sessionRouteSchema, coherence: profileCoherenceSummarySchema, driver: browserDriverMetadataSchema }),
  z.object({ type: z.literal("STOPPED"), version: z.literal(IPC_VERSION), profileId: idSchema }),
  z.object({ type: z.literal("ERROR"), version: z.literal(IPC_VERSION), profileId: idSchema.nullable(), code: sessionErrorCodeSchema.exclude(["RUNNER_CRASHED", "INVALID_COMMAND", "SECRET_STORAGE_UNAVAILABLE"]), message: z.string() }),
  z.object({ type: z.literal("CART_STATUS"), version: z.literal(IPC_VERSION), profileId: idSchema, status: cartStatusSchema.omit({ profileId: true }) }),
  z.object({ type: z.literal("RUN_EVENT"), version: z.literal(IPC_VERSION), profileId: idSchema, event: runEventSchema }),
  z.object({ type: z.literal("RUN_ARTIFACT"), version: z.literal(IPC_VERSION), profileId: idSchema, artifact: runArtifactSchema }),
  z.object({ type: z.literal("RUN_ENDED"), version: z.literal(IPC_VERSION), profileId: idSchema, runSessionId: idSchema }),
  z.object({ type: z.literal("CLIPBOARD_LEASE_REQUEST"), version: z.literal(IPC_VERSION), profileId: idSchema, requestId: idSchema, value: z.string().min(1).max(512) }),
  z.object({ type: z.literal("CLIPBOARD_LEASE_RELEASE"), version: z.literal(IPC_VERSION), profileId: idSchema, requestId: idSchema }),
  z.object({ type: z.literal("NETWORK_USAGE"), version: z.literal(IPC_VERSION), profileId: idSchema, runId: idSchema, runSessionId: idSchema, usage: networkUsageCounterSchema }),
  z.object({ type: z.literal("PAYMENT_HANDOFF"), version: z.literal(IPC_VERSION), profileId: idSchema, runId: idSchema, runSessionId: idSchema, phase: z.enum(["DETECTED", "RETURNED"]), category: z.literal("PSD2_3DS") }),
  z.object({ type: z.literal("HEALTH"), version: z.literal(IPC_VERSION), profileId: idSchema, health: browserHealthSnapshotSchema.omit({ id: true, subjectKind: true, subjectId: true, runId: true }) })
]);
export type RunnerEvent = z.infer<typeof runnerEventSchema>;

export const monitorCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("START_MONITOR"), version: z.literal(IPC_VERSION), runId: idSchema, target: targetSnapshotSchema, policy: monitorPolicySchema, routes: z.array(monitorRouteSchema).max(20) }),
  z.object({ type: z.literal("TEST_TARGET"), version: z.literal(IPC_VERSION), target: targetSnapshotSchema, policy: monitorPolicySchema, routes: z.array(monitorRouteSchema).max(20) }),
  z.object({ type: z.literal("SET_MONITOR_TURBO"), version: z.literal(IPC_VERSION), enabled: z.boolean() }),
  z.object({ type: z.literal("PAUSE_MONITOR"), version: z.literal(IPC_VERSION), until: timestampSchema }),
  z.object({ type: z.literal("RESUME_MONITOR"), version: z.literal(IPC_VERSION) }),
  z.object({ type: z.literal("STOP_MONITOR"), version: z.literal(IPC_VERSION) })
]);
export type MonitorCommand = z.infer<typeof monitorCommandSchema>;
export const monitorEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MONITOR_EVENT"), version: z.literal(IPC_VERSION), runId: idSchema.nullable(), eventType: z.string().min(1).max(80), check: targetCheckSchema.nullable() }),
  z.object({ type: z.literal("MONITOR_TEST_RESULT"), version: z.literal(IPC_VERSION), check: targetCheckSchema }),
  z.object({ type: z.literal("MONITOR_HEALTH"), version: z.literal(IPC_VERSION), runId: idSchema.nullable(), health: browserHealthSnapshotSchema.omit({ id: true, subjectKind: true, subjectId: true, runId: true }) }),
  z.object({ type: z.literal("MONITOR_RUNTIME"), version: z.literal(IPC_VERSION), status: monitorRuntimeStatusSchema }),
  z.object({ type: z.literal("MONITOR_USAGE"), version: z.literal(IPC_VERSION), runId: idSchema, routeId: z.string().min(1).max(120), usage: networkUsageCounterSchema }),
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
export const healthIpc = { get: "health:get", changed: "health:changed" } as const;
export const warmingIpc = { list: "warming:list", start: "warming:start", update: "warming:update", openDestination: "warming:open-destination", complete: "warming:complete", changed: "warming:changed" } as const;
export const proxyIpc = { list: "proxies:list", create: "proxies:create", update: "proxies:update", remove: "proxies:remove", test: "proxies:test", benchmarks: "proxies:benchmarks" } as const;
export const shippingIpc = { list: "shipping:list", create: "shipping:create", update: "shipping:update", remove: "shipping:remove", changed: "shipping:changed" } as const;
export const storeIpc = { list: "stores:list", update: "stores:update", changed: "stores:changed" } as const;
export const settingsIpc = { getNetworkProbe: "settings:get-network-probe", updateNetworkProbe: "settings:update-network-probe", getMonitor: "settings:get-monitor", updateMonitor: "settings:update-monitor", appInfo: "settings:app-info" } as const;
export const monitorIpc = { status: "monitor:status", setTurbo: "monitor:set-turbo", changed: "monitor:changed" } as const;
export const usageIpc = { run: "usage:run", totals: "usage:totals" } as const;
export type AppInfo = { version: string; electronVersion: string; chromeVersion: string | null; osVersion: string };
export const sessionIpc = { list: "sessions:list", open: "sessions:open", close: "sessions:close", restart: "sessions:restart", openAll: "sessions:open-all", closeAll: "sessions:close-all", checkCart: "sessions:check-cart", emptyCart: "sessions:empty-cart", emptyCarts: "sessions:empty-carts", carts: "sessions:carts", cartChanged: "sessions:cart-changed", changed: "sessions:changed" } as const;
export const runIpc = { list: "runs:list", get: "runs:get", start: "runs:start", end: "runs:end", resume: "runs:resume", remove: "runs:remove", changed: "runs:changed" } as const;
export const runSetupIpc = { list: "run-setups:list", create: "run-setups:create", remove: "run-setups:remove", changed: "run-setups:changed" } as const;
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };
export function defaultRoute(): SessionRoute { return { kind: "direct", verification: { status: "PENDING", publicIp: null, country: null, city: null, verifiedAt: null, message: null } }; }
