import { z } from "zod";
import { STORE_GENERAL, discoverySourceDescriptorSchema, discoverySourceSchema, storeCurrencySchema } from "./stores";
import { estimateCostMicrosUsd } from "./costs";
import { captchaProviderSnapshotSchema, captchaStrategyOverrideSchema, captchaStrategySchema, runCaptchaOverrideSchema, targetCaptchaStrategySchema } from "./captcha";

export * from "./stores";
export * from "./costs";
export * from "./captcha";

export const IPC_VERSION = 21 as const;
export const SCHEMA_VERSION = 20 as const;
export const DEFAULT_NETWORK_PROBE_URL = "https://ipwho.is/";

const idSchema = z.string().uuid();
const timestampSchema = z.number().int().nonnegative();
const jsonRecordSchema = z.record(z.string(), z.unknown());
export const storeIdSchema = z.string().trim().min(1).max(64);
export type StoreId = z.infer<typeof storeIdSchema>;

const priorityListSchema = z.array(z.string().trim().min(1).max(120)).max(40);
const directProductUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "eu.supreme.com" && url.pathname.startsWith("/products/");
}, "Direct product URLs must be an HTTPS eu.supreme.com product page.");
export const targetCurrencySchema = storeCurrencySchema;
export const checkoutModeSchema = z.enum(["ASSISTED", "FULL_AUTO"]);
export type CheckoutMode = z.infer<typeof checkoutModeSchema>;
export const checkoutModeOverrideSchema = z.enum(["INHERIT_TARGET", "ASSISTED", "FULL_AUTO"]);
export type CheckoutModeOverride = z.infer<typeof checkoutModeOverrideSchema>;
export const maxCheckoutsSchema = z.union([z.literal("UNLIMITED"), z.number().int().min(1).max(20)]);
export type MaxCheckouts = z.infer<typeof maxCheckoutsSchema>;
export const targetSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(120), storeId: storeIdSchema, productKeywords: priorityListSchema.min(1), negativeKeywords: priorityListSchema,
  directProductUrl: directProductUrlSchema.nullable().default(null), preferredColors: priorityListSchema, sizePriority: priorityListSchema, currency: targetCurrencySchema, maxRetailMinor: z.number().int().min(0), quantity: z.literal(1).default(1), checkoutMode: checkoutModeSchema.default("ASSISTED"), maxCheckouts: maxCheckoutsSchema.default("UNLIMITED"), captchaStrategy: targetCaptchaStrategySchema.default("INHERIT_APP"), enabled: z.boolean(),
  latestCheck: z.lazy(() => targetCheckSchema).nullable(), createdAt: timestampSchema, updatedAt: timestampSchema
});
export type Target = z.infer<typeof targetSchema>;
export const createTargetSchema = z.object({ name: z.string().trim().min(1).max(120), storeId: storeIdSchema.default(STORE_GENERAL), productKeywords: priorityListSchema.min(1), negativeKeywords: priorityListSchema.default([]), directProductUrl: directProductUrlSchema.nullable().optional().default(null), preferredColors: priorityListSchema.default([]), sizePriority: priorityListSchema.default([]), currency: targetCurrencySchema.default("EUR"), maxRetailMinor: z.coerce.number().int().min(0), quantity: z.literal(1).default(1), checkoutMode: checkoutModeSchema.default("ASSISTED"), maxCheckouts: maxCheckoutsSchema.default("UNLIMITED"), captchaStrategy: targetCaptchaStrategySchema.default("INHERIT_APP"), enabled: z.boolean().default(true) });
export type CreateTargetInput = z.input<typeof createTargetSchema>;
export const updateTargetSchema = createTargetSchema.partial().refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
export type UpdateTargetInput = z.input<typeof updateTargetSchema>;
export const productVariantSchema = z.object({ id: z.string().regex(/^\d{1,32}$/, "Variant IDs must be decimal strings."), color: z.string().min(1).max(120), size: z.string().min(1).max(80), available: z.boolean() });
export type ProductVariant = z.infer<typeof productVariantSchema>;
export const productCandidateSchema = z.object({ name: z.string().min(1).max(300), url: z.string().url(), imageUrl: z.string().url().nullable().default(null), priceMinor: z.number().int().min(0).nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(), variants: z.array(productVariantSchema), listingOrder: z.number().int().min(0) });
export type ProductCandidate = z.infer<typeof productCandidateSchema>;
export const targetDecisionSchema = z.object({ kind: z.enum(["NO_MATCH", "MATCHED", "VARIANT_SELECTED", "PRICE_LIMIT_EXCEEDED", "CURRENCY_MISMATCH", "NO_ACCEPTABLE_VARIANT", "ERROR"]), message: z.string().max(500), candidate: productCandidateSchema.nullable(), selectedVariant: productVariantSchema.nullable() });
export type TargetDecision = z.infer<typeof targetDecisionSchema>;
export const monitorFailureCodeSchema = z.enum(["PROXY_TRANSPORT_FAILED", "PROXY_AUTH_FAILED", "STOREFRONT_PROTECTION", "STOREFRONT_SERVICE_UNAVAILABLE", "NO_HEALTHY_ROUTES", "BUDGET_CAPPED", "MONITOR_ENDPOINT_UNSUPPORTED", "INVALID_MONITOR_POLICY", "MONITOR_RESPONSE_TOO_LARGE", "MONITOR_CONNECTION_FAILED", "UNKNOWN"]);
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
export const proxySecretRevealSchema = z.object({
  kind: z.literal("PROXY"), token: idSchema, expiresAt: timestampSchema, proxyProfileId: idSchema, name: z.string().min(1).max(80),
  protocol: proxyProtocolSchema, host: z.string().min(1).max(253), port: z.number().int().min(1).max(65_535), username: z.string().max(512).nullable(), password: z.string().max(512).nullable(), url: z.string().max(2_048)
});
export type ProxySecretReveal = z.infer<typeof proxySecretRevealSchema>;
export const shippingSecretRevealSchema = z.object({
  kind: z.literal("SHIPPING"), token: idSchema, expiresAt: timestampSchema, shippingProfileId: idSchema, name: z.string().min(1).max(80), details: shippingDetailsSchema
});
export type ShippingSecretReveal = z.infer<typeof shippingSecretRevealSchema>;
export const secretCopyFieldSchema = z.enum(["proxy-url", "proxy-server", "proxy-username", "proxy-password", "shipping-full-name", "shipping-email", "shipping-phone", "shipping-address-1", "shipping-address-2", "shipping-postal-code", "shipping-city", "shipping-region", "shipping-country"]);
export type SecretCopyField = z.infer<typeof secretCopyFieldSchema>;
export const createShippingProfileSchema = z.object({ name: z.string().trim().min(1).max(80), details: shippingDetailsSchema, enabled: z.boolean().default(true) });
export type CreateShippingProfileInput = z.input<typeof createShippingProfileSchema>;
export const updateShippingProfileSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), details: shippingDetailsSchema.nullable().optional(), enabled: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
export type UpdateShippingProfileInput = z.input<typeof updateShippingProfileSchema>;
export const shippingProfileSnapshotSchema = z.object({ shippingProfileId: idSchema.nullable(), name: z.string().nullable(), country: z.string().regex(/^[A-Z]{2}$/).nullable(), complete: z.boolean() });
export type ShippingProfileSnapshot = z.infer<typeof shippingProfileSnapshotSchema>;

export const paymentProfileKindSchema = z.enum(["CARD", "VCC", "GATEWAY_TOKEN"]);
export type PaymentProfileKind = z.infer<typeof paymentProfileKindSchema>;
export const paymentBillingDetailsSchema = shippingDetailsSchema.pick({ fullName: true, address1: true, address2: true, postalCode: true, city: true, region: true, country: true });
export type PaymentBillingDetails = z.infer<typeof paymentBillingDetailsSchema>;
export const paymentCardSecretSchema = z.object({
  version: z.literal(1), kind: z.enum(["CARD", "VCC"]), pan: z.string().regex(/^\d{12,19}$/), expiryMonth: z.number().int().min(1).max(12), expiryYear: z.number().int().min(2020).max(2200),
  cvv: z.string().regex(/^\d{3,4}$/), cardholderName: z.string().trim().min(1).max(160), billing: paymentBillingDetailsSchema.nullable().default(null),
});
export type PaymentCardSecret = z.infer<typeof paymentCardSecretSchema>;
export const paymentProfileSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(80), kind: paymentProfileKindSchema, brand: z.string().max(32).nullable(), last4: z.string().regex(/^\d{4}$/).nullable(),
  expiryMonth: z.number().int().min(1).max(12).nullable(), expiryYear: z.number().int().min(2020).max(2200).nullable(), tags: z.array(z.string().min(1).max(40)).max(12), configured: z.boolean(), createdAt: timestampSchema, updatedAt: timestampSchema,
});
export type PaymentProfile = z.infer<typeof paymentProfileSchema>;
const paymentProfileBaseInputSchema = z.object({ name: z.string().trim().min(1).max(80), kind: z.enum(["CARD", "VCC"]), cardNumber: z.string().transform((value) => value.replace(/[\s-]/g, "")), expiryMonth: z.coerce.number().int().min(1).max(12), expiryYear: z.coerce.number().int().min(new Date().getUTCFullYear()).max(2200), cvv: z.string().trim().regex(/^\d{3,4}$/), cardholderName: z.string().trim().min(1).max(160), tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]), billing: paymentBillingDetailsSchema.nullable().optional().default(null) });
export const createPaymentProfileSchema = paymentProfileBaseInputSchema.superRefine((value, context) => { if (!luhnValid(value.cardNumber)) context.addIssue({ code: z.ZodIssueCode.custom, message: "The card number failed its checksum.", path: ["cardNumber"] }); });
export type CreatePaymentProfileInput = z.input<typeof createPaymentProfileSchema>;
export const updatePaymentProfileSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(), replacement: paymentProfileBaseInputSchema.omit({ name: true, tags: true }).optional() }).refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
export type UpdatePaymentProfileInput = z.input<typeof updatePaymentProfileSchema>;
export const paymentProfileSnapshotSchema = z.object({ paymentProfileId: idSchema.nullable(), label: z.string().max(120).nullable(), kind: paymentProfileKindSchema.nullable(), configured: z.boolean(), path: z.enum(["PAYMENT_PROFILE", "SHOP_PAY", "NONE"]).default("NONE") });
export type PaymentProfileSnapshot = z.infer<typeof paymentProfileSnapshotSchema>;
export function luhnValid(value: string): boolean { const digits = value.replace(/[\s-]/g, ""); if (!/^\d{12,19}$/.test(digits)) return false; let sum = 0; let double = false; for (let index = digits.length - 1; index >= 0; index -= 1) { let digit = Number(digits[index]); if (double) { digit *= 2; if (digit > 9) digit -= 9; } sum += digit; double = !double; } return sum % 10 === 0; }
export function cardBrand(pan: string): string { if (/^4/.test(pan)) return "Visa"; if (/^(5[1-5]|2[2-7])/.test(pan)) return "Mastercard"; if (/^3[47]/.test(pan)) return "American Express"; return "Card"; }

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
export const browserProfileSchema = z.object({ id: idSchema, name: z.string().trim().min(1).max(80), userDataDir: z.string().min(1), proxyProfileId: idSchema.nullable(), shippingProfileId: idSchema.nullable(), paymentProfileId: idSchema.nullable().default(null), checkoutModeOverride: checkoutModeOverrideSchema.default("INHERIT_TARGET"), captchaStrategyOverride: captchaStrategyOverrideSchema.default("INHERIT_TARGET"), driver: browserDriverConfigSchema.default({ kind: "NATIVE_STEALTH" }), enabled: z.boolean(), createdAt: timestampSchema, updatedAt: timestampSchema });
export type BrowserProfile = z.infer<typeof browserProfileSchema>;
export const createBrowserProfileSchema = z.object({ name: z.string().trim().min(1, "A profile name is required.").max(80), driver: browserDriverInputSchema.default({ kind: "NATIVE_STEALTH" }), checkoutModeOverride: checkoutModeOverrideSchema.default("INHERIT_TARGET"), captchaStrategyOverride: captchaStrategyOverrideSchema.default("INHERIT_TARGET"), enabled: z.boolean().default(true) });
export type CreateBrowserProfileInput = z.input<typeof createBrowserProfileSchema>;
export const updateBrowserProfileSchema = z.object({ name: z.string().trim().min(1, "A profile name is required.").max(80).optional(), enabled: z.boolean().optional(), driver: browserDriverInputSchema.optional(), proxyProfileId: idSchema.nullable().optional(), shippingProfileId: idSchema.nullable().optional(), paymentProfileId: idSchema.nullable().optional(), checkoutModeOverride: checkoutModeOverrideSchema.optional(), captchaStrategyOverride: captchaStrategyOverrideSchema.optional() }).refine((value) => Object.keys(value).length > 0, { message: "Provide at least one field to update." });
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
export const sessionErrorCodeSchema = z.enum(["BROWSER_START_FAILED", "PROXY_CONNECTION_FAILED", "PROXY_AUTH_FAILED", "SECRET_STORAGE_UNAVAILABLE", "INVALID_DRIVER_ENDPOINT", "EXTERNAL_CDP_CONNECTION_FAILED", "DRIVER_CAPABILITY_UNAVAILABLE", "STEALTH_VERIFICATION_FAILED", "RUNNER_CRASHED", "RUN_INTERRUPTED", "INVALID_COMMAND", "RECORDING_FAILED", "NAVIGATION_TIMEOUT", "STORE_UNAVAILABLE", "VARIANT_NOT_AVAILABLE", "ATC_FAILED", "CHECKOUT_NAV_FAILED", "CHECKPOINT_DETECTED", "CAPTCHA_SOLVER_FAILED", "PAYMENT_PROFILE_UNAVAILABLE", "PAYMENT_FORM_UNSUPPORTED", "PAYMENT_SUBMISSION_FAILED", "PAYMENT_RESULT_AMBIGUOUS", "CHECKOUT_LIMIT_REACHED", "UNKNOWN"]);
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
export const monitorRuntimeStateSchema = z.enum(["STANDBY", "TURBO", "SERVICE_COOLDOWN", "POOL_EXHAUSTED", "BUDGET_CAPPED", "STOPPED"]);
export type MonitorRuntimeState = z.infer<typeof monitorRuntimeStateSchema>;
export const discoverySourceHealthSchema = z.object({
  source: discoverySourceSchema, routeId: z.string().min(1).max(120),
  status: z.enum(["AVAILABLE", "BACKING_OFF", "UNAVAILABLE"]), lastStatusClass: z.number().int().min(1).max(5).nullable(),
  lastLatencyMs: z.number().nonnegative().nullable(), backoffUntil: timestampSchema.nullable(), reasonCode: z.string().max(80).nullable(),
  responseBytes: z.number().int().nonnegative().default(0), candidateCount: z.number().int().nonnegative().default(0),
});
export type DiscoverySourceHealth = z.infer<typeof discoverySourceHealthSchema>;
export const discoverySnapshotSchema = z.object({
  descriptorVersion: z.literal(1), mode: z.enum(["DIRECT", "MESH"]), sources: z.array(discoverySourceDescriptorSchema),
  sitemapStandbyIntervalMs: z.literal(30_000), sitemapTurboIntervalMs: z.literal(5_000),
  routeAllocation: z.record(discoverySourceSchema, z.string().max(120)), sourceHealth: z.array(discoverySourceHealthSchema),
});
export type DiscoverySnapshot = z.infer<typeof discoverySnapshotSchema>;
export const monitorRuntimeStatusSchema = z.object({
  runId: idSchema.nullable(), storeId: storeIdSchema.nullable(), state: monitorRuntimeStateSchema,
  activeIntervalMs: z.number().int().min(200).nullable(), fastEndsAt: timestampSchema.nullable(), nextPollAt: timestampSchema.nullable(),
  configuredRouteCount: z.number().int().nonnegative(), healthyRouteCount: z.number().int().nonnegative(),
  lastErrorCode: monitorFailureCodeSchema.nullable(), sources: z.array(discoverySourceHealthSchema).default([]), updatedAt: timestampSchema,
});
export type MonitorRuntimeStatus = z.infer<typeof monitorRuntimeStatusSchema>;
export function defaultMonitorSettings(proxyProfileIds: string[] = []): MonitorSettings {
  return { proxyProfileIds, defaults: { ...DEFAULT_MONITOR_BEHAVIOR }, stores: {} };
}
export function resolveMonitorBehavior(settings: MonitorSettings, storeId: string): MonitorBehavior {
  return monitorBehaviorSchema.parse({ ...settings.defaults, ...(settings.stores[storeId] ?? {}) });
}

/* Appearance. A theme is four numbers on top of a built-in palette: every
   override is nullable, so "unset" keeps following the shipped token rather
   than freezing today's hex into the database. */
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour.");
export const themeModeSchema = z.enum(["dark", "light", "system"]);
export type ThemeMode = z.infer<typeof themeModeSchema>;
export const resolvedThemeSchema = z.enum(["dark", "light"]);
export type ResolvedTheme = z.infer<typeof resolvedThemeSchema>;
export const themeOverridesSchema = z.object({
  accent: hexColorSchema.nullable(),
  background: hexColorSchema.nullable(),
  foreground: hexColorSchema.nullable(),
  contrast: z.number().min(0.7).max(1.4).nullable(),
});
export type ThemeOverrides = z.infer<typeof themeOverridesSchema>;
/* Density is spacing only — control heights, row heights, padding. The type
   scale is deliberately not part of it: section 33.3 caps type at 17px on a
   13px base, and a console that lets the operator grow the text past that
   stops being the interface the layouts were designed against. */
export const densitySchema = z.enum(["comfortable", "compact"]);
export type Density = z.infer<typeof densitySchema>;
export const appearanceSettingsSchema = z.object({
  mode: themeModeSchema,
  /* Keyed by the resolved theme, not by mode: System borrows whichever of the
     two is active, so customising under System edits the one on screen. */
  themes: z.object({ dark: themeOverridesSchema, light: themeOverridesSchema }),
  /* Defaulted, not required: a row written before density existed must still
     parse, or adding a field would silently reset the operator's theme. */
  density: densitySchema.default("comfortable"),
});
export type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>;
export const chromeColorsSchema = z.object({ backgroundColor: hexColorSchema, symbolColor: hexColorSchema });
export type ChromeColors = z.infer<typeof chromeColorsSchema>;
export function defaultThemeOverrides(): ThemeOverrides { return { accent: null, background: null, foreground: null, contrast: null }; }
export function defaultAppearanceSettings(): AppearanceSettings {
  return { mode: "dark", themes: { dark: defaultThemeOverrides(), light: defaultThemeOverrides() }, density: "comfortable" };
}

/* Window placement. Position is nullable because a first launch has none and a
   saved one can point at a display that is no longer attached; size is always
   the restore size, never the maximised frame. */
export const WINDOW_MIN_WIDTH = 960;
export const WINDOW_MIN_HEIGHT = 650;
export const WINDOW_DEFAULT_WIDTH = 1240;
export const WINDOW_DEFAULT_HEIGHT = 860;
export const windowBoundsSchema = z.object({
  x: z.number().int().nullable(),
  y: z.number().int().nullable(),
  width: z.number().int().min(WINDOW_MIN_WIDTH),
  height: z.number().int().min(WINDOW_MIN_HEIGHT),
  maximized: z.boolean(),
});
export type WindowBounds = z.infer<typeof windowBoundsSchema>;

export const networkUsageCompletenessSchema = z.enum(["EXACT", "PARTIAL", "UNSUPPORTED"]);
export type NetworkUsageCompleteness = z.infer<typeof networkUsageCompletenessSchema>;
export const networkUsageSourceSchema = z.enum(["MONITOR", "BROWSER"]);
export type NetworkUsageSource = z.infer<typeof networkUsageSourceSchema>;
export const networkUsageCounterSchema = z.object({ receivedBytes: z.number().int().nonnegative(), sentBytes: z.number().int().nonnegative(), requestCount: z.number().int().nonnegative(), completeness: networkUsageCompletenessSchema });
export type NetworkUsageCounter = z.infer<typeof networkUsageCounterSchema>;
export const runNetworkUsageSchema = networkUsageCounterSchema.extend({
  id: idSchema, runId: idSchema, usageKey: z.string().min(1).max(160), source: networkUsageSourceSchema,
  runSessionId: idSchema.nullable(), storeId: storeIdSchema.nullable(), proxyProfileId: idSchema.nullable(), proxyName: z.string().max(80).nullable(),
  discoverySource: discoverySourceSchema.nullable().default(null), costPerGbMicrosUsd: costPerGbMicrosUsdSchema, estimatedCostMicrosUsd: z.number().int().nonnegative().nullable(), updatedAt: timestampSchema,
});
export type RunNetworkUsage = z.infer<typeof runNetworkUsageSchema>;
export const networkUsageTotalsSchema = networkUsageCounterSchema.extend({ estimatedCostMicrosUsd: z.number().int().nonnegative().nullable() });
export type NetworkUsageTotals = z.infer<typeof networkUsageTotalsSchema>;
export function estimateProxyCostMicrosUsd(receivedBytes: number, sentBytes: number, costPerGbMicrosUsd: number | null): number | null {
  return estimateCostMicrosUsd(receivedBytes, sentBytes, costPerGbMicrosUsd);
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
export const runExecutionModeSchema = z.enum(["OBSERVATION", "CHECKOUT"]);
export type RunExecutionMode = z.infer<typeof runExecutionModeSchema>;
export const purchaseModeSchema = z.enum(["DRY_RUN", "LIVE"]);
export type PurchaseMode = z.infer<typeof purchaseModeSchema>;
export const runExecutionStateSchema = z.enum(["OBSERVING", "WAITING_FOR_TARGET", "PRODUCT_OPEN", "VARIANT_SELECTED", "CARTING", "CARTED", "CHECKOUT", "CAPTCHA_SOLVING", "CHECKPOINT", "CHECKOUT_HANDOFF", "READY_TO_CONFIRM", "READY_TO_SUBMIT", "SUBMITTING", "SUBMITTED", "CHECKOUT_LIMIT_REACHED", "SUCCESS", "FAILED", "ENDED"]);
export type RunExecutionState = z.infer<typeof runExecutionStateSchema>;
export const runStatusSchema = z.enum(["STARTING", "RECORDING", "COMPLETED", "FAILED"]);
export type RunStatus = z.infer<typeof runStatusSchema>;
export const runSessionStatusSchema = z.enum(["STARTING", "RECORDING", "ENDED", "FAILED"]);
export type RunSessionStatus = z.infer<typeof runSessionStatusSchema>;
export const runArtifactKindSchema = z.enum(["SCREENSHOT", "TRACE", "HAR", "VIDEO", "MANIFEST"]);
export type RunArtifactKind = z.infer<typeof runArtifactKindSchema>;
export const runEnvironmentSchema = z.object({ appVersion: z.string(), schemaVersion: z.number().int(), osVersion: z.string(), chromeVersion: z.string().nullable(), playwrightVersion: z.string(), capturedAt: timestampSchema });
export type RunEnvironment = z.infer<typeof runEnvironmentSchema>;
export const runSchema = z.object({ id: idSchema, name: z.string().min(1).max(120), diagnosticLevel: diagnosticLevelSchema, executionMode: runExecutionModeSchema.default("OBSERVATION"), purchaseMode: z.union([purchaseModeSchema, z.literal("LEGACY_MANUAL")]).default("LEGACY_MANUAL"), maxCheckouts: maxCheckoutsSchema.default("UNLIMITED"), status: runStatusSchema, startedAt: timestampSchema, endedAt: timestampSchema.nullable(), environment: runEnvironmentSchema, targetSnapshot: targetSnapshotSchema.nullable(), discoverySnapshot: discoverySnapshotSchema.nullable().default(null), createdAt: timestampSchema, updatedAt: timestampSchema });
export type Run = z.infer<typeof runSchema>;
export const runSessionSchema = z.object({ id: idSchema, runId: idSchema, browserProfileId: idSchema, browserProfileName: z.string(), route: sessionRouteSchema, shippingProfile: shippingProfileSnapshotSchema.default({ shippingProfileId: null, name: null, country: null, complete: false }), paymentProfile: paymentProfileSnapshotSchema.default({ paymentProfileId: null, label: null, kind: null, configured: false, path: "NONE" }), checkoutMode: checkoutModeSchema.default("ASSISTED"), captchaStrategy: captchaStrategySchema.default("MANUAL_HARVESTER"), captchaProvider: captchaProviderSnapshotSchema.default(null), assistedEligible: z.boolean().default(false), executionState: runExecutionStateSchema.default("OBSERVING"), checkpointReason: z.string().nullable().default(null), quotaOutcome: z.enum(["NONE", "RESERVED", "BYPASSED", "SUBMITTED", "RELEASED", "LIMIT_REACHED", "SUCCEEDED", "AMBIGUOUS"]).default("NONE"), orderIndex: z.number().int().min(1).nullable().default(null), status: runSessionStatusSchema, startedAt: timestampSchema, endedAt: timestampSchema.nullable(), finalError: sessionErrorSchema.nullable() });
export type RunSession = z.infer<typeof runSessionSchema>;
export const runEventSchema = z.object({ id: idSchema, runId: idSchema, runSessionId: idSchema.nullable(), wallTimeMs: timestampSchema, elapsedNs: z.string().regex(/^\d+$/), type: z.string().min(1).max(80), stateBefore: z.string().nullable(), stateAfter: z.string().nullable(), payload: jsonRecordSchema });
export type RunEvent = z.infer<typeof runEventSchema>;
export const runArtifactSchema = z.object({ id: idSchema, runId: idSchema, runSessionId: idSchema, kind: runArtifactKindSchema, relativePath: z.string().min(1).max(512), sensitive: z.boolean(), createdAt: timestampSchema });
export type RunArtifact = z.infer<typeof runArtifactSchema>;
export const runDetailSchema = z.object({ run: runSchema, sessions: z.array(runSessionSchema), events: z.array(runEventSchema), artifacts: z.array(runArtifactSchema) });
export type RunDetail = z.infer<typeof runDetailSchema>;

export const failureCategorySchema = z.enum(["NETWORK_PROXY", "STOREFRONT_PROTECTION", "PRODUCT_VARIANT", "CART", "CHECKOUT", "CAPTCHA", "PAYMENT_HANDOFF", "BROWSER_RUNNER", "USER_ABORTED", "UNKNOWN"]);
export type FailureCategory = z.infer<typeof failureCategorySchema>;
export const observedOutcomeSchema = z.enum(["SUCCESS", "CHECKOUT_LIMIT_REACHED", "PAYMENT_RESULT_AMBIGUOUS", "READY_TO_SUBMIT", "READY_TO_CONFIRM", "FAILED", "ENDED_WITHOUT_READY", "OBSERVATION_ONLY"]);
export const manualOutcomeSchema = z.enum(["ORDER_CONFIRMED", "ORDER_NOT_CONFIRMED", "UNKNOWN"]);
export type ManualOutcome = z.infer<typeof manualOutcomeSchema>;
const nullableMetric = z.number().nonnegative().nullable();
export const sessionMetricsSchema = z.object({
  derivationVersion: z.literal(1), runId: idSchema, runSessionId: idSchema, browserProfileId: idSchema, browserProfileName: z.string(),
  proxyProfileId: idSchema.nullable(), proxyName: z.string().nullable(), observedOutcome: observedOutcomeSchema,
  detectToCartMs: nullableMetric, cartToCheckoutMs: nullableMetric, human3dsDurationMs: nullableMetric, checkpointDurationMs: nullableMetric,
  checkpointCount: z.number().int().nonnegative(), turnstileCount: z.number().int().nonnegative(), captchaChallengeCount: z.number().int().nonnegative(),
  networkErrorCount: z.number().int().nonnegative(), http4xxCount: z.number().int().nonnegative(), http5xxCount: z.number().int().nonnegative(),
  failureCategory: failureCategorySchema.nullable(), incompleteCheckpoint: z.boolean(), incomplete3ds: z.boolean(), anomalies: z.array(z.string()),
  checkoutMode: z.string().nullable(), captchaStrategy: z.string().nullable(), captchaSolveDurationMs: nullableMetric,
  readyToSubmitToDispatchMs: nullableMetric, paymentSubmissionToResultMs: nullableMetric, orderIndex: z.number().int().min(1).nullable(), quotaOutcome: z.string(),
  captchaSolveCostMicrosUsd: z.number().int().nonnegative().nullable(), captchaFailoverCount: z.number().int().nonnegative(),
});
export type SessionMetrics = z.infer<typeof sessionMetricsSchema>;
export const runMetricsSchema = z.object({
  derivationVersion: z.literal(1), runId: idSchema, monitorToDetectMs: nullableMetric, totalDurationMs: nullableMetric,
  discoveryWinner: discoverySourceSchema.nullable(), discoverySourceTimings: z.record(discoverySourceSchema, nullableMetric), anomalies: z.array(z.string()),
});
export type RunMetrics = z.infer<typeof runMetricsSchema>;
export const runAnnotationSchema = z.object({
  id: idSchema, runId: idSchema, runSessionId: idSchema.nullable(), kind: z.enum(["NOTE", "FAILURE_CLASSIFICATION", "MANUAL_OUTCOME"]),
  text: z.string().trim().max(2_000).nullable(), failureCategory: failureCategorySchema.nullable(), manualOutcome: manualOutcomeSchema.nullable(),
  createdAt: timestampSchema, updatedAt: timestampSchema,
});
export type RunAnnotation = z.infer<typeof runAnnotationSchema>;
export const createRunAnnotationSchema = runAnnotationSchema.omit({ id: true, createdAt: true, updatedAt: true }).superRefine((value, context) => {
  if (value.kind === "NOTE" && !value.text) context.addIssue({ code: z.ZodIssueCode.custom, message: "A note is required." });
  if (value.kind === "FAILURE_CLASSIFICATION" && !value.failureCategory) context.addIssue({ code: z.ZodIssueCode.custom, message: "A failure category is required." });
  if (value.kind === "MANUAL_OUTCOME" && !value.manualOutcome) context.addIssue({ code: z.ZodIssueCode.custom, message: "A manual outcome is required." });
});
export type CreateRunAnnotationInput = z.input<typeof createRunAnnotationSchema>;
export const analyticsFilterSchema = z.object({ targetId: idSchema.nullable().default(null), storeId: storeIdSchema.nullable().default(null), profileId: idSchema.nullable().default(null), proxyProfileId: idSchema.nullable().default(null), appVersions: z.array(z.string()).default([]), range: z.enum(["LAST_20", "7_DAYS", "30_DAYS", "90_DAYS", "ALL"]).default("LAST_20") });
export type AnalyticsFilter = z.infer<typeof analyticsFilterSchema>;
export const analyticsRateSchema = z.object({ numerator: z.number().int().nonnegative(), denominator: z.number().int().nonnegative(), rate: z.number().min(0).max(1).nullable() });
export const reliabilityRowSchema = z.object({ id: z.string(), name: z.string(), attempts: z.number().int().nonnegative(), readyRate: analyticsRateSchema, failureRate: analyticsRateSchema, checkpointRate: analyticsRateSchema, turnstileRate: analyticsRateSchema, medianDetectToCartMs: nullableMetric, p95DetectToCartMs: nullableMetric });
export type ReliabilityRow = z.infer<typeof reliabilityRowSchema>;
export const analyticsResultSchema = z.object({ runs: z.array(runSchema), runMetrics: z.array(runMetricsSchema), sessionMetrics: z.array(sessionMetricsSchema), profiles: z.array(reliabilityRowSchema), proxies: z.array(reliabilityRowSchema), annotations: z.array(runAnnotationSchema) });
export type AnalyticsResult = z.infer<typeof analyticsResultSchema>;
export const runSessionOverrideSchema = z.object({ browserProfileId: idSchema, checkoutMode: checkoutModeOverrideSchema.default("INHERIT_TARGET"), captchaStrategy: captchaStrategyOverrideSchema.default("INHERIT_TARGET"), paymentProfileId: idSchema.nullable().optional() });
export type RunSessionOverride = z.infer<typeof runSessionOverrideSchema>;
export const createRunSchema = z.object({ name: z.string().trim().min(1).max(120), diagnosticLevel: diagnosticLevelSchema, executionMode: runExecutionModeSchema.default("OBSERVATION"), purchaseMode: purchaseModeSchema.default("DRY_RUN"), profileIds: z.array(idSchema).min(1).max(20).refine((ids) => new Set(ids).size === ids.length, "Each profile may only be selected once."), sessionOverrides: z.array(runSessionOverrideSchema).max(20).default([]), captchaOverrides: z.array(runCaptchaOverrideSchema).max(20).default([]), targetId: idSchema.nullable().default(null), deepDebugAcknowledged: z.boolean().default(false), fullAutoAcknowledged: z.boolean().default(false) }).superRefine((value, context) => {
  if (value.diagnosticLevel === "DEEP_DEBUG" && !value.deepDebugAcknowledged) context.addIssue({ code: z.ZodIssueCode.custom, message: "Deep Debug requires acknowledgement because HAR and video can contain sensitive browser state.", path: ["deepDebugAcknowledged"] });
  if (value.executionMode === "CHECKOUT" && !value.targetId) context.addIssue({ code: z.ZodIssueCode.custom, message: "Checkout requires a target.", path: ["targetId"] });
  const overrideIds = value.captchaOverrides.map((entry) => entry.browserProfileId);
  if (new Set(overrideIds).size !== overrideIds.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Each profile may only have one CAPTCHA override.", path: ["captchaOverrides"] });
  for (const [index, entry] of value.captchaOverrides.entries()) if (!value.profileIds.includes(entry.browserProfileId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "CAPTCHA overrides must belong to a selected profile.", path: ["captchaOverrides", index, "browserProfileId"] });
  const sessionOverrideIds = value.sessionOverrides.map((entry) => entry.browserProfileId);
  if (new Set(sessionOverrideIds).size !== sessionOverrideIds.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Each profile may only have one session override.", path: ["sessionOverrides"] });
  for (const [index, entry] of value.sessionOverrides.entries()) if (!value.profileIds.includes(entry.browserProfileId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Session overrides must belong to a selected profile.", path: ["sessionOverrides", index, "browserProfileId"] });
});
export type CreateRunInput = z.input<typeof createRunSchema>;
export const runSetupSchema = z.object({ id: idSchema, name: z.string().trim().min(1).max(120), diagnosticLevel: diagnosticLevelSchema, executionMode: runExecutionModeSchema, profileIds: z.array(idSchema).min(1).max(20).refine((ids) => new Set(ids).size === ids.length, "Each profile may only be selected once."), sessionOverrides: z.array(runSessionOverrideSchema).max(20).default([]), captchaOverrides: z.array(runCaptchaOverrideSchema).max(20).default([]), targetId: idSchema.nullable(), createdAt: timestampSchema, updatedAt: timestampSchema });
export type RunSetup = z.infer<typeof runSetupSchema>;
export const createRunSetupSchema = runSetupSchema.pick({ name: true, diagnosticLevel: true, executionMode: true, profileIds: true, sessionOverrides: true, captchaOverrides: true, targetId: true });
export type CreateRunSetupInput = z.input<typeof createRunSetupSchema>;
export const runnerCaptchaRuntimeSchema = z.object({ strategy: captchaStrategySchema, provider: captchaProviderSnapshotSchema, solveTimeoutMs: z.number().int().min(5_000).max(120_000), fallbackAfterMs: z.number().int().min(1_000).max(30_000) });
export type RunnerCaptchaRuntime = z.infer<typeof runnerCaptchaRuntimeSchema>;
export const runnerRecordingSchema = z.object({ runId: idSchema, runSessionId: idSchema, diagnosticLevel: diagnosticLevelSchema, checkoutMode: checkoutModeSchema.default("ASSISTED"), purchaseMode: purchaseModeSchema.default("DRY_RUN"), captcha: runnerCaptchaRuntimeSchema.default({ strategy: "MANUAL_HARVESTER", provider: null, solveTimeoutMs: 30_000, fallbackAfterMs: 5_000 }), artifactDir: z.string().min(1), startedAt: timestampSchema });
export type RunnerRecording = z.infer<typeof runnerRecordingSchema>;

export const clipboardLeaseDenialReasonSchema = z.enum(["CLIPBOARD_NOT_EMPTY", "CLIPBOARD_UNAVAILABLE", "QUEUE_TIMEOUT", "SESSION_ENDED"]);
export type ClipboardLeaseDenialReason = z.infer<typeof clipboardLeaseDenialReasonSchema>;

export const runnerCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("START"), version: z.literal(IPC_VERSION), profileId: idSchema, userDataDir: z.string().min(1), driver: runnerBrowserDriverSchema, proxy: runnerProxySchema.nullable(), probeUrl: z.string().url(), recording: runnerRecordingSchema.nullable(), background: z.boolean().default(false) }),
  z.object({ type: z.literal("END_RUN"), version: z.literal(IPC_VERSION), runSessionId: idSchema }),
  z.object({ type: z.literal("ASSIST_TARGET"), version: z.literal(IPC_VERSION), runId: idSchema, runSessionId: idSchema, candidate: productCandidateSchema, variant: productVariantSchema, quantity: z.literal(1), priceConstraint: z.object({ currency: targetCurrencySchema, maxRetailMinor: z.number().int().nonnegative() }), shipping: runnerShippingSchema, checkoutMode: checkoutModeSchema, purchaseMode: purchaseModeSchema, paymentProfile: paymentProfileSnapshotSchema }),
  z.object({ type: z.literal("RESUME_ASSIST"), version: z.literal(IPC_VERSION), runId: idSchema, runSessionId: idSchema }),
  z.object({ type: z.literal("RETRY_CAPTCHA"), version: z.literal(IPC_VERSION), runId: idSchema, runSessionId: idSchema }),
  z.object({ type: z.literal("TEST_CAPTCHA"), version: z.literal(IPC_VERSION), runId: idSchema, runSessionId: idSchema, fixture: z.enum(["RECAPTCHA_V2", "RECAPTCHA_V3", "TURNSTILE", "GEETEST_V4"]) }),
  z.object({ type: z.literal("CAPTCHA_CREDENTIAL_RESPONSE"), version: z.literal(IPC_VERSION), requestId: idSchema, credential: z.object({ kind: z.enum(["CAPSOLVER", "CUSTOM_ASYNC", "CUSTOM_FAST_TOKEN"]), endpoint: z.string().url().nullable(), apiKey: z.string().min(1).max(1_024) }).nullable(), failure: z.enum(["NOT_CONFIGURED", "UNAVAILABLE", "CANCELLED"]).nullable() }),
  z.object({ type: z.literal("PAYMENT_SECRET_RESPONSE"), version: z.literal(IPC_VERSION), requestId: idSchema, secret: paymentCardSecretSchema.nullable(), failure: z.enum(["NOT_CONFIGURED", "UNAVAILABLE", "CANCELLED"]).nullable() }),
  z.object({ type: z.literal("CHECKOUT_SLOT_GRANTED"), version: z.literal(IPC_VERSION), requestId: idSchema, reservationId: idSchema.nullable(), limit: maxCheckoutsSchema }),
  z.object({ type: z.literal("CHECKOUT_SLOT_DENIED"), version: z.literal(IPC_VERSION), requestId: idSchema, succeeded: z.number().int().nonnegative(), limit: z.number().int().min(1) }),
  z.object({ type: z.literal("CHECKOUT_SUCCESS_RECORDED"), version: z.literal(IPC_VERSION), requestId: idSchema, orderIndex: z.number().int().min(1) }),
  z.object({ type: z.literal("CHECK_CART"), version: z.literal(IPC_VERSION), profileId: idSchema }),
  z.object({ type: z.literal("EMPTY_CART"), version: z.literal(IPC_VERSION), profileId: idSchema }),
  z.object({ type: z.literal("OPEN_WARM_DESTINATION"), version: z.literal(IPC_VERSION), url: z.string().url() }),
  z.object({ type: z.literal("FOCUS_ASSIST_PAGE"), version: z.literal(IPC_VERSION) }),
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
  z.object({ type: z.literal("CAPTCHA_CREDENTIAL_REQUEST"), version: z.literal(IPC_VERSION), profileId: idSchema, runId: idSchema, runSessionId: idSchema, requestId: idSchema, provider: z.enum(["CAPSOLVER", "CUSTOM_ASYNC", "CUSTOM_FAST_TOKEN"]) }),
  z.object({ type: z.literal("PAYMENT_SECRET_REQUEST"), version: z.literal(IPC_VERSION), profileId: idSchema, runId: idSchema, runSessionId: idSchema, requestId: idSchema, paymentProfileId: idSchema }),
  z.object({ type: z.literal("CHECKOUT_SLOT_REQUEST"), version: z.literal(IPC_VERSION), profileId: idSchema, runId: idSchema, runSessionId: idSchema, requestId: idSchema }),
  z.object({ type: z.literal("PAYMENT_SUBMISSION_RESULT"), version: z.literal(IPC_VERSION), profileId: idSchema, runId: idSchema, runSessionId: idSchema, requestId: idSchema, reservationId: idSchema.nullable(), outcome: z.enum(["SUCCESS", "REJECTED", "AMBIGUOUS"]), durationMs: z.number().int().nonnegative(), code: z.string().max(80).nullable() }),
  z.object({ type: z.literal("CAPTCHA_LAB_RESULT"), version: z.literal(IPC_VERSION), profileId: idSchema, runId: idSchema, runSessionId: idSchema, fixture: z.enum(["RECAPTCHA_V2", "RECAPTCHA_V3", "TURNSTILE", "GEETEST_V4"]), status: z.enum(["PASSED", "FAILED"]), message: z.string().max(500) }),
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
  z.object({ type: z.literal("SET_BUDGET_BLOCKS"), version: z.literal(IPC_VERSION), routeIds: z.array(z.string().min(1).max(120)).max(20), resetAt: timestampSchema.nullable() }),
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
  z.object({ type: z.literal("MONITOR_DISCOVERY_EVENT"), version: z.literal(IPC_VERSION), runId: idSchema, event: z.object({ type: z.enum(["DISCOVERY_SOURCE_PROBED", "DISCOVERY_SOURCE_UNAVAILABLE", "DISCOVERY_CANDIDATE_FOUND", "DISCOVERY_CANDIDATE_HYDRATED", "DISCOVERY_MESH_WINNER"]), source: discoverySourceSchema, routeId: z.string().min(1).max(120), elapsedNs: z.string().regex(/^\d+$/), payload: jsonRecordSchema }) }),
  z.object({ type: z.literal("MONITOR_USAGE"), version: z.literal(IPC_VERSION), runId: idSchema, routeId: z.string().min(1).max(120), discoverySource: discoverySourceSchema.nullable().default(null), usage: networkUsageCounterSchema }),
  z.object({ type: z.literal("MONITOR_STOPPED"), version: z.literal(IPC_VERSION), runId: idSchema.nullable() })
]);
export type MonitorEvent = z.infer<typeof monitorEventSchema>;

export const networkProbeSettingsSchema = z.object({ probeUrl: z.string().url().refine((value) => new URL(value).protocol === "https:", "The probe URL must use HTTPS.") });
export type NetworkProbeSettings = z.infer<typeof networkProbeSettingsSchema>;
export const benchmarkStatusSchema = z.enum(["PASS", "WARN", "FAIL"]);
export type BenchmarkStatus = z.infer<typeof benchmarkStatusSchema>;
export const proxyBenchmarkSchema = z.object({ id: idSchema, routeKind: z.enum(["direct", "proxy"]), proxyProfileId: idSchema.nullable(), probeUrl: z.string().url(), startedAt: timestampSchema, completedAt: timestampSchema, attempts: z.number().int().min(1), successes: z.number().int().min(0), publicIp: z.string().nullable(), country: z.string().nullable(), city: z.string().nullable(), connectLatencyMs: z.number().nonnegative().nullable(), medianLatencyMs: z.number().nonnegative().nullable(), jitterMs: z.number().nonnegative().nullable(), failureRate: z.number().min(0).max(1), ipStable: z.boolean(), qualityScore: z.number().int().min(0).max(100), status: benchmarkStatusSchema, errorCode: z.string().nullable(), errorMessage: z.string().nullable(), samples: z.array(z.number().nonnegative()) });
export type ProxyBenchmark = z.infer<typeof proxyBenchmarkSchema>;

export const paymentBatchPreviewRowSchema = z.object({ rowNumber: z.number().int().min(2), name: z.string().max(80), kind: z.enum(["CARD", "VCC"]), brand: z.string().max(32).nullable(), last4: z.string().regex(/^\d{4}$/).nullable(), expiryMonth: z.number().int().min(1).max(12).nullable(), expiryYear: z.number().int().min(2020).max(2200).nullable(), tags: z.array(z.string().max(40)), errors: z.array(z.string().max(80)), warnings: z.array(z.string().max(80)) });
export type PaymentBatchPreviewRow = z.infer<typeof paymentBatchPreviewRowSchema>;
export const paymentBatchPreviewSchema = z.object({ token: idSchema, expiresAt: timestampSchema, rows: z.array(paymentBatchPreviewRowSchema).max(500) });
export type PaymentBatchPreview = z.infer<typeof paymentBatchPreviewSchema>;
export const previewPaymentPasteSchema = z.object({ text: z.string().min(1).max(1_000_000) });
export const commitPaymentBatchSchema = z.object({ token: idSchema, selections: z.array(z.object({ rowNumber: z.number().int().min(2), includeWarnings: z.boolean().default(false), browserProfileId: idSchema.nullable().default(null) })).min(1).max(500) }).superRefine((value, context) => { const rows = value.selections.map((entry) => entry.rowNumber); if (new Set(rows).size !== rows.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Each row may only be selected once." }); const profiles = value.selections.map((entry) => entry.browserProfileId).filter(Boolean); if (new Set(profiles).size !== profiles.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Each browser may only be assigned once." }); });
export type CommitPaymentBatchInput = z.input<typeof commitPaymentBatchSchema>;
export const paymentBatchCommitResultSchema = z.object({ profiles: z.array(paymentProfileSchema), assignedBrowserProfileIds: z.array(idSchema) });
export type PaymentBatchCommitResult = z.infer<typeof paymentBatchCommitResultSchema>;

export const profileIpc = { list: "profiles:list", create: "profiles:create", update: "profiles:update", remove: "profiles:remove", reorder: "profiles:reorder" } as const;
export const targetIpc = { list: "targets:list", create: "targets:create", update: "targets:update", remove: "targets:remove", test: "targets:test", changed: "targets:changed" } as const;
export const healthIpc = { get: "health:get", changed: "health:changed" } as const;
export const warmingIpc = { list: "warming:list", start: "warming:start", update: "warming:update", openDestination: "warming:open-destination", complete: "warming:complete", changed: "warming:changed" } as const;
export const proxyIpc = { list: "proxies:list", create: "proxies:create", update: "proxies:update", remove: "proxies:remove", test: "proxies:test", benchmarks: "proxies:benchmarks", reveal: "proxies:reveal", copyRevealed: "proxies:copy-revealed" } as const;
export const shippingIpc = { list: "shipping:list", create: "shipping:create", update: "shipping:update", remove: "shipping:remove", reveal: "shipping:reveal", copyRevealed: "shipping:copy-revealed", changed: "shipping:changed" } as const;
export const paymentIpc = { list: "payments:list", create: "payments:create", update: "payments:update", remove: "payments:remove", previewCsv: "payments:preview-csv", previewPaste: "payments:preview-paste", commitBatch: "payments:commit-batch", cancelBatch: "payments:cancel-batch", changed: "payments:changed" } as const;
export const storeIpc = { list: "stores:list", update: "stores:update", changed: "stores:changed" } as const;
export const settingsIpc = { getNetworkProbe: "settings:get-network-probe", updateNetworkProbe: "settings:update-network-probe", getMonitor: "settings:get-monitor", updateMonitor: "settings:update-monitor", getAppearance: "settings:get-appearance", updateAppearance: "settings:update-appearance", applyChrome: "settings:apply-chrome", appInfo: "settings:app-info" } as const;
export const monitorIpc = { status: "monitor:status", setTurbo: "monitor:set-turbo", changed: "monitor:changed" } as const;
export const usageIpc = { run: "usage:run", totals: "usage:totals" } as const;
export type AppInfo = { version: string; electronVersion: string; chromeVersion: string | null; osVersion: string };
export const sessionIpc = { list: "sessions:list", open: "sessions:open", close: "sessions:close", restart: "sessions:restart", checkCoherence: "sessions:check-coherence", checkCoherenceAll: "sessions:check-coherence-all", openAll: "sessions:open-all", closeAll: "sessions:close-all", checkCart: "sessions:check-cart", emptyCart: "sessions:empty-cart", emptyCarts: "sessions:empty-carts", carts: "sessions:carts", cartChanged: "sessions:cart-changed", changed: "sessions:changed" } as const;
export const simulatePaymentHandoffSchema = z.object({
  profileId: idSchema,
  phase: z.enum(["DETECTED", "RETURNED"]),
});
export type SimulatePaymentHandoffInput = z.infer<typeof simulatePaymentHandoffSchema>;
export const runIpc = { list: "runs:list", get: "runs:get", start: "runs:start", end: "runs:end", resume: "runs:resume", remove: "runs:remove", simulatePaymentHandoff: "runs:simulate-payment-handoff", changed: "runs:changed" } as const;
export const analyticsIpc = { query: "analytics:query", compare: "analytics:compare", annotations: "analytics:annotations", createAnnotation: "analytics:create-annotation", removeAnnotation: "analytics:remove-annotation", revealArtifact: "analytics:reveal-artifact" } as const;
export const runSetupIpc = { list: "run-setups:list", create: "run-setups:create", remove: "run-setups:remove", changed: "run-setups:changed" } as const;
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };
export function defaultRoute(): SessionRoute { return { kind: "direct", verification: { status: "PENDING", publicIp: null, country: null, city: null, verifiedAt: null, message: null } }; }
