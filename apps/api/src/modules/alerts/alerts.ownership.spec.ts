// apps/api/src/modules/alerts/alerts.ownership.spec.ts
//
// SECURITY-CRITICAL: a user must never read or mutate another user's alert rule.
// Two complementary proofs, both mock-based (no DB):
//   1. Repository: every scoped query carries `user_id` alongside `id`, and a
//      0-row result maps to null/false.
//   2. Service: when the repo reports "not owned" (null/false), the service
//      raises 404 (NotFoundException) for GET / PATCH / DELETE.

import { NotFoundException } from '@nestjs/common';
import { AlertsRepository } from './alerts.repository';
import { AlertsService } from './alerts.service';

// Valid v4-form UUIDs (the service's isUuid requires version nibble [1-5] +
// variant [89ab]; all-zero ids would be rejected by normalizeUserId).
const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';
const RULE_ID = '11111111-1111-4111-8111-111111111111';

describe('AlertsRepository — ownership scoping SQL', () => {
  it('getRule filters on id AND user_id and returns null on 0 rows', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]); // user B owns nothing
    const prisma = { $queryRawUnsafe: queryRawUnsafe } as never;
    const repo = new AlertsRepository(prisma);

    const result = await repo.getRule(USER_B, RULE_ID);

    expect(result).toBeNull();
    const [sql, ...args] = queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('id = $1::uuid');
    expect(sql).toContain('user_id = $2::uuid');
    expect(args).toEqual([RULE_ID, USER_B]);
  });

  it('updateRule WHERE carries id AND user_id and returns null on 0 rows', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const prisma = { $queryRawUnsafe: queryRawUnsafe } as never;
    const repo = new AlertsRepository(prisma);

    const result = await repo.updateRule(USER_B, RULE_ID, { enabled: false });

    expect(result).toBeNull();
    const [sql, ...args] = queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('update alert_rules');
    expect(sql).toMatch(/where\s+id = \$\d+::uuid\s+and user_id = \$\d+::uuid/);
    // id + userId are the last two bound params (after the SET values)
    expect(args[args.length - 2]).toBe(RULE_ID);
    expect(args[args.length - 1]).toBe(USER_B);
  });

  it('deleteRule filters on id AND user_id and returns false on 0 rows', async () => {
    const executeRawUnsafe = jest.fn().mockResolvedValue(0); // nothing owned by B
    const prisma = { $executeRawUnsafe: executeRawUnsafe } as never;
    const repo = new AlertsRepository(prisma);

    const result = await repo.deleteRule(USER_B, RULE_ID);

    expect(result).toBe(false);
    const [sql, ...args] = executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('delete from alert_rules');
    expect(sql).toContain('id = $1::uuid');
    expect(sql).toContain('user_id = $2::uuid');
    expect(args).toEqual([RULE_ID, USER_B]);
  });

  it('deleteRule returns true when exactly the owner row is removed', async () => {
    const executeRawUnsafe = jest.fn().mockResolvedValue(1);
    const prisma = { $executeRawUnsafe: executeRawUnsafe } as never;
    const repo = new AlertsRepository(prisma);

    expect(await repo.deleteRule(USER_A, RULE_ID)).toBe(true);
  });
});

describe('AlertsService — non-owner gets 404', () => {
  // A repo where every scoped lookup behaves as if user B owns nothing (the real
  // SQL would have matched 0 rows): getRule -> null, updateRule -> null,
  // deleteRule -> false.
  function repoForNonOwner() {
    return {
      getRule: jest.fn().mockResolvedValue(null),
      updateRule: jest.fn().mockResolvedValue(null),
      deleteRule: jest.fn().mockResolvedValue(false),
      walletBelongsToUser: jest.fn().mockResolvedValue(true),
    } as unknown as AlertsRepository;
  }

  it('GET another user\'s rule -> 404', async () => {
    const repo = repoForNonOwner();
    const service = new AlertsService(repo);
    await expect(service.getRule(USER_B, RULE_ID)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(repo.getRule).toHaveBeenCalledWith(USER_B, RULE_ID);
  });

  it('PATCH another user\'s rule -> 404', async () => {
    const repo = repoForNonOwner();
    const service = new AlertsService(repo);
    await expect(
      service.updateRule(USER_B, RULE_ID, { enabled: false })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.updateRule).toHaveBeenCalledWith(USER_B, RULE_ID, {
      enabled: false,
    });
  });

  it('DELETE another user\'s rule -> 404', async () => {
    const repo = repoForNonOwner();
    const service = new AlertsService(repo);
    await expect(service.deleteRule(USER_B, RULE_ID)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(repo.deleteRule).toHaveBeenCalledWith(USER_B, RULE_ID);
  });

  it('owner reads succeed (control)', async () => {
    const ownedRule = { id: RULE_ID, userId: USER_A } as never;
    const repo = {
      getRule: jest.fn().mockResolvedValue(ownedRule),
    } as unknown as AlertsRepository;
    const service = new AlertsService(repo);
    await expect(service.getRule(USER_A, RULE_ID)).resolves.toBe(ownedRule);
  });
});
