import { z } from "zod";

export const IPC_VERSION = 1 as const;

export const browserProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  userDataDir: z.string().min(1),
  proxyProfileId: z.string().uuid().nullable(),
  shippingProfileId: z.string().uuid().nullable(),
  enabled: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
});

export type BrowserProfile = z.infer<typeof browserProfileSchema>;

export const createBrowserProfileSchema = z.object({
  name: z.string().trim().min(1, "A profile name is required.").max(80),
  enabled: z.boolean().default(true)
});
export type CreateBrowserProfileInput = z.input<typeof createBrowserProfileSchema>;

export const updateBrowserProfileSchema = z.object({
  name: z.string().trim().min(1, "A profile name is required.").max(80).optional(),
  enabled: z.boolean().optional()
}).refine((value) => value.name !== undefined || value.enabled !== undefined, {
  message: "Provide at least one field to update."
});
export type UpdateBrowserProfileInput = z.input<typeof updateBrowserProfileSchema>;

export const sessionStateSchema = z.enum([
  "STOPPED", "STARTING", "READY", "STOPPING", "CRASHED", "ERROR"
]);
export type SessionState = z.infer<typeof sessionStateSchema>;

export const sessionErrorSchema = z.object({
  code: z.enum(["BROWSER_START_FAILED", "RUNNER_CRASHED", "INVALID_COMMAND", "UNKNOWN"]),
  message: z.string()
});
export type SessionError = z.infer<typeof sessionErrorSchema>;

export const sessionSnapshotSchema = z.object({
  profileId: z.string().uuid(),
  state: sessionStateSchema,
  error: sessionErrorSchema.nullable(),
  updatedAt: z.number().int().nonnegative()
});
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;

export const sessionCommandSchema = z.enum(["open", "close", "restart"]);
export type SessionCommand = z.infer<typeof sessionCommandSchema>;

export const runnerCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("START"), version: z.literal(IPC_VERSION), profileId: z.string().uuid(), userDataDir: z.string().min(1) }),
  z.object({ type: z.literal("STOP"), version: z.literal(IPC_VERSION) })
]);
export type RunnerCommand = z.infer<typeof runnerCommandSchema>;

export const runnerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("READY"), version: z.literal(IPC_VERSION), profileId: z.string().uuid() }),
  z.object({ type: z.literal("STOPPED"), version: z.literal(IPC_VERSION), profileId: z.string().uuid() }),
  z.object({ type: z.literal("ERROR"), version: z.literal(IPC_VERSION), profileId: z.string().uuid().nullable(), code: z.literal("BROWSER_START_FAILED"), message: z.string() })
]);
export type RunnerEvent = z.infer<typeof runnerEventSchema>;

export const profileIpc = {
  list: "profiles:list",
  create: "profiles:create",
  update: "profiles:update",
  remove: "profiles:remove"
} as const;

export const sessionIpc = {
  list: "sessions:list",
  open: "sessions:open",
  close: "sessions:close",
  restart: "sessions:restart",
  openAll: "sessions:open-all",
  closeAll: "sessions:close-all",
  changed: "sessions:changed"
} as const;

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };
