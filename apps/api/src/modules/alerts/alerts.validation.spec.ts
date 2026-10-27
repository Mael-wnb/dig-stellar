// apps/api/src/modules/alerts/alerts.validation.spec.ts — Lot SEC (G1)
//
// A PRESENT userId that is not a string (repeated query key → array) is a 400
// before any repository call; an ABSENT one still resolves to the demo account.
import { BadRequestException } from '@nestjs/common';
import { AlertsService } from './alerts.service';

const USER = '00000000-0000-4000-8000-0000000000aa';

function makeService() {
  const repo = {
    listRules: jest.fn(async () => []),
  };
  return { service: new AlertsService(repo as never), repo };
}

describe('AlertsService.normalizeUserId type guard', () => {
  it('array userId → 400, repository untouched', async () => {
    const { service, repo } = makeService();
    await expect(service.listRules([USER, USER] as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.listRules).not.toHaveBeenCalled();
  });

  it('absent userId → demo account (W1 debt, unchanged)', async () => {
    const { service, repo } = makeService();
    await service.listRules(undefined);
    expect(repo.listRules).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001');
  });

  it('valid userId passes through', async () => {
    const { service, repo } = makeService();
    await service.listRules(USER);
    expect(repo.listRules).toHaveBeenCalledWith(USER);
  });
});
