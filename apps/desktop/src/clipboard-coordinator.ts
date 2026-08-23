import type { ClipboardLeaseDenialReason } from "@copify/shared";

export type ClipboardLeaseRequest = { profileId: string; requestId: string; value: string };
export interface ClipboardPort {
  availableFormats(): string[];
  writeLease(value: string, requestId: string): void;
  ownsLease(value: string, requestId: string): boolean;
  clear(): void;
}

type ClipboardCoordinatorOptions = {
  leaseTimeoutMs?: number;
  queueTimeoutMs?: number;
  grant(profileId: string, requestId: string): void;
  deny(profileId: string, requestId: string, reason: ClipboardLeaseDenialReason): void;
};

type QueuedLease = ClipboardLeaseRequest & { timer: NodeJS.Timeout };
type ActiveLease = ClipboardLeaseRequest & { timer: NodeJS.Timeout };

export class ClipboardCoordinator {
  private readonly queue: QueuedLease[] = [];
  private readonly requestKeys = new Set<string>();
  private active: ActiveLease | undefined;
  private processing = false;
  private readonly leaseTimeoutMs: number;
  private readonly queueTimeoutMs: number;

  constructor(private readonly clipboard: ClipboardPort, private readonly options: ClipboardCoordinatorOptions) {
    this.leaseTimeoutMs = options.leaseTimeoutMs ?? 1_000;
    this.queueTimeoutMs = options.queueTimeoutMs ?? 10_000;
  }

  request(request: ClipboardLeaseRequest): void {
    const key = requestKey(request.profileId, request.requestId);
    if (this.requestKeys.has(key)) { this.options.deny(request.profileId, request.requestId, "CLIPBOARD_UNAVAILABLE"); return; }
    this.requestKeys.add(key);
    const queued: QueuedLease = {
      ...request,
      timer: setTimeout(() => {
        const index = this.queue.indexOf(queued);
        if (index === -1) return;
        this.queue.splice(index, 1); this.requestKeys.delete(key);
        this.options.deny(request.profileId, request.requestId, "QUEUE_TIMEOUT");
      }, this.queueTimeoutMs),
    };
    queued.timer.unref?.();
    this.queue.push(queued);
    void this.process();
  }

  release(profileId: string, requestId: string): void {
    if (this.active?.profileId === profileId && this.active.requestId === requestId) { this.finishActive(); return; }
    const index = this.queue.findIndex((request) => request.profileId === profileId && request.requestId === requestId);
    if (index === -1) return;
    const [request] = this.queue.splice(index, 1); clearTimeout(request.timer); this.requestKeys.delete(requestKey(profileId, requestId));
  }

  cancelProfile(profileId: string): void {
    if (this.active?.profileId === profileId) this.finishActive();
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const request = this.queue[index]; if (request.profileId !== profileId) continue;
      this.queue.splice(index, 1); clearTimeout(request.timer); this.requestKeys.delete(requestKey(request.profileId, request.requestId));
      this.options.deny(request.profileId, request.requestId, "SESSION_ENDED");
    }
  }

  cancelAll(): void {
    if (this.active) this.finishActive();
    for (const request of this.queue.splice(0)) {
      clearTimeout(request.timer); this.requestKeys.delete(requestKey(request.profileId, request.requestId));
      this.options.deny(request.profileId, request.requestId, "SESSION_ENDED");
    }
  }

  private async process(): Promise<void> {
    if (this.processing || this.active) return;
    this.processing = true;
    try {
      while (!this.active && this.queue.length) {
        const request = this.queue.shift()!; clearTimeout(request.timer);
        let empty = false;
        try {
          empty = this.clipboard.availableFormats().length === 0;
          if (empty) { await Promise.resolve(); empty = this.clipboard.availableFormats().length === 0; }
        } catch { empty = false; }
        if (!empty) {
          this.requestKeys.delete(requestKey(request.profileId, request.requestId));
          this.options.deny(request.profileId, request.requestId, "CLIPBOARD_NOT_EMPTY");
          continue;
        }
        try {
          this.clipboard.writeLease(request.value, request.requestId);
          const active: ActiveLease = { ...request, timer: setTimeout(() => this.finishActive(), this.leaseTimeoutMs) };
          active.timer.unref?.(); this.active = active;
          this.options.grant(request.profileId, request.requestId);
        } catch {
          this.requestKeys.delete(requestKey(request.profileId, request.requestId));
          this.options.deny(request.profileId, request.requestId, "CLIPBOARD_UNAVAILABLE");
        }
      }
    } finally { this.processing = false; }
  }

  private finishActive(): void {
    const active = this.active; if (!active) return;
    this.active = undefined; clearTimeout(active.timer); this.requestKeys.delete(requestKey(active.profileId, active.requestId));
    try { if (this.clipboard.ownsLease(active.value, active.requestId)) this.clipboard.clear(); } catch { /* Never risk clearing a clipboard whose ownership cannot be proven. */ }
    void this.process();
  }
}

function requestKey(profileId: string, requestId: string): string { return `${profileId}:${requestId}`; }
