import { randomUUID } from "node:crypto";
import type { MaxCheckouts } from "@copify/shared";

export type CheckoutReservation = { id: string; runSessionId: string; submitted: boolean };
export type CheckoutQuotaSnapshot = { limit: MaxCheckouts; reserved: number; succeeded: number; ambiguous: number };

/** Main-process authority for one Run. JavaScript's event loop makes each method atomic. */
export class CheckoutQuota {
  private readonly reservations = new Map<string, CheckoutReservation>();
  private succeeded = 0;
  private ambiguous = 0;

  constructor(readonly limit: MaxCheckouts) {}

  reserve(runSessionId: string): { granted: true; reservationId: string | null; snapshot: CheckoutQuotaSnapshot } | { granted: false; snapshot: CheckoutQuotaSnapshot } {
    if (this.limit === "UNLIMITED") return { granted: true, reservationId: null, snapshot: this.snapshot() };
    const existing = [...this.reservations.values()].find((entry) => entry.runSessionId === runSessionId);
    if (existing) return { granted: true, reservationId: existing.id, snapshot: this.snapshot() };
    if (this.succeeded + this.reservations.size >= this.limit) return { granted: false, snapshot: this.snapshot() };
    const reservation: CheckoutReservation = { id: randomUUID(), runSessionId, submitted: false }; this.reservations.set(reservation.id, reservation);
    return { granted: true, reservationId: reservation.id, snapshot: this.snapshot() };
  }

  markSubmitted(reservationId: string | null): void { if (!reservationId) return; const reservation = this.reservations.get(reservationId); if (reservation) reservation.submitted = true; }

  succeed(reservationId: string | null): { orderIndex: number; snapshot: CheckoutQuotaSnapshot } {
    if (reservationId) this.reservations.delete(reservationId);
    this.succeeded += 1;
    return { orderIndex: this.succeeded, snapshot: this.snapshot() };
  }

  reject(reservationId: string | null): CheckoutQuotaSnapshot { if (reservationId) this.reservations.delete(reservationId); return this.snapshot(); }

  retainAmbiguous(reservationId: string | null): CheckoutQuotaSnapshot { if (reservationId && this.reservations.has(reservationId)) this.ambiguous += 1; return this.snapshot(); }

  releaseUnsubmittedForSession(runSessionId: string): CheckoutQuotaSnapshot {
    for (const [id, reservation] of this.reservations) if (reservation.runSessionId === runSessionId && !reservation.submitted) this.reservations.delete(id);
    return this.snapshot();
  }

  snapshot(): CheckoutQuotaSnapshot { return { limit: this.limit, reserved: this.reservations.size, succeeded: this.succeeded, ambiguous: this.ambiguous }; }
}
