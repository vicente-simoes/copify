import { z } from "zod";

export const storeCurrencySchema = z.enum(["EUR", "GBP", "USD"]);
export type StoreCurrency = z.infer<typeof storeCurrencySchema>;

export const storeStatusSchema = z.enum(["stable", "beta", "experimental", "unsupported"]);
export type StoreStatus = z.infer<typeof storeStatusSchema>;
export const storeMonitorKindSchema = z.enum(["shared", "in-browser"]).nullable();
export type StoreMonitorKind = z.infer<typeof storeMonitorKindSchema>;

export const discoverySourceSchema = z.enum(["direct-product", "collection", "product-sitemap", "predictive-search"]);
export type DiscoverySource = z.infer<typeof discoverySourceSchema>;
export const discoverySourceDescriptorSchema = z.object({
  kind: discoverySourceSchema,
  handlerId: z.string().min(1).max(80),
  cadence: z.enum(["active-interval", "adaptive-sitemap"]),
  pathTemplate: z.string().min(1).max(512).optional(),
  maxResponseBytes: z.number().int().min(1_024).max(8 * 1024 * 1024),
});
export type DiscoverySourceDescriptor = z.infer<typeof discoverySourceDescriptorSchema>;
export const storeMonitoringSchema = z.object({
  descriptorVersion: z.literal(1), mode: z.enum(["shared", "in-browser"]),
  access: z.enum(["PUBLIC", "AUTHORIZED", "LOCAL"]), recommendedPollIntervalMs: z.number().int().min(200),
  endpoint: z.string().url(), hydrationHandlerId: z.string().min(1).max(80),
  sources: z.array(discoverySourceDescriptorSchema).min(1),
}).nullable();
export type StoreMonitoring = z.infer<typeof storeMonitoringSchema>;

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
  monitoring: storeMonitoringSchema,
  warming: z.object({ storefrontUrl: z.string().url() }).nullable(),
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
    monitoring: {
      descriptorVersion: 1, mode: "shared", access: "PUBLIC", recommendedPollIntervalMs: 1_000,
      endpoint: "https://eu.supreme.com/collections/all", hydrationHandlerId: "supreme-product-page-v1",
      sources: [
        { kind: "direct-product", handlerId: "supreme-product-page-v1", cadence: "active-interval", maxResponseBytes: 2 * 1024 * 1024 },
        { kind: "collection", handlerId: "supreme-collection-v1", cadence: "active-interval", pathTemplate: "/collections/all", maxResponseBytes: 2 * 1024 * 1024 },
        { kind: "product-sitemap", handlerId: "shopify-sitemap-v1", cadence: "adaptive-sitemap", pathTemplate: "/sitemap.xml", maxResponseBytes: 2 * 1024 * 1024 },
        { kind: "predictive-search", handlerId: "shopify-predictive-search-v1", cadence: "active-interval", pathTemplate: "/search/suggest.json", maxResponseBytes: 512 * 1024 },
      ],
    },
    warming: { storefrontUrl: "https://eu.supreme.com/pages/shop" },
    variants: { sizes: { kind: "enum", values: SUPREME_EU_APPAREL_SIZES }, colors: { kind: "freeform" } }
  },
  {
    id: STORE_GENERAL, name: "General", region: null, currency: "EUR", status: "unsupported",
    capabilities: { monitor: null, cartInspection: false, addToCart: false, checkoutAutofill: false },
    monitoring: null,
    warming: null,
    variants: { sizes: { kind: "freeform" }, colors: { kind: "freeform" } }
  }
];

const BY_ID = new Map(MANIFESTS.map((manifest) => [manifest.id, manifest]));

export function listStoreManifests(): StoreManifest[] { return [...MANIFESTS]; }
export function getStoreManifest(id: string): StoreManifest | undefined { return BY_ID.get(id); }
export function isKnownStore(id: string): boolean { return BY_ID.has(id); }
export function requireStoreManifest(id: string): StoreManifest { const manifest = BY_ID.get(id); if (!manifest) throw new Error(`Unknown store "${id}".`); return manifest; }
export function storeCapabilities(id: string): StoreCapabilities | undefined { return BY_ID.get(id)?.capabilities; }
export function isMonitorable(id: string): boolean { return BY_ID.get(id)?.monitoring !== null && BY_ID.has(id); }
export function supportsAssistedCheckout(id: string): boolean { const capabilities = BY_ID.get(id)?.capabilities; return Boolean(capabilities?.addToCart && capabilities.checkoutAutofill); }

export const storeSettingsSchema = z.object({ id: z.string().min(1).max(64), enabled: z.boolean() });
export type StoreSettings = z.infer<typeof storeSettingsSchema>;
export const storeSchema = storeManifestSchema.extend({ enabled: z.boolean() });
export type Store = z.infer<typeof storeSchema>;

export type StoreShippingDestination = {
  country: string;
  label: string;
  regions: readonly string[];
};

const SUPREME_EU_SHIPPING_DESTINATIONS: readonly StoreShippingDestination[] = [
  { country: "AT", label: "Austria", regions: [] },
  { country: "BE", label: "Belgium", regions: [] },
  { country: "BG", label: "Bulgaria", regions: [] },
  { country: "HR", label: "Croatia", regions: [] },
  { country: "CY", label: "Cyprus", regions: [] },
  { country: "CZ", label: "Czech Republic", regions: [] },
  { country: "DK", label: "Denmark", regions: [] },
  { country: "EE", label: "Estonia", regions: [] },
  { country: "FI", label: "Finland", regions: [] },
  { country: "FR", label: "France", regions: [] },
  { country: "DE", label: "Germany", regions: [] },
  { country: "GR", label: "Greece", regions: [] },
  { country: "HU", label: "Hungary", regions: [] },
  { country: "IE", label: "Ireland", regions: [] },
  { country: "IT", label: "Italy", regions: [] },
  { country: "LV", label: "Latvia", regions: [] },
  { country: "LT", label: "Lithuania", regions: [] },
  { country: "LU", label: "Luxembourg", regions: [] },
  { country: "MT", label: "Malta", regions: [] },
  { country: "NL", label: "Netherlands", regions: [] },
  { country: "PL", label: "Poland", regions: [] },
  { country: "PT", label: "Portugal", regions: ["Azores", "Aveiro", "Beja", "Braga", "Bragança", "Castelo Branco", "Coimbra", "Évora", "Faro", "Guarda", "Leiria", "Lisbon", "Madeira", "Portalegre", "Porto", "Santarém", "Setúbal", "Viana do Castelo", "Vila Real", "Viseu"] },
  { country: "RO", label: "Romania", regions: [] },
  { country: "SK", label: "Slovakia", regions: [] },
  { country: "SI", label: "Slovenia", regions: [] },
  { country: "ES", label: "Spain", regions: [] },
  { country: "SE", label: "Sweden", regions: [] },
  { country: "CH", label: "Switzerland", regions: [] },
  { country: "GB", label: "United Kingdom", regions: [] },
];

const SHIPPING_DESTINATIONS = new Map<string, readonly StoreShippingDestination[]>([
  [STORE_SUPREME_EU, SUPREME_EU_SHIPPING_DESTINATIONS],
]);

export function getStoreShippingDestinations(id: string): readonly StoreShippingDestination[] {
  return SHIPPING_DESTINATIONS.get(id) ?? [];
}
