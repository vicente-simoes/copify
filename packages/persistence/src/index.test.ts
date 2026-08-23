import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
    expect(profile.launchMode).toBe("PLAYWRIGHT");
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
    expect((await repo.list())[0]).toMatchObject({ name: "Legacy", launchMode: "PLAYWRIGHT" });
    expect(await repo.listProxies()).toEqual([]);
  });

  it("resets v6 Native CDP choices to Playwright launch", async () => {
    const root = mkdtempSync(join(tmpdir(), "copify-v6-")); roots.push(root);
    const { DatabaseSync } = await import("node:sqlite"); const database = new DatabaseSync(join(root, "copify.sqlite"));
    database.exec("CREATE TABLE browser_profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, user_data_dir TEXT NOT NULL, proxy_profile_id TEXT, shipping_profile_id TEXT, launch_mode TEXT NOT NULL DEFAULT 'PLAYWRIGHT', enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); PRAGMA user_version = 6;");
    database.prepare("INSERT INTO browser_profiles VALUES (?,?,?,?,?,?,?,?,?)").run("00000000-0000-4000-8000-000000000006", "Native legacy", "C:/legacy", null, null, "NATIVE_CDP", 1, 1, 1); database.close();
    const repo = openProfileRepository(join(root, "copify.sqlite"), join(root, "browser-profiles")); repositories.push(repo);
    expect((await repo.list())[0]).toMatchObject({ name: "Native legacy", launchMode: "PLAYWRIGHT" });
  });

  it("migrates a v3 run database to targets and immutable target snapshots", async () => {
    const root = mkdtempSync(join(tmpdir(), "copify-v3-")); roots.push(root); const { DatabaseSync } = await import("node:sqlite"); const database = new DatabaseSync(join(root, "copify.sqlite"));
    database.exec("CREATE TABLE runs (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, diagnostic_level TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, environment_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); PRAGMA user_version = 3;"); database.close();
    const repo = openProfileRepository(join(root, "copify.sqlite"), join(root, "browser-profiles")); repositories.push(repo);
    await expect(repo.createTarget({ name: "Migrated target", productKeywords: ["Jacket"], maxRetailMinor: 1_000 })).resolves.toMatchObject({ storeId: "general" });
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
    const startedAt = Date.now(); const snapshot = { targetId: target.id, name: target.name, storeId: target.storeId, productKeywords: target.productKeywords, negativeKeywords: target.negativeKeywords, preferredColors: target.preferredColors, sizePriority: target.sizePriority, currency: target.currency, maxRetailMinor: target.maxRetailMinor, quantity: target.quantity, enabled: target.enabled, capturedAt: startedAt } as const;
    const detail = await repo.createRun({ name: "Target run", diagnosticLevel: "NORMAL", profileIds: [profile.id], targetId: target.id }, { appVersion: "0.4.0", schemaVersion: 4, osVersion: "win32", chromeVersion: null, playwrightVersion: "test", capturedAt: startedAt }, [{ id: randomUUID(), runId: randomUUID(), browserProfileId: profile.id, browserProfileName: profile.name, route: { kind: "direct", verification: { status: "PENDING", publicIp: null, country: null, city: null, verifiedAt: null, message: null } }, status: "STARTING", startedAt, endedAt: null, finalError: null }], snapshot);
    await repo.updateTarget(target.id, { name: "Changed" }); await repo.removeTarget(target.id);
    expect((await repo.getRun(detail.run.id))?.run.targetSnapshot?.name).toBe("Jacket");
  });
});
