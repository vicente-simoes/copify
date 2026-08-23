import { STORE_GENERAL, type ProxyProfile, type Target } from "@copify/shared";

export type Notice = { kind: "error" | "info"; message: string } | null;
export type ProxyDraft = {
  name: string;
  provider: ProxyProfile["provider"];
  type: ProxyProfile["type"];
  protocol: ProxyProfile["protocol"];
  host: string;
  port: number;
  username: string;
  password: string;
  expectedCountry?: string;
  expectedCity?: string;
  enabled: boolean;
};
export type TargetDraft = {
  storeId: Target["storeId"];
  name: string;
  productKeywords: string;
  negativeKeywords: string;
  preferredColors: string;
  sizePriority: string;
  currency: "EUR" | "GBP" | "USD";
  maxRetailPrice: string;
  enabled: boolean;
};
export type ShippingDraft = {
  name: string;
  fullName: string;
  email: string;
  phone: string;
  address1: string;
  address2: string;
  postalCode: string;
  city: string;
  region: string;
  country: string;
  enabled: boolean;
};
export const blankProxy = (): ProxyDraft => ({
  name: "",
  provider: "custom",
  type: "residential-sticky",
  protocol: "http",
  host: "",
  port: 8080,
  username: "",
  password: "",
  enabled: true,
});
export const blankTarget = (): TargetDraft => ({
  storeId: STORE_GENERAL,
  name: "",
  productKeywords: "",
  negativeKeywords: "",
  preferredColors: "",
  sizePriority: "",
  currency: "EUR",
  maxRetailPrice: "0.00",
  enabled: true,
});
export const blankShipping = (): ShippingDraft => ({
  name: "",
  fullName: "",
  email: "",
  phone: "",
  address1: "",
  address2: "",
  postalCode: "",
  city: "",
  region: "",
  country: "PT",
  enabled: true,
});
export const list = (value: string) =>
  value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
export const toMinor = (value: string) => {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  return match
    ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
    : -1;
};
export const fromMinor = (value: number) => (value / 100).toFixed(2);
