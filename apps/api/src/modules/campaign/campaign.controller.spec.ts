// Lot EP (EP1, gate 2): controller validation is thin and syntactic — 400 for
// malformed input, pass-through (trimmed) otherwise. Stub service records calls.
import { BadRequestException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { CampaignController } from './campaign.controller';
import type { CampaignService } from './campaign.service';

const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWXYZ';
const USER = '00000000-0000-4000-8000-0000000000aa';
const NONCE = '0123456789abcdef0123456789abcdef';

function stub() {
  return {
    issueChallenge: jest.fn().mockResolvedValue('challenge'),
    verifyChallenge: jest.fn().mockResolvedValue('verify'),
    getCampaign: jest.fn().mockReturnValue('campaign'),
    enroll: jest.fn().mockResolvedValue('enroll'),
    checkin: jest.fn().mockResolvedValue('checkin'),
    me: jest.fn().mockResolvedValue('me'),
    leaderboard: jest.fn().mockResolvedValue('leaderboard'),
  };
}

describe('AuthController', () => {
  it('challenge: trims the address, rejects anything that is not a G… key', async () => {
    const s = stub();
    const c = new AuthController(s as unknown as CampaignService);
    await c.challenge({ address: `  ${ADDRESS} ` });
    expect(s.issueChallenge).toHaveBeenCalledWith(ADDRESS);
    for (const bad of [undefined, '', 'not-a-key', ADDRESS.toLowerCase(), ADDRESS.slice(0, 55), `S${ADDRESS.slice(1)}`]) {
      expect(() => c.challenge({ address: bad as string })).toThrow(BadRequestException);
    }
    expect(() => c.challenge(undefined)).toThrow(BadRequestException);
  });

  it('verify: validates nonce / signedMessage / userId / provider and normalises optionals', async () => {
    const s = stub();
    const c = new AuthController(s as unknown as CampaignService);
    await c.verify({ address: ADDRESS, nonce: NONCE, signedMessage: 'AAAA', provider: 'freighter', userId: USER });
    expect(s.verifyChallenge).toHaveBeenCalledWith({ address: ADDRESS, nonce: NONCE, signedMessage: 'AAAA', provider: 'freighter', userId: USER });
    await c.verify({ address: ADDRESS, nonce: NONCE, signedMessage: 'AAAA' });
    expect(s.verifyChallenge).toHaveBeenLastCalledWith({ address: ADDRESS, nonce: NONCE, signedMessage: 'AAAA', provider: null, userId: null });

    const base = { address: ADDRESS, nonce: NONCE, signedMessage: 'AAAA' };
    expect(() => c.verify({ ...base, nonce: NONCE.toUpperCase() })).toThrow(BadRequestException);
    expect(() => c.verify({ ...base, nonce: NONCE.slice(1) })).toThrow(BadRequestException);
    expect(() => c.verify({ ...base, signedMessage: '' })).toThrow(BadRequestException);
    expect(() => c.verify({ ...base, signedMessage: 'x'.repeat(513) })).toThrow(BadRequestException);
    expect(() => c.verify({ ...base, userId: 'not-a-uuid' })).toThrow(BadRequestException);
    expect(() => c.verify({ ...base, provider: 'p'.repeat(65) })).toThrow(BadRequestException);
  });
});

describe('CampaignController', () => {
  it('enroll: requires address + userId, upper-cases and validates the referral code', async () => {
    const s = stub();
    const c = new CampaignController(s as unknown as CampaignService);
    await c.enroll({ address: ADDRESS, userId: USER, referralCode: ' abcdefgh ' });
    expect(s.enroll).toHaveBeenCalledWith({ address: ADDRESS, userId: USER, referralCode: 'ABCDEFGH' });
    await c.enroll({ address: ADDRESS, userId: USER });
    expect(s.enroll).toHaveBeenLastCalledWith({ address: ADDRESS, userId: USER, referralCode: null });
    expect(() => c.enroll({ address: ADDRESS })).toThrow(BadRequestException);
    expect(() => c.enroll({ address: ADDRESS, userId: USER, referralCode: 'ABC' })).toThrow(BadRequestException);
    expect(() => c.enroll({ address: ADDRESS, userId: USER, referralCode: 'ABCDEFG0' })).toThrow(BadRequestException); // 0 not in alphabet
  });

  it('checkin / me: address + userId required', async () => {
    const s = stub();
    const c = new CampaignController(s as unknown as CampaignService);
    await c.checkin({ address: ADDRESS, userId: USER });
    expect(s.checkin).toHaveBeenCalledWith({ address: ADDRESS, userId: USER });
    expect(() => c.checkin({ userId: USER })).toThrow(BadRequestException);
    await c.me(ADDRESS, USER);
    expect(s.me).toHaveBeenCalledWith({ address: ADDRESS, userId: USER });
    expect(() => c.me(ADDRESS, undefined)).toThrow(BadRequestException);
    expect(() => c.me(undefined, USER)).toThrow(BadRequestException);
  });

  it('leaderboard: address optional, validated when present', async () => {
    const s = stub();
    const c = new CampaignController(s as unknown as CampaignService);
    await c.leaderboard(undefined);
    expect(s.leaderboard).toHaveBeenCalledWith(null);
    await c.leaderboard(ADDRESS);
    expect(s.leaderboard).toHaveBeenLastCalledWith(ADDRESS);
    expect(() => c.leaderboard('nope')).toThrow(BadRequestException);
  });

  it('getCampaign passes through', () => {
    const s = stub();
    expect(new CampaignController(s as unknown as CampaignService).getCampaign()).toBe('campaign');
  });
});
