import { cardBrand, createPaymentProfileSchema, luhnValid, type CreatePaymentProfileInput, type PaymentBatchPreviewRow, type PaymentProfile } from "@copify/shared";

export const PAYMENT_CSV_HEADERS = ["name","kind","card_number","expiry_month","expiry_year","cvv","cardholder_name","tags","billing_address1","billing_address2","billing_postal_code","billing_city","billing_region","billing_country"] as const;
export type PendingPaymentRow = { rowNumber: number; input: CreatePaymentProfileInput | null; preview: PaymentBatchPreviewRow };

export function parsePaymentImport(text: string, existing: PaymentProfile[], now = new Date()): PendingPaymentRow[] {
  const records = parseCsv(text); if (!records.length) throw new Error("EMPTY_IMPORT");
  const headers = records[0].map((value) => value.trim().toLowerCase());
  if (headers.length !== PAYMENT_CSV_HEADERS.length || PAYMENT_CSV_HEADERS.some((header,index) => headers[index] !== header)) throw new Error("INVALID_HEADERS");
  const seenCards = new Set<string>(); const seenNames = new Set<string>();
  return records.slice(1).filter((record) => record.some((value) => value.trim())).map((record,index) => {
    const rowNumber = index + 2; const cells = Object.fromEntries(PAYMENT_CSV_HEADERS.map((header,cellIndex) => [header,(record[cellIndex] ?? "").trim()]));
    const cardNumber = cells.card_number.replace(/[\s-]/g, ""); const kind = cells.kind.toUpperCase(); const expiryMonth = Number(cells.expiry_month); let expiryYear = Number(cells.expiry_year); if (expiryYear >= 0 && expiryYear < 100) expiryYear += 2000;
    const tags = normalizeTags(cells.tags.split("|").filter(Boolean)); const errors: string[] = []; const warnings: string[] = [];
    if (!cells.name) errors.push("NAME_REQUIRED"); else if (seenNames.has(cells.name.toLowerCase())) errors.push("DUPLICATE_NAME"); else seenNames.add(cells.name.toLowerCase());
    if (kind !== "CARD" && kind !== "VCC") errors.push("INVALID_KIND");
    if (!/^\d{12,19}$/.test(cardNumber) || !luhnValid(cardNumber)) errors.push("INVALID_CARD_NUMBER");
    else if (seenCards.has(cardNumber)) errors.push("DUPLICATE_CARD"); else seenCards.add(cardNumber);
    if (!Number.isInteger(expiryMonth) || expiryMonth < 1 || expiryMonth > 12 || !Number.isInteger(expiryYear) || expiryYear < now.getUTCFullYear() || (expiryYear === now.getUTCFullYear() && expiryMonth < now.getUTCMonth() + 1)) errors.push("INVALID_EXPIRY");
    if (!/^\d{3,4}$/.test(cells.cvv)) errors.push("INVALID_CVV");
    if (!cells.cardholder_name) errors.push("CARDHOLDER_REQUIRED");
    const billingValues = [cells.billing_address1,cells.billing_postal_code,cells.billing_city,cells.billing_country]; const anyBilling = [...billingValues,cells.billing_address2,cells.billing_region].some(Boolean);
    if (anyBilling && billingValues.some((value) => !value)) errors.push("INCOMPLETE_BILLING");
    if (cells.billing_country && !/^[A-Za-z]{2}$/.test(cells.billing_country)) errors.push("INVALID_BILLING_COUNTRY");
    if (cardNumber.length >= 4 && existing.some((profile) => profile.last4 === cardNumber.slice(-4) && profile.expiryMonth === expiryMonth && profile.expiryYear === expiryYear)) warnings.push("EXISTING_LAST4_EXPIRY_COLLISION");
    const billing = anyBilling ? { fullName: cells.cardholder_name, address1: cells.billing_address1, ...(cells.billing_address2 ? { address2: cells.billing_address2 } : {}), postalCode: cells.billing_postal_code, city: cells.billing_city, ...(cells.billing_region ? { region: cells.billing_region } : {}), country: cells.billing_country.toUpperCase() } : null;
    const candidate = { name: cells.name, kind, cardNumber, expiryMonth, expiryYear, cvv: cells.cvv, cardholderName: cells.cardholder_name, tags, billing };
    const parsed = errors.length ? null : createPaymentProfileSchema.safeParse(candidate); if (parsed && !parsed.success) errors.push("INVALID_ROW");
    return { rowNumber, input: parsed?.success ? parsed.data : null, preview: { rowNumber, name: cells.name.slice(0,80), kind: kind === "VCC" ? "VCC" : "CARD", brand: cardNumber ? cardBrand(cardNumber) : null, last4: /^\d{4,}$/.test(cardNumber) ? cardNumber.slice(-4) : null, expiryMonth: Number.isInteger(expiryMonth) && expiryMonth >= 1 && expiryMonth <= 12 ? expiryMonth : null, expiryYear: Number.isInteger(expiryYear) && expiryYear >= 2020 && expiryYear <= 2200 ? expiryYear : null, tags, errors: [...new Set(errors)], warnings } };
  });
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) { const char = text[index]; if (quoted) { if (char === '"' && text[index+1] === '"') { value += '"'; index += 1; } else if (char === '"') quoted = false; else value += char; } else if (char === '"' && value.length === 0) quoted = true; else if (char === ",") { row.push(value); value = ""; } else if (char === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; } else value += char; }
  if (quoted) throw new Error("MALFORMED_CSV"); if (value.length || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); } return rows;
}
function normalizeTags(tags: string[]): string[] { return [...new Set(tags.map((tag) => tag.trim().replace(/\s+/g," ")).filter(Boolean).map((tag) => /^revolut$/i.test(tag) ? "Revolut" : /^mb\s*way$/i.test(tag) ? "MB WAY" : tag))].slice(0,12); }
