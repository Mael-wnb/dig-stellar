// Lot EP (EP4): the feed renders GET /campaign/me/activity rows as served —
// label per reason, signed points, multiplier when not ×1, the API's 8-char
// tx hash on action rows only — and an honest empty state.
import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ActivityFeed from './ActivityFeed.vue'
import { activityLabel, signedPoints } from '../../lib/activityLabels'
import type { CampaignActivity } from '../../api/campaign'

const render = (props: Record<string, unknown>) => renderToString(createSSRApp(ActivityFeed, props))

const activity = (rows: CampaignActivity['rows']): CampaignActivity => ({
  campaign: 1,
  address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWXYZ',
  rows,
  disclaimer: 'DISCLAIMER-FROM-API',
})

const now = new Date().toISOString()

describe('activityLabels', () => {
  it('maps every ledger reason family to the founder labels', () => {
    expect(activityLabel('action:sdex-swap')).toBe('Swap verified')
    expect(activityLabel('action:blend-deposit')).toBe('Blend deposit verified')
    expect(activityLabel('streak:daily')).toBe('Daily check-in')
    expect(activityLabel('social:x-follow')).toBe('Follow Dig on X')
    expect(activityLabel('social:x-repost')).toBe('Repost on X')
    expect(activityLabel('social:community-join')).toBe('Join the Dig Discord')
    expect(activityLabel('referral:referrer')).toBe('Referral')
    expect(activityLabel('referral:referee')).toBe('Referral')
    expect(activityLabel('adjust:founder-review-2026-11-05')).toBe('Adjustment')
    expect(activityLabel('something:new')).toBe('something:new') // unknown → raw, never hidden
  })

  it('signs the points', () => {
    expect(signedPoints(50)).toBe('+50')
    expect(signedPoints(-5)).toBe('−5')
    expect(signedPoints(0)).toBe('0')
    expect(signedPoints(1234)).toBe('+1,234')
  })
})

describe('ActivityFeed', () => {
  it('renders the rows in payload order with label, signed points, multiplier and short hash where the API gave one', async () => {
    const html = await render({
      activity: activity([
        { reason: 'action:sdex-swap', points: 60, multiplier: 1.2, countedDay: '2026-10-21', createdAt: now, txHashShort: 'abcdef01' },
        { reason: 'streak:daily', points: 5, multiplier: 1, countedDay: '2026-10-21', createdAt: now, txHashShort: null },
        { reason: 'adjust:founder-review', points: -5, multiplier: 1, countedDay: null, createdAt: now, txHashShort: null },
      ]),
    })
    const labels = [...html.matchAll(/data-testid="activity-label"[^>]*>([^<]+)</g)].map((m) => m[1])
    expect(labels).toEqual(['Swap verified', 'Daily check-in', 'Adjustment'])
    expect(html).toContain('+60 pts')
    expect(html).toContain('+5 pts')
    expect(html).toContain('−5 pts')
    expect(html).toContain('×1.20')
    expect((html.match(/×1\.00/g) ?? []).length).toBe(0) // ×1 is not shown
    expect(html.match(/abcdef01/g)).toHaveLength(1)
    expect(html).toContain('Your last 3 points entries')
    expect(html).toContain('s ago')
  })

  it('empty payload or no payload → the empty line, no list', async () => {
    expect(await render({ activity: activity([]) })).toContain('No activity yet. Check in or make a verified swap to start.')
    expect(await render({ activity: null })).toContain('No activity yet.')
  })
})
