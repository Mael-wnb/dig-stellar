// apps/api/src/modules/wallets/refresh-limiter.spec.ts — Lot SEC (G1)
import { RefreshLimiter } from './refresh-limiter';

const A = 'wallet-a';
const B = 'wallet-b';
const C = 'wallet-c';

function make(cooldownMs = 60_000, maxConcurrent = 2) {
  let t = 1_000_000;
  const limiter = new RefreshLimiter(cooldownMs, maxConcurrent, () => t);
  return { limiter, advance: (ms: number) => (t += ms) };
}

describe('RefreshLimiter', () => {
  it('grants the first refresh of a wallet (no cooldown mark yet)', () => {
    const { limiter } = make();
    const grant = limiter.tryAcquire(A);
    expect(grant.ok).toBe(true);
    expect(limiter.running).toBe(1);
  });

  it('denies a second refresh of the same wallet while the first runs (single-flight)', () => {
    const { limiter } = make();
    limiter.tryAcquire(A);
    const second = limiter.tryAcquire(A);
    expect(second).toMatchObject({ ok: false, reason: 'in-flight' });
  });

  it('denies a refresh within the cooldown after the first one finished', () => {
    const { limiter, advance } = make();
    const first = limiter.tryAcquire(A);
    if (!first.ok) throw new Error('expected grant');
    first.release();
    advance(30_000);
    const second = limiter.tryAcquire(A);
    expect(second).toMatchObject({ ok: false, reason: 'cooldown', retryAfterSeconds: 30 });
  });

  it('grants again once the cooldown has elapsed', () => {
    const { limiter, advance } = make();
    const first = limiter.tryAcquire(A);
    if (!first.ok) throw new Error('expected grant');
    first.release();
    advance(60_000);
    expect(limiter.tryAcquire(A).ok).toBe(true);
  });

  it('caps concurrent refreshes process-wide', () => {
    const { limiter } = make();
    expect(limiter.tryAcquire(A).ok).toBe(true);
    expect(limiter.tryAcquire(B).ok).toBe(true);
    expect(limiter.tryAcquire(C)).toMatchObject({ ok: false, reason: 'capacity' });
    expect(limiter.running).toBe(2);
  });

  it('frees capacity on release and release is idempotent', () => {
    const { limiter } = make();
    const a = limiter.tryAcquire(A);
    limiter.tryAcquire(B);
    if (!a.ok) throw new Error('expected grant');
    a.release();
    a.release();
    expect(limiter.running).toBe(1);
    expect(limiter.tryAcquire(C).ok).toBe(true);
  });

  it('checks single-flight and cooldown before capacity', () => {
    const { limiter } = make(60_000, 1);
    const a = limiter.tryAcquire(A);
    if (!a.ok) throw new Error('expected grant');
    expect(limiter.tryAcquire(A)).toMatchObject({ reason: 'in-flight' });
    a.release();
    expect(limiter.tryAcquire(A)).toMatchObject({ reason: 'cooldown' });
    expect(limiter.tryAcquire(B).ok).toBe(true);
  });
});
