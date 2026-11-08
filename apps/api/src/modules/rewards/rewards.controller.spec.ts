// Lot EP (EP5): controller validation is thin and syntactic — 400 for
// malformed input, pass-through (trimmed) otherwise. Stub service records calls.
import { BadRequestException } from '@nestjs/common';
import { RewardsController } from './rewards.controller';
import type { RewardsService } from './rewards.service';

const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWXYZ';
const USER = '00000000-0000-4000-8000-0000000000aa';

function stub() {
  return { me: jest.fn().mockResolvedValue('me'), claim: jest.fn().mockResolvedValue('claim') };
}
const controller = (s = stub()) => new RewardsController(s as unknown as RewardsService);

describe('RewardsController', () => {
  it('GET me: address + userId required (same access rule as /campaign/me), trimmed, 400 otherwise', async () => {
    const s = stub();
    const c = controller(s);
    expect(await c.me(` ${ADDRESS} `, USER)).toBe('me');
    expect(s.me).toHaveBeenCalledWith({ address: ADDRESS, userId: USER });
    expect(() => c.me(ADDRESS, undefined)).toThrow(BadRequestException);
    expect(() => c.me(undefined, USER)).toThrow(BadRequestException);
    expect(() => c.me(ADDRESS.toLowerCase(), USER)).toThrow(BadRequestException);
    expect(() => c.me(ADDRESS, 'nope')).toThrow(BadRequestException);
  });

  it('POST claim: same validation; the body is never passed through as-is', async () => {
    const s = stub();
    const c = controller(s);
    expect(await c.claim({ address: ADDRESS, userId: USER })).toBe('claim');
    expect(s.claim).toHaveBeenCalledWith({ address: ADDRESS, userId: USER });
    expect(() => c.claim({ address: ADDRESS })).toThrow(BadRequestException);
    expect(() => c.claim({ userId: USER })).toThrow(BadRequestException);
    expect(() => c.claim({ address: `S${ADDRESS.slice(1)}`, userId: USER })).toThrow(BadRequestException);
    expect(() => c.claim(undefined)).toThrow(BadRequestException);
    expect(s.claim).toHaveBeenCalledTimes(1);
  });
});
