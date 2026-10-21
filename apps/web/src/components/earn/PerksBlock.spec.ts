// Lot EP (EP3): the perks block renders the API's perks / nextPerk / tiers and
// nothing of its own — a granted badge stays shown whatever the balance, and
// the "next" line is the API's pointsRemaining verbatim.
import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import PerksBlock from './PerksBlock.vue'
import type { CampaignMe, CampaignRules } from '../../api/campaign'

const render = (props: Record<string, unknown>) => renderToString(createSSRApp(PerksBlock, props))

const rules: CampaignRules = {
  actions: {
    'sdex-swap': { basePoints: 50, dailyCap: 5, requiresMinNotional: true },
    'blend-deposit': { basePoints: 100, dailyCap: 3, requiresMinNotional: true },
    'blend-withdraw': { basePoints: 0, dailyCap: 0, requiresMinNotional: false },
  },
  streakDailyPoints: 5,
  streakMultipliers: [{ minDays: 0, multiplier: 1 }],
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
}

const me = (overrides: Partial<CampaignMe>): CampaignMe => ({
  campaign: 1,
  active: true,
  address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWXYZ',
  proven: true,
  enrolled: true,
  referralCode: 'ABCDEFGH',
  referredBy: null,
  balance: 55,
  streak: { current: 0, multiplierForToday: 1 },
  checkedInToday: false,
  pendingVerification: 0,
  tasks: [],
  perks: [],
  nextPerk: { key: 'early-access', threshold: 100, pointsRemaining: 45 },
  flags: { beta: false },
  disclaimer: 'DISCLAIMER-FROM-API',
  ...overrides,
})

describe('PerksBlock', () => {
  it('lists the three API tiers with their thresholds and the next line from pointsRemaining', async () => {
    const html = await render({ me: me({}), rules })
    expect(html).toContain('data-perk="early-access" data-granted="false"')
    expect(html).toContain('data-perk="beta-features" data-granted="false"')
    expect(html).toContain('data-perk="priority-rwa" data-granted="false"')
    expect(html).toContain('100 pts')
    expect(html).toContain('1,500 pts')
    expect(html).toContain('Next: Early access at 100 pts · 45 pts to go.')
    expect(html).not.toContain('Granted ')
  })

  it('a granted perk shows as a badge even when the balance is under its threshold', async () => {
    const html = await render({
      me: me({
        balance: 40,
        perks: [{ key: 'early-access', grantedAt: '2026-11-02T10:00:00.000Z' }],
        nextPerk: { key: 'beta-features', threshold: 500, pointsRemaining: 460 },
      }),
      rules,
    })
    expect(html).toContain('data-perk="early-access" data-granted="true"')
    expect(html).toContain('Granted Nov 2, 2026')
    expect(html).toContain('Next: Beta features at 500 pts · 460 pts to go.')
  })

  it('reached but not granted yet reads as pending the next sync; all granted reads as complete', async () => {
    const pending = await render({ me: me({ balance: 130, nextPerk: { key: 'early-access', threshold: 100, pointsRemaining: 0 } }), rules })
    expect(pending).toContain('Early access reached · granted at the next sync')
    const done = await render({
      me: me({
        perks: [
          { key: 'early-access', grantedAt: '2026-11-02T10:00:00.000Z' },
          { key: 'beta-features', grantedAt: '2026-11-03T10:00:00.000Z' },
          { key: 'priority-rwa', grantedAt: '2026-11-04T10:00:00.000Z' },
        ],
        nextPerk: null,
      }),
      rules,
    })
    expect(done).toContain('Every perk unlocked.')
    expect((done.match(/data-granted="true"/g) ?? []).length).toBe(3)
  })
})
