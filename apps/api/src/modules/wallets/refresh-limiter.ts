// apps/api/src/modules/wallets/refresh-limiter.ts
//
// Lot SEC (G1): admission control for POST /v1/wallets/:id/refresh.
//
// A refresh spawns indexer child processes and makes outbound Horizon/RPC
// calls, so it is the most expensive request the API serves. Three rules,
// checked in order, all answered with 429 by the caller:
//   1. single-flight — one refresh per wallet at a time;
//   2. cooldown — a wallet may be refreshed at most once per COOLDOWN window
//      (the FIRST refresh of a wallet, e.g. right after it is added, is exempt
//      because nothing has been recorded for it yet);
//   3. capacity — at most MAX_CONCURRENT refreshes run process-wide.
//
// State is in-memory and per API process: the beta runs one pm2 process, and a
// restart simply re-opens the window (acceptable — this is a brake, not a
// ledger). `now` is injectable for tests.

export const REFRESH_COOLDOWN_MS = 60_000;
export const REFRESH_MAX_CONCURRENT = 2;

export type RefreshDenial = {
  ok: false;
  reason: 'in-flight' | 'cooldown' | 'capacity';
  retryAfterSeconds: number;
};

export type RefreshGrant = {
  ok: true;
  /** Must be called exactly once when the refresh finishes (success or failure). */
  release: () => void;
};

export class RefreshLimiter {
  private readonly inFlight = new Set<string>();
  private readonly lastStartedAt = new Map<string, number>();

  constructor(
    private readonly cooldownMs = REFRESH_COOLDOWN_MS,
    private readonly maxConcurrent = REFRESH_MAX_CONCURRENT,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get running(): number {
    return this.inFlight.size;
  }

  tryAcquire(walletId: string): RefreshGrant | RefreshDenial {
    const now = this.now();
    this.prune(now);

    if (this.inFlight.has(walletId)) {
      return { ok: false, reason: 'in-flight', retryAfterSeconds: this.secondsLeft(walletId, now) };
    }

    const last = this.lastStartedAt.get(walletId);
    if (last !== undefined && now - last < this.cooldownMs) {
      return { ok: false, reason: 'cooldown', retryAfterSeconds: this.secondsLeft(walletId, now) };
    }

    if (this.inFlight.size >= this.maxConcurrent) {
      return { ok: false, reason: 'capacity', retryAfterSeconds: 5 };
    }

    this.inFlight.add(walletId);
    this.lastStartedAt.set(walletId, now);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.inFlight.delete(walletId);
      },
    };
  }

  private secondsLeft(walletId: string, now: number): number {
    const last = this.lastStartedAt.get(walletId) ?? now;
    return Math.max(1, Math.ceil((last + this.cooldownMs - now) / 1000));
  }

  // Forget cooldown marks that have expired so the map stays bounded by the
  // number of wallets refreshed in the last window, not ever.
  private prune(now: number): void {
    for (const [walletId, startedAt] of this.lastStartedAt) {
      if (now - startedAt >= this.cooldownMs && !this.inFlight.has(walletId)) {
        this.lastStartedAt.delete(walletId);
      }
    }
  }
}
