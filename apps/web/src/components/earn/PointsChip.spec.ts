// Lot EP (EP2): the chip renders the API value and nothing else — no constant
// of its own, nothing when the campaign is inactive, and the disclaimer with it.
import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import PointsChip from './PointsChip.vue'
import { pointsForActionIn } from '../../lib/pointsForAction'
import type { CampaignState } from '../../api/campaign'

const render = (props: Record<string, unknown>) => renderToString(createSSRApp(PointsChip, props))

const state = (active: boolean, swapPoints: number): CampaignState => ({
  campaign: 1,
  active,
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: null,
  rules: {
    actions: {
      'sdex-swap': { basePoints: swapPoints, dailyCap: 5, requiresMinNotional: true },
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
    perks: [{ key: 'early-access', threshold: 100 }],
  },
  disclaimer: 'DISCLAIMER-FROM-API',
})

describe('PointsChip', () => {
  it('renders "+N pts" from the prop, with the API disclaimer as the pill title', async () => {
    const html = await render({ points: 37, disclaimer: 'DISCLAIMER-FROM-API', caption: 'per verified swap' })
    expect(html).toContain('+37 pts')
    expect(html).toContain('title="DISCLAIMER-FROM-API"')
    expect(html).toContain('per verified swap')
    // no house constant leaks in: the only number is the one passed
    expect(html.match(/\+\d+ pts/g)).toEqual(['+37 pts'])
  })

  it('renders nothing when points is null (campaign inactive or unknown)', async () => {
    const html = await render({ points: null, disclaimer: 'DISCLAIMER-FROM-API' })
    expect(html).not.toContain('pts')
    expect(html).not.toContain('DISCLAIMER-FROM-API')
  })

  it('never shows an APY-style figure: the value is a plain integer with a + sign', async () => {
    const html = await render({ points: 100, disclaimer: null })
    expect(html).toContain('+100 pts')
    expect(html).not.toMatch(/%/)
  })
})

describe('pointsForActionIn (the only source of the chip value)', () => {
  it('returns the API basePoints for the kind when the campaign is active', () => {
    expect(pointsForActionIn(state(true, 50), 'sdex-swap')).toBe(50)
    expect(pointsForActionIn(state(true, 123), 'sdex-swap')).toBe(123) // whatever the API says, not 50
    expect(pointsForActionIn(state(true, 50), 'blend-deposit')).toBe(100)
  })

  it('returns null when the campaign is inactive or unknown', () => {
    expect(pointsForActionIn(state(false, 50), 'sdex-swap')).toBeNull()
    expect(pointsForActionIn(null, 'sdex-swap')).toBeNull()
  })

  it('returns null for a kind the rules do not carry a number for', () => {
    const s = state(true, 50)
    delete (s.rules.actions as Partial<typeof s.rules.actions>)['blend-deposit']
    expect(pointsForActionIn(s, 'blend-deposit')).toBeNull()
  })
})
