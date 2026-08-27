import { describe, expect, it } from "vitest";
import { PAYMENT_CSV_HEADERS, parsePaymentImport } from "./payment-import";

const header = PAYMENT_CSV_HEADERS.join(",");
describe("payment import", () => {
  it("parses quoted cards and returns redacted preview", () => { const rows=parsePaymentImport(`${header}\n"Drop, one",VCC,4242 4242 4242 4242,12,2030,123,Ada Lovelace,revolut|mb way,,,,,,`,[]); expect(rows[0].preview).toMatchObject({name:"Drop, one",last4:"4242",tags:["Revolut","MB WAY"],errors:[]}); expect(JSON.stringify(rows[0].preview)).not.toContain("4242424242424242"); });
  it("rejects duplicates and malformed payment fields", () => { const rows=parsePaymentImport(`${header}\nOne,CARD,4242424242424242,1,2020,12,Ada,,,,,,,\nTwo,CARD,4242424242424242,12,2030,123,Ada,,,,,,,`,[]); expect(rows[0].preview.errors).toEqual(expect.arrayContaining(["INVALID_EXPIRY","INVALID_CVV"])); expect(rows[1].preview.errors).toContain("DUPLICATE_CARD"); });
  it("requires the exact write-only template", () => { expect(()=>parsePaymentImport("name,card\nA,1",[])).toThrow("INVALID_HEADERS"); });
});
