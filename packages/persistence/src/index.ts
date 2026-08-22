import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_NETWORK_PROBE_URL, browserProfileSchema, createBrowserProfileSchema, createProxyProfileSchema, createRunSchema, createTargetSchema, networkProbeSettingsSchema, proxyBenchmarkSchema,
  proxyProfileSchema, runArtifactSchema, runDetailSchema, runEventSchema, runSchema, runSessionSchema, targetCheckSchema, targetSchema, updateBrowserProfileSchema, updateProxyProfileSchema, updateTargetSchema,
  type BrowserProfile, type CreateBrowserProfileInput, type CreateProxyProfileInput, type ProxyBenchmark, type ProxyProfile,
  type CreateRunInput, type CreateTargetInput, type Run, type RunArtifact, type RunDetail, type RunEnvironment, type RunEvent, type RunSession, type Target, type TargetCheck, type TargetSnapshot,
  type UpdateBrowserProfileInput, type UpdateProxyProfileInput, type UpdateTargetInput
} from "@copify/shared";

export * from "./schema";

type Row = Record<string, any>;
export type EncryptedCredential = Buffer | null | undefined;
export type EncryptedProxyCredentials = { username?: Buffer; password?: Buffer };
export type EncryptedProxyCredentialUpdate = { username?: EncryptedCredential; password?: EncryptedCredential };
export type StoredProxy = ProxyProfile & { usernameCiphertext: Buffer | null; passwordCiphertext: Buffer | null };

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
    this.sql.exec("PRAGMA user_version = 4;");
  }

  async list(): Promise<BrowserProfile[]> {
    return this.all("SELECT * FROM browser_profiles ORDER BY created_at ASC").map((row) => browserProfileSchema.parse(mapProfile(row)));
  }

  async get(id: string): Promise<BrowserProfile | undefined> {
    const row = this.getRow("SELECT * FROM browser_profiles WHERE id = ?", [id]);
    return row ? browserProfileSchema.parse(mapProfile(row)) : undefined;
  }

  async create(input: CreateBrowserProfileInput): Promise<BrowserProfile> {
    const parsed = createBrowserProfileSchema.parse(input); const id = randomUUID(); const now = Date.now();
    const profile: BrowserProfile = { id, name: parsed.name, userDataDir: profileDirectory(this.profilesRoot, id), proxyProfileId: null, shippingProfileId: null, enabled: parsed.enabled, createdAt: now, updatedAt: now };
    try {
      this.sql.prepare("INSERT INTO browser_profiles (id,name,user_data_dir,proxy_profile_id,shipping_profile_id,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .run(profile.id, profile.name, profile.userDataDir, null, null, profile.enabled ? 1 : 0, now, now);
    } catch (error) { throw new Error(isUniqueError(error) ? "A browser profile with that name already exists." : "Could not create the browser profile."); }
    return profile;
  }

  async update(id: string, input: UpdateBrowserProfileInput): Promise<BrowserProfile> {
    const parsed = updateBrowserProfileSchema.parse(input); const existing = await this.get(id);
    if (!existing) throw new Error("Browser profile not found.");
    if (parsed.proxyProfileId !== undefined && parsed.proxyProfileId !== null && !(await this.getProxy(parsed.proxyProfileId))) throw new Error("Proxy profile not found.");
    const updated = { ...existing, ...parsed, updatedAt: Date.now() };
    try {
      this.sql.prepare("UPDATE browser_profiles SET name=?, enabled=?, proxy_profile_id=?, updated_at=? WHERE id=?")
        .run(updated.name, updated.enabled ? 1 : 0, updated.proxyProfileId, updated.updatedAt, id);
    } catch (error) { throw new Error(isUniqueError(error) ? "A browser profile with that name already exists." : "Could not update the browser profile."); }
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const result = this.sql.prepare("DELETE FROM browser_profiles WHERE id = ?").run(id);
    return result.changes > 0;
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
        this.sql.prepare(`INSERT INTO proxy_profiles (id,name,provider,type,protocol,host,port,username_secret_id,password_secret_id,expected_country,expected_city,enabled,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, parsed.name, parsed.provider, parsed.type, parsed.protocol, parsed.host, parsed.port, usernameSecretId, passwordSecretId, parsed.expectedCountry ?? null, parsed.expectedCity ?? null, parsed.enabled ? 1 : 0, now, now);
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
        this.sql.prepare(`UPDATE proxy_profiles SET name=?,provider=?,type=?,protocol=?,host=?,port=?,username_secret_id=?,password_secret_id=?,expected_country=?,expected_city=?,enabled=?,updated_at=? WHERE id=?`)
          .run(updated.name, updated.provider, updated.type, updated.protocol, updated.host, updated.port, usernameSecretId, passwordSecretId, updated.expectedCountry, updated.expectedCity, updated.enabled ? 1 : 0, now, id);
      } catch (error) { throw new Error(isUniqueError(error) ? "A proxy profile with that name already exists." : "Could not update the proxy profile."); }
    });
    return proxyProfileSchema.parse(updated);
  }

  async removeProxy(id: string): Promise<boolean> {
    const existing = this.getProxyRow(id); if (!existing) return false;
    this.transaction(() => {
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

  async createRun(input: CreateRunInput, environment: RunEnvironment, sessions: RunSession[], targetSnapshot: TargetSnapshot | null = null): Promise<RunDetail> {
    const parsed = createRunSchema.parse(input); const now = Date.now(); const id = randomUUID();
    const run: Run = runSchema.parse({ id, name: parsed.name, diagnosticLevel: parsed.diagnosticLevel, status: "STARTING", startedAt: now, endedAt: null, environment, targetSnapshot, createdAt: now, updatedAt: now });
    this.transaction(() => {
      this.sql.prepare("INSERT INTO runs (id,name,diagnostic_level,status,started_at,ended_at,environment_json,target_snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(run.id, run.name, run.diagnosticLevel, run.status, run.startedAt, null, JSON.stringify(run.environment), targetSnapshot ? JSON.stringify(targetSnapshot) : null, now, now);
      for (const session of sessions) {
        const value = runSessionSchema.parse({ ...session, runId: id });
        this.sql.prepare("INSERT INTO run_sessions (id,run_id,browser_profile_id,browser_profile_name,route_json,status,started_at,ended_at,final_error_json) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(value.id, id, value.browserProfileId, value.browserProfileName, JSON.stringify(value.route), value.status, value.startedAt, value.endedAt, value.finalError ? JSON.stringify(value.finalError) : null);
      }
    });
    return (await this.getRun(id))!;
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

  async removeRun(id: string): Promise<boolean> {
    const existing = this.getRow("SELECT id FROM runs WHERE id = ?", [id]); if (!existing) return false;
    this.transaction(() => {
      this.sql.prepare("DELETE FROM run_artifacts WHERE run_id = ?").run(id);
      this.sql.prepare("DELETE FROM run_events WHERE run_id = ?").run(id);
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
  return { id: row.id, name: row.name, userDataDir: row.user_data_dir, proxyProfileId: row.proxy_profile_id ?? null, shippingProfileId: row.shipping_profile_id ?? null, enabled: Boolean(row.enabled), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function mapProxy(row: Row): Record<string, unknown> {
  return { id: row.id, name: row.name, provider: row.provider, type: row.type, protocol: row.protocol, host: row.host, port: Number(row.port), expectedCountry: row.expected_country ?? null, expectedCity: row.expected_city ?? null, usernameConfigured: Boolean(row.username_secret_id), passwordConfigured: Boolean(row.password_secret_id), enabled: Boolean(row.enabled), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function mapBenchmark(row: Row): Record<string, unknown> {
  return { id: row.id, routeKind: row.route_kind, proxyProfileId: row.proxy_profile_id ?? null, probeUrl: row.probe_url, startedAt: Number(row.started_at), completedAt: Number(row.completed_at), attempts: Number(row.attempts), successes: Number(row.successes), publicIp: row.public_ip ?? null, country: row.country ?? null, city: row.city ?? null, connectLatencyMs: nullableNumber(row.connect_latency_ms), medianLatencyMs: nullableNumber(row.median_latency_ms), jitterMs: nullableNumber(row.jitter_ms), failureRate: Number(row.failure_rate), ipStable: Boolean(row.ip_stable), qualityScore: Number(row.quality_score), status: row.status, errorCode: row.error_code ?? null, errorMessage: row.error_message ?? null, samples: JSON.parse(String(row.samples_json)) };
}
function mapRun(row: Row): Record<string, unknown> {
  return { id: row.id, name: row.name, diagnosticLevel: row.diagnostic_level, status: row.status, startedAt: Number(row.started_at), endedAt: row.ended_at === null || row.ended_at === undefined ? null : Number(row.ended_at), environment: JSON.parse(String(row.environment_json)), targetSnapshot: row.target_snapshot_json ? JSON.parse(String(row.target_snapshot_json)) : null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function mapTarget(row: Row): Record<string, unknown> {
  return { id: row.id, name: row.name, storeId: row.store_id, productKeywords: JSON.parse(String(row.product_keywords_json)), negativeKeywords: JSON.parse(String(row.negative_keywords_json)), preferredColors: JSON.parse(String(row.preferred_colors_json)), sizePriority: JSON.parse(String(row.size_priority_json)), currency: row.currency, maxRetailMinor: Number(row.max_retail_minor), quantity: Number(row.quantity), enabled: Boolean(row.enabled), latestCheck: row.latest_check_json ? JSON.parse(String(row.latest_check_json)) : null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function mapRunSession(row: Row): Record<string, unknown> {
  return { id: row.id, runId: row.run_id, browserProfileId: row.browser_profile_id, browserProfileName: row.browser_profile_name, route: JSON.parse(String(row.route_json)), status: row.status, startedAt: Number(row.started_at), endedAt: row.ended_at === null || row.ended_at === undefined ? null : Number(row.ended_at), finalError: row.final_error_json ? JSON.parse(String(row.final_error_json)) : null };
}
function mapRunEvent(row: Row): Record<string, unknown> {
  return { id: row.id, runId: row.run_id, runSessionId: row.run_session_id ?? null, wallTimeMs: Number(row.wall_time_ms), elapsedNs: String(row.elapsed_ns), type: row.type, stateBefore: row.state_before ?? null, stateAfter: row.state_after ?? null, payload: JSON.parse(String(row.payload_json)) };
}
function mapRunArtifact(row: Row): Record<string, unknown> {
  return { id: row.id, runId: row.run_id, runSessionId: row.run_session_id, kind: row.kind, relativePath: row.relative_path, sensitive: Boolean(row.sensitive), createdAt: Number(row.created_at) };
}
function nullableNumber(value: unknown): number | null { return value === null || value === undefined ? null : Number(value); }
function toBuffer(value: unknown): Buffer | null { return value instanceof Uint8Array ? Buffer.from(value) : null; }
function isUniqueError(error: unknown): boolean { return error instanceof Error && /UNIQUE constraint failed/i.test(error.message); }
