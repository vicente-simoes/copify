import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_NETWORK_PROBE_URL, browserHealthSnapshotSchema, browserProfileSchema, createBrowserProfileSchema, createProxyProfileSchema, createRunSchema, createRunSetupSchema, createShippingProfileSchema, createTargetSchema, defaultMonitorSettings, monitorSettingsSchema, networkProbeSettingsSchema, profileWarmStateSchema, proxyBenchmarkSchema,
  proxyProfileSchema, runArtifactSchema, runDetailSchema, runEventSchema, runNetworkUsageSchema, runSchema, runSessionSchema, runSetupSchema, shippingProfileSchema, targetCheckSchema, targetSchema, updateBrowserProfileSchema, updateProxyProfileSchema, updateShippingProfileSchema, updateTargetSchema,
  type BrowserHealthDetail, type BrowserHealthSnapshot, type BrowserProfile, type CreateBrowserProfileInput, type CreateProxyProfileInput, type MonitorSettings, type ProfileWarmState, type ProxyBenchmark, type ProxyProfile, type RunNetworkUsage,
  type CreateRunInput, type CreateRunSetupInput, type CreateShippingProfileInput, type CreateTargetInput, type Run, type RunArtifact, type RunDetail, type RunEnvironment, type RunEvent, type RunSession, type RunSetup, type ShippingDetails, type ShippingProfile, type Target, type TargetCheck, type TargetSnapshot,
  type UpdateBrowserProfileInput, type UpdateProxyProfileInput, type UpdateShippingProfileInput, type UpdateTargetInput
} from "@copify/shared";

export * from "./schema";

type Row = Record<string, any>;
export type EncryptedCredential = Buffer | null | undefined;
export type EncryptedProxyCredentials = { username?: Buffer; password?: Buffer };
export type EncryptedProxyCredentialUpdate = { username?: EncryptedCredential; password?: EncryptedCredential };
export type StoredProxy = ProxyProfile & { usernameCiphertext: Buffer | null; passwordCiphertext: Buffer | null };
export type StoredShippingProfile = ShippingProfile & { detailsCiphertext: Buffer | null };
export type StoredBrowserProfile = BrowserProfile & { externalCdpEndpointCiphertext: Buffer | null };
type NewRunSession = Omit<RunSession, "runId" | "shippingProfile" | "assistedEligible" | "executionState" | "checkpointReason"> & Partial<Pick<RunSession, "runId" | "shippingProfile" | "assistedEligible" | "executionState" | "checkpointReason">>;

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
    this.sql.exec("PRAGMA user_version = 12;");
  }

  async list(): Promise<BrowserProfile[]> {
    return this.all("SELECT * FROM browser_profiles ORDER BY created_at ASC").map((row) => browserProfileSchema.parse(mapProfile(row)));
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
    const profile: BrowserProfile = { id, name: parsed.name, userDataDir: profileDirectory(this.profilesRoot, id), proxyProfileId: null, shippingProfileId: null, driver: parsed.driver.kind === "EXTERNAL_CDP" ? { kind: "EXTERNAL_CDP", endpointConfigured: true } : { kind: "NATIVE_STEALTH" }, enabled: parsed.enabled, createdAt: now, updatedAt: now };
    try {
      this.transaction(() => {
        if (endpointSecretId && endpointCiphertext) this.insertSecret(endpointSecretId, endpointCiphertext, now);
        this.sql.prepare("INSERT INTO browser_profiles (id,name,user_data_dir,proxy_profile_id,shipping_profile_id,launch_mode,driver_kind,external_cdp_endpoint_secret_id,enabled,created_at,updated_at) VALUES (?,?,?,?,?,'PLAYWRIGHT',?,?,?,?,?)")
          .run(profile.id, profile.name, profile.userDataDir, null, null, profile.driver.kind, endpointSecretId, profile.enabled ? 1 : 0, now, now);
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
    const nextKind = parsed.driver?.kind ?? existing.driver.kind;
    const endpointUpdate = nextKind === "NATIVE_STEALTH" ? null : endpointCiphertext;
    const endpointSecretId = this.replaceSecret(existingRow.external_cdp_endpoint_secret_id, endpointUpdate, Date.now());
    const { driver: _driver, ...plainUpdates } = parsed;
    const updated = browserProfileSchema.parse({ ...existing, ...plainUpdates, driver: nextKind === "EXTERNAL_CDP" ? { kind: "EXTERNAL_CDP", endpointConfigured: Boolean(endpointSecretId) } : { kind: "NATIVE_STEALTH" }, updatedAt: Date.now() });
    try {
      this.transaction(() => {
        this.updateSecret(existingRow.external_cdp_endpoint_secret_id, endpointSecretId, endpointUpdate, updated.updatedAt);
        this.sql.prepare("UPDATE browser_profiles SET name=?, enabled=?, driver_kind=?, external_cdp_endpoint_secret_id=?, proxy_profile_id=?, shipping_profile_id=?, updated_at=? WHERE id=?")
          .run(updated.name, updated.enabled ? 1 : 0, updated.driver.kind, endpointSecretId, updated.proxyProfileId, updated.shippingProfileId, updated.updatedAt, id);
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
    try { this.sql.prepare("INSERT INTO targets (id,name,store_id,product_keywords_json,negative_keywords_json,preferred_colors_json,size_priority_json,currency,max_retail_minor,quantity,enabled,latest_check_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, parsed.name, parsed.storeId, JSON.stringify(parsed.productKeywords), JSON.stringify(parsed.negativeKeywords), JSON.stringify(parsed.preferredColors), JSON.stringify(parsed.sizePriority), parsed.currency, parsed.maxRetailMinor, parsed.quantity, parsed.enabled ? 1 : 0, null, now, now); } catch (error) { throw new Error(isUniqueError(error) ? "A target with that name already exists." : "Could not create target."); }
    return (await this.getTarget(id))!;
  }
  async updateTarget(id: string, input: UpdateTargetInput): Promise<Target> {
    const parsed = updateTargetSchema.parse(input); const existing = await this.getTarget(id); if (!existing) throw new Error("Target not found."); const updated = targetSchema.parse({ ...existing, ...parsed, updatedAt: Date.now() });
    try { this.sql.prepare("UPDATE targets SET name=?,store_id=?,product_keywords_json=?,negative_keywords_json=?,preferred_colors_json=?,size_priority_json=?,currency=?,max_retail_minor=?,quantity=?,enabled=?,updated_at=? WHERE id=?")
      .run(updated.name, updated.storeId, JSON.stringify(updated.productKeywords), JSON.stringify(updated.negativeKeywords), JSON.stringify(updated.preferredColors), JSON.stringify(updated.sizePriority), updated.currency, updated.maxRetailMinor, updated.quantity, updated.enabled ? 1 : 0, updated.updatedAt, id); } catch (error) { throw new Error(isUniqueError(error) ? "A target with that name already exists." : "Could not update target."); }
    return (await this.getTarget(id))!;
  }
  async setTargetCheck(targetId: string, check: TargetCheck): Promise<Target> { const value = targetCheckSchema.parse(check); this.sql.prepare("UPDATE targets SET latest_check_json=?, updated_at=? WHERE id=?").run(JSON.stringify(value), Date.now(), targetId); const target = await this.getTarget(targetId); if (!target) throw new Error("Target not found."); return target; }
  async removeTarget(id: string): Promise<boolean> { return this.sql.prepare("DELETE FROM targets WHERE id = ?").run(id).changes > 0; }

  async createRun(input: CreateRunInput, environment: RunEnvironment, sessions: NewRunSession[], targetSnapshot: TargetSnapshot | null = null): Promise<RunDetail> {
    const parsed = createRunSchema.parse(input); const now = Date.now(); const id = randomUUID();
    const run: Run = runSchema.parse({ id, name: parsed.name, diagnosticLevel: parsed.diagnosticLevel, executionMode: parsed.executionMode, status: "STARTING", startedAt: now, endedAt: null, environment, targetSnapshot, createdAt: now, updatedAt: now });
    this.transaction(() => {
      this.sql.prepare("INSERT INTO runs (id,name,diagnostic_level,execution_mode,status,started_at,ended_at,environment_json,target_snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(run.id, run.name, run.diagnosticLevel, run.executionMode, run.status, run.startedAt, null, JSON.stringify(run.environment), targetSnapshot ? JSON.stringify(targetSnapshot) : null, now, now);
      for (const session of sessions) {
        const value = runSessionSchema.parse({ ...session, runId: id });
        this.sql.prepare("INSERT INTO run_sessions (id,run_id,browser_profile_id,browser_profile_name,route_json,shipping_profile_json,assisted_eligible,execution_state,checkpoint_reason,status,started_at,ended_at,final_error_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(value.id, id, value.browserProfileId, value.browserProfileName, JSON.stringify(value.route), JSON.stringify(value.shippingProfile), value.assistedEligible ? 1 : 0, value.executionState, value.checkpointReason, value.status, value.startedAt, value.endedAt, value.finalError ? JSON.stringify(value.finalError) : null);
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

  async listRunSetups(): Promise<RunSetup[]> {
    return this.all("SELECT * FROM run_setups ORDER BY created_at ASC").map((row) => runSetupSchema.parse(mapRunSetup(row)));
  }

  async createRunSetup(input: CreateRunSetupInput): Promise<RunSetup> {
    const parsed = createRunSetupSchema.parse(input); const id = randomUUID(); const now = Date.now();
    try { this.sql.prepare("INSERT INTO run_setups (id,name,diagnostic_level,execution_mode,profile_ids_json,target_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, parsed.name, parsed.diagnosticLevel, parsed.executionMode, JSON.stringify(parsed.profileIds), parsed.targetId, now, now); }
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

  async addRunEvent(event: RunEvent): Promise<RunEvent> {
    const value = runEventSchema.parse(event);
    this.sql.prepare("INSERT INTO run_events (id,run_id,run_session_id,wall_time_ms,elapsed_ns,type,state_before,state_after,payload_json) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(value.id, value.runId, value.runSessionId, value.wallTimeMs, value.elapsedNs, value.type, value.stateBefore, value.stateAfter, JSON.stringify(value.payload));
    return value;
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

  async upsertRunNetworkUsage(input: RunNetworkUsage): Promise<RunNetworkUsage> {
    const value = runNetworkUsageSchema.parse(input);
    this.sql.prepare(`INSERT INTO run_network_usage (id,run_id,usage_key,source,run_session_id,store_id,proxy_profile_id,proxy_name,received_bytes,sent_bytes,request_count,completeness,cost_per_gb_micros_usd,estimated_cost_micros_usd,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id,usage_key) DO UPDATE SET received_bytes=excluded.received_bytes,sent_bytes=excluded.sent_bytes,request_count=excluded.request_count,completeness=excluded.completeness,cost_per_gb_micros_usd=excluded.cost_per_gb_micros_usd,estimated_cost_micros_usd=excluded.estimated_cost_micros_usd,updated_at=excluded.updated_at`)
      .run(value.id, value.runId, value.usageKey, value.source, value.runSessionId, value.storeId, value.proxyProfileId, value.proxyName, value.receivedBytes, value.sentBytes, value.requestCount, value.completeness, value.costPerGbMicrosUsd, value.estimatedCostMicrosUsd, value.updatedAt);
    return value;
  }

  async listRunNetworkUsage(runId: string): Promise<RunNetworkUsage[]> {
    return this.all("SELECT * FROM run_network_usage WHERE run_id=? ORDER BY source, usage_key", [runId]).map((row) => runNetworkUsageSchema.parse(mapRunNetworkUsage(row)));
  }

  async listNetworkUsage(): Promise<RunNetworkUsage[]> {
    return this.all("SELECT * FROM run_network_usage ORDER BY updated_at DESC").map((row) => runNetworkUsageSchema.parse(mapRunNetworkUsage(row)));
  }

  async removeRun(id: string): Promise<boolean> {
    const existing = this.getRow("SELECT id FROM runs WHERE id = ?", [id]); if (!existing) return false;
    this.transaction(() => {
      this.sql.prepare("DELETE FROM run_artifacts WHERE run_id = ?").run(id);
      this.sql.prepare("DELETE FROM run_events WHERE run_id = ?").run(id);
      this.sql.prepare("DELETE FROM browser_health_snapshots WHERE run_id = ?").run(id);
      this.sql.prepare("DELETE FROM run_network_usage WHERE run_id = ?").run(id);
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
  return { id: row.id, name: row.name, userDataDir: row.user_data_dir, proxyProfileId: row.proxy_profile_id ?? null, shippingProfileId: row.shipping_profile_id ?? null, driver: kind === "EXTERNAL_CDP" ? { kind, endpointConfigured: Boolean(row.external_cdp_endpoint_secret_id) } : { kind }, enabled: Boolean(row.enabled), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
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
function mapBenchmark(row: Row): Record<string, unknown> {
  return { id: row.id, routeKind: row.route_kind, proxyProfileId: row.proxy_profile_id ?? null, probeUrl: row.probe_url, startedAt: Number(row.started_at), completedAt: Number(row.completed_at), attempts: Number(row.attempts), successes: Number(row.successes), publicIp: row.public_ip ?? null, country: row.country ?? null, city: row.city ?? null, connectLatencyMs: nullableNumber(row.connect_latency_ms), medianLatencyMs: nullableNumber(row.median_latency_ms), jitterMs: nullableNumber(row.jitter_ms), failureRate: Number(row.failure_rate), ipStable: Boolean(row.ip_stable), qualityScore: Number(row.quality_score), status: row.status, errorCode: row.error_code ?? null, errorMessage: row.error_message ?? null, samples: JSON.parse(String(row.samples_json)) };
}
function mapRun(row: Row): Record<string, unknown> {
  return { id: row.id, name: row.name, diagnosticLevel: row.diagnostic_level, executionMode: row.execution_mode ?? "OBSERVATION", status: row.status, startedAt: Number(row.started_at), endedAt: row.ended_at === null || row.ended_at === undefined ? null : Number(row.ended_at), environment: JSON.parse(String(row.environment_json)), targetSnapshot: row.target_snapshot_json ? JSON.parse(String(row.target_snapshot_json)) : null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function mapRunSetup(row: Row): Record<string, unknown> {
  return { id: row.id, name: row.name, diagnosticLevel: row.diagnostic_level, executionMode: row.execution_mode, profileIds: JSON.parse(String(row.profile_ids_json)), targetId: row.target_id ?? null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function mapTarget(row: Row): Record<string, unknown> {
  return { id: row.id, name: row.name, storeId: row.store_id, productKeywords: JSON.parse(String(row.product_keywords_json)), negativeKeywords: JSON.parse(String(row.negative_keywords_json)), preferredColors: JSON.parse(String(row.preferred_colors_json)), sizePriority: JSON.parse(String(row.size_priority_json)), currency: row.currency, maxRetailMinor: Number(row.max_retail_minor), quantity: Number(row.quantity), enabled: Boolean(row.enabled), latestCheck: row.latest_check_json ? JSON.parse(String(row.latest_check_json)) : null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function mapRunSession(row: Row): Record<string, unknown> {
  return { id: row.id, runId: row.run_id, browserProfileId: row.browser_profile_id, browserProfileName: row.browser_profile_name, route: JSON.parse(String(row.route_json)), shippingProfile: row.shipping_profile_json ? JSON.parse(String(row.shipping_profile_json)) : { shippingProfileId: null, name: null, country: null, complete: false }, assistedEligible: Boolean(row.assisted_eligible), executionState: row.execution_state ?? "OBSERVING", checkpointReason: row.checkpoint_reason ?? null, status: row.status, startedAt: Number(row.started_at), endedAt: row.ended_at === null || row.ended_at === undefined ? null : Number(row.ended_at), finalError: row.final_error_json ? JSON.parse(String(row.final_error_json)) : null };
}
function mapRunEvent(row: Row): Record<string, unknown> {
  return { id: row.id, runId: row.run_id, runSessionId: row.run_session_id ?? null, wallTimeMs: Number(row.wall_time_ms), elapsedNs: String(row.elapsed_ns), type: row.type, stateBefore: row.state_before ?? null, stateAfter: row.state_after ?? null, payload: JSON.parse(String(row.payload_json)) };
}
function mapRunNetworkUsage(row: Row): Record<string, unknown> {
  return { id: row.id, runId: row.run_id, usageKey: row.usage_key, source: row.source, runSessionId: row.run_session_id ?? null, storeId: row.store_id ?? null, proxyProfileId: row.proxy_profile_id ?? null, proxyName: row.proxy_name ?? null, receivedBytes: Number(row.received_bytes), sentBytes: Number(row.sent_bytes), requestCount: Number(row.request_count), completeness: row.completeness, costPerGbMicrosUsd: nullableNumber(row.cost_per_gb_micros_usd), estimatedCostMicrosUsd: nullableNumber(row.estimated_cost_micros_usd), updatedAt: Number(row.updated_at) };
}
function mapRunArtifact(row: Row): Record<string, unknown> {
  return { id: row.id, runId: row.run_id, runSessionId: row.run_session_id, kind: row.kind, relativePath: row.relative_path, sensitive: Boolean(row.sensitive), createdAt: Number(row.created_at) };
}
function nullableNumber(value: unknown): number | null { return value === null || value === undefined ? null : Number(value); }
function toBuffer(value: unknown): Buffer | null { return value instanceof Uint8Array ? Buffer.from(value) : null; }
function isUniqueError(error: unknown): boolean { return error instanceof Error && /UNIQUE constraint failed/i.test(error.message); }
