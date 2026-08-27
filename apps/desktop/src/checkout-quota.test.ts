import { describe, expect, it } from "vitest";
import { CheckoutQuota } from "./checkout-quota";

describe("CheckoutQuota", () => {
  it("prevents finite concurrent reservations from overshooting", () => { const quota = new CheckoutQuota(1); const first = quota.reserve("a"); expect(first.granted).toBe(true); expect(quota.reserve("b")).toMatchObject({ granted: false }); });
  it("releases definite failures and assigns deterministic success indices", () => { const quota = new CheckoutQuota(2); const first = quota.reserve("a"); if (!first.granted) throw new Error(); quota.reject(first.reservationId); const retry = quota.reserve("b"); if (!retry.granted) throw new Error(); expect(quota.succeed(retry.reservationId).orderIndex).toBe(1); });
  it("retains ambiguous submitted slots", () => { const quota = new CheckoutQuota(1); const first = quota.reserve("a"); if (!first.granted) throw new Error(); quota.markSubmitted(first.reservationId); quota.retainAmbiguous(first.reservationId); quota.releaseUnsubmittedForSession("a"); expect(quota.snapshot()).toMatchObject({ reserved: 1, ambiguous: 1 }); });
  it("does not serialize unlimited sessions", () => { const quota = new CheckoutQuota("UNLIMITED"); expect([quota.reserve("a"),quota.reserve("b")].every((entry) => entry.granted && entry.reservationId === null)).toBe(true); });
});
