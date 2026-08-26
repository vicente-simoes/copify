import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { defaultMonitorSettings } from "@copify/shared";
import { openProfileRepository, profileDirectory, type ProfileRepository } from "./index";

const roots: string[] = [];
const repositories: ProfileRepository[] = [];
afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), "copify-persistence-"));
  roots.push(root);
  const repo = openProfileRepository(join(root, "copify.sqlite"), join(root, "browser-profiles"));
  repositories.push(repo);
  return repo;
}

describe("ProfileRepository", () => {
  it("creates persistent managed profiles and retains them across repository instances", async () => {
    const repo = repository();
    const profile = await repo.create({ name: "Home" });
    expect(profile.userDataDir).toContain(profile.id);
    expect(profile.driver).toEqual({ kind: "NATIVE_STEALTH" });
    expect(await repo.list()).toEqual([profile]);
    await expect(repo.create({ name: "Home" })).rejects.toThrow("already exists");
  });

  it("updates and removes only the profile record", async () => {
    const repo = repository();
    const profile = await repo.create({ name: "Home" });
    await expect(repo.update(profile.id, { name: "Office", enabled: false })).resolves.toMatchObject({ name: "Office", enabled: false });
    await expect(repo.remove(profile.id)).resolves.toBe(true);
    expect(await repo.list()).toEqual([]);
  });

  it("keeps a manual browser order across restarts and appends new profiles last", async () => {
    const root = mkdtempSync(join(tmpdir(), "copify-order-")); roots.push(root);
    const databasePath = join(root, "copify.sqlite"); const profilesRoot = join(root, "browser-profiles");
    const repo = openProfileRepository(databasePath, profilesRoot); repositories.push(repo);
    const first = await repo.create({ name: "First" }); const second = await repo.create({ name: "Second" }); const third = await repo.create({ name: "Third" });
    expect((await repo.list()).map((profile) => profile.name)).toEqual(["First", "Second", "Third"]);
    await repo.reorder([third.id, first.id, second.id]);
    expect((await repo.list()).map((profile) => profile.name)).toEqual(["Third", "First", "Second"]);
    await expect(repo.reorder([third.id, first.id])).rejects.toThrow("exactly once");
    await expect(repo.reorder([third.id, third.id, first.id])).rejects.toThrow("exactly once");
    const fourth = await repo.create({ name: "Fourth" });
    expect((await repo.list()).map((profile) => profile.name)).toEqual(["Third", "First", "Second", "Fourth"]);
    repo.close(); repositories.splice(repositories.indexOf(repo), 1);
    const reopened = openProfileRepository(databasePath, profilesRoot); repositories.push(reopened);
    expect((await reopened.list()).map((profile) => profile.name)).toEqual(["Third", "First", "Second", "Fourth"]);
    expect(fourth.name).toBe("Fourth");
  });

  it("always generates a child directory under the configured profile root", () => {
    expect(profileDirectory("C:/Copify/browser-profiles", "abc")).toMatch(/browser-profiles[\\/]abc$/);
  });

  it("keeps proxy credentials redacted and clears an inactive assignment on removal", async () => {
    const repo = repository();
    const proxy = await repo.createProxy({ name: "PT ISP", host: "proxy.example", port: 8080 }, { username: Buffer.from("encrypted-user"), password: Buffer.from("encrypted-password") });
    expect(proxy).toMatchObject({ usernameConfigured: true, passwordConfigured: true });
    expect(JSON.stringify(proxy)).not.toContain("encrypted-user");
    const profile = await repo.create({ name: "Home" });
    await repo.update(profile.id, { proxyProfileId: proxy.id });
    await repo.removeProxy(proxy.id);
    expect((await repo.get(profile.id))?.proxyProfileId).toBeNull();
    expect(await repo.getStoredProxy(proxy.id)).toBeUndefined();
  });

  it("keeps encrypted shipping details out of public records and clears assignments on deletion", async () => {
    const repo = repository(); const shipping = await repo.createShippingProfile({ name: "Home", details: { fullName: "Ada Lovelace", email: "ada@example.com", phone: "+351 1", address1: "1 Main St", postalCode: "1000", city: "Lisbon", country: "PT" } }, Buffer.from("encrypted-shipping"));
    expect(JSON.stringify(shipping)).not.toContain("Ada Lovelace"); expect(shipping).toMatchObject({ complete: true, country: "PT" });
    const profile = await repo.create({ name: "Home browser" }); await repo.update(profile.id, { shippingProfileId: shipping.id }); await repo.removeShippingProfile(shipping.id);
    expect((await repo.get(profile.id))?.shippingProfileId).toBeNull(); expect(await repo.getStoredShippingProfile(shipping.id)).toBeUndefined();
  });

  it("migrates an existing v1 database without removing browser profiles", async () => {
    const root = mkdtempSync(join(tmpdir(), "copify-v1-")); roots.push(root);
    const { DatabaseSync } = await import("node:sqlite"); const database = new DatabaseSync(join(root, "copify.sqlite"));
    database.exec("CREATE TABLE browser_profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, user_data_dir TEXT NOT NULL, proxy_profile_id TEXT, shipping_profile_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); PRAGMA user_version = 1;");
    database.prepare("INSERT INTO browser_profiles VALUES (?,?,?,?,?,?,?,?)").run("00000000-0000-4000-8000-000000000001", "Legacy", "C:/legacy", null, null, 1, 1, 1); database.close();
    const repo = openProfileRepository(join(root, "copify.sqlite"), join(root, "browser-profiles")); repositories.push(repo);
    expect((await repo.list())[0]).toMatchObject({ name: "Legacy", driver: { kind: "NATIVE_STEALTH" } });
    expect(await repo.listProxies()).toEqual([]);
  });

  it("migrates v6 Native CDP choices to Native Stealth", async () => {
    const root = mkdtempSync(join(tmpdir(), "copify-v6-")); roots.push(root);
    const { DatabaseSync } = await import("node:sqlite"); const database = new DatabaseSync(join(root, "copify.sqlite"));
    database.exec("CREATE TABLE browser_profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, user_data_dir TEXT NOT NULL, proxy_profile_id TEXT, shipping_profile_id TEXT, launch_mode TEXT NOT NULL DEFAULT 'PLAYWRIGHT', enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); PRAGMA user_version = 6;");
    database.prepare("INSERT INTO browser_profiles VALUES (?,?,?,?,?,?,?,?,?)").run("00000000-0000-4000-8000-000000000006", "Native legacy", "C:/legacy", null, null, "NATIVE_CDP", 1, 1, 1); database.close();
    const repo = openProfileRepository(join(root, "copify.sqlite"), join(root, "browser-profiles")); repositories.push(repo);
    expect((await repo.list())[0]).toMatchObject({ name: "Native legacy", driver: { kind: "NATIVE_STEALTH" } });
  });

  it("migrates a v3 run database to targets and immutable target snapshots", async () => {
    const root = mkdtempSync(join(tmpdir(), "copify-v3-")); roots.push(root); const { DatabaseSync } = await import("node:sqlite"); const database = new DatabaseSync(join(root, "copify.sqlite"));
    database.exec("CREATE TABLE runs (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, diagnostic_level TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, environment_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); PRAGMA user_version = 3;"); database.close();
    const repo = openProfileRepository(join(root, "copify.sqlite"), join(root, "browser-profiles")); repositories.push(repo);
    await expect(repo.createTarget({ name: "Migrated target", productKeywords: ["Jacket"], maxRetailMinor: 1_000 })).resolves.toMatchObject({ storeId: "general", directProductUrl: null });
  });

  it("persists ordered run timelines and removes all run records transactionally", async () => {
    const repo = repository(); const profile = await repo.create({ name: "Home" }); const startedAt = Date.now();
    const sessionId = randomUUID(); const detail = await repo.createRun({ name: "Direct test", diagnosticLevel: "NORMAL", profileIds: [profile.id] }, { appVersion: "0.3.0", schemaVersion: 3, osVersion: "win32", chromeVersion: null, playwrightVersion: "test", capturedAt: startedAt }, [{ id: sessionId, runId: randomUUID(), browserProfileId: profile.id, browserProfileName: profile.name, route: { kind: "direct", verification: { status: "PENDING", publicIp: null, country: null, city: null, verifiedAt: null, message: null } }, status: "STARTING", startedAt, endedAt: null, finalError: null }]);
    await repo.addRunEvent({ id: randomUUID(), runId: detail.run.id, runSessionId: sessionId, wallTimeMs: startedAt + 2, elapsedNs: "20", type: "SECOND", stateBefore: null, stateAfter: null, payload: {} });
    await repo.addRunEvent({ id: randomUUID(), runId: detail.run.id, runSessionId: sessionId, wallTimeMs: startedAt + 1, elapsedNs: "10", type: "FIRST", stateBefore: null, stateAfter: null, payload: {} });
    expect((await repo.getRun(detail.run.id))?.events.map((event) => event.type)).toEqual(["FIRST", "SECOND"]);
    expect(await repo.removeRun(detail.run.id)).toBe(true);
    expect(await repo.getRun(detail.run.id)).toBeUndefined();
  });

  it("migrates both v9 launch modes to Native Stealth without losing profiles", async () => {
    const root = mkdtempSync(join(tmpdir(), "copify-v9-")); roots.push(root);
    const { DatabaseSync } = await import("node:sqlite"); const database = new DatabaseSync(join(root, "copify.sqlite"));
    database.exec("CREATE TABLE app_secrets (id TEXT PRIMARY KEY NOT NULL, ciphertext BLOB NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE browser_profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, user_data_dir TEXT NOT NULL, proxy_profile_id TEXT, shipping_profile_id TEXT, launch_mode TEXT NOT NULL DEFAULT 'PLAYWRIGHT', enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); PRAGMA user_version = 9;");
    database.prepare("INSERT INTO browser_profiles VALUES (?,?,?,?,?,?,?,?,?)").run("00000000-0000-4000-8000-000000000009", "Legacy Playwright", "C:/legacy-a", null, null, "PLAYWRIGHT", 1, 1, 1);
    database.prepare("INSERT INTO browser_profiles VALUES (?,?,?,?,?,?,?,?,?)").run("00000000-0000-4000-8000-000000000010", "Legacy Native", "C:/legacy-b", null, null, "NATIVE_CDP", 1, 2, 2); database.close();
    const repo = openProfileRepository(join(root, "copify.sqlite"), join(root, "browser-profiles")); repositories.push(repo);
    expect((await repo.list()).map((profile) => profile.driver)).toEqual([{ kind: "NATIVE_STEALTH" }, { kind: "NATIVE_STEALTH" }]);
  });

  it("keeps an external CDP endpoint encrypted and write-only", async () => {
    const repo = repository(); const ciphertext = Buffer.from("encrypted-local-endpoint");
    const profile = await repo.create({ name: "External", driver: { kind: "EXTERNAL_CDP", endpoint: "http://127.0.0.1:9222" } }, ciphertext);
    expect(profile.driver).toEqual({ kind: "EXTERNAL_CDP", endpointConfigured: true });
    expect(JSON.stringify(profile)).not.toContain("9222");
    expect((await repo.getStoredBrowserProfile(profile.id))?.externalCdpEndpointCiphertext).toEqual(ciphertext);
    await repo.update(profile.id, { driver: { kind: "EXTERNAL_CDP", endpoint: null } }, null);
    expect((await repo.get(profile.id))?.driver).toEqual({ kind: "EXTERNAL_CDP", endpointConfigured: false });
  });

  it("persists the latest browser and watcher health independently of the event log", async () => {
    const repo = repository(); const profile = await repo.create({ name: "Home" }); const now = Date.now();
    const snapshot = { id: randomUUID(), subjectKind: "CHECKOUT" as const, subjectId: profile.id, runId: null, capturedAt: now, navigatorWebdriver: true, browserVersion: "Chrome/1", driverKind: "NATIVE_STEALTH" as const, stealthStatus: "PASS" as const, profileAgeMs: 1, cookieCount: 2, requestCount: 3, requestsPerMinute: 4, navigationCount: 5, navigationsPerMinute: 6, atcAttempts: 7, forbiddenCount: 8, rateLimitedCount: 9, challengeCount: 10, checkoutFailures: 11, averagePageLoadMs: 12, circuit: { state: "CLOSED" as const, consecutiveProtectionSignals: 0, reopenAt: null } };
    await repo.addBrowserHealthSnapshot(snapshot);
    expect(await repo.getBrowserHealth("CHECKOUT", profile.id)).toMatchObject({ latest: snapshot, recent: [snapshot] });
  });

  it("persists monitor settings and migrates legacy route selection", async () => {
    const repo = repository(); const proxy = await repo.createProxy({ name: "Monitor", host: "127.0.0.1", port: 8080 });
    const settings = defaultMonitorSettings([proxy.id]); expect(await repo.setMonitorSettings(settings)).toEqual(settings);
    expect(await repo.getMonitorSettings()).toEqual(settings);
  });

  it("migrates v10 monitor routes and persists cumulative run usage", async () => {
    const root = mkdtempSync(join(tmpdir(), "copify-v10-monitor-")); roots.push(root); const { DatabaseSync } = await import("node:sqlite"); const database = new DatabaseSync(join(root, "copify.sqlite")); const proxyId = randomUUID();
    database.exec("CREATE TABLE proxy_profiles (id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL UNIQUE,provider TEXT NOT NULL,type TEXT NOT NULL,protocol TEXT NOT NULL,host TEXT NOT NULL,port INTEGER NOT NULL,username_secret_id TEXT,password_secret_id TEXT,expected_country TEXT,expected_city TEXT,enabled INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL); CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at INTEGER NOT NULL); PRAGMA user_version=10;");
    database.prepare("INSERT INTO proxy_profiles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(proxyId, "Legacy monitor", "custom", "residential-sticky", "http", "127.0.0.1", 8080, null, null, null, null, 1, 1, 1); database.prepare("INSERT INTO app_settings VALUES ('monitor_network',?,1)").run(JSON.stringify({ proxyProfileIds: [proxyId] })); database.close();
    const repo = openProfileRepository(join(root, "copify.sqlite"), join(root, "browser-profiles")); repositories.push(repo); expect((await repo.getMonitorSettings()).proxyProfileIds).toEqual([proxyId]);
    const runId = randomUUID(); const usage = { id: randomUUID(), runId, usageKey: `monitor:${proxyId}`, source: "MONITOR" as const, runSessionId: null, storeId: "supreme-eu", proxyProfileId: proxyId, proxyName: "Legacy monitor", receivedBytes: 10, sentBytes: 2, requestCount: 1, completeness: "PARTIAL" as const, costPerGbMicrosUsd: 1_000_000, estimatedCostMicrosUsd: 0, updatedAt: Date.now() };
    await repo.upsertRunNetworkUsage(usage); expect(await repo.listRunNetworkUsage(runId)).toMatchObject([usage]);
  });

  it("migrates a v11 database to the current schema without removing its browser profiles", async () => {
    const root = mkdtempSync(join(tmpdir(), "copify-v11-")); roots.push(root); const databasePath = join(root, "copify.sqlite");
    const { DatabaseSync } = await import("node:sqlite"); const database = new DatabaseSync(databasePath);
    database.exec("CREATE TABLE browser_profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, user_data_dir TEXT NOT NULL, proxy_profile_id TEXT, shipping_profile_id TEXT, driver_kind TEXT NOT NULL DEFAULT 'NATIVE_STEALTH', external_cdp_endpoint_secret_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); PRAGMA user_version=11;");
    database.prepare("INSERT INTO browser_profiles VALUES (?,?,?,?,?,?,?,?,?,?)").run(idFor(11), "v0.9 profile", "C:/persistent-profile", null, null, "NATIVE_STEALTH", null, 1, 1, 1); database.close();
    const repo = openProfileRepository(databasePath, join(root, "browser-profiles")); repositories.push(repo);
    expect(await repo.list()).toMatchObject([{ id: idFor(11), name: "v0.9 profile", userDataDir: "C:/persistent-profile" }]);
    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    expect((inspection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(14);
    expect(inspection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profile_warm_states'").get()).toBeTruthy(); inspection.close();
  });

  it("repairs an existing target table missing the direct URL column and round-trips its value", async () => {
    const root = mkdtempSync(join(tmpdir(), "copify-target-url-")); roots.push(root); const databasePath = join(root, "copify.sqlite");
    const { DatabaseSync } = await import("node:sqlite"); const database = new DatabaseSync(databasePath);
    database.exec("CREATE TABLE targets (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, store_id TEXT NOT NULL, product_keywords_json TEXT NOT NULL, negative_keywords_json TEXT NOT NULL, preferred_colors_json TEXT NOT NULL, size_priority_json TEXT NOT NULL, currency TEXT NOT NULL, max_retail_minor INTEGER NOT NULL, quantity INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, latest_check_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); PRAGMA user_version=14;"); database.close();
    const repo = openProfileRepository(databasePath, join(root, "browser-profiles")); repositories.push(repo);
    const created = await repo.createTarget({ name: "Direct", storeId: "supreme-eu", productKeywords: ["Boxer Briefs"], directProductUrl: "https://eu.supreme.com/products/known?all=1", maxRetailMinor: 5_000 });
    expect((await repo.getTarget(created.id))?.directProductUrl).toBe("https://eu.supreme.com/products/known?all=1");
  });

  it("round-trips isolated warming state and marks it for review when route identity changes", async () => {
    const repo = repository(); const firstProxy = await repo.createProxy({ name: "PT sticky A", host: "proxy-a.invalid", port: 8080 }); const secondProxy = await repo.createProxy({ name: "PT sticky B", host: "proxy-b.invalid", port: 8081 });
    const created = await repo.create({ name: "Warm browser" }); const profile = await repo.update(created.id, { proxyProfileId: firstProxy.id }); const now = Date.now();
    const supreme = { id: randomUUID(), browserProfileId: profile.id, storeId: "supreme-eu" as const, status: "READY" as const, storefrontReady: true, googleReady: true, shopPayReady: true, storefrontCompletedAt: now - 80, googleCompletedAt: now - 60, shopPayCompletedAt: now - 40, proxyProfileId: firstProxy.id, driverKind: "NATIVE_STEALTH" as const, routePublicIp: "203.0.113.8", routeCountry: "PT", startedAt: now - 100, completedAt: now, updatedAt: now };
    const general = { ...supreme, id: randomUUID(), storeId: "general" as const, status: "IN_PROGRESS" as const, storefrontReady: false, completedAt: null };
    await repo.upsertProfileWarmState(supreme); await repo.upsertProfileWarmState(general);
    expect(await repo.getProfileWarmState(profile.id, "supreme-eu")).toEqual(supreme);
    expect(await repo.listProfileWarmStates(profile.id)).toHaveLength(2);
    await repo.updateProxy(firstProxy.id, { host: "proxy-a2.invalid" });
    expect((await repo.getProfileWarmState(profile.id, "supreme-eu"))?.status).toBe("REVIEW");
    await repo.upsertProfileWarmState(supreme);
    await repo.update(profile.id, { proxyProfileId: secondProxy.id });
    expect((await repo.getProfileWarmState(profile.id, "supreme-eu"))?.status).toBe("REVIEW");
    expect((await repo.getProfileWarmState(profile.id, "general"))?.status).toBe("REVIEW");
    await repo.remove(profile.id); expect(await repo.listProfileWarmStates(profile.id)).toEqual([]);
  });

  it("saves reusable run setups separately from run history", async () => {
    const repo = repository(); const profile = await repo.create({ name: "Home" }); const target = await repo.createTarget({ name: "Sneakers", productKeywords: ["Sneaker"], maxRetailMinor: 20_000 });
    const setup = await repo.createRunSetup({ name: "Sneakers drop", diagnosticLevel: "NORMAL", executionMode: "ASSISTED_CHECKOUT", profileIds: [profile.id], targetId: target.id });
    expect(await repo.listRunSetups()).toEqual([setup]);
    expect(await repo.removeRunSetup(setup.id)).toBe(true);
    expect(await repo.listRunSetups()).toEqual([]);
  });

  it("recovers interrupted active runs after an app restart", async () => {
    const repo = repository(); const profile = await repo.create({ name: "Home" }); const startedAt = Date.now(); const sessionId = randomUUID();
    const detail = await repo.createRun({ name: "Interrupted", diagnosticLevel: "NORMAL", profileIds: [profile.id] }, { appVersion: "0.4.0", schemaVersion: 4, osVersion: "win32", chromeVersion: null, playwrightVersion: "test", capturedAt: startedAt }, [{ id: sessionId, runId: randomUUID(), browserProfileId: profile.id, browserProfileName: profile.name, route: { kind: "direct", verification: { status: "PENDING", publicIp: null, country: null, city: null, verifiedAt: null, message: null } }, status: "RECORDING", startedAt, endedAt: null, finalError: null }]);
    await repo.setRunStatus(detail.run.id, "RECORDING"); expect(await repo.recoverInterruptedRuns()).toBe(1);
    const recovered = await repo.getRun(detail.run.id); expect(recovered?.run.status).toBe("FAILED"); expect(recovered?.sessions[0]).toMatchObject({ status: "FAILED", finalError: { code: "RUN_INTERRUPTED" } }); expect(recovered?.events.at(-1)?.type).toBe("RUN_INTERRUPTED");
  });

  it("persists a target's latest sanitized check and immutable run snapshot", async () => {
    const repo = repository(); const profile = await repo.create({ name: "Home" }); const target = await repo.createTarget({ name: "Jacket", productKeywords: ["Leather Jacket"], currency: "GBP", maxRetailMinor: 20_000 });
    const check = { id: randomUUID(), targetId: target.id, checkedAt: Date.now(), status: "SUCCESS" as const, decision: { kind: "NO_MATCH" as const, message: "No configured product phrase was found.", candidate: null, selectedVariant: null }, candidateCount: 0, errorMessage: null };
    await repo.setTargetCheck(target.id, check); expect((await repo.getTarget(target.id))?.latestCheck).toEqual(check);
    const startedAt = Date.now(); const snapshot = { targetId: target.id, name: target.name, storeId: target.storeId, productKeywords: target.productKeywords, negativeKeywords: target.negativeKeywords, directProductUrl: target.directProductUrl, preferredColors: target.preferredColors, sizePriority: target.sizePriority, currency: target.currency, maxRetailMinor: target.maxRetailMinor, quantity: target.quantity, enabled: target.enabled, capturedAt: startedAt } as const;
    const detail = await repo.createRun({ name: "Target run", diagnosticLevel: "NORMAL", profileIds: [profile.id], targetId: target.id }, { appVersion: "0.4.0", schemaVersion: 4, osVersion: "win32", chromeVersion: null, playwrightVersion: "test", capturedAt: startedAt }, [{ id: randomUUID(), runId: randomUUID(), browserProfileId: profile.id, browserProfileName: profile.name, route: { kind: "direct", verification: { status: "PENDING", publicIp: null, country: null, city: null, verifiedAt: null, message: null } }, status: "STARTING", startedAt, endedAt: null, finalError: null }], snapshot);
    await repo.updateTarget(target.id, { name: "Changed" }); await repo.removeTarget(target.id);
    expect((await repo.getRun(detail.run.id))?.run.targetSnapshot?.name).toBe("Jacket");
  });

  it("persists window placement and refuses a corrupt or undersized row", () => {
    const root = mkdtempSync(join(tmpdir(), "copify-persistence-"));
    roots.push(root);
    const file = join(root, "copify.sqlite");
    const repo = openProfileRepository(file, join(root, "browser-profiles"));
    repositories.push(repo);

    expect(repo.getWindowBounds()).toBeNull();
    const bounds = { x: 120, y: 80, width: 1400, height: 900, maximized: false };
    expect(repo.setWindowBounds(bounds)).toEqual(bounds);
    expect(repo.getWindowBounds()).toEqual(bounds);
    // A window that has never been placed keeps its size but no position.
    repo.setWindowBounds({ ...bounds, x: null, y: null, maximized: true });
    expect(repo.getWindowBounds()).toMatchObject({ x: null, y: null, maximized: true });
    expect(() => repo.setWindowBounds({ ...bounds, width: 100 })).toThrow();

    // A row hand-edited below the window minimum must read back as "no saved
    // placement" rather than open an unusably small window.
    repo.close(); repositories.pop();
    const raw = new DatabaseSync(file);
    raw.prepare("UPDATE app_settings SET value = ? WHERE key = 'window_bounds'").run(JSON.stringify({ x: 0, y: 0, width: 100, height: 100, maximized: false }));
    raw.close();
    const reopened = openProfileRepository(file, join(root, "browser-profiles"));
    repositories.push(reopened);
    expect(reopened.getWindowBounds()).toBeNull();
  });
});

function idFor(value: number): string { return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`; }
