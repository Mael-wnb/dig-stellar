// Lot EP (EP4): the strip renders seven boxes from /me streak.last7, marks
// the checked days, highlights today with the API's multiplierForToday and
// labels each checked day with last7[i].multiplier (the multiplier that
// applied ON that day, D-1 rule, computed by the API) — "—" on unchecked
// days; no multiplier is computed here. useCampaign is mocked so the wallet
// kit never loads in the runner.
import { describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { last7Fixture, meFixture, rulesFixture } from './earn.fixtures'

vi.mock('../../composables/useCampaign', () => ({
  useCampaign: () => ({ checkin: vi.fn() }),
}))

const { default: StreakStrip } = await import('./StreakStrip.vue')
const render = (props: Record<string, unknown>) => renderToString(createSSRApp(StreakStrip, props))

describe('StreakStrip (EP4)', () => {
  it('renders one box per last7 day, oldest first, checked flags from the payload, today highlighted', async () => {
    const html = await render({ me: meFixture(), rules: rulesFixture() })
    const days = [...html.matchAll(/data-day="([^"]+)"/g)].map((m) => m[1])
    expect(days).toEqual(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'])
    expect([...html.matchAll(/data-checked="([^"]+)"/g)].map((m) => m[1])).toEqual(['false', 'false', 'false', 'true', 'true', 'true', 'false'])
    expect([...html.matchAll(/data-today="([^"]+)"/g)].map((m) => m[1])).toEqual(['false', 'false', 'false', 'false', 'false', 'false', 'true'])
    expect(html).toContain('>Today<')
  })

  const labels = (html: string) => [...html.matchAll(/data-testid="streak-box-label"[^>]*>([^<]*)</g)].map((m) => m[1])

  it('labels: the multiplier that applied ON each checked day (last7[i].multiplier), "—" on unchecked days, today = multiplierForToday', async () => {
    // founder case: a run of 4 checked days ending yesterday + today → 1.00, 1.05, 1.10, 1.15, 1.20
    const me = meFixture({
      streak: {
        current: 5,
        multiplierForToday: 1.2,
        daysToCap: 2,
        last7: last7Fixture([false, false, true, true, true, true, true], [1, 1, 1, 1.05, 1.1, 1.15, 1.2]),
      },
    })
    const html = await render({ me, rules: rulesFixture() })
    expect(labels(html)).toEqual(['—', '—', '×1.00', '×1.05', '×1.10', '×1.15', '×1.20'])
    expect(html).toContain('×1.20 on action points today')
    // never a figure the API did not serve: the cap appears once, in the copy line
    expect((html.match(/×1\.35/g) ?? []).length).toBe(1)
  })

  it('renders last7 multipliers verbatim (odd values prove nothing is computed) and the rules\' daily points', async () => {
    const rules = rulesFixture({ streak: { ...rulesFixture().streak!, dailyPoints: 9, cap: 1.42 } })
    const me = meFixture({ streak: { current: 7, multiplierForToday: 1.42, daysToCap: 0, last7: last7Fixture([true, true, true, true, true, true, true], [1.07, 1.14, 1.21, 1.28, 1.35, 1.42, 1.42]) } })
    const html = await render({ me, rules })
    expect(labels(html)).toEqual(['×1.07', '×1.14', '×1.21', '×1.28', '×1.35', '×1.42', '×1.42'])
    expect(html).toContain('Check in · +9 pts')
  })

  it('copy: the D-1 rule stated without the off-by-one, from rules.streak', async () => {
    const html = await render({ me: meFixture(), rules: rulesFixture() })
    expect(html).toContain('Check in once per UTC day. Miss a day and the streak resets. Your multiplier each day comes from the days you checked in before it: 7 in a row → ×1.35.')
    expect(html).not.toContain('Day 7 of a streak')
  })

  it('deploy order: an older API without rules.streak / last7 → no boxes, no multiplier labels, button and copy still render, no error', async () => {
    const rules = rulesFixture()
    delete (rules as { streak?: unknown }).streak
    const me = meFixture({ streak: { current: 2, multiplierForToday: 1.1 } })
    const html = await render({ me, rules })
    expect(html).not.toContain('data-testid="streak-boxes"')
    expect(labels(html)).toEqual([])
    expect(html).toContain('Check in · +5 pts') // rules.streakDailyPoints fallback
    expect(html).toContain('Check in once per UTC day. Miss a day and the streak resets.')
    expect(html).not.toContain('in a row')
  })

  it('check-in button inside the card: live when not checked in, disabled copy afterwards; the UTC copy line is present', async () => {
    const live = await render({ me: meFixture({ checkedInToday: false }), rules: rulesFixture() })
    expect(live).toContain('Check in · +5 pts')
    expect(live).toContain('Check in once per UTC day. Miss a day and the streak resets.')
    const done = await render({ me: meFixture({ checkedInToday: true }), rules: rulesFixture() })
    expect(done).toContain('Checked in today ✓')
    expect(done).toMatch(/<button[^>]*disabled/)
  })

  it('wraps to two rows at phone width (7 columns, 4 at max-md)', async () => {
    const html = await render({ me: meFixture(), rules: rulesFixture() })
    expect(html).toContain('grid-cols-7 max-md:grid-cols-4')
  })
})
