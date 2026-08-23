import { z } from "zod";

export const storeCurrencySchema = z.enum(["EUR", "GBP", "USD"]);
export type StoreCurrency = z.infer<typeof storeCurrencySchema>;

export const storeStatusSchema = z.enum(["stable", "beta", "experimental", "unsupported"]);
export type StoreStatus = z.infer<typeof storeStatusSchema>;
export const storeMonitorKindSchema = z.enum(["shared", "in-browser"]).nullable();
export type StoreMonitorKind = z.infer<typeof storeMonitorKindSchema>;

export const storeCapabilitiesSchema = z.object({
  monitor: storeMonitorKindSchema, cartInspection: z.boolean(), addToCart: z.boolean(), checkoutAutofill: z.boolean()
});
export type StoreCapabilities = z.infer<typeof storeCapabilitiesSchema>;

export const storeVariantSizesSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("enum"), values: z.array(z.string().min(1).max(80)).min(1) }),
  z.object({ kind: z.literal("freeform") })
]);
export type StoreVariantSizes = z.infer<typeof storeVariantSizesSchema>;

export const storeManifestSchema = z.object({
  id: z.string().min(1).max(64), name: z.string().min(1).max(80), region: z.string().min(1).max(40).nullable(),
  currency: storeCurrencySchema, status: storeStatusSchema, capabilities: storeCapabilitiesSchema,
  variants: z.object({ sizes: storeVariantSizesSchema, colors: z.object({ kind: z.literal("freeform") }) })
});
export type StoreManifest = z.infer<typeof storeManifestSchema>;

export const STORE_SUPREME_EU = "supreme-eu" as const;
export const STORE_GENERAL = "general" as const;

const SUPREME_EU_APPAREL_SIZES = ["Small", "Medium", "Large", "XLarge", "XXLarge"];

const MANIFESTS: readonly StoreManifest[] = [
  {
    id: STORE_SUPREME_EU, name: "Supreme", region: "EU", currency: "EUR", status: "stable",
    capabilities: { monitor: "shared", cartInspection: true, addToCart: true, checkoutAutofill: true },
    variants: { sizes: { kind: "enum", values: SUPREME_EU_APPAREL_SIZES }, colors: { kind: "freeform" } }
  },
  {
    id: STORE_GENERAL, name: "General", region: null, currency: "EUR", status: "unsupported",
    capabilities: { monitor: null, cartInspection: false, addToCart: false, checkoutAutofill: false },
    variants: { sizes: { kind: "freeform" }, colors: { kind: "freeform" } }
  }
];

const BY_ID = new Map(MANIFESTS.map((manifest) => [manifest.id, manifest]));

export function listStoreManifests(): StoreManifest[] { return [...MANIFESTS]; }
export function getStoreManifest(id: string): StoreManifest | undefined { return BY_ID.get(id); }
export function isKnownStore(id: string): boolean { return BY_ID.has(id); }
export function requireStoreManifest(id: string): StoreManifest { const manifest = BY_ID.get(id); if (!manifest) throw new Error(`Unknown store "${id}".`); return manifest; }
export function storeCapabilities(id: string): StoreCapabilities | undefined { return BY_ID.get(id)?.capabilities; }
export function isMonitorable(id: string): boolean { return BY_ID.get(id)?.capabilities.monitor !== null && BY_ID.has(id); }
export function supportsAssistedCheckout(id: string): boolean { const capabilities = BY_ID.get(id)?.capabilities; return Boolean(capabilities?.addToCart && capabilities.checkoutAutofill); }

export const storeSettingsSchema = z.object({ id: z.string().min(1).max(64), enabled: z.boolean() });
export type StoreSettings = z.infer<typeof storeSettingsSchema>;
export const storeSchema = storeManifestSchema.extend({ enabled: z.boolean() });
export type Store = z.infer<typeof storeSchema>;
