// Lot EP (EP1, gate 2): controller validation is thin and syntactic — 400 for
// malformed input, pass-through (trimmed) otherwise. Stub service records calls.
import { BadRequestException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { CampaignController } from './campaign.controller';
import type { CampaignService } from './campaign.service';
import type { CampaignSocialService } from './campaign-social.service';

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
    activity: jest.fn().mockResolvedValue('activity'),
    leaderboard: jest.fn().mockResolvedValue('leaderboard'),
    metrics: jest.fn().mockResolvedValue('metrics'),
  };
}

function socialStub() {
  return {
    claim: jest.fn().mockResolvedValue('claim'),
    remove: jest.fn().mockResolvedValue('remove'),
  };
}

function campaignController(s = stub(), social = socialStub()) {
  return new CampaignController(s as unknown as CampaignService, social as unknown as CampaignSocialService);
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
    const c = campaignController(s);
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
    const c = campaignController(s);
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
    const c = campaignController(s);
    await c.leaderboard(undefined);
    expect(s.leaderboard).toHaveBeenCalledWith(null);
    await c.leaderboard(ADDRESS);
    expect(s.leaderboard).toHaveBeenLastCalledWith(ADDRESS);
    expect(() => c.leaderboard('nope')).toThrow(BadRequestException);
  });

  it('getCampaign passes through', () => {
    const s = stub();
    expect(campaignController(s).getCampaign()).toBe('campaign');
  });

  // --- EP2: social tasks ---

  it('social claim: normalises the handle (trim, @, lowercase), validates task/handle syntactically, never echoes the raw value', async () => {
    const social = socialStub();
    const c = campaignController(stub(), social);
    await c.claimSocial({ address: ADDRESS, userId: USER, task: ' x-follow ', handle: ' @Alice_01 ' });
    expect(social.claim).toHaveBeenCalledWith({ address: ADDRESS, userId: USER, task: 'x-follow', handle: 'alice_01' });
    // the task's EXISTENCE is the service's decision ('unknown-task'), not a 400
    await c.claimSocial({ address: ADDRESS, userId: USER, task: 'anything', handle: 'bob' });
    expect(social.claim).toHaveBeenLastCalledWith({ address: ADDRESS, userId: USER, task: 'anything', handle: 'bob' });

    const base = { address: ADDRESS, userId: USER, task: 'x-follow' };
    for (const bad of [undefined, '', '@', '@@alice', 'al ice', 'a-b', 'x'.repeat(33)]) {
      expect(() => c.claimSocial({ ...base, handle: bad as string })).toThrow(BadRequestException);
    }
    expect(() => c.claimSocial({ ...base, task: '', handle: 'alice' })).toThrow(BadRequestException);
    expect(() => c.claimSocial({ ...base, task: 't'.repeat(33), handle: 'alice' })).toThrow(BadRequestException);
    expect(() => c.claimSocial({ address: ADDRESS, task: 'x-follow', handle: 'alice' })).toThrow(BadRequestException);
    expect(() => c.claimSocial(undefined)).toThrow(BadRequestException);
  });

  it('social delete: UUID id in the path, address + userId in the body', async () => {
    const social = socialStub();
    const c = campaignController(stub(), social);
    const id = '33333333-3333-4333-8333-333333333333';
    await c.deleteSocial(id, { address: ADDRESS, userId: USER });
    expect(social.remove).toHaveBeenCalledWith({ address: ADDRESS, userId: USER, id });
    expect(() => c.deleteSocial('not-a-uuid', { address: ADDRESS, userId: USER })).toThrow(BadRequestException);
    expect(() => c.deleteSocial(undefined, { address: ADDRESS, userId: USER })).toThrow(BadRequestException);
    expect(() => c.deleteSocial(id, { address: ADDRESS })).toThrow(BadRequestException);
    expect(() => c.deleteSocial(id, undefined)).toThrow(BadRequestException);
  });
});

describe('CampaignController (EP3)', () => {
  it('metrics: no input, pass-through to the service', async () => {
    const s = stub();
    const c = campaignController(s);
    expect(await c.metrics()).toBe('metrics');
    expect(s.metrics).toHaveBeenCalledWith();
  });
});

describe('CampaignController (EP4)', () => {
  it('me/activity: address + userId required and validated like /me, pass-through otherwise', async () => {
    const s = stub();
    const c = campaignController(s);
    expect(await c.activity(` ${ADDRESS} `, USER)).toBe('activity');
    expect(s.activity).toHaveBeenCalledWith({ address: ADDRESS, userId: USER });
    expect(() => c.activity(undefined, USER)).toThrow(BadRequestException);
    expect(() => c.activity(ADDRESS, undefined)).toThrow(BadRequestException);
    expect(() => c.activity('not-an-address', USER)).toThrow(BadRequestException);
    expect(() => c.activity(ADDRESS, 'not-a-uuid')).toThrow(BadRequestException);
  });
});
