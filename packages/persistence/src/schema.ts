import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const browserProfiles = sqliteTable("browser_profiles", {
  id: text("id").primaryKey(), name: text("name").notNull().unique(), userDataDir: text("user_data_dir").notNull(),
  proxyProfileId: text("proxy_profile_id"), shippingProfileId: text("shipping_profile_id"), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull()
});

export const proxyProfiles = sqliteTable("proxy_profiles", {
  id: text("id").primaryKey(), name: text("name").notNull().unique(), provider: text("provider").notNull(), type: text("type").notNull(), protocol: text("protocol").notNull(),
  host: text("host").notNull(), port: integer("port").notNull(), usernameSecretId: text("username_secret_id"), passwordSecretId: text("password_secret_id"),
  expectedCountry: text("expected_country"), expectedCity: text("expected_city"), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull()
});

export const appSecrets = sqliteTable("app_secrets", {
  id: text("id").primaryKey(), ciphertext: blob("ciphertext", { mode: "buffer" }).notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull()
});

export const proxyBenchmarks = sqliteTable("proxy_benchmarks", {
  id: text("id").primaryKey(), routeKind: text("route_kind").notNull(), proxyProfileId: text("proxy_profile_id"), probeUrl: text("probe_url").notNull(),
  startedAt: integer("started_at").notNull(), completedAt: integer("completed_at").notNull(), attempts: integer("attempts").notNull(), successes: integer("successes").notNull(),
  publicIp: text("public_ip"), country: text("country"), city: text("city"), connectLatencyMs: integer("connect_latency_ms"), medianLatencyMs: integer("median_latency_ms"),
  jitterMs: integer("jitter_ms"), failureRate: integer("failure_rate").notNull(), ipStable: integer("ip_stable", { mode: "boolean" }).notNull(), qualityScore: integer("quality_score").notNull(),
  status: text("status").notNull(), errorCode: text("error_code"), errorMessage: text("error_message"), samplesJson: text("samples_json").notNull()
});

export const appSettings = sqliteTable("app_settings", { key: text("key").primaryKey(), value: text("value").notNull(), updatedAt: integer("updated_at").notNull() });
