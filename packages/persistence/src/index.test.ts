import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("migrates an existing v1 database without removing browser profiles", async () => {
    const root = mkdtempSync(join(tmpdir(), "copify-v1-")); roots.push(root);
    const { DatabaseSync } = await import("node:sqlite"); const database = new DatabaseSync(join(root, "copify.sqlite"));
    database.exec("CREATE TABLE browser_profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, user_data_dir TEXT NOT NULL, proxy_profile_id TEXT, shipping_profile_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); PRAGMA user_version = 1;");
    database.prepare("INSERT INTO browser_profiles VALUES (?,?,?,?,?,?,?,?)").run("00000000-0000-4000-8000-000000000001", "Legacy", "C:/legacy", null, null, 1, 1, 1); database.close();
    const repo = openProfileRepository(join(root, "copify.sqlite"), join(root, "browser-profiles")); repositories.push(repo);
    expect((await repo.list())[0]).toMatchObject({ name: "Legacy" });
    expect(await repo.listProxies()).toEqual([]);
  });
});
