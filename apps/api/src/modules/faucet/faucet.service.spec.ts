// R2 review fix (2026-08-17): a DB outage during the claim insert must never
// masquerade as 'already-claimed' — only a real Postgres 23505 may.
import { isUniqueViolation } from './faucet.service';

describe('isUniqueViolation', () => {
  it('recognizes the PG code in Prisma meta', () => {
    expect(isUniqueViolation({ meta: { code: '23505' } })).toBe(true);
  });

  it('recognizes the code / duplicate-key text in messages (driver drift)', () => {
    expect(isUniqueViolation(new Error('ERROR: code 23505 something'))).toBe(true);
    expect(
      isUniqueViolation({
        meta: {
          message:
            'duplicate key value violates unique constraint "uq_faucet_claims_wallet"',
        },
      }),
    ).toBe(true);
  });

  it('rejects everything else — outages, timeouts, null', () => {
    expect(isUniqueViolation(new Error('connection refused'))).toBe(false);
    expect(isUniqueViolation({ meta: { code: '40001' } })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
