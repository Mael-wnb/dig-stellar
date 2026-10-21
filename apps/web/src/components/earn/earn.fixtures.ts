// Lot EP (EP4): shared test fixtures for the Earn components — the API payload
// shapes with deliberately odd numbers, so a spec can prove a figure came from
// the payload and not from a constant in the component.
import type { CampaignMe, CampaignRules } from '../../api/campaign'

export const rulesFixture = (overrides: Partial<CampaignRules> = {}): CampaignRules => ({
  actions: {
    'sdex-swap': { basePoints: 50, dailyCap: 5, requiresMinNotional: true },
    'blend-deposit': { basePoints: 100, dailyCap: 3, requiresMinNotional: true },
    'blend-withdraw': { basePoints: 0, dailyCap: 0, requiresMinNotional: false },
  },
  streakDailyPoints: 5,
  streak: {
    stepPerDay: 0.05,
    cap: 1.35,
    dailyPoints: 5,
    daysToCap: 7,
    ladder: [
      { days: 1, multiplier: 1.05 },
      { days: 2, multiplier: 1.1 },
      { days: 3, multiplier: 1.15 },
      { days: 4, multiplier: 1.2 },
      { days: 5, multiplier: 1.25 },
      { days: 6, multiplier: 1.3 },
      { days: 7, multiplier: 1.35 },
    ],
  },
  socialTasks: {
    'x-follow': { points: 20, url: null, available: true },
    'x-repost': { points: 10, url: null, available: false },
    'community-join': { points: 20, url: null, available: true },
  },
  socialDailyCap: 50,
  referral: { referrer: 100, referee: 50 },
  perks: [
    { key: 'early-access', threshold: 100 },
    { key: 'beta-features', threshold: 500 },
    { key: 'priority-rwa', threshold: 1500 },
  ],
  ...overrides,
})

/** last7 as the API serves it: `multiplier` is the one that applied ON that day (D-1 rule). */
export const last7Fixture = (
  checked: boolean[] = [false, false, false, true, true, true, false],
  multipliers: number[] = [1, 1, 1, 1, 1.05, 1.1, 1.15],
) =>
  ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'].map((day, i) => ({
    day,
    checkedIn: checked[i] ?? false,
    multiplier: multipliers[i] ?? 1,
  }))

export const meFixture = (overrides: Partial<CampaignMe> = {}): CampaignMe => ({
  campaign: 1,
  active: true,
  address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWXYZ',
  proven: true,
  enrolled: true,
  referralCode: 'ABCDEFGH',
  referredBy: null,
  balance: 1234,
  pointsToday: 55,
  actionsToday: { 'sdex-swap': { counted: 2, cap: 5 }, 'blend-deposit': { counted: 0, cap: 3 } },
  pendingByKind: { 'sdex-swap': 0, 'blend-deposit': 0 },
  streak: { current: 3, multiplierForToday: 1.15, daysToCap: 4, last7: last7Fixture() },
  checkedInToday: false,
  pendingVerification: 0,
  tasks: [],
  perks: [],
  nextPerk: { key: 'early-access', threshold: 100, pointsRemaining: 0 },
  flags: { beta: false },
  disclaimer: 'DISCLAIMER-FROM-API',
  ...overrides,
})
