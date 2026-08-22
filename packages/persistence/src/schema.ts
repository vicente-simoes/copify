import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const browserProfiles = sqliteTable("browser_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  userDataDir: text("user_data_dir").notNull(),
  proxyProfileId: text("proxy_profile_id"),
  shippingProfileId: text("shipping_profile_id"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});
