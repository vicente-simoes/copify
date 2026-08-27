import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_NETWORK_PROBE_URL, browserHealthSnapshotSchema, browserProfileSchema, cardBrand, createBrowserProfileSchema, createPaymentProfileSchema, createProxyProfileSchema, createRunSchema, createRunSetupSchema, createShippingProfileSchema, createTargetSchema, appearanceSettingsSchema, captchaProviderConfigSchema, captchaProviderDiagnosticSchema, captchaSettingsSchema, chromeColorsSchema, defaultAppearanceSettings, defaultCaptchaSettings, defaultMonitorSettings, monitorSettingsSchema, networkProbeSettingsSchema, paymentProfileSchema, profileWarmStateSchema, proxyBenchmarkSchema,
  analyticsFilterSchema, createRunAnnotationSchema, proxyProfileSchema, runAnnotationSchema, runArtifactSchema, windowBoundsSchema, runDetailSchema, runEventSchema, runMetricsSchema, runNetworkUsageSchema, runSchema, runSessionSchema, runSetupSchema, sessionMetricsSchema, shippingProfileSchema, targetCheckSchema, targetSchema, updateBrowserProfileSchema, updatePaymentProfileSchema, updateProxyProfileSchema, updateShippingProfileSchema, updateTargetSchema,
  type BrowserHealthDetail, type BrowserHealthSnapshot, type BrowserProfile, type CreateBrowserProfileInput, type AppearanceSettings, type ChromeColors, type WindowBounds, type CreateProxyProfileInput, type MonitorSettings, type ProfileWarmState, type ProxyBenchmark, type ProxyProfile, type RunNetworkUsage,
  type AnalyticsFilter, type AnalyticsResult, type CaptchaProviderConfig, type CaptchaProviderDiagnostic, type CaptchaProviderKind, type CaptchaSettings, type CreatePaymentProfileInput, type CreateRunAnnotationInput, type CreateRunInput, type CreateRunSetupInput, type CreateShippingProfileInput, type CreateTargetInput, type PaymentProfile, type Run, type RunAnnotation, type RunArtifact, type RunDetail, type RunEnvironment, type RunEvent, type RunMetrics, type RunSession, type RunSetup, type SessionMetrics, type ShippingDetails, type ShippingProfile, type Target, type TargetCheck, type TargetSnapshot, type UpdateCaptchaSettingsInput,
  budgetStatusSchema, costBudgetSchema, costQuerySchema, costSummarySchema, createManualCostSnapshotSchema, estimateCostMicrosUsd, providerBalanceSnapshotSchema, providerUsageRecordSchema, resolveBudgetPeriod, resolveCostPeriod, resolveCostSeries, upsertCostBudgetSchema,
  type BudgetStatus, type CostBudget, type CostQuery, type CostSummary, type CreateManualCostSnapshotInput, type ProviderBalanceSnapshot, type ProviderUsageRecord, type UpsertCostBudgetInput,
  type UpdateBrowserProfileInput, type UpdatePaymentProfileInput, type UpdateProxyProfileInput, type UpdateShippingProfileInput, type UpdateTargetInput
} from "@copify/shared";
import { deriveMetrics, reliabilityRows } from "./analytics";
export { deriveMetrics, percentile, reliabilityRows } from "./analytics";

export * from "./schema";

type Row = Record<string, any>;
export type EncryptedCredential = Buffer | null | undefined;
export type EncryptedProxyCredentials = { username?: Buffer; password?: Buffer };
export type EncryptedProxyCredentialUpdate = { username?: EncryptedCredential; password?: EncryptedCredential };
export type StoredProxy = ProxyProfile & { usernameCiphertext: Buffer | null; passwordCiphertext: Buffer | null };
export type StoredShippingProfile = ShippingProfile & { detailsCiphertext: Buffer | null };
export type StoredPaymentProfile = PaymentProfile & { payloadCiphertext: Buffer | null };
export type StoredBrowserProfile = BrowserProfile & { externalCdpEndpointCiphertext: Buffer | null };
export type StoredCaptchaProvider = CaptchaProviderConfig & { apiKeyCiphertext: Buffer | null; lastDiagnostic: CaptchaProviderDiagnostic | null };
type NewRunSession = Omit<RunSession, "runId" | "shippingProfile" | "paymentProfile" | "checkoutMode" | "captchaStrategy" | "captchaProvider" | "assistedEligible" | "executionState" | "checkpointReason" | "quotaOutcome" | "orderIndex"> & Partial<Pick<RunSession, "runId" | "shippingProfile" | "paymentProfile" | "checkoutMode" | "captchaStrategy" | "captchaProvider" | "assistedEligible" | "executionState" | "checkpointReason" | "quotaOutcome" | "orderIndex">>;
export type EncryptedPaymentProfileCreate = { input: CreatePaymentProfileInput; ciphertext: Buffer };
export type RecordedUsageSnapshot = RunNetworkUsage & { browserProfileId?: string | null; proxyProvider?: string | null; timezoneId?: string };
export type ProviderImportRecord = Omit<ProviderUsageRecord, "id" | "authority" | "importBatchId" | "recordedAt">;

export function profileDirectory(profilesRoot: string, profileId: string): string {
  return join(resolve(profilesRoot), profileId);
}

export class ProfileRepository {
  constructor(private readonly sql: DatabaseSync, private readonly profilesRoot: string) {
    mkdirSync(dirname(profilesRoot), { recursive: true });
    mkdirSync(profilesRoot, { recursive: true });
    this.migrate();
  }

  private migrate(): void {
    const version = Number((this.sql.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
    if (version < 1) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS browser_profiles (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, user_data_dir TEXT NOT NULL, proxy_profile_id TEXT,
        shipping_profile_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );`);
    }
    if (version < 2) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS app_secrets (
        id TEXT PRIMARY KEY NOT NULL, ciphertext BLOB NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS proxy_profiles (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, type TEXT NOT NULL, protocol TEXT NOT NULL,
        host TEXT NOT NULL, port INTEGER NOT NULL, username_secret_id TEXT, password_secret_id TEXT, expected_country TEXT,
        expected_city TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS proxy_benchmarks (
        id TEXT PRIMARY KEY NOT NULL, route_kind TEXT NOT NULL, proxy_profile_id TEXT, probe_url TEXT NOT NULL,
        started_at INTEGER NOT NULL, completed_at INTEGER NOT NULL, attempts INTEGER NOT NULL, successes INTEGER NOT NULL,
        public_ip TEXT, country TEXT, city TEXT, connect_latency_ms REAL, median_latency_ms REAL, jitter_ms REAL,
        failure_rate REAL NOT NULL, ip_stable INTEGER NOT NULL, quality_score INTEGER NOT NULL, status TEXT NOT NULL,
        error_code TEXT, error_message TEXT, samples_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS proxy_benchmarks_route_completed_idx ON proxy_benchmarks(proxy_profile_id, completed_at DESC);
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
    }
    if (version < 3) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, diagnostic_level TEXT NOT NULL, status TEXT NOT NULL,
        started_at INTEGER NOT NULL, ended_at INTEGER, environment_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_sessions (
        id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, browser_profile_id TEXT NOT NULL, browser_profile_name TEXT NOT NULL,
        route_json TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, final_error_json TEXT
      );
      CREATE INDEX IF NOT EXISTS run_sessions_run_idx ON run_sessions(run_id, started_at ASC);
      CREATE TABLE IF NOT EXISTS run_events (
        id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, run_session_id TEXT, wall_time_ms INTEGER NOT NULL, elapsed_ns TEXT NOT NULL,
        type TEXT NOT NULL, state_before TEXT, state_after TEXT, payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS run_events_run_elapsed_idx ON run_events(run_id, elapsed_ns ASC);
      CREATE INDEX IF NOT EXISTS run_events_session_elapsed_idx ON run_events(run_session_id, elapsed_ns ASC);
      CREATE TABLE IF NOT EXISTS run_artifacts (
        id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, run_session_id TEXT NOT NULL, kind TEXT NOT NULL,
        relative_path TEXT NOT NULL, sensitive INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS run_artifacts_run_idx ON run_artifacts(run_id, run_session_id);
      `);
    }
    if (version < 4) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS targets (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, store_id TEXT NOT NULL, product_keywords_json TEXT NOT NULL, negative_keywords_json TEXT NOT NULL,
        preferred_colors_json TEXT NOT NULL, size_priority_json TEXT NOT NULL, currency TEXT NOT NULL, max_retail_minor INTEGER NOT NULL, quantity INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, latest_check_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      ALTER TABLE runs ADD COLUMN target_snapshot_json TEXT;
      CREATE INDEX IF NOT EXISTS targets_enabled_idx ON targets(enabled, created_at ASC);`);
    }
    if (version < 5) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS shipping_profiles (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, details_secret_id TEXT, country TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_sessions (
        id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, browser_profile_id TEXT NOT NULL, browser_profile_name TEXT NOT NULL,
        route_json TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, final_error_json TEXT
      );
      ALTER TABLE runs ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'OBSERVATION';
      ALTER TABLE run_sessions ADD COLUMN shipping_profile_json TEXT;
      ALTER TABLE run_sessions ADD COLUMN assisted_eligible INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE run_sessions ADD COLUMN execution_state TEXT NOT NULL DEFAULT 'OBSERVING';
      ALTER TABLE run_sessions ADD COLUMN checkpoint_reason TEXT;
      CREATE INDEX IF NOT EXISTS shipping_profiles_enabled_idx ON shipping_profiles(enabled, created_at ASC);`);
    }
    if (version < 6 && this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='browser_profiles'").get()) {
      this.sql.exec("ALTER TABLE browser_profiles ADD COLUMN launch_mode TEXT NOT NULL DEFAULT 'PLAYWRIGHT';");
    }
    if (version < 7 && this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='browser_profiles'").get()) {
      this.sql.exec("UPDATE browser_profiles SET launch_mode = 'PLAYWRIGHT' WHERE launch_mode = 'NATIVE_CDP';");
    }
    if (version < 8) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS run_setups (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, diagnostic_level TEXT NOT NULL, execution_mode TEXT NOT NULL,
        profile_ids_json TEXT NOT NULL, target_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS run_setups_created_idx ON run_setups(created_at ASC);`);
    }
    if (version < 9) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS browser_health_snapshots (
        id TEXT PRIMARY KEY NOT NULL, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, run_id TEXT,
        captured_at INTEGER NOT NULL, payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS browser_health_subject_idx ON browser_health_snapshots(subject_kind, subject_id, captured_at DESC);
      CREATE INDEX IF NOT EXISTS browser_health_run_idx ON browser_health_snapshots(run_id, captured_at DESC);`);
    }
    if (version < 10 && this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='browser_profiles'").get()) {
      this.sql.exec(`ALTER TABLE browser_profiles ADD COLUMN driver_kind TEXT NOT NULL DEFAULT 'NATIVE_STEALTH';
        ALTER TABLE browser_profiles ADD COLUMN external_cdp_endpoint_secret_id TEXT;
        UPDATE browser_profiles SET driver_kind='NATIVE_STEALTH' WHERE launch_mode IN ('PLAYWRIGHT','NATIVE_CDP') OR driver_kind IS NULL;`);
    }
    if (version < 11) {
      if (this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='proxy_profiles'").get()) this.sql.exec("ALTER TABLE proxy_profiles ADD COLUMN cost_per_gb_micros_usd INTEGER;");
      this.sql.exec(`CREATE TABLE IF NOT EXISTS run_network_usage (
        id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, usage_key TEXT NOT NULL, source TEXT NOT NULL,
        run_session_id TEXT, store_id TEXT, proxy_profile_id TEXT, proxy_name TEXT,
        received_bytes INTEGER NOT NULL, sent_bytes INTEGER NOT NULL, request_count INTEGER NOT NULL, completeness TEXT NOT NULL,
        cost_per_gb_micros_usd INTEGER, estimated_cost_micros_usd INTEGER, updated_at INTEGER NOT NULL,
        UNIQUE(run_id, usage_key)
      );
      CREATE INDEX IF NOT EXISTS run_network_usage_run_idx ON run_network_usage(run_id, source);
      CREATE INDEX IF NOT EXISTS run_network_usage_proxy_idx ON run_network_usage(proxy_profile_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS run_network_usage_store_idx ON run_network_usage(store_id, updated_at DESC);`);
    }
    if (version < 12) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS profile_warm_states (
        id TEXT PRIMARY KEY NOT NULL, browser_profile_id TEXT NOT NULL, store_id TEXT NOT NULL, status TEXT NOT NULL,
        storefront_ready INTEGER NOT NULL, google_ready INTEGER NOT NULL, shop_pay_ready INTEGER NOT NULL,
        storefront_completed_at INTEGER, google_completed_at INTEGER, shop_pay_completed_at INTEGER,
        proxy_profile_id TEXT, driver_kind TEXT NOT NULL, route_public_ip TEXT, route_country TEXT,
        started_at INTEGER NOT NULL, completed_at INTEGER, updated_at INTEGER NOT NULL,
        UNIQUE(browser_profile_id, store_id)
      );
      CREATE INDEX IF NOT EXISTS profile_warm_states_profile_idx ON profile_warm_states(browser_profile_id, updated_at DESC);`);
    }
    if (version < 13 && this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='browser_profiles'").get()) {
      this.sql.exec("ALTER TABLE browser_profiles ADD COLUMN position INTEGER NOT NULL DEFAULT 0;");
      // Seed the manual order from creation order so existing installs open on
      // exactly the list they had before rows became draggable.
      const statement = this.sql.prepare("UPDATE browser_profiles SET position=? WHERE id=?");
      this.all("SELECT id FROM browser_profiles ORDER BY created_at ASC, id ASC").forEach((row, index) => statement.run(index, String(row.id)));
    }
    if (this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='targets'").get()) {
      const hasDirectProductUrl = this.all("PRAGMA table_info(targets)").some((row) => String(row.name) === "direct_product_url");
      if (!hasDirectProductUrl) this.sql.exec("ALTER TABLE targets ADD COLUMN direct_product_url TEXT;");
    }
    if (version < 15) {
      const runColumns = this.all("PRAGMA table_info(runs)");
      if (runColumns.length && !runColumns.some((row) => row.name === "discovery_snapshot_json")) this.sql.exec("ALTER TABLE runs ADD COLUMN discovery_snapshot_json TEXT;");
      const usageColumns = this.all("PRAGMA table_info(run_network_usage)");
      if (usageColumns.length && !usageColumns.some((row) => row.name === "discovery_source")) this.sql.exec("ALTER TABLE run_network_usage ADD COLUMN discovery_source TEXT;");
      this.sql.exec(`CREATE TABLE IF NOT EXISTS monitor_discovery_state (store_id TEXT NOT NULL, source TEXT NOT NULL, route_id TEXT NOT NULL, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(store_id,source,route_id));`);
    }
    if (version < 16) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS historical_metrics (
        run_id TEXT NOT NULL, scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, target_id TEXT, store_id TEXT, browser_profile_id TEXT, proxy_profile_id TEXT,
        app_version TEXT NOT NULL, derivation_version INTEGER NOT NULL, metrics_json TEXT NOT NULL, derived_at INTEGER NOT NULL, PRIMARY KEY(run_id,scope_kind,scope_id)
      );
      CREATE INDEX IF NOT EXISTS historical_metrics_cohort_idx ON historical_metrics(target_id,store_id,app_version,derived_at DESC);
      CREATE INDEX IF NOT EXISTS historical_metrics_profile_idx ON historical_metrics(browser_profile_id,derived_at DESC);
      CREATE INDEX IF NOT EXISTS historical_metrics_proxy_idx ON historical_metrics(proxy_profile_id,derived_at DESC);
      CREATE TABLE IF NOT EXISTS run_annotations (
        id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, run_session_id TEXT, kind TEXT NOT NULL, text TEXT, failure_category TEXT, manual_outcome TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS run_annotations_run_idx ON run_annotations(run_id,run_session_id,created_at);`);
    }
    if (version < 17) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS cost_usage_buckets (
        id TEXT PRIMARY KEY NOT NULL, bucket_start_at INTEGER NOT NULL, timezone_id TEXT NOT NULL,
        run_id TEXT NOT NULL, usage_key TEXT NOT NULL, source TEXT NOT NULL, run_session_id TEXT, browser_profile_id TEXT, store_id TEXT,
        proxy_profile_id TEXT, proxy_name TEXT, proxy_provider TEXT, discovery_source TEXT,
        received_bytes INTEGER NOT NULL, sent_bytes INTEGER NOT NULL, request_count INTEGER NOT NULL, completeness TEXT NOT NULL,
        cost_per_gb_micros_usd INTEGER, estimated_cost_micros_usd INTEGER, legacy INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
        UNIQUE(bucket_start_at,run_id,usage_key)
      );
      CREATE INDEX IF NOT EXISTS cost_usage_buckets_period_idx ON cost_usage_buckets(bucket_start_at,proxy_provider);
      CREATE INDEX IF NOT EXISTS cost_usage_buckets_proxy_idx ON cost_usage_buckets(proxy_profile_id,bucket_start_at);
      CREATE INDEX IF NOT EXISTS cost_usage_buckets_run_idx ON cost_usage_buckets(run_id,bucket_start_at);
      CREATE INDEX IF NOT EXISTS cost_usage_buckets_store_idx ON cost_usage_buckets(store_id,bucket_start_at);
      CREATE INDEX IF NOT EXISTS cost_usage_buckets_profile_idx ON cost_usage_buckets(browser_profile_id,bucket_start_at);
      CREATE TABLE IF NOT EXISTS usage_cursors (
        run_id TEXT NOT NULL, usage_key TEXT NOT NULL, received_bytes INTEGER NOT NULL, sent_bytes INTEGER NOT NULL,
        request_count INTEGER NOT NULL, epoch INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(run_id,usage_key)
      );
      CREATE TABLE IF NOT EXISTS provider_import_batches (
        id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, normalized_digest TEXT NOT NULL UNIQUE, row_count INTEGER NOT NULL,
        rejected_row_count INTEGER NOT NULL, interval_start_at INTEGER, interval_end_at INTEGER, imported_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_usage_records (
        id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, authority TEXT NOT NULL, interval_start_at INTEGER NOT NULL,
        interval_end_at INTEGER NOT NULL, received_bytes INTEGER, request_count INTEGER, billed_cost_micros_usd INTEGER,
        plan_label TEXT, import_batch_id TEXT, recorded_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS provider_usage_records_period_idx ON provider_usage_records(provider,interval_start_at,interval_end_at);
      CREATE TABLE IF NOT EXISTS provider_balance_snapshots (
        id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, authority TEXT NOT NULL, effective_at INTEGER NOT NULL,
        remaining_credit_micros_usd INTEGER, remaining_bytes INTEGER, recorded_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS provider_balance_snapshots_provider_idx ON provider_balance_snapshots(provider,effective_at DESC);
      CREATE TABLE IF NOT EXISTS cost_budgets (
        id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, cadence TEXT NOT NULL, limit_micros_usd INTEGER NOT NULL,
        starting_credit_micros_usd INTEGER, timezone_id TEXT NOT NULL, thresholds_json TEXT NOT NULL, hard_cap INTEGER NOT NULL,
        enabled INTEGER NOT NULL, enabled_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(provider,cadence)
      );
      CREATE TABLE IF NOT EXISTS budget_threshold_events (
        id TEXT PRIMARY KEY NOT NULL, budget_id TEXT NOT NULL, period_start_at INTEGER NOT NULL, threshold INTEGER NOT NULL,
        fired_at INTEGER NOT NULL, UNIQUE(budget_id,period_start_at,threshold)
      );`);
      const timezoneId = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const hasUsage=Boolean(this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='run_network_usage'").get());
      const hasProxies=Boolean(this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='proxy_profiles'").get());
      const hasSessions=Boolean(this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='run_sessions'").get());
      const legacyRows = hasUsage ? this.all(`SELECT u.*, ${hasProxies?"p.provider":"NULL"} AS proxy_provider, ${hasSessions?"s.browser_profile_id":"NULL"} AS browser_profile_id
        FROM run_network_usage u ${hasProxies?"LEFT JOIN proxy_profiles p ON p.id=u.proxy_profile_id":""} ${hasSessions?"LEFT JOIN run_sessions s ON s.id=u.run_session_id":""}`) : [];
      const insertBucket = this.sql.prepare(`INSERT OR IGNORE INTO cost_usage_buckets
        (id,bucket_start_at,timezone_id,run_id,usage_key,source,run_session_id,browser_profile_id,store_id,proxy_profile_id,proxy_name,proxy_provider,discovery_source,received_bytes,sent_bytes,request_count,completeness,cost_per_gb_micros_usd,estimated_cost_micros_usd,legacy,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const insertCursor = this.sql.prepare(`INSERT OR IGNORE INTO usage_cursors (run_id,usage_key,received_bytes,sent_bytes,request_count,epoch,updated_at) VALUES (?,?,?,?,?,0,?)`);
      for (const row of legacyRows) {
        const received = Number(row.received_bytes); const sent = Number(row.sent_bytes); const rate = nullableNumber(row.cost_per_gb_micros_usd);
        const supported = Boolean(row.proxy_profile_id) && row.completeness !== "UNSUPPORTED";
        const estimate = estimateCostMicrosUsd(received, sent, rate, supported);
        insertBucket.run(randomUUID(), Math.floor(Number(row.updated_at) / 60_000) * 60_000, timezoneId, row.run_id, row.usage_key, row.source,
          row.run_session_id ?? null, row.browser_profile_id ?? null, row.store_id ?? null, row.proxy_profile_id ?? null, row.proxy_name ?? null,
          row.proxy_provider ?? null, row.discovery_source ?? null, received, sent, Number(row.request_count), "PARTIAL", rate, estimate, 1, Number(row.updated_at));
        insertCursor.run(row.run_id, row.usage_key, received, sent, Number(row.request_count), Number(row.updated_at));
        this.sql.prepare("UPDATE run_network_usage SET estimated_cost_micros_usd=? WHERE id=?").run(estimate, row.id);
      }
    }
    if (version < 18) {
      const addColumn = (table: string, column: string, definition: string): void => {
        const columns = this.all(`PRAGMA table_info(${table})`);
        if (columns.length && !columns.some((row) => String(row.name) === column)) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
      };
      addColumn("targets", "captcha_strategy", "captcha_strategy TEXT NOT NULL DEFAULT 'INHERIT_APP'");
      addColumn("browser_profiles", "captcha_strategy_override", "captcha_strategy_override TEXT NOT NULL DEFAULT 'INHERIT_TARGET'");
      addColumn("run_sessions", "captcha_strategy", "captcha_strategy TEXT NOT NULL DEFAULT 'MANUAL_HARVESTER'");
      addColumn("run_sessions", "captcha_provider_json", "captcha_provider_json TEXT");
      addColumn("run_setups", "captcha_overrides_json", "captcha_overrides_json TEXT NOT NULL DEFAULT '[]'");
      this.sql.exec(`CREATE TABLE IF NOT EXISTS captcha_providers (
        kind TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL, endpoint TEXT, enabled INTEGER NOT NULL DEFAULT 1,
        last_diagnostic_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS captcha_provider_credentials (
        provider_kind TEXT PRIMARY KEY NOT NULL, api_key_secret_id TEXT NOT NULL, updated_at INTEGER NOT NULL
      );`);
    }
    if (version < 19) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS captcha_cost_records (
        event_id TEXT PRIMARY KEY NOT NULL, occurred_at INTEGER NOT NULL, run_id TEXT NOT NULL, run_session_id TEXT,
        browser_profile_id TEXT, store_id TEXT, provider_kind TEXT, provider_label TEXT, captcha_kind TEXT NOT NULL,
        strategy TEXT NOT NULL, attempt INTEGER NOT NULL, cost_micros_usd INTEGER, authority TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS captcha_cost_records_period_idx ON captcha_cost_records(occurred_at,provider_kind);
      CREATE INDEX IF NOT EXISTS captcha_cost_records_run_idx ON captcha_cost_records(run_id,occurred_at);
      CREATE INDEX IF NOT EXISTS captcha_cost_records_store_idx ON captcha_cost_records(store_id,occurred_at);`);
      const hasCostBudgets=Boolean(this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cost_budgets'").get());
      if(hasCostBudgets)this.sql.exec(`ALTER TABLE cost_budgets RENAME TO cost_budgets_v18;
      CREATE TABLE cost_budgets (
        id TEXT PRIMARY KEY NOT NULL, category TEXT NOT NULL, provider TEXT NOT NULL, cadence TEXT NOT NULL, limit_micros_usd INTEGER NOT NULL,
        starting_credit_micros_usd INTEGER, timezone_id TEXT NOT NULL, thresholds_json TEXT NOT NULL, hard_cap INTEGER NOT NULL,
        enabled INTEGER NOT NULL, enabled_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(category,provider,cadence)
      );
      INSERT INTO cost_budgets (id,category,provider,cadence,limit_micros_usd,starting_credit_micros_usd,timezone_id,thresholds_json,hard_cap,enabled,enabled_at,created_at,updated_at)
        SELECT id,'PROXY',provider,cadence,limit_micros_usd,starting_credit_micros_usd,timezone_id,thresholds_json,hard_cap,enabled,enabled_at,created_at,updated_at FROM cost_budgets_v18;
      DROP TABLE cost_budgets_v18;`);
      else this.sql.exec(`CREATE TABLE cost_budgets (
        id TEXT PRIMARY KEY NOT NULL, category TEXT NOT NULL, provider TEXT NOT NULL, cadence TEXT NOT NULL, limit_micros_usd INTEGER NOT NULL,
        starting_credit_micros_usd INTEGER, timezone_id TEXT NOT NULL, thresholds_json TEXT NOT NULL, hard_cap INTEGER NOT NULL,
        enabled INTEGER NOT NULL, enabled_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(category,provider,cadence)
      );`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS budget_threshold_events (
        id TEXT PRIMARY KEY NOT NULL, budget_id TEXT NOT NULL, period_start_at INTEGER NOT NULL, threshold INTEGER NOT NULL,
        fired_at INTEGER NOT NULL, UNIQUE(budget_id,period_start_at,threshold)
      );`);
    }
    if (version < 20) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS payment_profiles (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, brand TEXT, last4 TEXT,
        expiry_month INTEGER, expiry_year INTEGER, tags_json TEXT NOT NULL DEFAULT '[]', payload_secret_id TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS payment_profiles_created_idx ON payment_profiles(created_at ASC);`);
      const addV20Column = (table: string, column: string, definition: string): void => { const columns=this.all(`PRAGMA table_info(${table})`); if(columns.length&&!columns.some((row)=>String(row.name)===column))this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`); };
      addV20Column("browser_profiles","payment_profile_id","payment_profile_id TEXT"); addV20Column("browser_profiles","checkout_mode_override","checkout_mode_override TEXT NOT NULL DEFAULT 'INHERIT_TARGET'");
      addV20Column("targets","checkout_mode","checkout_mode TEXT NOT NULL DEFAULT 'ASSISTED'"); addV20Column("targets","max_checkouts","max_checkouts TEXT NOT NULL DEFAULT 'UNLIMITED'");
      addV20Column("runs","purchase_mode","purchase_mode TEXT NOT NULL DEFAULT 'LEGACY_MANUAL'"); addV20Column("runs","max_checkouts","max_checkouts TEXT NOT NULL DEFAULT 'UNLIMITED'");
      addV20Column("run_sessions","payment_profile_json","payment_profile_json TEXT"); addV20Column("run_sessions","checkout_mode","checkout_mode TEXT NOT NULL DEFAULT 'ASSISTED'"); addV20Column("run_sessions","quota_outcome","quota_outcome TEXT NOT NULL DEFAULT 'NONE'"); addV20Column("run_sessions","order_index","order_index INTEGER");
      addV20Column("run_setups","session_overrides_json","session_overrides_json TEXT NOT NULL DEFAULT '[]'");
      if(this.all("PRAGMA table_info(runs)").some((row)=>String(row.name)==="execution_mode"))this.sql.prepare("UPDATE runs SET execution_mode='CHECKOUT' WHERE execution_mode='ASSISTED_CHECKOUT'").run();
      if(this.all("PRAGMA table_info(run_setups)").some((row)=>String(row.name)==="execution_mode"))this.sql.prepare("UPDATE run_setups SET execution_mode='CHECKOUT' WHERE execution_mode='ASSISTED_CHECKOUT'").run();
    }
    // Earlier v0.12 builds used the user-entered range end as a manual balance's
    // effective timestamp. A balance is observed when it is entered, so repair
    // those records once on open; this also makes today's current balance visible.
    if (this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='provider_balance_snapshots'").get()) {
      this.sql.prepare("UPDATE provider_balance_snapshots SET effective_at=recorded_at WHERE authority='MANUAL_CONFIRMED' AND effective_at>recorded_at").run();
    }
    if (this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='provider_usage_records'").get()) {
      this.sql.prepare("UPDATE provider_usage_records SET interval_end_at=recorded_at WHERE authority='MANUAL_CONFIRMED' AND interval_end_at>recorded_at").run();
    }
    this.sql.exec("PRAGMA user_version = 20;");
  }

  async list(): Promise<BrowserProfile[]> {
    return this.all("SELECT * FROM browser_profiles ORDER BY position ASC, created_at ASC").map((row) => browserProfileSchema.parse(mapProfile(row)));
  }

  /** Applies a manual order; `ids` must name every profile exactly once. */
  async reorder(ids: string[]): Promise<BrowserProfile[]> {
    const existing = new Set(this.all("SELECT id FROM browser_profiles").map((row) => String(row.id)));
    const unique = new Set(ids);
    if (unique.size !== ids.length || ids.length !== existing.size || ids.some((id) => !existing.has(id))) {
      throw new Error("The new browser order must list every browser exactly once.");
    }
    this.transaction(() => {
      const statement = this.sql.prepare("UPDATE browser_profiles SET position=? WHERE id=?");
      ids.forEach((id, index) => statement.run(index, id));
    });
    return this.list();
  }

  async get(id: string): Promise<BrowserProfile | undefined> {
    const row = this.getRow("SELECT * FROM browser_profiles WHERE id = ?", [id]);
    return row ? browserProfileSchema.parse(mapProfile(row)) : undefined;
  }

  async getStoredBrowserProfile(id: string): Promise<StoredBrowserProfile | undefined> {
    const row = this.getRow(`SELECT p.*, s.ciphertext AS external_cdp_endpoint_ciphertext FROM browser_profiles p
      LEFT JOIN app_secrets s ON s.id=p.external_cdp_endpoint_secret_id WHERE p.id=?`, [id]);
    return row ? { ...browserProfileSchema.parse(mapProfile(row)), externalCdpEndpointCiphertext: toBuffer(row.external_cdp_endpoint_ciphertext) } : undefined;
  }

  async create(input: CreateBrowserProfileInput, endpointCiphertext?: Buffer): Promise<BrowserProfile> {
    const parsed = createBrowserProfileSchema.parse(input); const id = randomUUID(); const now = Date.now();
    const endpointSecretId = endpointCiphertext ? randomUUID() : null;
    const profile: BrowserProfile = { id, name: parsed.name, userDataDir: profileDirectory(this.profilesRoot, id), proxyProfileId: null, shippingProfileId: null, paymentProfileId: null, checkoutModeOverride: parsed.checkoutModeOverride, captchaStrategyOverride: parsed.captchaStrategyOverride, driver: parsed.driver.kind === "EXTERNAL_CDP" ? { kind: "EXTERNAL_CDP", endpointConfigured: true } : { kind: "NATIVE_STEALTH" }, enabled: parsed.enabled, createdAt: now, updatedAt: now };
    try {
      this.transaction(() => {
        if (endpointSecretId && endpointCiphertext) this.insertSecret(endpointSecretId, endpointCiphertext, now);
        const last = this.getRow("SELECT MAX(position) AS position FROM browser_profiles");
        const position = last?.position == null ? 0 : Number(last.position) + 1;
        this.sql.prepare("INSERT INTO browser_profiles (id,name,user_data_dir,proxy_profile_id,shipping_profile_id,payment_profile_id,checkout_mode_override,captcha_strategy_override,launch_mode,driver_kind,external_cdp_endpoint_secret_id,enabled,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'PLAYWRIGHT',?,?,?,?,?,?)")
          .run(profile.id, profile.name, profile.userDataDir, null, null, null, profile.checkoutModeOverride, profile.captchaStrategyOverride, profile.driver.kind, endpointSecretId, profile.enabled ? 1 : 0, position, now, now);
      });
    } catch (error) { throw new Error(isUniqueError(error) ? "A browser profile with that name already exists." : "Could not create the browser profile."); }
    return profile;
  }

  async update(id: string, input: UpdateBrowserProfileInput, endpointCiphertext?: EncryptedCredential): Promise<BrowserProfile> {
    const parsed = updateBrowserProfileSchema.parse(input); const existingRow = this.getRow("SELECT * FROM browser_profiles WHERE id=?", [id]);
    if (!existingRow) throw new Error("Browser profile not found.");
    const existing = browserProfileSchema.parse(mapProfile(existingRow));
    if (parsed.proxyProfileId !== undefined && parsed.proxyProfileId !== null && !(await this.getProxy(parsed.proxyProfileId))) throw new Error("Proxy profile not found.");
    if (parsed.shippingProfileId !== undefined && parsed.shippingProfileId !== null && !(await this.getShippingProfile(parsed.shippingProfileId))) throw new Error("Shipping profile not found.");
    if (parsed.paymentProfileId !== undefined && parsed.paymentProfileId !== null && !(await this.getPaymentProfile(parsed.paymentProfileId))) throw new Error("Payment profile not found.");
    const nextKind = parsed.driver?.kind ?? existing.driver.kind;
    const endpointUpdate = nextKind === "NATIVE_STEALTH" ? null : endpointCiphertext;
    const endpointSecretId = this.replaceSecret(existingRow.external_cdp_endpoint_secret_id, endpointUpdate, Date.now());
    const { driver: _driver, ...plainUpdates } = parsed;
    const updated = browserProfileSchema.parse({ ...existing, ...plainUpdates, driver: nextKind === "EXTERNAL_CDP" ? { kind: "EXTERNAL_CDP", endpointConfigured: Boolean(endpointSecretId) } : { kind: "NATIVE_STEALTH" }, updatedAt: Date.now() });
    try {
      this.transaction(() => {
        this.updateSecret(existingRow.external_cdp_endpoint_secret_id, endpointSecretId, endpointUpdate, updated.updatedAt);
        this.sql.prepare("UPDATE browser_profiles SET name=?, enabled=?, driver_kind=?, external_cdp_endpoint_secret_id=?, proxy_profile_id=?, shipping_profile_id=?, payment_profile_id=?, checkout_mode_override=?, captcha_strategy_override=?, updated_at=? WHERE id=?")
          .run(updated.name, updated.enabled ? 1 : 0, updated.driver.kind, endpointSecretId, updated.proxyProfileId, updated.shippingProfileId, updated.paymentProfileId, updated.checkoutModeOverride, updated.captchaStrategyOverride, updated.updatedAt, id);
        if (parsed.proxyProfileId !== undefined || parsed.driver !== undefined) this.sql.prepare("UPDATE profile_warm_states SET status='REVIEW', updated_at=? WHERE browser_profile_id=?").run(updated.updatedAt, id);
      });
    } catch (error) { throw new Error(isUniqueError(error) ? "A browser profile with that name already exists." : "Could not update the browser profile."); }
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const existing = this.getRow("SELECT external_cdp_endpoint_secret_id FROM browser_profiles WHERE id=?", [id]); if (!existing) return false;
    this.transaction(() => { this.sql.prepare("DELETE FROM profile_warm_states WHERE browser_profile_id=?").run(id); this.sql.prepare("DELETE FROM browser_profiles WHERE id = ?").run(id); if (existing.external_cdp_endpoint_secret_id) this.sql.prepare("DELETE FROM app_secrets WHERE id=?").run(existing.external_cdp_endpoint_secret_id); });
    return true;
  }

  async listShippingProfiles(): Promise<ShippingProfile[]> { return this.all("SELECT * FROM shipping_profiles ORDER BY created_at ASC").map((row) => shippingProfileSchema.parse(mapShipping(row))); }
  async getShippingProfile(id: string): Promise<ShippingProfile | undefined> { const row = this.getRow("SELECT * FROM shipping_profiles WHERE id = ?", [id]); return row ? shippingProfileSchema.parse(mapShipping(row)) : undefined; }
  async getStoredShippingProfile(id: string): Promise<StoredShippingProfile | undefined> {
    const row = this.getRow("SELECT s.*, a.ciphertext AS details_ciphertext FROM shipping_profiles s LEFT JOIN app_secrets a ON a.id = s.details_secret_id WHERE s.id = ?", [id]);
    return row ? { ...shippingProfileSchema.parse(mapShipping(row)), detailsCiphertext: toBuffer(row.details_ciphertext) } : undefined;
  }
  async createShippingProfile(input: CreateShippingProfileInput, ciphertext: Buffer): Promise<ShippingProfile> {
    const parsed = createShippingProfileSchema.parse(input); const id = randomUUID(); const secretId = randomUUID(); const now = Date.now();
    this.transaction(() => { this.insertSecret(secretId, ciphertext, now); try { this.sql.prepare("INSERT INTO shipping_profiles (id,name,details_secret_id,country,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(id, parsed.name, secretId, parsed.details.country, parsed.enabled ? 1 : 0, now, now); } catch (error) { throw new Error(isUniqueError(error) ? "A shipping profile with that name already exists." : "Could not create shipping profile."); } });
    return (await this.getShippingProfile(id))!;
  }
  async updateShippingProfile(id: string, input: UpdateShippingProfileInput, ciphertext: Buffer | null | undefined): Promise<ShippingProfile> {
    const parsed = updateShippingProfileSchema.parse(input); const existing = this.getRow("SELECT * FROM shipping_profiles WHERE id = ?", [id]); if (!existing) throw new Error("Shipping profile not found."); const now = Date.now();
    const detailsSecretId = this.replaceSecret(existing.details_secret_id, ciphertext, now); const current = shippingProfileSchema.parse(mapShipping(existing)); const country = parsed.details ? parsed.details.country : ciphertext === null ? null : current.country;
    const updated = shippingProfileSchema.parse({ ...current, ...parsed, country, detailsConfigured: Boolean(detailsSecretId), complete: Boolean(detailsSecretId), updatedAt: now });
    this.transaction(() => { this.updateSecret(existing.details_secret_id, detailsSecretId, ciphertext, now); try { this.sql.prepare("UPDATE shipping_profiles SET name=?,details_secret_id=?,country=?,enabled=?,updated_at=? WHERE id=?").run(updated.name, detailsSecretId, updated.country, updated.enabled ? 1 : 0, now, id); } catch (error) { throw new Error(isUniqueError(error) ? "A shipping profile with that name already exists." : "Could not update shipping profile."); } });
    return updated;
  }
  async removeShippingProfile(id: string): Promise<boolean> {
    const existing = this.getRow("SELECT * FROM shipping_profiles WHERE id = ?", [id]); if (!existing) return false;
    this.transaction(() => { this.sql.prepare("UPDATE browser_profiles SET shipping_profile_id=NULL, updated_at=? WHERE shipping_profile_id=?").run(Date.now(), id); this.sql.prepare("DELETE FROM shipping_profiles WHERE id=?").run(id); if (existing.details_secret_id) this.sql.prepare("DELETE FROM app_secrets WHERE id=?").run(existing.details_secret_id); }); return true;
  }

  async listPaymentProfiles(): Promise<PaymentProfile[]> { return this.all("SELECT * FROM payment_profiles ORDER BY created_at ASC").map((row) => paymentProfileSchema.parse(mapPayment(row))); }
  async getPaymentProfile(id: string): Promise<PaymentProfile | undefined> { const row = this.getRow("SELECT * FROM payment_profiles WHERE id=?", [id]); return row ? paymentProfileSchema.parse(mapPayment(row)) : undefined; }
  async getStoredPaymentProfile(id: string): Promise<StoredPaymentProfile | undefined> {
    const row = this.getRow("SELECT p.*,s.ciphertext AS payload_ciphertext FROM payment_profiles p LEFT JOIN app_secrets s ON s.id=p.payload_secret_id WHERE p.id=?", [id]);
    return row ? { ...paymentProfileSchema.parse(mapPayment(row)), payloadCiphertext: toBuffer(row.payload_ciphertext) } : undefined;
  }
  async createPaymentProfile(input: CreatePaymentProfileInput, ciphertext: Buffer): Promise<PaymentProfile> {
    const parsed = createPaymentProfileSchema.parse(input); return this.insertPaymentProfiles([{ input: parsed, ciphertext }], [])[0];
  }
  async createPaymentProfilesAtomic(entries: EncryptedPaymentProfileCreate[], assignments: { entryIndex: number; browserProfileId: string }[]): Promise<PaymentProfile[]> {
    const parsed = entries.map((entry) => ({ input: createPaymentProfileSchema.parse(entry.input), ciphertext: entry.ciphertext }));
    const profileIds = new Set(this.all("SELECT id FROM browser_profiles").map((row) => String(row.id)));
    if (assignments.some((entry) => entry.entryIndex < 0 || entry.entryIndex >= parsed.length || !profileIds.has(entry.browserProfileId))) throw new Error("A batch browser assignment is invalid.");
    if (new Set(assignments.map((entry) => entry.browserProfileId)).size !== assignments.length) throw new Error("Each browser may only be assigned once per batch.");
    return this.insertPaymentProfiles(parsed, assignments);
  }
  private insertPaymentProfiles(entries: { input: ReturnType<typeof createPaymentProfileSchema.parse>; ciphertext: Buffer }[], assignments: { entryIndex: number; browserProfileId: string }[]): PaymentProfile[] {
    const now = Date.now(); const created: PaymentProfile[] = [];
    this.transaction(() => {
      for (const entry of entries) {
        const id = randomUUID(); const secretId = randomUUID(); const pan = entry.input.cardNumber;
        this.insertSecret(secretId, entry.ciphertext, now);
        try { this.sql.prepare("INSERT INTO payment_profiles (id,name,kind,brand,last4,expiry_month,expiry_year,tags_json,payload_secret_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .run(id, entry.input.name, entry.input.kind, cardBrand(pan), pan.slice(-4), entry.input.expiryMonth, entry.input.expiryYear, JSON.stringify(normalizePaymentTags(entry.input.tags)), secretId, now, now); }
        catch (error) { throw new Error(isUniqueError(error) ? "A payment profile with that name already exists." : "Could not create payment profile."); }
        created.push(paymentProfileSchema.parse(mapPayment(this.getRow("SELECT * FROM payment_profiles WHERE id=?", [id])!)));
      }
      for (const assignment of assignments) this.sql.prepare("UPDATE browser_profiles SET payment_profile_id=?,updated_at=? WHERE id=?").run(created[assignment.entryIndex].id, now, assignment.browserProfileId);
    });
    return created;
  }
  async updatePaymentProfile(id: string, input: UpdatePaymentProfileInput, ciphertext: Buffer | undefined): Promise<PaymentProfile> {
    const parsed = updatePaymentProfileSchema.parse(input); const row = this.getRow("SELECT * FROM payment_profiles WHERE id=?", [id]); if (!row) throw new Error("Payment profile not found."); const now = Date.now();
    const current = paymentProfileSchema.parse(mapPayment(row)); const secretId = ciphertext ? randomUUID() : String(row.payload_secret_id);
    const replacement = parsed.replacement; const next = paymentProfileSchema.parse({ ...current, name: parsed.name ?? current.name, tags: normalizePaymentTags(parsed.tags ?? current.tags), ...(replacement ? { kind: replacement.kind, brand: cardBrand(replacement.cardNumber), last4: replacement.cardNumber.slice(-4), expiryMonth: replacement.expiryMonth, expiryYear: replacement.expiryYear, configured: true } : {}), updatedAt: now });
    this.transaction(() => { if (ciphertext) { this.insertSecret(secretId, ciphertext, now); if (row.payload_secret_id) this.sql.prepare("DELETE FROM app_secrets WHERE id=?").run(row.payload_secret_id); } try { this.sql.prepare("UPDATE payment_profiles SET name=?,kind=?,brand=?,last4=?,expiry_month=?,expiry_year=?,tags_json=?,payload_secret_id=?,updated_at=? WHERE id=?").run(next.name,next.kind,next.brand,next.last4,next.expiryMonth,next.expiryYear,JSON.stringify(next.tags),secretId,now,id); } catch (error) { throw new Error(isUniqueError(error) ? "A payment profile with that name already exists." : "Could not update payment profile."); } });
    return next;
  }
  async removePaymentProfile(id: string): Promise<boolean> {
    const row = this.getRow("SELECT payload_secret_id FROM payment_profiles WHERE id=?", [id]); if (!row) return false;
    this.transaction(() => { this.sql.prepare("UPDATE browser_profiles SET payment_profile_id=NULL,updated_at=? WHERE payment_profile_id=?").run(Date.now(),id); this.sql.prepare("DELETE FROM payment_profiles WHERE id=?").run(id); if (row.payload_secret_id) this.sql.prepare("DELETE FROM app_secrets WHERE id=?").run(row.payload_secret_id); }); return true;
  }

  async listProxies(): Promise<ProxyProfile[]> {
    return this.all("SELECT * FROM proxy_profiles ORDER BY created_at ASC").map((row) => proxyProfileSchema.parse(mapProxy(row)));
  }

  async getProxy(id: string): Promise<ProxyProfile | undefined> {
    const row = this.getRow("SELECT * FROM proxy_profiles WHERE id = ?", [id]);
    return row ? proxyProfileSchema.parse(mapProxy(row)) : undefined;
  }

  async getStoredProxy(id: string): Promise<StoredProxy | undefined> {
    const row = this.getRow(`SELECT p.*, u.ciphertext AS username_ciphertext, pw.ciphertext AS password_ciphertext
      FROM proxy_profiles p LEFT JOIN app_secrets u ON u.id = p.username_secret_id LEFT JOIN app_secrets pw ON pw.id = p.password_secret_id WHERE p.id = ?`, [id]);
    return row ? { ...proxyProfileSchema.parse(mapProxy(row)), usernameCiphertext: toBuffer(row.username_ciphertext), passwordCiphertext: toBuffer(row.password_ciphertext) } : undefined;
  }

  async createProxy(input: CreateProxyProfileInput, credentials: EncryptedProxyCredentials = {}): Promise<ProxyProfile> {
    const parsed = createProxyProfileSchema.parse(input); const id = randomUUID(); const now = Date.now();
    const usernameSecretId = credentials.username ? randomUUID() : null; const passwordSecretId = credentials.password ? randomUUID() : null;
    this.transaction(() => {
      if (usernameSecretId && credentials.username) this.insertSecret(usernameSecretId, credentials.username, now);
      if (passwordSecretId && credentials.password) this.insertSecret(passwordSecretId, credentials.password, now);
      try {
        this.sql.prepare(`INSERT INTO proxy_profiles (id,name,provider,type,protocol,host,port,username_secret_id,password_secret_id,expected_country,expected_city,cost_per_gb_micros_usd,enabled,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, parsed.name, parsed.provider, parsed.type, parsed.protocol, parsed.host, parsed.port, usernameSecretId, passwordSecretId, parsed.expectedCountry ?? null, parsed.expectedCity ?? null, parsed.costPerGbMicrosUsd, parsed.enabled ? 1 : 0, now, now);
      } catch (error) { throw new Error(isUniqueError(error) ? "A proxy profile with that name already exists." : "Could not create the proxy profile."); }
    });
    return (await this.getProxy(id))!;
  }

  async updateProxy(id: string, input: UpdateProxyProfileInput, credentials: EncryptedProxyCredentialUpdate = {}): Promise<ProxyProfile> {
    const parsed = updateProxyProfileSchema.parse(input); const existing = this.getProxyRow(id);
    if (!existing) throw new Error("Proxy profile not found.");
    const now = Date.now();
    const usernameSecretId = this.replaceSecret(existing.username_secret_id, credentials.username, now);
    const passwordSecretId = this.replaceSecret(existing.password_secret_id, credentials.password, now);
    const updated = { ...proxyProfileSchema.parse(mapProxy(existing)), ...parsed, usernameConfigured: Boolean(usernameSecretId), passwordConfigured: Boolean(passwordSecretId), updatedAt: now };
    this.transaction(() => {
      this.updateSecret(existing.username_secret_id, usernameSecretId, credentials.username, now);
      this.updateSecret(existing.password_secret_id, passwordSecretId, credentials.password, now);
      try {
        this.sql.prepare(`UPDATE proxy_profiles SET name=?,provider=?,type=?,protocol=?,host=?,port=?,username_secret_id=?,password_secret_id=?,expected_country=?,expected_city=?,cost_per_gb_micros_usd=?,enabled=?,updated_at=? WHERE id=?`)
          .run(updated.name, updated.provider, updated.type, updated.protocol, updated.host, updated.port, usernameSecretId, passwordSecretId, updated.expectedCountry, updated.expectedCity, updated.costPerGbMicrosUsd, updated.enabled ? 1 : 0, now, id);
        this.sql.prepare("UPDATE profile_warm_states SET status='REVIEW', updated_at=? WHERE proxy_profile_id=?").run(now, id);
      } catch (error) { throw new Error(isUniqueError(error) ? "A proxy profile with that name already exists." : "Could not update the proxy profile."); }
    });
    return proxyProfileSchema.parse(updated);
  }

  async removeProxy(id: string): Promise<boolean> {
    const existing = this.getProxyRow(id); if (!existing) return false;
    this.transaction(() => {
      this.sql.prepare("UPDATE profile_warm_states SET status='REVIEW', updated_at=? WHERE proxy_profile_id=?").run(Date.now(), id);
      this.sql.prepare("UPDATE browser_profiles SET proxy_profile_id = NULL, updated_at = ? WHERE proxy_profile_id = ?").run(Date.now(), id);
      this.sql.prepare("DELETE FROM proxy_profiles WHERE id = ?").run(id);
      if (existing.username_secret_id) this.sql.prepare("DELETE FROM app_secrets WHERE id = ?").run(existing.username_secret_id);
      if (existing.password_secret_id) this.sql.prepare("DELETE FROM app_secrets WHERE id = ?").run(existing.password_secret_id);
    });
    return true;
  }

  async addBenchmark(benchmark: ProxyBenchmark): Promise<ProxyBenchmark> {
    const value = proxyBenchmarkSchema.parse(benchmark);
    this.sql.prepare(`INSERT INTO proxy_benchmarks (id,route_kind,proxy_profile_id,probe_url,started_at,completed_at,attempts,successes,public_ip,country,city,connect_latency_ms,median_latency_ms,jitter_ms,failure_rate,ip_stable,quality_score,status,error_code,error_message,samples_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(value.id, value.routeKind, value.proxyProfileId, value.probeUrl, value.startedAt, value.completedAt, value.attempts, value.successes, value.publicIp, value.country, value.city, value.connectLatencyMs, value.medianLatencyMs, value.jitterMs, value.failureRate, value.ipStable ? 1 : 0, value.qualityScore, value.status, value.errorCode, value.errorMessage, JSON.stringify(value.samples));
    return value;
  }

  async listBenchmarks(proxyProfileId: string | null, limit = 10): Promise<ProxyBenchmark[]> {
    const rows = proxyProfileId === null
      ? this.all("SELECT * FROM proxy_benchmarks WHERE route_kind = 'direct' ORDER BY completed_at DESC LIMIT ?", [limit])
      : this.all("SELECT * FROM proxy_benchmarks WHERE proxy_profile_id = ? ORDER BY completed_at DESC LIMIT ?", [proxyProfileId, limit]);
    return rows.map((row) => proxyBenchmarkSchema.parse(mapBenchmark(row)));
  }

  async getNetworkProbeUrl(): Promise<string> {
    const row = this.getRow("SELECT value FROM app_settings WHERE key = 'network_probe_url'");
    return row ? networkProbeSettingsSchema.parse({ probeUrl: row.value }).probeUrl : DEFAULT_NETWORK_PROBE_URL;
  }

  async setNetworkProbeUrl(probeUrl: string): Promise<string> {
    const value = networkProbeSettingsSchema.parse({ probeUrl }).probeUrl; const now = Date.now();
    this.sql.prepare("INSERT INTO app_settings (key,value,updated_at) VALUES ('network_probe_url',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(value, now);
    return value;
  }

  async listStoreSettings(): Promise<Record<string, boolean>> {
    const row = this.getRow("SELECT value FROM app_settings WHERE key = 'store_settings'");
    if (!row) return {};
    try { const parsed: unknown = JSON.parse(String(row.value)); return parsed && typeof parsed === "object" ? Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([id, enabled]) => [id, Boolean(enabled)])) : {}; }
    catch { return {}; }
  }

  async setStoreEnabled(id: string, enabled: boolean): Promise<Record<string, boolean>> {
    const next = { ...(await this.listStoreSettings()), [id]: enabled }; const now = Date.now();
    this.sql.prepare("INSERT INTO app_settings (key,value,updated_at) VALUES ('store_settings',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(JSON.stringify(next), now);
    return next;
  }

  async listTargets(): Promise<Target[]> { return this.all("SELECT * FROM targets ORDER BY created_at ASC").map((row) => targetSchema.parse(mapTarget(row))); }
  async getTarget(id: string): Promise<Target | undefined> { const row = this.getRow("SELECT * FROM targets WHERE id = ?", [id]); return row ? targetSchema.parse(mapTarget(row)) : undefined; }
  async createTarget(input: CreateTargetInput): Promise<Target> {
    const parsed = createTargetSchema.parse(input); const id = randomUUID(); const now = Date.now();
    try { this.sql.prepare("INSERT INTO targets (id,name,store_id,product_keywords_json,negative_keywords_json,direct_product_url,preferred_colors_json,size_priority_json,currency,max_retail_minor,quantity,checkout_mode,max_checkouts,captcha_strategy,enabled,latest_check_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, parsed.name, parsed.storeId, JSON.stringify(parsed.productKeywords), JSON.stringify(parsed.negativeKeywords), parsed.directProductUrl, JSON.stringify(parsed.preferredColors), JSON.stringify(parsed.sizePriority), parsed.currency, parsed.maxRetailMinor, parsed.quantity, parsed.checkoutMode, String(parsed.maxCheckouts), parsed.captchaStrategy, parsed.enabled ? 1 : 0, null, now, now); } catch (error) { throw new Error(isUniqueError(error) ? "A target with that name already exists." : "Could not create target."); }
    return (await this.getTarget(id))!;
  }
  async updateTarget(id: string, input: UpdateTargetInput): Promise<Target> {
    const parsed = updateTargetSchema.parse(input); const existing = await this.getTarget(id); if (!existing) throw new Error("Target not found."); const updated = targetSchema.parse({ ...existing, ...parsed, updatedAt: Date.now() });
    try { this.sql.prepare("UPDATE targets SET name=?,store_id=?,product_keywords_json=?,negative_keywords_json=?,direct_product_url=?,preferred_colors_json=?,size_priority_json=?,currency=?,max_retail_minor=?,quantity=?,checkout_mode=?,max_checkouts=?,captcha_strategy=?,enabled=?,updated_at=? WHERE id=?")
      .run(updated.name, updated.storeId, JSON.stringify(updated.productKeywords), JSON.stringify(updated.negativeKeywords), updated.directProductUrl, JSON.stringify(updated.preferredColors), JSON.stringify(updated.sizePriority), updated.currency, updated.maxRetailMinor, updated.quantity, updated.checkoutMode, String(updated.maxCheckouts), updated.captchaStrategy, updated.enabled ? 1 : 0, updated.updatedAt, id); } catch (error) { throw new Error(isUniqueError(error) ? "A target with that name already exists." : "Could not update target."); }
    return (await this.getTarget(id))!;
  }
  async setTargetCheck(targetId: string, check: TargetCheck): Promise<Target> { const value = targetCheckSchema.parse(check); this.sql.prepare("UPDATE targets SET latest_check_json=?, updated_at=? WHERE id=?").run(JSON.stringify(value), Date.now(), targetId); const target = await this.getTarget(targetId); if (!target) throw new Error("Target not found."); return target; }
  async removeTarget(id: string): Promise<boolean> { return this.sql.prepare("DELETE FROM targets WHERE id = ?").run(id).changes > 0; }

  async createRun(input: CreateRunInput, environment: RunEnvironment, sessions: NewRunSession[], targetSnapshot: TargetSnapshot | null = null): Promise<RunDetail> {
    const parsed = createRunSchema.parse(input); const now = Date.now(); const id = randomUUID();
    const run: Run = runSchema.parse({ id, name: parsed.name, diagnosticLevel: parsed.diagnosticLevel, executionMode: parsed.executionMode, purchaseMode: parsed.purchaseMode, maxCheckouts: targetSnapshot?.maxCheckouts ?? "UNLIMITED", status: "STARTING", startedAt: now, endedAt: null, environment, targetSnapshot, discoverySnapshot: null, createdAt: now, updatedAt: now });
    this.transaction(() => {
      this.sql.prepare("INSERT INTO runs (id,name,diagnostic_level,execution_mode,purchase_mode,max_checkouts,status,started_at,ended_at,environment_json,target_snapshot_json,discovery_snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(run.id, run.name, run.diagnosticLevel, run.executionMode, run.purchaseMode, String(run.maxCheckouts), run.status, run.startedAt, null, JSON.stringify(run.environment), targetSnapshot ? JSON.stringify(targetSnapshot) : null, null, now, now);
      for (const session of sessions) {
        const value = runSessionSchema.parse({ ...session, runId: id });
        this.sql.prepare("INSERT INTO run_sessions (id,run_id,browser_profile_id,browser_profile_name,route_json,shipping_profile_json,payment_profile_json,checkout_mode,captcha_strategy,captcha_provider_json,assisted_eligible,execution_state,checkpoint_reason,quota_outcome,order_index,status,started_at,ended_at,final_error_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(value.id, id, value.browserProfileId, value.browserProfileName, JSON.stringify(value.route), JSON.stringify(value.shippingProfile), JSON.stringify(value.paymentProfile), value.checkoutMode, value.captchaStrategy, value.captchaProvider ? JSON.stringify(value.captchaProvider) : null, value.assistedEligible ? 1 : 0, value.executionState, value.checkpointReason, value.quotaOutcome, value.orderIndex, value.status, value.startedAt, value.endedAt, value.finalError ? JSON.stringify(value.finalError) : null);
      }
    });
    return (await this.getRun(id))!;
  }

  async getMonitorSettings(): Promise<MonitorSettings> {
    const enabled = new Set((await this.listProxies()).filter((proxy) => proxy.enabled).map((proxy) => proxy.id));
    const row = this.getRow("SELECT value FROM app_settings WHERE key = 'monitor_settings'");
    if (row) {
      try { const parsed = monitorSettingsSchema.parse(JSON.parse(String(row.value))); return { ...parsed, proxyProfileIds: parsed.proxyProfileIds.filter((id) => enabled.has(id)) }; }
      catch { return defaultMonitorSettings(); }
    }
    const legacy = this.getRow("SELECT value FROM app_settings WHERE key = 'monitor_network'");
    let proxyProfileIds: string[] = [];
    try { const value = legacy ? JSON.parse(String(legacy.value)) as { proxyProfileIds?: unknown } : {}; if (Array.isArray(value.proxyProfileIds)) proxyProfileIds = value.proxyProfileIds.filter((id): id is string => typeof id === "string" && enabled.has(id)); } catch { /* use defaults */ }
    const migrated = defaultMonitorSettings(proxyProfileIds); this.setJsonSetting("monitor_settings", migrated); return migrated;
  }

  async setMonitorSettings(input: MonitorSettings): Promise<MonitorSettings> {
    const value = monitorSettingsSchema.parse(input);
    const existing = new Set((await this.listProxies()).filter((proxy) => proxy.enabled).map((proxy) => proxy.id));
    const filtered = { ...value, proxyProfileIds: value.proxyProfileIds.filter((id) => existing.has(id)) };
    this.setJsonSetting("monitor_settings", filtered);
    return filtered;
  }

  async getCaptchaSettings(): Promise<CaptchaSettings> {
    const defaults = defaultCaptchaSettings();
    const row = this.getRow("SELECT value FROM app_settings WHERE key='captcha_settings'");
    let base: Omit<CaptchaSettings, "providers"> = { appMode: defaults.appMode, activeProvider: defaults.activeProvider, solveTimeoutMs: defaults.solveTimeoutMs, fallbackAfterMs: defaults.fallbackAfterMs };
    if (row) {
      try {
        const stored = JSON.parse(String(row.value)) as Partial<CaptchaSettings>;
        base = captchaSettingsSchema.omit({ providers: true }).parse({ ...base, ...stored });
      } catch { /* retain safe defaults */ }
    }
    const providers = this.all(`SELECT p.*, c.api_key_secret_id FROM captcha_providers p LEFT JOIN captcha_provider_credentials c ON c.provider_kind=p.kind ORDER BY p.created_at ASC`)
      .map((provider) => { let lastDiagnostic: unknown = null; try { lastDiagnostic = provider.last_diagnostic_json ? JSON.parse(String(provider.last_diagnostic_json)) : null; } catch { /* ignored */ } return captchaProviderConfigSchema.parse({ kind: provider.kind, label: provider.label, endpoint: provider.endpoint ?? null, apiKeyConfigured: Boolean(provider.api_key_secret_id), enabled: Boolean(provider.enabled), lastDiagnostic, updatedAt: Number(provider.updated_at) }); });
    const activeProvider = base.activeProvider && providers.some((provider) => provider.kind === base.activeProvider && provider.enabled) ? base.activeProvider : null;
    return captchaSettingsSchema.parse({ ...base, activeProvider, providers });
  }

  async setCaptchaSettings(input: UpdateCaptchaSettingsInput): Promise<CaptchaSettings> {
    const current = await this.getCaptchaSettings();
    const next = captchaSettingsSchema.omit({ providers: true }).parse({ ...current, ...input });
    if (next.activeProvider && !current.providers.some((provider) => provider.kind === next.activeProvider && provider.enabled)) throw new Error("The active CAPTCHA provider must be configured and enabled.");
    this.setJsonSetting("captcha_settings", next);
    return this.getCaptchaSettings();
  }

  async upsertCaptchaProvider(input: { kind: CaptchaProviderKind; label: string; endpoint: string | null; enabled: boolean }, apiKeyCiphertext?: EncryptedCredential): Promise<CaptchaSettings> {
    const now = Date.now(); const existing = this.getRow("SELECT * FROM captcha_providers WHERE kind=?", [input.kind]);
    const credential = this.getRow("SELECT api_key_secret_id FROM captcha_provider_credentials WHERE provider_kind=?", [input.kind]);
    const nextSecretId = this.replaceSecret(credential?.api_key_secret_id, apiKeyCiphertext, now);
    this.transaction(() => {
      this.updateSecret(credential?.api_key_secret_id, nextSecretId, apiKeyCiphertext, now);
      this.sql.prepare(`INSERT INTO captcha_providers (kind,label,endpoint,enabled,last_diagnostic_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(kind) DO UPDATE SET label=excluded.label,endpoint=excluded.endpoint,enabled=excluded.enabled,updated_at=excluded.updated_at`)
        .run(input.kind, input.label, input.endpoint, input.enabled ? 1 : 0, existing?.last_diagnostic_json ?? null, existing ? Number(existing.created_at) : now, now);
      if (nextSecretId) this.sql.prepare(`INSERT INTO captcha_provider_credentials (provider_kind,api_key_secret_id,updated_at) VALUES (?,?,?)
        ON CONFLICT(provider_kind) DO UPDATE SET api_key_secret_id=excluded.api_key_secret_id,updated_at=excluded.updated_at`).run(input.kind, nextSecretId, now);
      else this.sql.prepare("DELETE FROM captcha_provider_credentials WHERE provider_kind=?").run(input.kind);
    });
    return this.getCaptchaSettings();
  }

  async getStoredCaptchaProvider(kind: CaptchaProviderKind): Promise<StoredCaptchaProvider | undefined> {
    const row = this.getRow(`SELECT p.*, c.api_key_secret_id, s.ciphertext AS api_key_ciphertext FROM captcha_providers p
      LEFT JOIN captcha_provider_credentials c ON c.provider_kind=p.kind LEFT JOIN app_secrets s ON s.id=c.api_key_secret_id WHERE p.kind=?`, [kind]);
    if (!row) return undefined;
    let lastDiagnostic: CaptchaProviderDiagnostic | null = null;
    try { lastDiagnostic = row.last_diagnostic_json ? captchaProviderDiagnosticSchema.parse(JSON.parse(String(row.last_diagnostic_json))) : null; } catch { /* corrupted diagnostics are ignored */ }
    const config = captchaProviderConfigSchema.parse({ kind: row.kind, label: row.label, endpoint: row.endpoint ?? null, apiKeyConfigured: Boolean(row.api_key_secret_id), enabled: Boolean(row.enabled), lastDiagnostic, updatedAt: Number(row.updated_at) });
    return { ...config, apiKeyCiphertext: toBuffer(row.api_key_ciphertext), lastDiagnostic };
  }

  async setCaptchaProviderDiagnostic(diagnostic: CaptchaProviderDiagnostic): Promise<void> {
    const value = captchaProviderDiagnosticSchema.parse(diagnostic);
    this.sql.prepare("UPDATE captcha_providers SET last_diagnostic_json=?,updated_at=? WHERE kind=?").run(JSON.stringify(value), Date.now(), value.provider);
  }

  async removeCaptchaProvider(kind: CaptchaProviderKind): Promise<CaptchaSettings> {
    const before = await this.getCaptchaSettings();
    const credential = this.getRow("SELECT api_key_secret_id FROM captcha_provider_credentials WHERE provider_kind=?", [kind]);
    this.transaction(() => {
      this.sql.prepare("DELETE FROM captcha_provider_credentials WHERE provider_kind=?").run(kind);
      this.sql.prepare("DELETE FROM captcha_providers WHERE kind=?").run(kind);
      if (credential?.api_key_secret_id) this.sql.prepare("DELETE FROM app_secrets WHERE id=?").run(credential.api_key_secret_id);
    });
    const settings = await this.getCaptchaSettings();
    if (before.activeProvider === kind) return this.setCaptchaSettings({ ...settings, activeProvider: null });
    return settings;
  }

  async getAppearanceSettings(): Promise<AppearanceSettings> {
    const row = this.getRow("SELECT value FROM app_settings WHERE key = 'appearance_settings'");
    if (!row) return defaultAppearanceSettings();
    try { return appearanceSettingsSchema.parse(JSON.parse(String(row.value))); }
    catch { return defaultAppearanceSettings(); }
  }

  async setAppearanceSettings(input: AppearanceSettings): Promise<AppearanceSettings> {
    const value = appearanceSettingsSchema.parse(input);
    this.setJsonSetting("appearance_settings", value);
    return value;
  }

  /* The window frame is drawn by the OS before the renderer exists, so the
     resolved chrome colours are cached here for the next launch. */
  getChromeColors(): ChromeColors | null {
    const row = this.getRow("SELECT value FROM app_settings WHERE key = 'appearance_chrome'");
    if (!row) return null;
    try { return chromeColorsSchema.parse(JSON.parse(String(row.value))); }
    catch { return null; }
  }

  setChromeColors(input: ChromeColors): ChromeColors {
    const value = chromeColorsSchema.parse(input);
    this.setJsonSetting("appearance_chrome", value);
    return value;
  }

  /* Synchronous, like the chrome colours: both are read while the window is
     being constructed, before any IPC exists to ask the renderer. */
  getWindowBounds(): WindowBounds | null {
    const row = this.getRow("SELECT value FROM app_settings WHERE key = 'window_bounds'");
    if (!row) return null;
    try { return windowBoundsSchema.parse(JSON.parse(String(row.value))); }
    catch { return null; }
  }

  setWindowBounds(input: WindowBounds): WindowBounds {
    const value = windowBoundsSchema.parse(input);
    this.setJsonSetting("window_bounds", value);
    return value;
  }

  async listRunSetups(): Promise<RunSetup[]> {
    return this.all("SELECT * FROM run_setups ORDER BY created_at ASC").map((row) => runSetupSchema.parse(mapRunSetup(row)));
  }

  async createRunSetup(input: CreateRunSetupInput): Promise<RunSetup> {
    const parsed = createRunSetupSchema.parse(input); const id = randomUUID(); const now = Date.now();
    try { this.sql.prepare("INSERT INTO run_setups (id,name,diagnostic_level,execution_mode,profile_ids_json,session_overrides_json,captcha_overrides_json,target_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, parsed.name, parsed.diagnosticLevel, parsed.executionMode, JSON.stringify(parsed.profileIds), JSON.stringify(parsed.sessionOverrides), JSON.stringify(parsed.captchaOverrides), parsed.targetId, now, now); }
    catch (error) { throw new Error(isUniqueError(error) ? "A saved run setup with that name already exists." : "Could not save the run setup."); }
    return runSetupSchema.parse({ id, ...parsed, createdAt: now, updatedAt: now });
  }

  async removeRunSetup(id: string): Promise<boolean> {
    return this.sql.prepare("DELETE FROM run_setups WHERE id = ?").run(id).changes > 0;
  }

  async listRuns(limit = 100): Promise<Run[]> {
    return this.all("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?", [limit]).map((row) => runSchema.parse(mapRun(row)));
  }

  async getRun(id: string): Promise<RunDetail | undefined> {
    const row = this.getRow("SELECT * FROM runs WHERE id = ?", [id]); if (!row) return undefined;
    const sessions = this.all("SELECT * FROM run_sessions WHERE run_id = ? ORDER BY started_at ASC", [id]).map((value) => runSessionSchema.parse(mapRunSession(value)));
    const events = this.all("SELECT * FROM run_events WHERE run_id = ? ORDER BY CAST(elapsed_ns AS INTEGER) ASC, wall_time_ms ASC", [id]).map((value) => runEventSchema.parse(mapRunEvent(value)));
    const artifacts = this.all("SELECT * FROM run_artifacts WHERE run_id = ? ORDER BY created_at ASC", [id]).map((value) => runArtifactSchema.parse(mapRunArtifact(value)));
    return runDetailSchema.parse({ run: mapRun(row), sessions, events, artifacts });
  }

  async setRunStatus(id: string, status: Run["status"], ended = false): Promise<void> {
    const now = Date.now(); this.sql.prepare("UPDATE runs SET status=?, ended_at=?, updated_at=? WHERE id=?").run(status, ended ? now : null, now, id);
  }

  async setRunSession(id: string, status: RunSession["status"], route?: RunSession["route"], finalError?: RunSession["finalError"]): Promise<void> {
    const ended = status === "ENDED" || status === "FAILED" ? Date.now() : null;
    this.sql.prepare("UPDATE run_sessions SET status=?, route_json=COALESCE(?,route_json), ended_at=COALESCE(?,ended_at), final_error_json=? WHERE id=?")
      .run(status, route ? JSON.stringify(route) : null, ended, finalError ? JSON.stringify(finalError) : null, id);
  }
  async setRunSessionExecution(id: string, executionState: RunSession["executionState"], checkpointReason: string | null = null): Promise<void> { this.sql.prepare("UPDATE run_sessions SET execution_state=?, checkpoint_reason=? WHERE id=?").run(executionState, checkpointReason, id); }
  async setRunSessionQuota(id: string, quotaOutcome: RunSession["quotaOutcome"], orderIndex: number | null = null): Promise<void> { this.sql.prepare("UPDATE run_sessions SET quota_outcome=?,order_index=? WHERE id=?").run(quotaOutcome,orderIndex,id); }

  async addRunEvent(event: RunEvent): Promise<RunEvent> {
    const value = runEventSchema.parse(event);
    this.transaction(() => {
      this.sql.prepare("INSERT INTO run_events (id,run_id,run_session_id,wall_time_ms,elapsed_ns,type,state_before,state_after,payload_json) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(value.id, value.runId, value.runSessionId, value.wallTimeMs, value.elapsedNs, value.type, value.stateBefore, value.stateAfter, JSON.stringify(value.payload));
      this.recordCaptchaCostEventSync(value);
    });
    return value;
  }

  async recordCaptchaCostEvent(event: RunEvent, browserProfileId: string | null = null, storeId: string | null = null): Promise<boolean> {
    const value = runEventSchema.parse(event);
    return this.recordCaptchaCostEventSync(value, browserProfileId, storeId);
  }

  private recordCaptchaCostEventSync(event: RunEvent, browserProfileId: string | null = null, storeId: string | null = null): boolean {
    if (event.type !== "CAPTCHA_TOKEN_ACQUIRED") return false;
    const payload = event.payload; const rawCost = payload.costMicrosUsd; const cost = typeof rawCost === "number" && Number.isSafeInteger(rawCost) && rawCost >= 0 ? rawCost : null;
    const session = event.runSessionId ? this.getRow("SELECT browser_profile_id FROM run_sessions WHERE id=?", [event.runSessionId]) : undefined;
    const run = this.getRow("SELECT target_snapshot_json FROM runs WHERE id=?", [event.runId]);
    let recordedStoreId = storeId; if (!recordedStoreId && run?.target_snapshot_json) { try { recordedStoreId = String(JSON.parse(String(run.target_snapshot_json)).storeId ?? "") || null; } catch { recordedStoreId = null; } }
    return this.sql.prepare(`INSERT OR IGNORE INTO captcha_cost_records
      (event_id,occurred_at,run_id,run_session_id,browser_profile_id,store_id,provider_kind,provider_label,captcha_kind,strategy,attempt,cost_micros_usd,authority)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(event.id,event.wallTimeMs,event.runId,event.runSessionId,browserProfileId??session?.browser_profile_id??null,recordedStoreId,
        typeof payload.providerId==="string"?payload.providerId:null,typeof payload.providerLabel==="string"?payload.providerLabel:null,String(payload.kind??"UNKNOWN"),String(payload.strategy??"UNKNOWN"),
        typeof payload.attempt==="number"&&Number.isSafeInteger(payload.attempt)?payload.attempt:1,cost,cost===null?"UNAVAILABLE":"PROVIDER_REPORTED").changes > 0;
  }

  async addRunArtifact(artifact: RunArtifact): Promise<RunArtifact> {
    const value = runArtifactSchema.parse(artifact);
    this.sql.prepare("INSERT INTO run_artifacts (id,run_id,run_session_id,kind,relative_path,sensitive,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(value.id, value.runId, value.runSessionId, value.kind, value.relativePath, value.sensitive ? 1 : 0, value.createdAt);
    return value;
  }

  async addBrowserHealthSnapshot(snapshot: BrowserHealthSnapshot): Promise<BrowserHealthSnapshot> {
    const value = browserHealthSnapshotSchema.parse(snapshot);
    this.sql.prepare("INSERT INTO browser_health_snapshots (id,subject_kind,subject_id,run_id,captured_at,payload_json) VALUES (?,?,?,?,?,?)")
      .run(value.id, value.subjectKind, value.subjectId, value.runId, value.capturedAt, JSON.stringify(value));
    return value;
  }

  async getBrowserHealth(subjectKind: BrowserHealthSnapshot["subjectKind"], subjectId: string, limit = 20): Promise<BrowserHealthDetail> {
    const rows = this.all("SELECT payload_json FROM browser_health_snapshots WHERE subject_kind=? AND subject_id=? ORDER BY captured_at DESC LIMIT ?", [subjectKind, subjectId, limit]);
    const recent = rows.map((row) => browserHealthSnapshotSchema.parse(JSON.parse(String(row.payload_json))));
    return { latest: recent[0] ?? null, recent };
  }

  async listProfileWarmStates(browserProfileId?: string): Promise<ProfileWarmState[]> {
    const rows = browserProfileId
      ? this.all("SELECT * FROM profile_warm_states WHERE browser_profile_id=? ORDER BY updated_at DESC", [browserProfileId])
      : this.all("SELECT * FROM profile_warm_states ORDER BY updated_at DESC");
    return rows.map((row) => profileWarmStateSchema.parse(mapWarmState(row)));
  }

  async getProfileWarmState(browserProfileId: string, storeId: string): Promise<ProfileWarmState | undefined> {
    const row = this.getRow("SELECT * FROM profile_warm_states WHERE browser_profile_id=? AND store_id=?", [browserProfileId, storeId]);
    return row ? profileWarmStateSchema.parse(mapWarmState(row)) : undefined;
  }

  async upsertProfileWarmState(input: ProfileWarmState): Promise<ProfileWarmState> {
    const value = profileWarmStateSchema.parse(input);
    this.sql.prepare(`INSERT INTO profile_warm_states (id,browser_profile_id,store_id,status,storefront_ready,google_ready,shop_pay_ready,storefront_completed_at,google_completed_at,shop_pay_completed_at,proxy_profile_id,driver_kind,route_public_ip,route_country,started_at,completed_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(browser_profile_id,store_id) DO UPDATE SET status=excluded.status,storefront_ready=excluded.storefront_ready,google_ready=excluded.google_ready,shop_pay_ready=excluded.shop_pay_ready,storefront_completed_at=excluded.storefront_completed_at,google_completed_at=excluded.google_completed_at,shop_pay_completed_at=excluded.shop_pay_completed_at,proxy_profile_id=excluded.proxy_profile_id,driver_kind=excluded.driver_kind,route_public_ip=excluded.route_public_ip,route_country=excluded.route_country,started_at=excluded.started_at,completed_at=excluded.completed_at,updated_at=excluded.updated_at`)
      .run(value.id, value.browserProfileId, value.storeId, value.status, value.storefrontReady ? 1 : 0, value.googleReady ? 1 : 0, value.shopPayReady ? 1 : 0, value.storefrontCompletedAt, value.googleCompletedAt, value.shopPayCompletedAt, value.proxyProfileId, value.driverKind, value.routePublicIp, value.routeCountry, value.startedAt, value.completedAt, value.updatedAt);
    return value;
  }

  async upsertRunNetworkUsage(input: RunNetworkUsage | Omit<RunNetworkUsage, "discoverySource">): Promise<RunNetworkUsage> {
    const value = runNetworkUsageSchema.parse(input);
    this.sql.prepare(`INSERT INTO run_network_usage (id,run_id,usage_key,source,run_session_id,store_id,proxy_profile_id,proxy_name,discovery_source,received_bytes,sent_bytes,request_count,completeness,cost_per_gb_micros_usd,estimated_cost_micros_usd,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id,usage_key) DO UPDATE SET discovery_source=excluded.discovery_source,received_bytes=excluded.received_bytes,sent_bytes=excluded.sent_bytes,request_count=excluded.request_count,completeness=excluded.completeness,cost_per_gb_micros_usd=excluded.cost_per_gb_micros_usd,estimated_cost_micros_usd=excluded.estimated_cost_micros_usd,updated_at=excluded.updated_at`)
      .run(value.id, value.runId, value.usageKey, value.source, value.runSessionId, value.storeId, value.proxyProfileId, value.proxyName, value.discoverySource, value.receivedBytes, value.sentBytes, value.requestCount, value.completeness, value.costPerGbMicrosUsd, value.estimatedCostMicrosUsd, value.updatedAt);
    return value;
  }

  /** Converts a cumulative worker counter into an append-only minute delta. */
  async recordUsageSnapshot(input: RecordedUsageSnapshot): Promise<RunNetworkUsage> {
    const value = runNetworkUsageSchema.parse(input); const now = value.updatedAt;
    const cursor = this.getRow("SELECT * FROM usage_cursors WHERE run_id=? AND usage_key=?", [value.runId, value.usageKey]);
    const reset = Boolean(cursor) && (value.receivedBytes < Number(cursor!.received_bytes) || value.sentBytes < Number(cursor!.sent_bytes) || value.requestCount < Number(cursor!.request_count));
    const deltaReceived = cursor && !reset ? value.receivedBytes - Number(cursor.received_bytes) : value.receivedBytes;
    const deltaSent = cursor && !reset ? value.sentBytes - Number(cursor.sent_bytes) : value.sentBytes;
    const deltaRequests = cursor && !reset ? value.requestCount - Number(cursor.request_count) : value.requestCount;
    const previous = this.getRow("SELECT * FROM run_network_usage WHERE run_id=? AND usage_key=?", [value.runId, value.usageKey]);
    const totalReceived = (previous ? Number(previous.received_bytes) : 0) + deltaReceived;
    const totalSent = (previous ? Number(previous.sent_bytes) : 0) + deltaSent;
    const totalRequests = (previous ? Number(previous.request_count) : 0) + deltaRequests;
    const provider = input.proxyProvider ?? (value.proxyProfileId ? this.getRow("SELECT provider FROM proxy_profiles WHERE id=?", [value.proxyProfileId])?.provider as string | undefined : undefined) ?? null;
    const browserProfileId = input.browserProfileId ?? (value.runSessionId ? this.getRow("SELECT browser_profile_id FROM run_sessions WHERE id=?", [value.runSessionId])?.browser_profile_id as string | undefined : undefined) ?? null;
    const supported = Boolean(value.proxyProfileId) && value.completeness !== "UNSUPPORTED";
    const totalEstimate = estimateCostMicrosUsd(totalReceived, totalSent, value.costPerGbMicrosUsd, supported);
    const deltaEstimate = estimateCostMicrosUsd(deltaReceived, deltaSent, value.costPerGbMicrosUsd, supported);
    const result = runNetworkUsageSchema.parse({ ...value, receivedBytes: totalReceived, sentBytes: totalSent, requestCount: totalRequests, estimatedCostMicrosUsd: totalEstimate });
    this.transaction(() => {
      this.sql.prepare(`INSERT INTO usage_cursors (run_id,usage_key,received_bytes,sent_bytes,request_count,epoch,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(run_id,usage_key) DO UPDATE SET received_bytes=excluded.received_bytes,sent_bytes=excluded.sent_bytes,request_count=excluded.request_count,epoch=excluded.epoch,updated_at=excluded.updated_at`)
        .run(value.runId, value.usageKey, value.receivedBytes, value.sentBytes, value.requestCount, Number(cursor?.epoch ?? 0) + (reset ? 1 : 0), now);
      this.sql.prepare(`INSERT INTO run_network_usage (id,run_id,usage_key,source,run_session_id,store_id,proxy_profile_id,proxy_name,discovery_source,received_bytes,sent_bytes,request_count,completeness,cost_per_gb_micros_usd,estimated_cost_micros_usd,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id,usage_key) DO UPDATE SET discovery_source=excluded.discovery_source,received_bytes=excluded.received_bytes,sent_bytes=excluded.sent_bytes,request_count=excluded.request_count,completeness=excluded.completeness,cost_per_gb_micros_usd=excluded.cost_per_gb_micros_usd,estimated_cost_micros_usd=excluded.estimated_cost_micros_usd,updated_at=excluded.updated_at`)
        .run(result.id, result.runId, result.usageKey, result.source, result.runSessionId, result.storeId, result.proxyProfileId, result.proxyName, result.discoverySource, result.receivedBytes, result.sentBytes, result.requestCount, result.completeness, result.costPerGbMicrosUsd, result.estimatedCostMicrosUsd, result.updatedAt);
      if (deltaReceived || deltaSent || deltaRequests) {
        const bucket = Math.floor(now / 60_000) * 60_000; const bucketId = randomUUID(); const timezoneId = input.timezoneId ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
        this.sql.prepare(`INSERT INTO cost_usage_buckets (id,bucket_start_at,timezone_id,run_id,usage_key,source,run_session_id,browser_profile_id,store_id,proxy_profile_id,proxy_name,proxy_provider,discovery_source,received_bytes,sent_bytes,request_count,completeness,cost_per_gb_micros_usd,estimated_cost_micros_usd,legacy,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(bucket_start_at,run_id,usage_key) DO UPDATE SET
          received_bytes=received_bytes+excluded.received_bytes,sent_bytes=sent_bytes+excluded.sent_bytes,request_count=request_count+excluded.request_count,
          completeness=CASE WHEN completeness='UNSUPPORTED' OR excluded.completeness='UNSUPPORTED' THEN 'UNSUPPORTED' WHEN completeness='PARTIAL' OR excluded.completeness='PARTIAL' THEN 'PARTIAL' ELSE 'EXACT' END,
          estimated_cost_micros_usd=CASE WHEN estimated_cost_micros_usd IS NULL OR excluded.estimated_cost_micros_usd IS NULL THEN NULL ELSE estimated_cost_micros_usd+excluded.estimated_cost_micros_usd END,updated_at=excluded.updated_at`)
          .run(bucketId, bucket, timezoneId, value.runId, value.usageKey, value.source, value.runSessionId, browserProfileId, value.storeId, value.proxyProfileId, value.proxyName, provider, value.discoverySource,
            deltaReceived, deltaSent, deltaRequests, value.completeness, value.costPerGbMicrosUsd, deltaEstimate, 0, now);
      }
    });
    return result;
  }

  async listRunNetworkUsage(runId: string): Promise<RunNetworkUsage[]> {
    return this.all("SELECT * FROM run_network_usage WHERE run_id=? ORDER BY source, usage_key", [runId]).map((row) => runNetworkUsageSchema.parse(mapRunNetworkUsage(row)));
  }

  async listNetworkUsage(): Promise<RunNetworkUsage[]> {
    return this.all("SELECT * FROM run_network_usage ORDER BY updated_at DESC").map((row) => runNetworkUsageSchema.parse(mapRunNetworkUsage(row)));
  }

  async createManualCostSnapshot(input: CreateManualCostSnapshotInput): Promise<{ usage: ProviderUsageRecord | null; balance: ProviderBalanceSnapshot | null }> {
    const value = createManualCostSnapshotSchema.parse(input); const now = Date.now(); let usage: ProviderUsageRecord | null = null; let balance: ProviderBalanceSnapshot | null = null;
    const observedEndAt = Math.min(value.intervalEndAt, now);
    if (value.usedBytes !== null || value.requestCount !== null || value.billedCostMicrosUsd !== null) usage = providerUsageRecordSchema.parse({ id: randomUUID(), provider: value.provider, authority: "MANUAL_CONFIRMED", intervalStartAt: value.intervalStartAt, intervalEndAt: observedEndAt, receivedBytes: value.usedBytes, requestCount: value.requestCount, billedCostMicrosUsd: value.billedCostMicrosUsd, planLabel: null, importBatchId: null, recordedAt: now });
    if (value.remainingCreditMicrosUsd !== null) balance = providerBalanceSnapshotSchema.parse({ id: randomUUID(), provider: value.provider, authority: "MANUAL_CONFIRMED", effectiveAt: observedEndAt, remainingCreditMicrosUsd: value.remainingCreditMicrosUsd, remainingBytes: null, recordedAt: now });
    this.transaction(() => {
      if (usage) this.insertProviderUsage(usage);
      if (balance) this.insertProviderBalance(balance);
    }); return { usage, balance };
  }

  /** Removes only an operator-entered usage/cost snapshot; imports are immutable. */
  async removeManualCostSnapshot(id: string): Promise<boolean> {
    return this.sql.prepare("DELETE FROM provider_usage_records WHERE id=? AND authority='MANUAL_CONFIRMED' AND import_batch_id IS NULL").run(id).changes > 0;
  }

  async commitProviderImport(provider: string, digest: string, records: ProviderImportRecord[], rejectedRowCount = 0): Promise<{ id: string; duplicate: boolean; rowCount: number }> {
    const existing = this.getRow("SELECT id,row_count FROM provider_import_batches WHERE normalized_digest=?", [digest]);
    if (existing) return { id: String(existing.id), duplicate: true, rowCount: Number(existing.row_count) };
    const now = Date.now(); const id = randomUUID(); const starts = records.map((row) => row.intervalStartAt); const ends = records.map((row) => row.intervalEndAt);
    this.transaction(() => {
      this.sql.prepare("INSERT INTO provider_import_batches (id,provider,normalized_digest,row_count,rejected_row_count,interval_start_at,interval_end_at,imported_at) VALUES (?,?,?,?,?,?,?,?)")
        .run(id, provider, digest, records.length, rejectedRowCount, starts.length ? Math.min(...starts) : null, ends.length ? Math.max(...ends) : null, now);
      for (const record of records) this.insertProviderUsage(providerUsageRecordSchema.parse({ ...record, id: randomUUID(), provider, authority: "PROVIDER_CONFIRMED", importBatchId: id, recordedAt: now }));
    }); return { id, duplicate: false, rowCount: records.length };
  }

  async listReconciliation(provider?: string): Promise<{ usage: ProviderUsageRecord[]; balances: ProviderBalanceSnapshot[]; imports: Array<{id:string;provider:string;rowCount:number;rejectedRowCount:number;spendRowCount:number;billedCostMicrosUsd:number|null;intervalStartAt:number|null;intervalEndAt:number|null;importedAt:number}> }> {
    const where = provider ? " WHERE provider=?" : ""; const params = provider ? [provider] : [];
    return {
      usage: this.all(`SELECT * FROM provider_usage_records${where} ORDER BY interval_end_at DESC`, params).map(mapProviderUsage),
      balances: this.all(`SELECT * FROM provider_balance_snapshots${where} ORDER BY effective_at DESC`, params).map(mapProviderBalance),
      imports: this.all(`SELECT b.id,b.provider,b.row_count,b.rejected_row_count,b.interval_start_at,b.interval_end_at,b.imported_at,COUNT(u.id) AS spend_row_count,SUM(u.billed_cost_micros_usd) AS billed_cost_micros_usd FROM provider_import_batches b LEFT JOIN provider_usage_records u ON u.import_batch_id=b.id AND u.billed_cost_micros_usd IS NOT NULL${provider ? " WHERE b.provider=?" : ""} GROUP BY b.id,b.provider,b.row_count,b.rejected_row_count,b.interval_start_at,b.interval_end_at,b.imported_at ORDER BY b.imported_at DESC`, params).map((row) => ({ id: String(row.id), provider: String(row.provider), rowCount: Number(row.row_count), rejectedRowCount: Number(row.rejected_row_count), spendRowCount: Number(row.spend_row_count), billedCostMicrosUsd: nullableNumber(row.billed_cost_micros_usd), intervalStartAt: nullableNumber(row.interval_start_at), intervalEndAt: nullableNumber(row.interval_end_at), importedAt: Number(row.imported_at) })),
    };
  }

  async listCostBudgets(): Promise<CostBudget[]> { return this.all("SELECT * FROM cost_budgets ORDER BY category,provider,cadence").map(mapCostBudget); }
  async upsertCostBudget(input: UpsertCostBudgetInput): Promise<CostBudget> {
    const value = upsertCostBudgetSchema.parse(input); const current = this.getRow("SELECT * FROM cost_budgets WHERE category=? AND provider=? AND cadence=?", [value.category, value.provider, value.cadence]); const now = Date.now();
    const budget = costBudgetSchema.parse({ ...value, id: current?.id ?? value.id ?? randomUUID(), enabledAt: current ? Number(current.enabled_at) : now, createdAt: current ? Number(current.created_at) : now, updatedAt: now });
    this.sql.prepare(`INSERT INTO cost_budgets (id,category,provider,cadence,limit_micros_usd,starting_credit_micros_usd,timezone_id,thresholds_json,hard_cap,enabled,enabled_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(category,provider,cadence) DO UPDATE SET limit_micros_usd=excluded.limit_micros_usd,starting_credit_micros_usd=excluded.starting_credit_micros_usd,timezone_id=excluded.timezone_id,thresholds_json=excluded.thresholds_json,hard_cap=excluded.hard_cap,enabled=excluded.enabled,updated_at=excluded.updated_at`)
      .run(budget.id,budget.category,budget.provider,budget.cadence,budget.limitMicrosUsd,budget.startingCreditMicrosUsd,budget.timezoneId,JSON.stringify(budget.thresholds),budget.hardCap?1:0,budget.enabled?1:0,budget.enabledAt,budget.createdAt,budget.updatedAt);
    return budget;
  }
  async removeCostBudget(id: string): Promise<boolean> { return this.sql.prepare("DELETE FROM cost_budgets WHERE id=?").run(id).changes > 0; }

  async getBudgetStatuses(now = Date.now()): Promise<BudgetStatus[]> {
    const results: BudgetStatus[] = [];
    for (const budget of (await this.listCostBudgets()).filter((row) => row.enabled)) {
      const period = resolveBudgetPeriod(budget.cadence, budget.timezoneId, now); const effectiveStart = Math.max(period.startAt, budget.enabledAt);
      let spent=0; let authority:"COPIFY_ESTIMATED"|"PROVIDER_CONFIRMED"|"MANUAL_CONFIRMED"|"PROVIDER_REPORTED"="COPIFY_ESTIMATED"; let dataAgeMs:number|null=null;
      if(budget.category==="CAPTCHA"){
        const providerFilter=budget.provider==="ALL"?"":" AND (provider_kind=? COLLATE NOCASE OR provider_label=? COLLATE NOCASE)";const params:any[]=[effectiveStart,period.endAt];if(providerFilter)params.push(budget.provider,budget.provider);
        const row=this.getRow(`SELECT COALESCE(SUM(cost_micros_usd),0) AS total,MAX(occurred_at) AS latest FROM captcha_cost_records WHERE occurred_at>=? AND occurred_at<?${providerFilter}`,params);spent=Number(row?.total??0);authority="PROVIDER_REPORTED";const latest=nullableNumber(row?.latest);dataAgeMs=latest===null?null:Math.max(0,now-latest);
      }else{
        const providerFilter=budget.provider==="ALL"?"":" AND proxy_provider=?";const params:any[]=[effectiveStart,period.endAt];if(providerFilter)params.push(budget.provider);
        const estimateRow=this.getRow(`SELECT COALESCE(SUM(estimated_cost_micros_usd),0) AS total,MAX(updated_at) AS latest FROM cost_usage_buckets WHERE bucket_start_at>=? AND bucket_start_at<?${providerFilter}`,params);const estimate=Number(estimateRow?.total??0);const latestUsage=nullableNumber(estimateRow?.latest);
        if(budget.provider!=="ALL"){const confirmed=this.confirmedRange(budget.provider,effectiveStart,Math.min(period.endAt,now));const useConfirmed=latestUsage!==null&&confirmed.coverageStart!==null&&confirmed.coverageStart<=effectiveStart&&confirmed.coveredThrough!==null&&confirmed.coveredThrough>=latestUsage;spent=useConfirmed?confirmed.cost:estimate;authority=useConfirmed?confirmed.authority:"COPIFY_ESTIMATED";dataAgeMs=useConfirmed&&confirmed.recordedAt?Math.max(0,now-confirmed.recordedAt):null;}else spent=estimate;
      }
      const firedThresholds = this.all("SELECT threshold FROM budget_threshold_events WHERE budget_id=? AND period_start_at=? ORDER BY threshold", [budget.id,period.startAt]).map((row)=>Number(row.threshold));
      results.push(budgetStatusSchema.parse({ budget, periodStartAt: period.startAt, periodEndAt: period.endAt, spentMicrosUsd: spent, authority, percent: budget.limitMicrosUsd ? spent / budget.limitMicrosUsd * 100 : 0, firedThresholds, capped: budget.category==="PROXY"&&budget.hardCap&&spent>=budget.limitMicrosUsd, dataAgeMs }));
    } return results;
  }

  async markBudgetThreshold(budgetId: string, periodStartAt: number, threshold: number, firedAt = Date.now()): Promise<boolean> {
    return this.sql.prepare("INSERT OR IGNORE INTO budget_threshold_events (id,budget_id,period_start_at,threshold,fired_at) VALUES (?,?,?,?,?)").run(randomUUID(),budgetId,periodStartAt,threshold,firedAt).changes > 0;
  }

  async queryCosts(input: CostQuery, now = Date.now()): Promise<CostSummary> {
    const query = costQuerySchema.parse(input); const period = resolveCostPeriod(query.period, now);
    const proxyProviderClause = query.provider ? " AND b.proxy_provider=? COLLATE NOCASE" : ""; const proxyParams: any[] = [period.startAt,period.endAt]; if (query.provider) proxyParams.push(query.provider);
    const buckets = query.scope==="CAPTCHA"?[]:this.all(`SELECT b.*, p.name AS browser_profile_name, r.name AS run_name FROM cost_usage_buckets b LEFT JOIN browser_profiles p ON p.id=b.browser_profile_id LEFT JOIN runs r ON r.id=b.run_id WHERE b.bucket_start_at>=? AND b.bucket_start_at<?${proxyProviderClause}`, proxyParams);
    const captchaProviderClause=query.provider?" AND (c.provider_kind=? COLLATE NOCASE OR c.provider_label=? COLLATE NOCASE)":"";const captchaParams:any[]=[period.startAt,period.endAt];if(query.provider)captchaParams.push(query.provider,query.provider);
    const captchaRows=query.scope==="PROXY"?[]:this.all(`SELECT c.*,p.name AS browser_profile_name,r.name AS run_name FROM captcha_cost_records c LEFT JOIN browser_profiles p ON p.id=c.browser_profile_id LEFT JOIN runs r ON r.id=c.run_id WHERE c.occurred_at>=? AND c.occurred_at<?${captchaProviderClause}`,captchaParams);
    const groups = new Map<string,{label:string;proxyRows:Row[];captchaRows:Row[]}>();
    const add=(key:string,label:string,category:"PROXY"|"CAPTCHA",row:Row)=>{const group=groups.get(key)??{label,proxyRows:[],captchaRows:[]};group[category==="PROXY"?"proxyRows":"captchaRows"].push(row);groups.set(key,group);};
    const proxyKey = (row:Row):[string,string] => {
      if(query.groupBy==="CATEGORY")return["PROXY","Proxy traffic"];
      if(query.groupBy==="PROXY")return[String(row.proxy_profile_id??"direct"),String(row.proxy_name??"Direct")];
      if(query.groupBy==="CAPTCHA_KIND")return["not-captcha","Not CAPTCHA"];
      if(query.groupBy==="STORE")return[String(row.store_id??"unknown"),String(row.store_id??"Unknown store")];
      if(query.groupBy==="SOURCE")return[String(row.source),String(row.source).toLowerCase()];
      if(query.groupBy==="BROWSER_PROFILE")return[String(row.browser_profile_id??"monitor"),String(row.browser_profile_name??"Monitor")];
      if(query.groupBy==="RUN")return[String(row.run_id),String(row.run_name??row.run_id)];
      return[String(row.proxy_provider??"direct"),String(row.proxy_provider??"Direct")];
    };
    const captchaKey=(row:Row):[string,string]=>{
      if(query.groupBy==="CATEGORY")return["CAPTCHA","CAPTCHA solves"];
      if(query.groupBy==="PROXY")return["not-proxy","No proxy allocation"];
      if(query.groupBy==="CAPTCHA_KIND")return[String(row.captcha_kind),String(row.captcha_kind)];
      if(query.groupBy==="STORE")return[String(row.store_id??"unknown"),String(row.store_id??"Unknown store")];
      if(query.groupBy==="SOURCE")return["CAPTCHA","captcha"];
      if(query.groupBy==="BROWSER_PROFILE")return[String(row.browser_profile_id??"lab"),String(row.browser_profile_name??"CAPTCHA Lab")];
      if(query.groupBy==="RUN")return[String(row.run_id),String(row.run_name??row.run_id)];
      return[String(row.provider_kind??row.provider_label??"unknown"),String(row.provider_label??row.provider_kind??"Unknown CAPTCHA provider")];
    };
    for(const row of buckets){const[key,label]=proxyKey(row);add(key,label,"PROXY",row);}for(const row of captchaRows){const[key,label]=captchaKey(row);add(key,label,"CAPTCHA",row);}
    const pricedBytes = buckets.filter((row)=>row.proxy_profile_id && row.estimated_cost_micros_usd!==null).reduce((sum,row)=>sum+Number(row.received_bytes)+Number(row.sent_bytes),0);
    const proxiedBytes = buckets.filter((row)=>row.proxy_profile_id).reduce((sum,row)=>sum+Number(row.received_bytes)+Number(row.sent_bytes),0); const estimateValues=buckets.map((r)=>nullableNumber(r.estimated_cost_micros_usd)); const estimate=estimateValues.some((v)=>v!==null)?estimateValues.reduce<number>((s,v)=>s+(v??0),0):null;
    const providers = query.provider ? [query.provider] : [...new Set(buckets.map((row)=>row.proxy_provider).filter(Boolean).map(String))]; let confirmedCost=0; let hasConfirmed=false; let confirmedAuthority: "PROVIDER_CONFIRMED"|"MANUAL_CONFIRMED"|null=null; let confirmedAge:number|null=null;
    for (const provider of providers) { const confirmed=this.confirmedRange(provider,period.startAt,period.endAt); if (confirmed.hasData) { hasConfirmed=true; confirmedCost+=confirmed.cost; if (confirmed.authority==="PROVIDER_CONFIRMED") confirmedAuthority="PROVIDER_CONFIRMED"; else confirmedAuthority??="MANUAL_CONFIRMED"; if (confirmed.recordedAt) confirmedAge=Math.max(confirmedAge??0,now-confirmed.recordedAt); } }
    const balanceParams: any[] = [period.endAt]; if (query.provider) balanceParams.push(query.provider); balanceParams.push(period.endAt);
    const balances=this.all(`SELECT b.* FROM provider_balance_snapshots b WHERE b.effective_at<=?${query.provider?" AND b.provider=?":""} AND NOT EXISTS (SELECT 1 FROM provider_balance_snapshots newer WHERE newer.provider=b.provider AND newer.effective_at<=? AND (newer.effective_at>b.effective_at OR (newer.effective_at=b.effective_at AND (newer.recorded_at>b.recorded_at OR (newer.recorded_at=b.recorded_at AND newer.id>b.id)))))`,balanceParams);
    const remaining=balances.length&&balances.some((r)=>r.remaining_credit_micros_usd!==null)?balances.reduce((s,r)=>s+Number(r.remaining_credit_micros_usd??0),0):null;
    const rows=[...groups.entries()].map(([id,group])=>{const received=group.proxyRows.reduce((s,r)=>s+Number(r.received_bytes),0);const sent=group.proxyRows.reduce((s,r)=>s+Number(r.sent_bytes),0);const vals=group.proxyRows.map((r)=>nullableNumber(r.estimated_cost_micros_usd));const estimated=vals.some((v)=>v!==null)?vals.reduce<number>((s,v)=>s+(v??0),0):null;const providerConfirmed=query.groupBy==="PROVIDER"&&group.proxyRows.length&&id!=="direct"?this.confirmedRange(id,period.startAt,period.endAt):null;const captchaCosts=group.captchaRows.map((r)=>nullableNumber(r.cost_micros_usd));const captchaKnown=captchaCosts.some((v)=>v!==null)?captchaCosts.reduce<number>((s,v)=>s+(v??0),0):null;const confirmed=(providerConfirmed?.hasData?providerConfirmed.cost:0)+(captchaKnown??0);const hasRowConfirmed=Boolean(providerConfirmed?.hasData)||captchaKnown!==null;const mixed=group.proxyRows.length>0&&group.captchaRows.length>0;const activity=[...group.proxyRows.map((r)=>Number(r.updated_at)),...group.captchaRows.map((r)=>Number(r.occurred_at))];return{id,label:group.label,category:mixed?"MIXED":group.captchaRows.length?"CAPTCHA":"PROXY",captchaSolveCount:group.captchaRows.length,unknownCaptchaCostCount:captchaCosts.filter((v)=>v===null).length,receivedBytes:received,sentBytes:sent,requestCount:group.proxyRows.reduce((s,r)=>s+Number(r.request_count),0),estimatedCostMicrosUsd:estimated,confirmedCostMicrosUsd:hasRowConfirmed?confirmed:null,completeness:group.proxyRows.length?worstCompleteness(group.proxyRows.map((r)=>String(r.completeness))):captchaKnown===null?"UNSUPPORTED":"EXACT",authority:mixed?"MIXED":providerConfirmed?.hasData?providerConfirmed.authority:captchaKnown!==null?"PROVIDER_REPORTED":estimated!==null?"COPIFY_ESTIMATED":null,lastActivityAt:activity.length?Math.max(...activity):null};});
    const plan=resolveCostSeries(period.startAt,period.endAt,period.timezoneId);
    const points=plan.edges.slice(0,-1).map((startAt,index)=>({startAt,endAt:plan.edges[index+1]!,proxyCosts:[] as (number|null)[],captchaCosts:[] as (number|null)[],receivedBytes:0,sentBytes:0,requestCount:0,captchaSolveCount:0}));
    const pointAt=(at:number)=>{let low=0,high=points.length-1;while(low<=high){const mid=(low+high)>>1;const point=points[mid]!;if(at<point.startAt)high=mid-1;else if(at>=point.endAt)low=mid+1;else return point;}return undefined;};
    for(const row of buckets){const point=pointAt(Number(row.bucket_start_at));if(!point)continue;point.proxyCosts.push(nullableNumber(row.estimated_cost_micros_usd));point.receivedBytes+=Number(row.received_bytes);point.sentBytes+=Number(row.sent_bytes);point.requestCount+=Number(row.request_count);}
    for(const row of captchaRows){const point=pointAt(Number(row.occurred_at));if(!point)continue;point.captchaCosts.push(nullableNumber(row.cost_micros_usd));point.captchaSolveCount+=1;}
    const known=(values:(number|null)[])=>values.some((value)=>value!==null)?values.reduce<number>((sum,value)=>sum+(value??0),0):null;
    const series=points.map(({proxyCosts,captchaCosts,...point})=>({...point,proxyCostMicrosUsd:known(proxyCosts),captchaCostMicrosUsd:known(captchaCosts)}));
    const confirmedComparable = providers.length > 0 && providers.every((provider) => this.confirmedRange(provider,period.startAt,period.endAt).coversRange);
    const captchaValues=captchaRows.map((row)=>nullableNumber(row.cost_micros_usd));const captchaCost=captchaValues.some((value)=>value!==null)?captchaValues.reduce<number>((sum,value)=>sum+(value??0),0):null;const proxyKnown=hasConfirmed&&confirmedComparable?confirmedCost:estimate;const totalKnown=proxyKnown===null&&captchaCost===null?null:(proxyKnown??0)+(captchaCost??0);
    return costSummarySchema.parse({period,estimatedCostMicrosUsd:estimate,confirmedCostMicrosUsd:hasConfirmed?confirmedCost:null,confirmedAuthority,confirmedDifferenceMicrosUsd:hasConfirmed&&confirmedComparable&&estimate!==null?confirmedCost-estimate:null,captchaCostMicrosUsd:captchaCost,captchaSolveCount:captchaRows.length,unknownCaptchaCostCount:captchaValues.filter((value)=>value===null).length,totalKnownCostMicrosUsd:totalKnown,receivedBytes:buckets.reduce((s,r)=>s+Number(r.received_bytes),0),sentBytes:buckets.reduce((s,r)=>s+Number(r.sent_bytes),0),requestCount:buckets.reduce((s,r)=>s+Number(r.request_count),0),remainingCreditMicrosUsd:remaining,estimationCoverage:proxiedBytes?pricedBytes/proxiedBytes:null,confirmedDataAgeMs:confirmedAge,rows,budgets:await this.getBudgetStatuses(now),seriesGranularity:plan.granularity,series,updatedAt:now});
  }
  async getRunArtifact(id: string): Promise<RunArtifact | undefined> { const row = this.getRow("SELECT * FROM run_artifacts WHERE id=?", [id]); return row ? runArtifactSchema.parse(mapRunArtifact(row)) : undefined; }
  async setRunDiscoverySnapshot(id: string, snapshot: Run["discoverySnapshot"]): Promise<void> { this.sql.prepare("UPDATE runs SET discovery_snapshot_json=?,updated_at=? WHERE id=?").run(snapshot ? JSON.stringify(snapshot) : null, Date.now(), id); }
  async upsertMonitorDiscoveryState(storeId: string, source: string, routeId: string, state: Record<string, unknown>): Promise<void> { this.sql.prepare("INSERT INTO monitor_discovery_state (store_id,source,route_id,state_json,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(store_id,source,route_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at").run(storeId, source, routeId, JSON.stringify(state), Date.now()); }
  async listMonitorDiscoveryState(storeId: string): Promise<Array<{ source: string; routeId: string; state: Record<string, unknown>; updatedAt: number }>> { return this.all("SELECT * FROM monitor_discovery_state WHERE store_id=? ORDER BY source,route_id", [storeId]).map((row) => ({ source: String(row.source), routeId: String(row.route_id), state: JSON.parse(String(row.state_json)), updatedAt: Number(row.updated_at) })); }

  async materializeRunMetrics(runId: string): Promise<{ run: RunMetrics; sessions: SessionMetrics[] }> {
    const detail = await this.getRun(runId); if (!detail) throw new Error("Run not found."); const metrics = deriveMetrics(detail); const now = Date.now();
    this.transaction(() => {
      const put = this.sql.prepare(`INSERT INTO historical_metrics (run_id,scope_kind,scope_id,target_id,store_id,browser_profile_id,proxy_profile_id,app_version,derivation_version,metrics_json,derived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id,scope_kind,scope_id) DO UPDATE SET target_id=excluded.target_id,store_id=excluded.store_id,browser_profile_id=excluded.browser_profile_id,proxy_profile_id=excluded.proxy_profile_id,app_version=excluded.app_version,derivation_version=excluded.derivation_version,metrics_json=excluded.metrics_json,derived_at=excluded.derived_at`);
      put.run(runId, "RUN", runId, detail.run.targetSnapshot?.targetId ?? null, detail.run.targetSnapshot?.storeId ?? null, null, null, detail.run.environment.appVersion, 1, JSON.stringify(metrics.run), now);
      for (const session of metrics.sessions) put.run(runId, "SESSION", session.runSessionId, detail.run.targetSnapshot?.targetId ?? null, detail.run.targetSnapshot?.storeId ?? null, session.browserProfileId, session.proxyProfileId, detail.run.environment.appVersion, 1, JSON.stringify(session), now);
    }); return metrics;
  }

  async listRunAnnotations(runId?: string): Promise<RunAnnotation[]> {
    const rows = runId ? this.all("SELECT * FROM run_annotations WHERE run_id=? ORDER BY created_at", [runId]) : this.all("SELECT * FROM run_annotations ORDER BY created_at");
    return rows.map((row) => runAnnotationSchema.parse({ id: row.id, runId: row.run_id, runSessionId: row.run_session_id ?? null, kind: row.kind, text: row.text ?? null, failureCategory: row.failure_category ?? null, manualOutcome: row.manual_outcome ?? null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }));
  }

  async createRunAnnotation(input: CreateRunAnnotationInput): Promise<RunAnnotation> {
    const value = createRunAnnotationSchema.parse(input); if (!await this.getRun(value.runId)) throw new Error("Run not found."); const now = Date.now();
    if (value.kind !== "NOTE") this.sql.prepare("DELETE FROM run_annotations WHERE run_id=? AND run_session_id IS ? AND kind=?").run(value.runId, value.runSessionId, value.kind);
    const annotation = runAnnotationSchema.parse({ ...value, id: randomUUID(), createdAt: now, updatedAt: now });
    this.sql.prepare("INSERT INTO run_annotations (id,run_id,run_session_id,kind,text,failure_category,manual_outcome,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(annotation.id, annotation.runId, annotation.runSessionId, annotation.kind, annotation.text, annotation.failureCategory, annotation.manualOutcome, now, now); return annotation;
  }
  async removeRunAnnotation(id: string): Promise<boolean> { return this.sql.prepare("DELETE FROM run_annotations WHERE id=?").run(id).changes > 0; }

  async queryAnalytics(input: AnalyticsFilter): Promise<AnalyticsResult> {
    const filter = analyticsFilterSchema.parse(input); const allRuns = (await this.listRuns(500)).filter((run) => !["STARTING", "RECORDING"].includes(run.status)); const now = Date.now();
    let runs = allRuns.filter((run) => (!filter.targetId || run.targetSnapshot?.targetId === filter.targetId) && (!filter.storeId || run.targetSnapshot?.storeId === filter.storeId) && (!filter.appVersions.length || filter.appVersions.includes(run.environment.appVersion)));
    const days = filter.range === "7_DAYS" ? 7 : filter.range === "30_DAYS" ? 30 : filter.range === "90_DAYS" ? 90 : null; if (days) runs = runs.filter((run) => run.startedAt >= now - days * 86_400_000); if (filter.range === "LAST_20") runs = runs.slice(0, 20);
    for (const run of runs) { const row = this.getRow("SELECT derivation_version FROM historical_metrics WHERE run_id=? AND scope_kind='RUN'", [run.id]); if (!row || Number(row.derivation_version) !== 1) await this.materializeRunMetrics(run.id); }
    const ids = new Set(runs.map((run) => run.id)); const rows = this.all("SELECT * FROM historical_metrics").filter((row) => ids.has(String(row.run_id)));
    let runMetrics = rows.filter((row) => row.scope_kind === "RUN").map((row) => runMetricsSchema.parse(JSON.parse(String(row.metrics_json))));
    let sessionMetrics = rows.filter((row) => row.scope_kind === "SESSION").map((row) => sessionMetricsSchema.parse(JSON.parse(String(row.metrics_json))));
    if (filter.profileId) sessionMetrics = sessionMetrics.filter((row) => row.browserProfileId === filter.profileId); if (filter.proxyProfileId) sessionMetrics = sessionMetrics.filter((row) => row.proxyProfileId === filter.proxyProfileId);
    const activeRunIds = new Set(sessionMetrics.map((row) => row.runId)); runMetrics = runMetrics.filter((row) => activeRunIds.has(row.runId) || (!filter.profileId && !filter.proxyProfileId));
    return { runs, runMetrics, sessionMetrics, profiles: reliabilityRows(sessionMetrics, "profile"), proxies: reliabilityRows(sessionMetrics, "proxy"), annotations: (await this.listRunAnnotations()).filter((row) => ids.has(row.runId)) };
  }

  async removeRun(id: string): Promise<boolean> {
    const existing = this.getRow("SELECT id FROM runs WHERE id = ?", [id]); if (!existing) return false;
    this.transaction(() => {
      this.sql.prepare("DELETE FROM run_artifacts WHERE run_id = ?").run(id);
      this.sql.prepare("DELETE FROM run_events WHERE run_id = ?").run(id);
      this.sql.prepare("DELETE FROM browser_health_snapshots WHERE run_id = ?").run(id);
      this.sql.prepare("DELETE FROM run_network_usage WHERE run_id = ?").run(id);
      this.sql.prepare("DELETE FROM historical_metrics WHERE run_id = ?").run(id);
      this.sql.prepare("DELETE FROM run_annotations WHERE run_id = ?").run(id);
      this.sql.prepare("DELETE FROM run_sessions WHERE run_id = ?").run(id);
      this.sql.prepare("DELETE FROM runs WHERE id = ?").run(id);
    });
    return true;
  }

  async recoverInterruptedRuns(): Promise<number> {
    const interrupted = this.all("SELECT id, started_at FROM runs WHERE status IN ('STARTING', 'RECORDING')"); if (!interrupted.length) return 0;
    const now = Date.now(); const error = { code: "RUN_INTERRUPTED", message: "Copify closed before this run was ended." };
    this.transaction(() => {
      for (const run of interrupted) {
        this.sql.prepare("UPDATE runs SET status='FAILED', ended_at=?, updated_at=? WHERE id=?").run(now, now, run.id);
        this.sql.prepare("UPDATE run_sessions SET status='FAILED', ended_at=?, final_error_json=? WHERE run_id=? AND status IN ('STARTING', 'RECORDING')").run(now, JSON.stringify(error), run.id);
        this.sql.prepare("INSERT INTO run_events (id,run_id,run_session_id,wall_time_ms,elapsed_ns,type,state_before,state_after,payload_json) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(randomUUID(), run.id, null, now, (BigInt(Math.max(0, now - Number(run.started_at))) * 1_000_000n).toString(), "RUN_INTERRUPTED", "RECORDING", "FAILED", JSON.stringify({ message: error.message }));
      }
    });
    return interrupted.length;
  }

  close(): void { this.sql.close(); }

  private insertProviderUsage(value: ProviderUsageRecord): void {
    this.sql.prepare("INSERT INTO provider_usage_records (id,provider,authority,interval_start_at,interval_end_at,received_bytes,request_count,billed_cost_micros_usd,plan_label,import_batch_id,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(value.id,value.provider,value.authority,value.intervalStartAt,value.intervalEndAt,value.receivedBytes,value.requestCount,value.billedCostMicrosUsd,value.planLabel,value.importBatchId,value.recordedAt);
  }
  private insertProviderBalance(value: ProviderBalanceSnapshot): void {
    this.sql.prepare("INSERT INTO provider_balance_snapshots (id,provider,authority,effective_at,remaining_credit_micros_usd,remaining_bytes,recorded_at) VALUES (?,?,?,?,?,?,?)")
      .run(value.id,value.provider,value.authority,value.effectiveAt,value.remainingCreditMicrosUsd,value.remainingBytes,value.recordedAt);
  }
  /** Provider CSV rows take precedence; overlapping manual rows are excluded. */
  private confirmedRange(provider: string, startAt: number, endAt: number): { hasData:boolean; cost:number; authority:"PROVIDER_CONFIRMED"|"MANUAL_CONFIRMED"; coverageStart:number|null; coveredThrough:number|null; coversRange:boolean; recordedAt:number|null } {
    const rows=this.all("SELECT * FROM provider_usage_records WHERE provider=? AND interval_end_at>? AND interval_start_at<? ORDER BY interval_start_at",[provider,startAt,endAt]);
    // A traffic-only provider export is authoritative for traffic, but not for billed
    // spend. It must not hide an overlapping manual Money Stats total.
    const providerCostRows=rows.filter((row)=>row.authority==="PROVIDER_CONFIRMED" && row.billed_cost_micros_usd!==null);
    // A manually entered dashboard total is an aggregate, not a time-series. Show
    // it when the requested range fully contains that confirmed interval, but never
    // allocate it into a smaller overlapping range such as Today.
    const manualRows=rows.filter((row)=>row.authority==="MANUAL_CONFIRMED" && Number(row.interval_start_at)>=startAt && Number(row.interval_end_at)<=endAt && !providerCostRows.some((confirmed)=>Number(row.interval_start_at)<Number(confirmed.interval_end_at)&&Number(row.interval_end_at)>Number(confirmed.interval_start_at)));
    const selected=[...providerCostRows,...manualRows]; const costRows=selected; const authority=providerCostRows.length?"PROVIDER_CONFIRMED":"MANUAL_CONFIRMED";
    const ordered=[...selected].sort((a,b)=>Number(a.interval_start_at)-Number(b.interval_start_at)); const coverageStart=ordered.length?Number(ordered[0].interval_start_at):null; let coveredThrough=coverageStart;
    for(const row of ordered){const rowStart=Number(row.interval_start_at);const rowEnd=Number(row.interval_end_at);if(coveredThrough!==null&&rowStart<=coveredThrough+1_000)coveredThrough=Math.max(coveredThrough,rowEnd);}
    return { hasData:costRows.length>0,cost:costRows.reduce((sum,row)=>sum+Number(row.billed_cost_micros_usd),0),authority,coverageStart,coveredThrough,coversRange:coverageStart!==null&&coverageStart<=startAt+1_000&&coveredThrough!==null&&coveredThrough>=endAt-1_000,recordedAt:selected.length?Math.max(...selected.map((row)=>Number(row.recorded_at))):null };
  }
  private getProxyRow(id: string): Row | undefined { return this.getRow("SELECT * FROM proxy_profiles WHERE id = ?", [id]); }
  private getRow(query: string, params: any[] = []): Row | undefined { return this.sql.prepare(query).get(...params) as Row | undefined; }
  private all(query: string, params: any[] = []): Row[] { return this.sql.prepare(query).all(...params) as Row[]; }
  private transaction(action: () => void): void { this.sql.exec("BEGIN IMMEDIATE"); try { action(); this.sql.exec("COMMIT"); } catch (error) { this.sql.exec("ROLLBACK"); throw error; } }
  private setJsonSetting(key: string, value: unknown): void { this.sql.prepare("INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(key, JSON.stringify(value), Date.now()); }
  private insertSecret(id: string, ciphertext: Buffer, now: number): void { this.sql.prepare("INSERT INTO app_secrets (id,ciphertext,created_at,updated_at) VALUES (?,?,?,?)").run(id, ciphertext, now, now); }
  private replaceSecret(currentId: unknown, value: EncryptedCredential, _now: number): string | null { if (value === undefined) return typeof currentId === "string" ? currentId : null; return value === null ? null : randomUUID(); }
  private updateSecret(currentId: unknown, nextId: string | null, value: EncryptedCredential, now: number): void {
    if (value === undefined) return;
    if (typeof currentId === "string") this.sql.prepare("DELETE FROM app_secrets WHERE id = ?").run(currentId);
    if (nextId && value) this.insertSecret(nextId, value, now);
  }
}

export function openProfileRepository(databasePath: string, profilesRoot: string): ProfileRepository {
  mkdirSync(dirname(databasePath), { recursive: true }); const sql = new DatabaseSync(databasePath); sql.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return new ProfileRepository(sql, profilesRoot);
}

function mapProfile(row: Row): Record<string, unknown> {
  const kind = row.driver_kind === "EXTERNAL_CDP" ? "EXTERNAL_CDP" : "NATIVE_STEALTH";
  return { id: row.id, name: row.name, userDataDir: row.user_data_dir, proxyProfileId: row.proxy_profile_id ?? null, shippingProfileId: row.shipping_profile_id ?? null, paymentProfileId: row.payment_profile_id ?? null, checkoutModeOverride: row.checkout_mode_override ?? "INHERIT_TARGET", captchaStrategyOverride: row.captcha_strategy_override ?? "INHERIT_TARGET", driver: kind === "EXTERNAL_CDP" ? { kind, endpointConfigured: Boolean(row.external_cdp_endpoint_secret_id) } : { kind }, enabled: Boolean(row.enabled), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function mapWarmState(row: Row): Record<string, unknown> {
  return { id: row.id, browserProfileId: row.browser_profile_id, storeId: row.store_id, status: row.status, storefrontReady: Boolean(row.storefront_ready), googleReady: Boolean(row.google_ready), shopPayReady: Boolean(row.shop_pay_ready), storefrontCompletedAt: nullableNumber(row.storefront_completed_at), googleCompletedAt: nullableNumber(row.google_completed_at), shopPayCompletedAt: nullableNumber(row.shop_pay_completed_at), proxyProfileId: row.proxy_profile_id ?? null, driverKind: row.driver_kind, routePublicIp: row.route_public_ip ?? null, routeCountry: row.route_country ?? null, startedAt: Number(row.started_at), completedAt: row.completed_at == null ? null : Number(row.completed_at), updatedAt: Number(row.updated_at) };
}
function mapProxy(row: Row): Record<string, unknown> {
  return { id: row.id, name: row.name, provider: row.provider, type: row.type, protocol: row.protocol, host: row.host, port: Number(row.port), expectedCountry: row.expected_country ?? null, expectedCity: row.expected_city ?? null, costPerGbMicrosUsd: nullableNumber(row.cost_per_gb_micros_usd), usernameConfigured: Boolean(row.username_secret_id), passwordConfigured: Boolean(row.password_secret_id), enabled: Boolean(row.enabled), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function mapShipping(row: Row): Record<string, unknown> {
  return { id: row.id, name: row.name, country: row.country ?? null, detailsConfigured: Boolean(row.details_secret_id), complete: Boolean(row.details_secret_id), enabled: Boolean(row.enabled), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function mapPayment(row: Row): Record<string, unknown> { return { id: row.id, name: row.name, kind: row.kind, brand: row.brand ?? null, last4: row.last4 ?? null, expiryMonth: nullableNumber(row.expiry_month), expiryYear: nullableNumber(row.expiry_year), tags: row.tags_json ? JSON.parse(String(row.tags_json)) : [], configured: Boolean(row.payload_secret_id), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }; }
function mapBenchmark(row: Row): Record<string, unknown> {
  return { id: row.id, routeKind: row.route_kind, proxyProfileId: row.proxy_profile_id ?? null, probeUrl: row.probe_url, startedAt: Number(row.started_at), completedAt: Number(row.completed_at), attempts: Number(row.attempts), successes: Number(row.successes), publicIp: row.public_ip ?? null, country: row.country ?? null, city: row.city ?? null, connectLatencyMs: nullableNumber(row.connect_latency_ms), medianLatencyMs: nullableNumber(row.median_latency_ms), jitterMs: nullableNumber(row.jitter_ms), failureRate: Number(row.failure_rate), ipStable: Boolean(row.ip_stable), qualityScore: Number(row.quality_score), status: row.status, errorCode: row.error_code ?? null, errorMessage: row.error_message ?? null, samples: JSON.parse(String(row.samples_json)) };
}
function mapRun(row: Row): Record<string, unknown> {
  return { id: row.id, name: row.name, diagnosticLevel: row.diagnostic_level, executionMode: row.execution_mode === "ASSISTED_CHECKOUT" ? "CHECKOUT" : row.execution_mode ?? "OBSERVATION", purchaseMode: row.purchase_mode ?? "LEGACY_MANUAL", maxCheckouts: parseMaxCheckouts(row.max_checkouts), status: row.status, startedAt: Number(row.started_at), endedAt: row.ended_at === null || row.ended_at === undefined ? null : Number(row.ended_at), environment: JSON.parse(String(row.environment_json)), targetSnapshot: row.target_snapshot_json ? JSON.parse(String(row.target_snapshot_json)) : null, discoverySnapshot: row.discovery_snapshot_json ? JSON.parse(String(row.discovery_snapshot_json)) : null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function mapRunSetup(row: Row): Record<string, unknown> {
  return { id: row.id, name: row.name, diagnosticLevel: row.diagnostic_level, executionMode: row.execution_mode === "ASSISTED_CHECKOUT" ? "CHECKOUT" : row.execution_mode, profileIds: JSON.parse(String(row.profile_ids_json)), sessionOverrides: row.session_overrides_json ? JSON.parse(String(row.session_overrides_json)) : [], captchaOverrides: row.captcha_overrides_json ? JSON.parse(String(row.captcha_overrides_json)) : [], targetId: row.target_id ?? null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function mapTarget(row: Row): Record<string, unknown> {
  return { id: row.id, name: row.name, storeId: row.store_id, productKeywords: JSON.parse(String(row.product_keywords_json)), negativeKeywords: JSON.parse(String(row.negative_keywords_json)), directProductUrl: row.direct_product_url ?? null, preferredColors: JSON.parse(String(row.preferred_colors_json)), sizePriority: JSON.parse(String(row.size_priority_json)), currency: row.currency, maxRetailMinor: Number(row.max_retail_minor), quantity: 1, checkoutMode: row.checkout_mode ?? "ASSISTED", maxCheckouts: parseMaxCheckouts(row.max_checkouts), captchaStrategy: row.captcha_strategy ?? "INHERIT_APP", enabled: Boolean(row.enabled), latestCheck: row.latest_check_json ? JSON.parse(String(row.latest_check_json)) : null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function mapRunSession(row: Row): Record<string, unknown> {
  return { id: row.id, runId: row.run_id, browserProfileId: row.browser_profile_id, browserProfileName: row.browser_profile_name, route: JSON.parse(String(row.route_json)), shippingProfile: row.shipping_profile_json ? JSON.parse(String(row.shipping_profile_json)) : { shippingProfileId: null, name: null, country: null, complete: false }, paymentProfile: row.payment_profile_json ? JSON.parse(String(row.payment_profile_json)) : { paymentProfileId: null, label: null, kind: null, configured: false, path: "NONE" }, checkoutMode: row.checkout_mode ?? "ASSISTED", captchaStrategy: row.captcha_strategy ?? "MANUAL_HARVESTER", captchaProvider: row.captcha_provider_json ? JSON.parse(String(row.captcha_provider_json)) : null, assistedEligible: Boolean(row.assisted_eligible), executionState: row.execution_state ?? "OBSERVING", checkpointReason: row.checkpoint_reason ?? null, quotaOutcome: row.quota_outcome ?? "NONE", orderIndex: nullableNumber(row.order_index), status: row.status, startedAt: Number(row.started_at), endedAt: row.ended_at === null || row.ended_at === undefined ? null : Number(row.ended_at), finalError: row.final_error_json ? JSON.parse(String(row.final_error_json)) : null };
}
function mapRunEvent(row: Row): Record<string, unknown> {
  return { id: row.id, runId: row.run_id, runSessionId: row.run_session_id ?? null, wallTimeMs: Number(row.wall_time_ms), elapsedNs: String(row.elapsed_ns), type: row.type, stateBefore: row.state_before ?? null, stateAfter: row.state_after ?? null, payload: JSON.parse(String(row.payload_json)) };
}
function mapRunNetworkUsage(row: Row): Record<string, unknown> {
  return { id: row.id, runId: row.run_id, usageKey: row.usage_key, source: row.source, runSessionId: row.run_session_id ?? null, storeId: row.store_id ?? null, proxyProfileId: row.proxy_profile_id ?? null, proxyName: row.proxy_name ?? null, discoverySource: row.discovery_source ?? null, receivedBytes: Number(row.received_bytes), sentBytes: Number(row.sent_bytes), requestCount: Number(row.request_count), completeness: row.completeness, costPerGbMicrosUsd: nullableNumber(row.cost_per_gb_micros_usd), estimatedCostMicrosUsd: nullableNumber(row.estimated_cost_micros_usd), updatedAt: Number(row.updated_at) };
}
function mapProviderUsage(row: Row): ProviderUsageRecord { return providerUsageRecordSchema.parse({id:row.id,provider:row.provider,authority:row.authority,intervalStartAt:Number(row.interval_start_at),intervalEndAt:Number(row.interval_end_at),receivedBytes:nullableNumber(row.received_bytes),requestCount:nullableNumber(row.request_count),billedCostMicrosUsd:nullableNumber(row.billed_cost_micros_usd),planLabel:row.plan_label??null,importBatchId:row.import_batch_id??null,recordedAt:Number(row.recorded_at)}); }
function mapProviderBalance(row: Row): ProviderBalanceSnapshot { return providerBalanceSnapshotSchema.parse({id:row.id,provider:row.provider,authority:row.authority,effectiveAt:Number(row.effective_at),remainingCreditMicrosUsd:nullableNumber(row.remaining_credit_micros_usd),remainingBytes:nullableNumber(row.remaining_bytes),recordedAt:Number(row.recorded_at)}); }
function mapCostBudget(row: Row): CostBudget { return costBudgetSchema.parse({id:row.id,category:row.category??"PROXY",provider:row.provider,cadence:row.cadence,limitMicrosUsd:Number(row.limit_micros_usd),startingCreditMicrosUsd:nullableNumber(row.starting_credit_micros_usd),timezoneId:row.timezone_id,thresholds:JSON.parse(String(row.thresholds_json)),hardCap:Boolean(row.hard_cap),enabled:Boolean(row.enabled),enabledAt:Number(row.enabled_at),createdAt:Number(row.created_at),updatedAt:Number(row.updated_at)}); }
function worstCompleteness(values:string[]):"EXACT"|"PARTIAL"|"UNSUPPORTED" { return values.includes("UNSUPPORTED")?"UNSUPPORTED":values.includes("PARTIAL")?"PARTIAL":"EXACT"; }
function mapRunArtifact(row: Row): Record<string, unknown> {
  return { id: row.id, runId: row.run_id, runSessionId: row.run_session_id, kind: row.kind, relativePath: row.relative_path, sensitive: Boolean(row.sensitive), createdAt: Number(row.created_at) };
}
function nullableNumber(value: unknown): number | null { return value === null || value === undefined ? null : Number(value); }
function parseMaxCheckouts(value: unknown): "UNLIMITED" | number { if (value === null || value === undefined || String(value) === "UNLIMITED") return "UNLIMITED"; const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 1 ? parsed : "UNLIMITED"; }
function normalizePaymentTags(tags: string[]): string[] { return [...new Set(tags.map((tag) => tag.trim().replace(/\s+/g," ")).filter(Boolean).map((tag) => /^revolut$/i.test(tag) ? "Revolut" : /^mb\s*way$/i.test(tag) ? "MB WAY" : tag))].slice(0,12); }
function toBuffer(value: unknown): Buffer | null { return value instanceof Uint8Array ? Buffer.from(value) : null; }
function isUniqueError(error: unknown): boolean { return error instanceof Error && /UNIQUE constraint failed/i.test(error.message); }
