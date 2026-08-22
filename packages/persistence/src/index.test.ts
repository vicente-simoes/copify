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
});
