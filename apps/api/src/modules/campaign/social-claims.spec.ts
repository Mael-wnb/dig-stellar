// Lot EP (EP2): one test per branch of the pure social-claim rules.
import { SOCIAL_DAILY_CAP, SOCIAL_TASKS, LEDGER_REASON_RE, type CampaignWindow } from './campaign-rules';
import {
  HANDLE_RE,
  SOCIAL_CLAIM_HANDLE_KEY,
  SOCIAL_CLAIM_TASK_KEY,
  SOCIAL_DELETE_REASON,
  normaliseHandle,
  socialClaimEligibility,
  socialUniqueViolationReason,
  type SocialClaimFacts,
} from './social-claims';

const live: CampaignWindow = { enabled: true, startsAtMs: 1_000, endsAtMs: null, nowMs: 2_000 };

const facts = (overrides: Partial<SocialClaimFacts> = {}): SocialClaimFacts => ({
  window: live,
  proven: true,
  enrolled: true,
  task: 'x-follow',
  taskAvailable: true,
  handle: 'alice',
  existingClaims: [],
  handleUsedByOtherWallet: false,
  awardedTodayPoints: 0,
  ...overrides,
});

describe('normaliseHandle / HANDLE_RE', () => {
  it('trims, strips one leading @ and lowercases', () => {
    expect(normaliseHandle('  @Alice_01 ')).toBe('alice_01');
    expect(normaliseHandle('@@double')).toBe('@double'); // only one @ is stripped → invalid downstream
    expect(normaliseHandle('Bob.Smith')).toBe('bob.smith');
  });

  it('accepts 1-32 of [a-z0-9_.] and refuses the rest', () => {
    for (const ok of ['a', 'alice_01', 'bob.smith', 'x'.repeat(32)]) expect(HANDLE_RE.test(ok)).toBe(true);
    for (const bad of ['', '@alice', 'Alice', 'al ice', 'x'.repeat(33), 'a-b', 'héllo']) expect(HANDLE_RE.test(bad)).toBe(false);
  });
});

describe('socialClaimEligibility — check order', () => {
  it('inactive campaign wins over everything', () => {
    expect(socialClaimEligibility(facts({ window: { ...live, enabled: false }, proven: false }))).toEqual({
      ok: false,
      reason: 'campaign-disabled',
    });
    expect(socialClaimEligibility(facts({ window: { ...live, nowMs: 500 } }))).toEqual({ ok: false, reason: 'campaign-not-started' });
    expect(socialClaimEligibility(facts({ window: { ...live, endsAtMs: 1_500 } }))).toEqual({ ok: false, reason: 'campaign-ended' });
  });

  it('proof, then enrolment', () => {
    expect(socialClaimEligibility(facts({ proven: false, enrolled: false }))).toEqual({ ok: false, reason: 'ownership-proof-required' });
    expect(socialClaimEligibility(facts({ enrolled: false }))).toEqual({ ok: false, reason: 'not-enrolled' });
  });

  it('unknown task, then an unavailable task (x-repost without its URL), before any claim check', () => {
    expect(socialClaimEligibility(facts({ task: 'tiktok-dance', taskAvailable: false }))).toEqual({ ok: false, reason: 'unknown-task' });
    expect(socialClaimEligibility(facts({ task: 'x-repost', taskAvailable: false, handleUsedByOtherWallet: true }))).toEqual({
      ok: false,
      reason: 'task-unavailable',
    });
    expect(socialClaimEligibility(facts({ task: 'x-repost', taskAvailable: true }))).toMatchObject({ ok: true, points: SOCIAL_TASKS['x-repost'] });
  });

  it('already-claimed beats handle-mismatch for the same task', () => {
    const existing = [{ task_key: 'x-follow', handle_normalized: 'someoneelse' }];
    expect(socialClaimEligibility(facts({ existingClaims: existing }))).toEqual({ ok: false, reason: 'already-claimed' });
  });

  it('one handle per wallet: a different handle on another task is handle-mismatch', () => {
    const existing = [{ task_key: 'x-follow', handle_normalized: 'alice' }];
    expect(socialClaimEligibility(facts({ task: 'x-repost', handle: 'bob', existingClaims: existing }))).toEqual({
      ok: false,
      reason: 'handle-mismatch',
    });
    expect(socialClaimEligibility(facts({ task: 'x-repost', handle: 'alice', existingClaims: existing }))).toMatchObject({ ok: true });
  });

  it('a handle claimed by another wallet is refused', () => {
    expect(socialClaimEligibility(facts({ handleUsedByOtherWallet: true }))).toEqual({ ok: false, reason: 'handle-already-used' });
  });

  it('the daily cap comes from socialAward', () => {
    expect(socialClaimEligibility(facts({ awardedTodayPoints: SOCIAL_DAILY_CAP - SOCIAL_TASKS['x-follow'] + 1 }))).toEqual({
      ok: false,
      reason: 'social-daily-cap-reached',
    });
    expect(socialClaimEligibility(facts({ awardedTodayPoints: SOCIAL_DAILY_CAP - SOCIAL_TASKS['x-follow'] }))).toMatchObject({ ok: true });
  });

  it('the award carries the task reason, base points, multiplier 1 and points = base', () => {
    for (const key of Object.keys(SOCIAL_TASKS) as Array<keyof typeof SOCIAL_TASKS>) {
      const d = socialClaimEligibility(facts({ task: key }));
      expect(d).toEqual({ ok: true, reason: `social:${key}`, basePoints: SOCIAL_TASKS[key], multiplier: 1, points: SOCIAL_TASKS[key] });
      expect(LEDGER_REASON_RE.test(`social:${key}`)).toBe(true);
    }
  });

  it('the three tasks together fit exactly in the daily cap', () => {
    expect(Object.values(SOCIAL_TASKS).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(SOCIAL_DAILY_CAP);
  });
});

describe('delete reason + unique-key mapping', () => {
  it('adjust:social-delete is a legal ledger reason', () => {
    expect(LEDGER_REASON_RE.test(SOCIAL_DELETE_REASON)).toBe(true);
    expect(SOCIAL_DELETE_REASON.startsWith('adjust:')).toBe(true);
  });

  it('maps the two social unique keys and nothing else', () => {
    expect(socialUniqueViolationReason(SOCIAL_CLAIM_TASK_KEY)).toBe('already-claimed');
    expect(socialUniqueViolationReason(SOCIAL_CLAIM_HANDLE_KEY)).toBe('handle-already-used');
    expect(socialUniqueViolationReason('campaign, lower(address)')).toBeNull();
    expect(socialUniqueViolationReason(null)).toBeNull();
  });
});
