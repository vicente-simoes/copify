import { afterEach, describe, expect, it, vi } from "vitest";
import { ClipboardCoordinator, type ClipboardPort } from "./clipboard-coordinator";

function fixture(formats: string[] = []) {
  let currentFormats = [...formats]; let value = ""; let marker = ""; let clears = 0;
  const grants: string[] = []; const denials: Array<{ id: string; reason: string }> = [];
  const port: ClipboardPort = {
    availableFormats: () => [...currentFormats],
    writeLease: (next, requestId) => { value = next; marker = requestId; currentFormats = ["text/plain", "text/html"]; },
    ownsLease: (next, requestId) => value === next && marker === requestId,
    clear: () => { clears += 1; value = ""; marker = ""; currentFormats = []; },
  };
  const coordinator = new ClipboardCoordinator(port, {
    grant: (_profile, id) => grants.push(id),
    deny: (_profile, id, reason) => denials.push({ id, reason }),
  });
  return { coordinator, grants, denials, clears: () => clears, change: (nextFormats: string[], nextValue = "user") => { currentFormats = nextFormats; value = nextValue; marker = "user"; } };
}

afterEach(() => vi.useRealTimers());

describe("empty-only clipboard coordinator", () => {
  it.each([["text/plain"], ["text/html"], ["text/rtf"], ["image/png"], ["FileNameW"], ["application/x-ole-object"], ["custom/vendor"]])("denies and leaves a nonempty %s clipboard untouched", async (format) => {
    const value = fixture([format]); value.coordinator.request({ profileId: "profile", requestId: `request-${format}`, value: "shipping" }); await Promise.resolve();
    expect(value.grants).toEqual([]); expect(value.denials[0]?.reason).toBe("CLIPBOARD_NOT_EMPTY"); expect(value.clears()).toBe(0);
  });

  it("grants leases FIFO and clears only the released Copify payload", async () => {
    const value = fixture(); value.coordinator.request({ profileId: "one", requestId: "first", value: "alpha" }); value.coordinator.request({ profileId: "two", requestId: "second", value: "beta" });
    await Promise.resolve(); await Promise.resolve(); expect(value.grants).toEqual(["first"]);
    value.coordinator.release("one", "first"); await Promise.resolve(); await Promise.resolve();
    expect(value.grants).toEqual(["first", "second"]); expect(value.clears()).toBe(1);
  });

  it("does not clear content another application places during a lease", async () => {
    const value = fixture(); value.coordinator.request({ profileId: "one", requestId: "first", value: "alpha" }); await Promise.resolve(); await Promise.resolve();
    value.change(["text/plain"], "new user copy"); value.coordinator.release("one", "first"); expect(value.clears()).toBe(0);
  });

  it("cleans up owned values on timeout and queued requests on cancellation", async () => {
    vi.useFakeTimers(); const value = fixture(); value.coordinator.request({ profileId: "one", requestId: "first", value: "alpha" }); await Promise.resolve(); await Promise.resolve();
    value.coordinator.request({ profileId: "two", requestId: "second", value: "beta" });
    await vi.advanceTimersByTimeAsync(1_000); expect(value.clears()).toBe(1); expect(value.grants).toContain("second");
    value.coordinator.cancelProfile("two"); expect(value.clears()).toBe(2);
  });

  it("rejects duplicate request IDs", async () => {
    const value = fixture(); const request = { profileId: "one", requestId: "same", value: "alpha" }; value.coordinator.request(request); value.coordinator.request(request); await Promise.resolve();
    expect(value.denials).toContainEqual({ id: "same", reason: "CLIPBOARD_UNAVAILABLE" });
  });
});
