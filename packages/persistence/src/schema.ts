import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const browserProfiles = sqliteTable("browser_profiles", {
  id: text("id").primaryKey(), name: text("name").notNull().unique(), userDataDir: text("user_data_dir").notNull(),
  proxyProfileId: text("proxy_profile_id"), shippingProfileId: text("shipping_profile_id"), launchMode: text("launch_mode").notNull().default("PLAYWRIGHT"),
  driverKind: text("driver_kind").notNull().default("NATIVE_STEALTH"), externalCdpEndpointSecretId: text("external_cdp_endpoint_secret_id"), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  position: integer("position").notNull().default(0), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull()
});

export const proxyProfiles = sqliteTable("proxy_profiles", {
  id: text("id").primaryKey(), name: text("name").notNull().unique(), provider: text("provider").notNull(), type: text("type").notNull(), protocol: text("protocol").notNull(),
  host: text("host").notNull(), port: integer("port").notNull(), usernameSecretId: text("username_secret_id"), passwordSecretId: text("password_secret_id"),
  expectedCountry: text("expected_country"), expectedCity: text("expected_city"), costPerGbMicrosUsd: integer("cost_per_gb_micros_usd"), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull()
});

export const appSecrets = sqliteTable("app_secrets", {
  id: text("id").primaryKey(), ciphertext: blob("ciphertext", { mode: "buffer" }).notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull()
});

export const shippingProfiles = sqliteTable("shipping_profiles", {
  id: text("id").primaryKey(), name: text("name").notNull().unique(), detailsSecretId: text("details_secret_id"), country: text("country"), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull()
});

export const proxyBenchmarks = sqliteTable("proxy_benchmarks", {
  id: text("id").primaryKey(), routeKind: text("route_kind").notNull(), proxyProfileId: text("proxy_profile_id"), probeUrl: text("probe_url").notNull(),
  startedAt: integer("started_at").notNull(), completedAt: integer("completed_at").notNull(), attempts: integer("attempts").notNull(), successes: integer("successes").notNull(),
  publicIp: text("public_ip"), country: text("country"), city: text("city"), connectLatencyMs: integer("connect_latency_ms"), medianLatencyMs: integer("median_latency_ms"),
  jitterMs: integer("jitter_ms"), failureRate: integer("failure_rate").notNull(), ipStable: integer("ip_stable", { mode: "boolean" }).notNull(), qualityScore: integer("quality_score").notNull(),
  status: text("status").notNull(), errorCode: text("error_code"), errorMessage: text("error_message"), samplesJson: text("samples_json").notNull()
});

export const appSettings = sqliteTable("app_settings", { key: text("key").primaryKey(), value: text("value").notNull(), updatedAt: integer("updated_at").notNull() });

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(), name: text("name").notNull(), diagnosticLevel: text("diagnostic_level").notNull(), executionMode: text("execution_mode").notNull(), status: text("status").notNull(),
  startedAt: integer("started_at").notNull(), endedAt: integer("ended_at"), environmentJson: text("environment_json").notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull()
});

export const runSessions = sqliteTable("run_sessions", {
  id: text("id").primaryKey(), runId: text("run_id").notNull(), browserProfileId: text("browser_profile_id").notNull(), browserProfileName: text("browser_profile_name").notNull(),
  routeJson: text("route_json").notNull(), shippingProfileJson: text("shipping_profile_json"), assistedEligible: integer("assisted_eligible", { mode: "boolean" }).notNull().default(false), executionState: text("execution_state").notNull().default("OBSERVING"), checkpointReason: text("checkpoint_reason"), status: text("status").notNull(), startedAt: integer("started_at").notNull(), endedAt: integer("ended_at"), finalErrorJson: text("final_error_json")
});

export const runEvents = sqliteTable("run_events", {
  id: text("id").primaryKey(), runId: text("run_id").notNull(), runSessionId: text("run_session_id"), wallTimeMs: integer("wall_time_ms").notNull(), elapsedNs: text("elapsed_ns").notNull(),
  type: text("type").notNull(), stateBefore: text("state_before"), stateAfter: text("state_after"), payloadJson: text("payload_json").notNull()
});

export const runArtifacts = sqliteTable("run_artifacts", {
  id: text("id").primaryKey(), runId: text("run_id").notNull(), runSessionId: text("run_session_id").notNull(), kind: text("kind").notNull(),
  relativePath: text("relative_path").notNull(), sensitive: integer("sensitive", { mode: "boolean" }).notNull(), createdAt: integer("created_at").notNull()
});

export const profileWarmStates = sqliteTable("profile_warm_states", {
  id: text("id").primaryKey(), browserProfileId: text("browser_profile_id").notNull(), storeId: text("store_id").notNull(), status: text("status").notNull(),
  storefrontReady: integer("storefront_ready", { mode: "boolean" }).notNull(), googleReady: integer("google_ready", { mode: "boolean" }).notNull(), shopPayReady: integer("shop_pay_ready", { mode: "boolean" }).notNull(),
  storefrontCompletedAt: integer("storefront_completed_at"), googleCompletedAt: integer("google_completed_at"), shopPayCompletedAt: integer("shop_pay_completed_at"),
  proxyProfileId: text("proxy_profile_id"), driverKind: text("driver_kind").notNull(), routePublicIp: text("route_public_ip"), routeCountry: text("route_country"),
  startedAt: integer("started_at").notNull(), completedAt: integer("completed_at"), updatedAt: integer("updated_at").notNull()
});

export const runNetworkUsage = sqliteTable("run_network_usage", {
  id: text("id").primaryKey(), runId: text("run_id").notNull(), usageKey: text("usage_key").notNull(), source: text("source").notNull(),
  runSessionId: text("run_session_id"), storeId: text("store_id"), proxyProfileId: text("proxy_profile_id"), proxyName: text("proxy_name"),
  receivedBytes: integer("received_bytes").notNull(), sentBytes: integer("sent_bytes").notNull(), requestCount: integer("request_count").notNull(), completeness: text("completeness").notNull(),
  costPerGbMicrosUsd: integer("cost_per_gb_micros_usd"), estimatedCostMicrosUsd: integer("estimated_cost_micros_usd"), updatedAt: integer("updated_at").notNull()
});

export const runSetups = sqliteTable("run_setups", {
  id: text("id").primaryKey(), name: text("name").notNull().unique(), diagnosticLevel: text("diagnostic_level").notNull(), executionMode: text("execution_mode").notNull(),
  profileIdsJson: text("profile_ids_json").notNull(), targetId: text("target_id"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull()
});

export const targets = sqliteTable("targets", {
  id: text("id").primaryKey(), name: text("name").notNull().unique(), storeId: text("store_id").notNull(), productKeywordsJson: text("product_keywords_json").notNull(), negativeKeywordsJson: text("negative_keywords_json").notNull(),
  directProductUrl: text("direct_product_url"), preferredColorsJson: text("preferred_colors_json").notNull(), sizePriorityJson: text("size_priority_json").notNull(), currency: text("currency").notNull(), maxRetailMinor: integer("max_retail_minor").notNull(), quantity: integer("quantity").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true), latestCheckJson: text("latest_check_json"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull()
});
