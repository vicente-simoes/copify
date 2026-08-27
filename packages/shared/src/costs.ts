import { z } from "zod";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/* A ceiling on the series so a multi-year custom range cannot return a point
   per bucket forever; past it the last bucket simply absorbs the remainder. */
const MAX_SERIES_POINTS = 400;

const idSchema = z.string().uuid();
const timestampSchema = z.number().int().nonnegative();
const nullableMoneySchema = z.number().int().nonnegative().nullable();

export const costAuthoritySchema = z.enum(["COPIFY_ESTIMATED", "PROVIDER_CONFIRMED", "MANUAL_CONFIRMED", "PROVIDER_REPORTED", "MIXED"]);
export type CostAuthority = z.infer<typeof costAuthoritySchema>;
export const costCategorySchema = z.enum(["PROXY", "CAPTCHA"]);
export type CostCategory = z.infer<typeof costCategorySchema>;
export const costScopeSchema = z.enum(["ALL", "PROXY", "CAPTCHA"]);
export type CostScope = z.infer<typeof costScopeSchema>;
export const costPeriodPresetSchema = z.enum(["TODAY", "LAST_24_HOURS", "ROLLING_7_DAYS", "CALENDAR_MONTH", "CUSTOM"]);
export type CostPeriodPreset = z.infer<typeof costPeriodPresetSchema>;
export const costGroupBySchema = z.enum(["CATEGORY", "PROVIDER", "PROXY", "CAPTCHA_KIND", "STORE", "SOURCE", "BROWSER_PROFILE", "RUN"]);
export type CostGroupBy = z.infer<typeof costGroupBySchema>;
export const budgetCadenceSchema = z.enum(["DAILY", "WEEKLY", "MONTHLY"]);
export type BudgetCadence = z.infer<typeof budgetCadenceSchema>;

export const costPeriodSchema = z.object({
  preset: costPeriodPresetSchema,
  startAt: timestampSchema.nullable().default(null),
  endAt: timestampSchema.nullable().default(null),
  timezoneId: z.string().min(1).max(120),
}).superRefine((value, context) => {
  if (value.preset === "CUSTOM" && (value.startAt === null || value.endAt === null || value.endAt <= value.startAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A custom period requires an end after its start." });
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone: value.timezoneId }).format(0); }
  catch { context.addIssue({ code: z.ZodIssueCode.custom, message: "Use a valid IANA timezone." }); }
});
export type CostPeriod = z.infer<typeof costPeriodSchema>;

export const costQuerySchema = z.object({
  period: costPeriodSchema,
  scope: costScopeSchema.default("ALL"),
  groupBy: costGroupBySchema.default("PROVIDER"),
  provider: z.string().min(1).max(40).nullable().default(null),
});
export type CostQuery = z.input<typeof costQuerySchema>;

export const costBreakdownRowSchema = z.object({
  id: z.string().min(1).max(160), label: z.string().min(1).max(160),
  category: z.enum(["PROXY", "CAPTCHA", "MIXED"]), captchaSolveCount: z.number().int().nonnegative(), unknownCaptchaCostCount: z.number().int().nonnegative(),
  receivedBytes: z.number().int().nonnegative(), sentBytes: z.number().int().nonnegative(), requestCount: z.number().int().nonnegative(),
  estimatedCostMicrosUsd: nullableMoneySchema, confirmedCostMicrosUsd: nullableMoneySchema,
  completeness: z.enum(["EXACT", "PARTIAL", "UNSUPPORTED"]), authority: costAuthoritySchema.nullable(), lastActivityAt: timestampSchema.nullable(),
});
export type CostBreakdownRow = z.infer<typeof costBreakdownRowSchema>;

export const costSeriesGranularitySchema = z.enum(["HOUR", "DAY", "WEEK"]);
export type CostSeriesGranularity = z.infer<typeof costSeriesGranularitySchema>;
export const costSeriesPointSchema = z.object({
  startAt: timestampSchema, endAt: timestampSchema,
  proxyCostMicrosUsd: nullableMoneySchema, captchaCostMicrosUsd: nullableMoneySchema,
  receivedBytes: z.number().int().nonnegative(), sentBytes: z.number().int().nonnegative(),
  requestCount: z.number().int().nonnegative(), captchaSolveCount: z.number().int().nonnegative(),
});
export type CostSeriesPoint = z.infer<typeof costSeriesPointSchema>;

export const providerUsageRecordSchema = z.object({
  id: idSchema, provider: z.string().min(1).max(40), authority: costAuthoritySchema.exclude(["COPIFY_ESTIMATED", "PROVIDER_REPORTED", "MIXED"]),
  intervalStartAt: timestampSchema, intervalEndAt: timestampSchema, receivedBytes: z.number().int().nonnegative().nullable(),
  requestCount: z.number().int().nonnegative().nullable(), billedCostMicrosUsd: nullableMoneySchema, planLabel: z.string().max(120).nullable(),
  importBatchId: idSchema.nullable(), recordedAt: timestampSchema,
});
export type ProviderUsageRecord = z.infer<typeof providerUsageRecordSchema>;

export const providerBalanceSnapshotSchema = z.object({
  id: idSchema, provider: z.string().min(1).max(40), authority: costAuthoritySchema.exclude(["COPIFY_ESTIMATED", "PROVIDER_REPORTED", "MIXED"]),
  effectiveAt: timestampSchema, remainingCreditMicrosUsd: nullableMoneySchema, remainingBytes: z.number().int().nonnegative().nullable(), recordedAt: timestampSchema,
});
export type ProviderBalanceSnapshot = z.infer<typeof providerBalanceSnapshotSchema>;

export const createManualCostSnapshotSchema = z.object({
  provider: z.string().min(1).max(40), intervalStartAt: timestampSchema, intervalEndAt: timestampSchema,
  usedBytes: z.number().int().nonnegative().nullable().default(null), requestCount: z.number().int().nonnegative().nullable().default(null),
  billedCostMicrosUsd: nullableMoneySchema.default(null), remainingCreditMicrosUsd: nullableMoneySchema.default(null),
}).superRefine((value, context) => {
  if (value.intervalEndAt <= value.intervalStartAt) context.addIssue({ code: z.ZodIssueCode.custom, message: "The snapshot end must follow its start." });
  if ([value.usedBytes, value.requestCount, value.billedCostMicrosUsd, value.remainingCreditMicrosUsd].every((entry) => entry === null)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Enter at least one usage, cost, or credit value." });
});
export type CreateManualCostSnapshotInput = z.input<typeof createManualCostSnapshotSchema>;

export const providerImportMappingSchema = z.object({
  timestampColumn: z.string().min(1), endTimestampColumn: z.string().nullable().default(null), trafficColumn: z.string().nullable().default(null),
  trafficUnit: z.enum(["BYTES", "KB", "MB", "GB"]).default("MB"), requestCountColumn: z.string().nullable().default(null),
  costColumn: z.string().nullable().default(null), planColumn: z.string().nullable().default(null),
}).refine((value) => value.trafficColumn !== null || value.requestCountColumn !== null || value.costColumn !== null, "Map at least one usage or cost column.");
export type ProviderImportMapping = z.infer<typeof providerImportMappingSchema>;
export const providerImportPreviewSchema = z.object({
  token: idSchema, expiresAt: timestampSchema, provider: z.string().min(1).max(40), headers: z.array(z.object({ id: z.string(), label: z.string(), inferredType: z.enum(["DATE", "NUMBER", "TEXT", "UNKNOWN"]) })).max(200),
  mapping: providerImportMappingSchema.nullable(), rows: z.array(z.object({ intervalStartAt: timestampSchema, intervalEndAt: timestampSchema, usedBytes: z.number().int().nonnegative().nullable(), requestCount: z.number().int().nonnegative().nullable(), billedCostMicrosUsd: nullableMoneySchema, planLabel: z.string().max(120).nullable() })).max(20),
  totalRows: z.number().int().nonnegative(), rejectedRows: z.number().int().nonnegative(), spendRowCount: z.number().int().nonnegative(), warnings: z.array(z.string().max(240)).max(20),
});
export type ProviderImportPreview = z.infer<typeof providerImportPreviewSchema>;
export const openProviderImportSchema = z.object({ provider: z.string().min(1).max(40) });
export const previewProviderImportSchema = z.object({ token: idSchema, mapping: providerImportMappingSchema.optional() });
export const commitProviderImportSchema = z.object({ token: idSchema, mapping: providerImportMappingSchema });
export const providerImportCommitResultSchema = z.object({ id: idSchema, duplicate: z.boolean(), rowCount: z.number().int().nonnegative() });
export type ProviderImportCommitResult = z.infer<typeof providerImportCommitResultSchema>;
export const reconciliationStatusSchema = z.object({
  usage: z.array(providerUsageRecordSchema), balances: z.array(providerBalanceSnapshotSchema),
  imports: z.array(z.object({ id:idSchema, provider:z.string(), rowCount:z.number().int(), rejectedRowCount:z.number().int(), spendRowCount:z.number().int(), billedCostMicrosUsd:nullableMoneySchema, intervalStartAt:timestampSchema.nullable(), intervalEndAt:timestampSchema.nullable(), importedAt:timestampSchema })),
  connectors: z.array(z.object({ provider:z.string(), available:z.boolean(), unavailableReason:z.string().nullable() })),
});
export type ReconciliationStatus = z.infer<typeof reconciliationStatusSchema>;

const costBudgetObjectSchema = z.object({
  id: idSchema, category: costCategorySchema.default("PROXY"), provider: z.string().min(1).max(40), cadence: budgetCadenceSchema, limitMicrosUsd: z.number().int().positive(),
  startingCreditMicrosUsd: nullableMoneySchema, timezoneId: z.string().min(1).max(120), thresholds: z.array(z.number().int().min(1).max(100)).min(1).max(10),
  hardCap: z.boolean(), enabled: z.boolean(), enabledAt: timestampSchema, createdAt: timestampSchema, updatedAt: timestampSchema,
});
const captchaBudgetSafety = (value: { category: CostCategory; hardCap: boolean }, context: z.RefinementCtx): void => { if (value.category === "CAPTCHA" && value.hardCap) context.addIssue({ code: z.ZodIssueCode.custom, message: "CAPTCHA budgets are alert-only and cannot stop checkout solving." }); };
export const costBudgetSchema = costBudgetObjectSchema.superRefine(captchaBudgetSafety);
export type CostBudget = z.infer<typeof costBudgetSchema>;
export const upsertCostBudgetSchema = costBudgetObjectSchema.omit({ id: true, createdAt: true, updatedAt: true, enabledAt: true }).extend({ id: idSchema.optional() }).superRefine(captchaBudgetSafety);
export type UpsertCostBudgetInput = z.input<typeof upsertCostBudgetSchema>;
export const budgetStatusSchema = z.object({
  budget: costBudgetSchema, periodStartAt: timestampSchema, periodEndAt: timestampSchema, spentMicrosUsd: z.number().int().nonnegative(),
  authority: costAuthoritySchema, percent: z.number().nonnegative(), firedThresholds: z.array(z.number().int()), capped: z.boolean(), dataAgeMs: z.number().int().nonnegative().nullable(),
});
export type BudgetStatus = z.infer<typeof budgetStatusSchema>;

export const costSummarySchema = z.object({
  period: z.object({ startAt: timestampSchema, endAt: timestampSchema, timezoneId: z.string(), label: z.string() }),
  estimatedCostMicrosUsd: nullableMoneySchema, confirmedCostMicrosUsd: nullableMoneySchema, confirmedAuthority: costAuthoritySchema.nullable(),
  captchaCostMicrosUsd: nullableMoneySchema, captchaSolveCount: z.number().int().nonnegative(), unknownCaptchaCostCount: z.number().int().nonnegative(), totalKnownCostMicrosUsd: nullableMoneySchema,
  confirmedDifferenceMicrosUsd: z.number().int().nullable(), receivedBytes: z.number().int().nonnegative(), sentBytes: z.number().int().nonnegative(), requestCount: z.number().int().nonnegative(),
  remainingCreditMicrosUsd: nullableMoneySchema, estimationCoverage: z.number().min(0).max(1).nullable(), confirmedDataAgeMs: z.number().int().nonnegative().nullable(),
  rows: z.array(costBreakdownRowSchema), budgets: z.array(budgetStatusSchema),
  seriesGranularity: costSeriesGranularitySchema, series: z.array(costSeriesPointSchema).max(MAX_SERIES_POINTS),
  updatedAt: timestampSchema,
});
export type CostSummary = z.infer<typeof costSummarySchema>;

export function estimateCostMicrosUsd(receivedBytes: number, sentBytes: number, rateMicrosUsd: number | null, supported = true): number | null {
  if (!supported || rateMicrosUsd === null) return null;
  const result = (BigInt(receivedBytes) + BigInt(sentBytes)) * BigInt(rateMicrosUsd) / 1_000_000_000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("The calculated proxy cost exceeds the supported range.");
  return Number(result);
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
function localParts(timestamp: number, timezoneId: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezoneId, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(timestamp);
  const value = (kind: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === kind)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}
function zonedEpoch(parts: LocalParts, timezoneId: string): number {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second); let guess = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) { const actual = localParts(guess, timezoneId); const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second); guess += desired - represented; }
  return guess;
}
function startOfLocalDay(timestamp: number, timezoneId: string): number { const value = localParts(timestamp, timezoneId); return zonedEpoch({ ...value, hour: 0, minute: 0, second: 0 }, timezoneId); }
function addLocalDays(timestamp: number, days: number, timezoneId: string): number { const value = localParts(timestamp, timezoneId); const shifted = new Date(Date.UTC(value.year, value.month - 1, value.day + days)); return zonedEpoch({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), hour: 0, minute: 0, second: 0 }, timezoneId); }

export function resolveCostPeriod(period: CostPeriod, now = Date.now()): { startAt: number; endAt: number; timezoneId: string; label: string } {
  const value = costPeriodSchema.parse(period); const timezoneId = value.timezoneId;
  if (value.preset === "CUSTOM") return { startAt: value.startAt!, endAt: value.endAt!, timezoneId, label: "Custom range" };
  if (value.preset === "LAST_24_HOURS") return { startAt: now - 86_400_000, endAt: now, timezoneId, label: "Last 24 hours" };
  if (value.preset === "ROLLING_7_DAYS") return { startAt: now - 7 * 86_400_000, endAt: now, timezoneId, label: "Rolling 7 days" };
  const today = startOfLocalDay(now, timezoneId);
  if (value.preset === "TODAY") return { startAt: today, endAt: now, timezoneId, label: "Today" };
  const parts = localParts(now, timezoneId); const startAt = zonedEpoch({ year: parts.year, month: parts.month, day: 1, hour: 0, minute: 0, second: 0 }, timezoneId);
  return { startAt, endAt: now, timezoneId, label: "Calendar month" };
}

/* Spend reads as a shape over time, not as one number, so the summary carries a
   bucketed series. The bucket follows the span rather than the preset: a custom
   two-day range and "Last 24 hours" are the same question. Day and week edges go
   through the zoned helpers so a bucket is the operator's day, not a UTC day. */
export function resolveCostSeries(startAt: number, endAt: number, timezoneId: string): { granularity: CostSeriesGranularity; edges: number[] } {
  const span = Math.max(0, endAt - startAt);
  const granularity: CostSeriesGranularity = span <= 48 * HOUR_MS ? "HOUR" : span <= 120 * DAY_MS ? "DAY" : "WEEK";
  const edges: number[] = [];
  if (granularity === "HOUR") {
    let edge = zonedEpoch({ ...localParts(startAt, timezoneId), minute: 0, second: 0 }, timezoneId);
    while (edge <= endAt && edges.length < MAX_SERIES_POINTS) { edges.push(edge); edge += HOUR_MS; }
    edges.push(Math.max(edge, endAt));
    return { granularity, edges };
  }
  const step = granularity === "DAY" ? 1 : 7;
  let edge = startOfLocalDay(startAt, timezoneId);
  if (granularity === "WEEK") { const parts = localParts(edge, timezoneId); edge = addLocalDays(edge, -((new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() + 6) % 7), timezoneId); }
  while (edge <= endAt && edges.length < MAX_SERIES_POINTS) { edges.push(edge); edge = addLocalDays(edge, step, timezoneId); }
  edges.push(Math.max(edge, endAt));
  return { granularity, edges };
}

export function resolveBudgetPeriod(cadence: BudgetCadence, timezoneId: string, now = Date.now()): { startAt: number; endAt: number } {
  const today = startOfLocalDay(now, timezoneId);
  if (cadence === "DAILY") return { startAt: today, endAt: addLocalDays(today, 1, timezoneId) };
  if (cadence === "WEEKLY") { const parts = localParts(now, timezoneId); const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay(); const back = (weekday + 6) % 7; const startAt = addLocalDays(today, -back, timezoneId); return { startAt, endAt: addLocalDays(startAt, 7, timezoneId) }; }
  const parts = localParts(now, timezoneId); const startAt = zonedEpoch({ year: parts.year, month: parts.month, day: 1, hour: 0, minute: 0, second: 0 }, timezoneId); const next = new Date(Date.UTC(parts.year, parts.month, 1)); const endAt = zonedEpoch({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: 1, hour: 0, minute: 0, second: 0 }, timezoneId); return { startAt, endAt };
}

export interface ProviderCostConnector {
  readonly provider: string;
  readonly available: boolean;
  readonly unavailableReason: string | null;
}

export const costIpc = {
  query: "costs:query", manualSnapshot: "costs:manual-snapshot", importOpen: "costs:import-open", importPreview: "costs:import-preview", importCommit: "costs:import-commit", importCancel: "costs:import-cancel",
  removeManualSnapshot: "costs:remove-manual-snapshot", budgets: "costs:budgets", upsertBudget: "costs:upsert-budget", removeBudget: "costs:remove-budget", reconciliation: "costs:reconciliation", changed: "costs:changed",
} as const;
