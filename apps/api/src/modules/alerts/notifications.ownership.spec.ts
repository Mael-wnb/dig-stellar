// apps/api/src/modules/alerts/notifications.ownership.spec.ts
//
// SECURITY-CRITICAL: a user must never read or mark-read another user's
// notification. Mock-based (no DB), two proofs:
//   1. Repository: list/countUnread/markRead SQL all carry `user_id`.
//   2. Service: user B marking user A's notification → 404; and the "already read"
//      200 no-op is correctly distinguished from "not owned" (still 404 for B).

import { NotFoundException } from '@nestjs/common';
import { AlertsRepository } from './alerts.repository';
import { AlertsService } from './alerts.service';

const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';
const NOTIF_ID = '22222222-2222-4222-8222-222222222222';

describe('AlertsRepository — notifications ownership scoping SQL', () => {
  it('listNotifications filters on user_id and clamps the limit', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const prisma = { $queryRawUnsafe: queryRawUnsafe } as never;
    const repo = new AlertsRepository(prisma);

    await repo.listNotifications(USER_B, { limit: 9999 });

    const [sql, ...args] = queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('from notifications');
    expect(sql).toContain('user_id = $1::uuid');
    expect(args[0]).toBe(USER_B);
    expect(args[2]).toBe(200); // MAX cap applied
  });

  it('countUnread filters on user_id AND read_at is null', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([{ count: 0 }]);
    const prisma = { $queryRawUnsafe: queryRawUnsafe } as never;
    const repo = new AlertsRepository(prisma);

    await repo.countUnread(USER_B);

    const [sql, ...args] = queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('user_id = $1::uuid');
    expect(sql).toContain('read_at is null');
    expect(args).toEqual([USER_B]);
  });

  it('markRead scopes by id AND user_id AND read_at is null; false on 0 rows', async () => {
    const executeRawUnsafe = jest.fn().mockResolvedValue(0);
    const prisma = { $executeRawUnsafe: executeRawUnsafe } as never;
    const repo = new AlertsRepository(prisma);

    const result = await repo.markRead(USER_B, NOTIF_ID);

    expect(result).toBe(false);
    const [sql, ...args] = executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('update notifications');
    expect(sql).toContain('id = $1::uuid');
    expect(sql).toContain('user_id = $2::uuid');
    expect(sql).toContain('read_at is null');
    expect(args).toEqual([NOTIF_ID, USER_B]);
  });

  it('markRead returns true when exactly the owner unread row flips', async () => {
    const executeRawUnsafe = jest.fn().mockResolvedValue(1);
    const prisma = { $executeRawUnsafe: executeRawUnsafe } as never;
    const repo = new AlertsRepository(prisma);
    expect(await repo.markRead(USER_A, NOTIF_ID)).toBe(true);
  });
});

describe('AlertsService — mark-read ownership / idempotency', () => {
  it("user B marking user A's notification -> 404 (never leaks as already-read)", async () => {
    const repo = {
      markRead: jest.fn().mockResolvedValue(false), // 0 rows (not owned)
      notificationExists: jest.fn().mockResolvedValue(false), // scoped: B owns none
    } as unknown as AlertsRepository;
    const service = new AlertsService(repo);

    await expect(service.markRead(USER_B, NOTIF_ID)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(repo.markRead).toHaveBeenCalledWith(USER_B, NOTIF_ID);
    expect(repo.notificationExists).toHaveBeenCalledWith(USER_B, NOTIF_ID);
  });

  it('owner marking an already-read notification -> 200 no-op (not 404)', async () => {
    const repo = {
      markRead: jest.fn().mockResolvedValue(false), // already read, 0 rows flipped
      notificationExists: jest.fn().mockResolvedValue(true), // exists + owned
    } as unknown as AlertsRepository;
    const service = new AlertsService(repo);

    await expect(service.markRead(USER_A, NOTIF_ID)).resolves.toEqual({
      read: true,
      id: NOTIF_ID,
      alreadyRead: true,
    });
  });

  it('owner marking an unread notification -> flips it', async () => {
    const repo = {
      markRead: jest.fn().mockResolvedValue(true),
      notificationExists: jest.fn(),
    } as unknown as AlertsRepository;
    const service = new AlertsService(repo);

    await expect(service.markRead(USER_A, NOTIF_ID)).resolves.toEqual({
      read: true,
      id: NOTIF_ID,
      alreadyRead: false,
    });
    // No existence check needed when the flip succeeded.
    expect(repo.notificationExists).not.toHaveBeenCalled();
  });
});
