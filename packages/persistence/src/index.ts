import { DatabaseSync } from "node:sqlite";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { asc, eq } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  browserProfileSchema,
  createBrowserProfileSchema,
  updateBrowserProfileSchema,
  type BrowserProfile,
  type CreateBrowserProfileInput,
  type UpdateBrowserProfileInput
} from "@copify/shared";
import { browserProfiles } from "./schema";

export { browserProfiles } from "./schema";

export function profileDirectory(profilesRoot: string, profileId: string): string {
  return join(resolve(profilesRoot), profileId);
}

export class ProfileRepository {
  private readonly db: SqliteRemoteDatabase<{ browserProfiles: typeof browserProfiles }>;

  constructor(private readonly sql: DatabaseSync, private readonly profilesRoot: string) {
    mkdirSync(dirname(profilesRoot), { recursive: true });
    mkdirSync(profilesRoot, { recursive: true });
    this.migrate();
    this.db = drizzle(async (query, params, method) => {
      const statement = this.sql.prepare(query);
      if (method === "run") { statement.run(...params); return { rows: [] }; }
      if (method === "get") {
        const row = statement.get(...params) as Record<string, unknown> | undefined;
        return { rows: row ? Object.values(row) : undefined as unknown as unknown[] };
      }
      return { rows: (statement.all(...params) as Record<string, unknown>[]).map(Object.values) };
    }, { schema: { browserProfiles } });
  }

  private migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS browser_profiles (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL UNIQUE,
        user_data_dir TEXT NOT NULL,
        proxy_profile_id TEXT,
        shipping_profile_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      PRAGMA user_version = 1;
    `);
  }

  async list(): Promise<BrowserProfile[]> {
    return (await this.db.select().from(browserProfiles).orderBy(asc(browserProfiles.createdAt)).all()).map((row) => browserProfileSchema.parse(row));
  }

  async create(input: CreateBrowserProfileInput): Promise<BrowserProfile> {
    const parsed = createBrowserProfileSchema.parse(input);
    const id = randomUUID();
    const now = Date.now();
    const profile: BrowserProfile = {
      id,
      name: parsed.name,
      userDataDir: profileDirectory(this.profilesRoot, id),
      proxyProfileId: null,
      shippingProfileId: null,
      enabled: parsed.enabled,
      createdAt: now,
      updatedAt: now
    };
    try {
      await this.db.insert(browserProfiles).values(profile).run();
    } catch (error) {
      throw new Error(isUniqueError(error) ? "A browser profile with that name already exists." : "Could not create the browser profile.");
    }
    return profile;
  }

  async update(id: string, input: UpdateBrowserProfileInput): Promise<BrowserProfile> {
    const parsed = updateBrowserProfileSchema.parse(input);
    const existing = await this.get(id);
    if (!existing) throw new Error("Browser profile not found.");
    const updated = { ...existing, ...parsed, updatedAt: Date.now() };
    try {
      await this.db.update(browserProfiles).set({ name: updated.name, enabled: updated.enabled, updatedAt: updated.updatedAt }).where(eq(browserProfiles.id, id)).run();
    } catch (error) {
      throw new Error(isUniqueError(error) ? "A browser profile with that name already exists." : "Could not update the browser profile.");
    }
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    await this.db.delete(browserProfiles).where(eq(browserProfiles.id, id)).run();
    return true;
  }

  async get(id: string): Promise<BrowserProfile | undefined> {
    const row = await this.db.select().from(browserProfiles).where(eq(browserProfiles.id, id)).get();
    return row ? browserProfileSchema.parse(row) : undefined;
  }

  close(): void { this.sql.close(); }
}

export function openProfileRepository(databasePath: string, profilesRoot: string): ProfileRepository {
  mkdirSync(dirname(databasePath), { recursive: true });
  const sql = new DatabaseSync(databasePath);
  sql.exec("PRAGMA journal_mode = WAL;");
  return new ProfileRepository(sql, profilesRoot);
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}
