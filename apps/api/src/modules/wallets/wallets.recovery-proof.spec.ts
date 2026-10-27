// apps/api/src/modules/wallets/wallets.recovery-proof.spec.ts
//
// Lot EP (Gate 2B, 2026-10-16): the no-session wallet-connect recovery path
// requires a FRESH, UNBOUND wallet-ownership proof (recon §1.5: a signer
// address is public, so address-only recovery handed the account's userId to
// anyone). Mock-based like wallets.connect.spec.ts: a fake prisma routes raw
// SQL by shape; a small in-memory fake of CampaignRepository.consumeUnboundProof
// applies the real filter semantics (unconsumed, verified within maxAge) so the
// expiry and single-use rules are exercised, not stubbed.
//
//   1. stranger with address only  → 200 { connected:false, reason } and NO userId
//   2. owner with a fresh unbound proof → recovered; the proof is consumed and
//      bound (second attempt refused)
//   3. same-userId reconnect → unchanged (the proof repository is never asked)
//   4. expired proof → refused

import { WalletsService } from './wallets.service';
import { RECOVERY_PROOF_MAX_AGE_SECONDS } from '../campaign/campaign-config';

const SIGNER_OWNER = '00000000-0000-4000-8000-0000000000cc';
const WALLET_ID = '11111111-1111-4111-8111-111111111111';
const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWLT';

type Call = { sql: string; args: unknown[] };

function walletRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: WALLET_ID,
    user_id: SIGNER_OWNER,
    chain: 'stellar',
    address: ADDRESS,
    label: null,
    is_primary: false,
    is_active: true,
    is_active_signer: true,
    metadata: {},
    created_at: '2026-08-14T00:00:00Z',
    updated_at: '2026-08-14T00:00:00Z',
    ...overrides,
  };
}

function kindOf(sql: string): string {
  if (sql.includes('insert into user_wallets')) return 'insert';
  if (sql.includes('select count(*) as count')) return 'count';
  if (sql.includes('is_active_signer = false')) return 'demote';
  if (sql.includes('update user_wallets') && sql.includes('is_active_signer = true')) return 'promote';
  if (sql.includes('and is_active_signer = true')) return 'recovery-lookup';
  if (sql.includes('where user_id') && sql.includes('lower(address)')) return 'scoped-lookup';
  return 'other';
}

/** In-memory stand-in for wallet_ownership_proofs with the consume filter semantics. */
function fakeProofStore(now: () => number) {
  const proofs: Array<{ id: string; address: string; user_id: string | null; verified_at: Date; consumed_at: Date | null }> = [];
  const calls: Array<{ address: string; userId: string; maxAgeSeconds: number }> = [];
  return {
    proofs,
    calls,
    addUnbound(address: string, verifiedAtMs: number) {
      proofs.push({ id: `p${proofs.length + 1}`, address, user_id: null, verified_at: new Date(verifiedAtMs), consumed_at: null });
    },
    repo: {
      consumeUnboundProof: jest.fn(async (address: string, userId: string, maxAgeSeconds: number) => {
        calls.push({ address, userId, maxAgeSeconds });
        const cutoff = now() - maxAgeSeconds * 1000;
        const candidate = proofs
          .filter((p) => p.address.toLowerCase() === address.toLowerCase() && p.user_id == null && p.consumed_at == null && p.verified_at.getTime() >= cutoff)
          .sort((a, b) => b.verified_at.getTime() - a.verified_at.getTime())[0];
        if (!candidate) return null;
        candidate.consumed_at = new Date(now());
        candidate.user_id = userId;
        return { ...candidate, provider: null, nonce: 'n'.repeat(32), signature_variant: 'raw' as const };
      }),
    },
  };
}

function makeService(store: ReturnType<typeof fakeProofStore>, signerExists = true) {
  const calls: Call[] = [];
  const handler = async (sql: string, ...args: unknown[]) => {
    calls.push({ sql, args });
    switch (kindOf(sql)) {
      case 'recovery-lookup':
        return signerExists ? [walletRow()] : [];
      case 'scoped-lookup':
        return [walletRow()];
      case 'insert':
        return [walletRow({ user_id: args[0] as string })];
      case 'count':
        return [{ count: 1 }];
      case 'demote':
        return 0;
      case 'promote':
        return [walletRow({ id: args[0] as string, user_id: args[1] as string })];
      default:
        return [];
    }
  };
  const prisma = { $queryRawUnsafe: jest.fn(handler), $executeRawUnsafe: jest.fn(handler) } as never;
  const service = new WalletsService(prisma, store.repo as never);
  jest.spyOn(service, 'getWalletsOverview').mockImplementation(async (userId?: string) => ({ userId }) as never);
  return { service, calls };
}

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);

describe('connectWallet — no session, recovery requires an unbound ownership proof (Gate 2B)', () => {
  it('1. a stranger presenting the signer address alone is refused: structured reason, NO userId, nothing promoted', async () => {
    const store = fakeProofStore(() => NOW);
    const { service, calls } = makeService(store);

    const result = await service.connectWallet({ chain: 'stellar', address: ADDRESS });

    expect(result).toEqual({
      connected: false,
      reason: 'ownership-proof-required',
      createdUser: false,
      createdWallet: false,
      wallet: null,
      userId: null,
    });
    expect(JSON.stringify(result)).not.toContain(SIGNER_OWNER);
    expect(calls.some((c) => kindOf(c.sql) === 'promote')).toBe(false);
    expect(calls.some((c) => kindOf(c.sql) === 'insert')).toBe(false);
    expect(store.calls).toEqual([{ address: ADDRESS, userId: SIGNER_OWNER, maxAgeSeconds: RECOVERY_PROOF_MAX_AGE_SECONDS }]);
  });

  it('2. the owner with a fresh unbound proof is recovered; the proof is consumed + bound, so a second attempt is refused', async () => {
    const store = fakeProofStore(() => NOW);
    store.addUnbound(ADDRESS, NOW - 30_000); // proven 30 s ago, no session
    const { service, calls } = makeService(store);

    const first = await service.connectWallet({ chain: 'stellar', address: ADDRESS });
    expect(first).toMatchObject({ connected: true, createdUser: false, createdWallet: false });
    expect(first.wallet!.userId).toBe(SIGNER_OWNER);
    expect((first as { userId?: string }).userId).toBe(SIGNER_OWNER);
    const promote = calls.find((c) => kindOf(c.sql) === 'promote');
    expect(promote).toBeDefined();
    expect(promote!.args[1]).toBe(SIGNER_OWNER);

    // consumed and bound to the recovered user, atomically in the repository
    expect(store.proofs[0]).toMatchObject({ user_id: SIGNER_OWNER });
    expect(store.proofs[0].consumed_at).not.toBeNull();

    const second = await service.connectWallet({ chain: 'stellar', address: ADDRESS });
    expect(second).toMatchObject({ connected: false, reason: 'ownership-proof-required', userId: null });
    expect(store.repo.consumeUnboundProof).toHaveBeenCalledTimes(2);
  });

  it('3. a same-userId reconnect is unchanged: attaches in the session account and never consults the proof store', async () => {
    const store = fakeProofStore(() => NOW);
    const { service, calls } = makeService(store);

    const result = await service.connectWallet({ userId: SIGNER_OWNER, chain: 'stellar', address: ADDRESS });

    expect(result).toMatchObject({ connected: true, createdUser: false, createdWallet: false });
    expect(result.wallet!.userId).toBe(SIGNER_OWNER);
    expect(store.repo.consumeUnboundProof).not.toHaveBeenCalled();
    expect(calls.some((c) => kindOf(c.sql) === 'recovery-lookup')).toBe(false);
  });

  it('4. an expired proof (older than RECOVERY_PROOF_MAX_AGE_SECONDS) is refused and left untouched', async () => {
    const store = fakeProofStore(() => NOW);
    store.addUnbound(ADDRESS, NOW - (RECOVERY_PROOF_MAX_AGE_SECONDS + 1) * 1000);
    const { service } = makeService(store);

    const result = await service.connectWallet({ chain: 'stellar', address: ADDRESS });

    expect(result).toMatchObject({ connected: false, reason: 'ownership-proof-required', userId: null });
    expect(store.proofs[0].consumed_at).toBeNull();
    expect(store.proofs[0].user_id).toBeNull();

    // the boundary itself is accepted (verified_at >= now - maxAge)
    store.addUnbound(ADDRESS, NOW - RECOVERY_PROOF_MAX_AGE_SECONDS * 1000);
    const boundary = await service.connectWallet({ chain: 'stellar', address: ADDRESS });
    expect(boundary).toMatchObject({ connected: true });
  });

  it('5. a brand-new address (no signer account anywhere) still forks a fresh account without any proof', async () => {
    const store = fakeProofStore(() => NOW);
    const { service, calls } = makeService(store, false);

    const result = await service.connectWallet({ chain: 'stellar', address: ADDRESS });

    expect(result).toMatchObject({ connected: true, createdUser: true, createdWallet: true });
    expect(store.repo.consumeUnboundProof).not.toHaveBeenCalled();
    expect(calls.some((c) => kindOf(c.sql) === 'insert')).toBe(true);
  });
});
