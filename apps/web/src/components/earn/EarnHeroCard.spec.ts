// Lot EP (EP4): the hero renders the API's balance, pointsToday, pending count
// and streak figures — and follows the founder's "from tomorrow" rule when the
// bar is full but the D-1 multiplier is not at the cap yet.
import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import EarnHeroCard from './EarnHeroCard.vue'
import { meFixture, rewardsMeFixture, rulesFixture } from './earn.fixtures'

const render = (props: Record<string, unknown>) => renderToString(createSSRApp(EarnHeroCard, props))

describe('EarnHeroCard', () => {
  it('renders the balance large, "+N today" from pointsToday and the rank when given', async () => {
    const html = await render({ me: meFixture({ balance: 1234, pointsToday: 55 }), rules: rulesFixture(), rank: 7 })
    expect(html).toContain('1,234')
    expect(html).toContain('+55 today')
    expect(html).toContain('Rank #7 on the leaderboard')
  })

  it('"0 today" has no plus sign; no rank line without a rank', async () => {
    const html = await render({ me: meFixture({ pointsToday: 0 }), rules: rulesFixture(), rank: null })
    expect(html).toContain('>0 today')
    expect(html).not.toContain('+0 today')
    expect(html).not.toContain('Rank #')
  })

  it('streak line: day n / 7, today\'s multiplier, the cap at day 7; the bar width is from daysToCap', async () => {
    const html = await render({
      me: meFixture({ streak: { current: 3, multiplierForToday: 1.15, daysToCap: 4, last7: [] } }),
      rules: rulesFixture(),
    })
    expect(html).toContain('Streak day 3 / 7 · ×1.15 today · ×1.35 after 7 days')
    expect(html).not.toContain('at day 7')
    expect(html).toContain('width: 43%') // (7 - 4) / 7
  })

  it('founder rule: daysToCap 0 but multiplier below the cap → "×1.35 from tomorrow" (never a full bar with a lower figure)', async () => {
    const html = await render({
      me: meFixture({ streak: { current: 7, multiplierForToday: 1.3, daysToCap: 0, last7: [] } }),
      rules: rulesFixture(),
    })
    expect(html).toContain('Streak day 7 / 7 · ×1.30 today · ×1.35 from tomorrow')
    expect(html).toContain('width: 100%')
  })

  it('cap reached and applied today → "cap reached"; a streak past 7 still reads 7 / 7', async () => {
    const html = await render({
      me: meFixture({ streak: { current: 12, multiplierForToday: 1.35, daysToCap: 0, last7: [] } }),
      rules: rulesFixture(),
    })
    expect(html).toContain('Streak day 7 / 7 · ×1.35 today · cap reached')
  })

  it('pending badge: singular / plural from pendingVerification, absent at 0', async () => {
    expect(await render({ me: meFixture({ pendingVerification: 1 }), rules: rulesFixture() })).toContain(
      '1 action awaiting verification (next check within 15 min)',
    )
    expect(await render({ me: meFixture({ pendingVerification: 3 }), rules: rulesFixture() })).toContain(
      '3 actions awaiting verification (next check within 15 min)',
    )
    expect(await render({ me: meFixture({ pendingVerification: 0 }), rules: rulesFixture() })).not.toContain('awaiting verification')
  })

  it('never computes: with cap 1.5 and daysToCap 10 in the rules, the copy follows the rules payload', async () => {
    const rules = rulesFixture({ streak: { ...rulesFixture().streak, cap: 1.5, daysToCap: 10 } })
    const html = await render({ me: meFixture({ streak: { current: 2, multiplierForToday: 1.1, daysToCap: 8, last7: [] } }), rules })
    expect(html).toContain('Streak day 2 / 10 · ×1.10 today · ×1.50 after 10 days')
    expect(html).toContain('width: 20%')
  })

  it('deploy order: an older API without rules.streak / streak.daysToCap → balance still renders, no streak line, no bar, no error', async () => {
    const rules = rulesFixture()
    delete (rules as { streak?: unknown }).streak
    const me = meFixture({ streak: { current: 3, multiplierForToday: 1.15 } })
    delete (me as { pointsToday?: unknown }).pointsToday
    const html = await render({ me, rules })
    expect(html).toContain('1,234')
    expect(html).not.toContain('role="progressbar"')
    expect(html).not.toContain('Streak day')
    expect(html).not.toContain('today')
  })

  describe('EP5: XLM rewards block', () => {
    const live = () => rulesFixture({ rewards: { enabled: true, dailyPoolXlm: 137, dailyCapXlm: 5, minClaimXlm: 1 } })
    /** The rendered Claim button tag (SSR puts `disabled` before data-testid). */
    const claimButton = (html: string) => html.match(/<button[^>]*data-testid="hero-claim"[^>]*>[^<]*<\/button>/)?.[0] ?? ''
    const isDisabled = (html: string) => /\sdisabled(\s|>)/.test(claimButton(html))
    /** The rewards block only (the streak bar below it legitimately carries a % width). */
    const rewardsBlock = (html: string) => {
      const start = html.indexOf('data-testid="hero-rewards"')
      return start < 0 ? '' : html.slice(start, html.indexOf('data-testid="hero-streak-line"', start))
    }

    it('hidden entirely when rules.rewards.enabled is false or absent (older API), even with a rewards payload', async () => {
      const off = await render({ me: meFixture(), rules: rulesFixture(), rewards: rewardsMeFixture() })
      expect(off).not.toContain('Daily pool')
      expect(off).not.toContain('Claimable')
      expect(off).not.toContain('data-testid="hero-claim"')
      const older = rulesFixture()
      delete (older as { rewards?: unknown }).rewards
      const olderHtml = await render({ me: meFixture(), rules: older, rewards: rewardsMeFixture() })
      expect(olderHtml).not.toContain('XLM')
      expect(olderHtml).not.toContain('data-testid="hero-rewards"')
    })

    it('pool line from rules.rewards.dailyPoolXlm, claimable from /rewards/me — verbatim, nothing computed', async () => {
      const html = await render({ me: meFixture(), rules: live(), rewards: rewardsMeFixture({ claimableXlm: 2.4234567 }) })
      expect(html).toContain('Daily pool · 137 XLM shared by points')
      expect(html).toContain('Claimable: 2.4234567 XLM')
      expect(claimButton(html)).toMatch(/>Claim</)
      expect(isDisabled(html)).toBe(false)
      expect(rewardsBlock(html)).not.toContain('%')
      expect(rewardsBlock(html)).not.toContain('5 XLM') // the per-wallet cap is not shown here
    })

    it('below the minimum: the button is disabled and reads "X / 1 XLM minimum" (minimum from the payload)', async () => {
      const html = await render({ me: meFixture(), rules: live(), rewards: rewardsMeFixture({ claimableXlm: 0.3, minClaimXlm: 1 }) })
      expect(html).toContain('Claimable: 0.3 XLM')
      expect(isDisabled(html)).toBe(true)
      expect(claimButton(html)).toContain('0.3 / 1 XLM minimum')
      // exactly the minimum is claimable
      const atMin = await render({ me: meFixture(), rules: live(), rewards: rewardsMeFixture({ claimableXlm: 1, minClaimXlm: 1 }) })
      expect(isDisabled(atMin)).toBe(false)
      // an odd minimum from the API is what is shown
      const odd = await render({ me: meFixture(), rules: live(), rewards: rewardsMeFixture({ claimableXlm: 1.5, minClaimXlm: 2.5 }) })
      expect(odd).toContain('1.5 / 2.5 XLM minimum')
    })

    it('while /rewards/me has not answered: "Claimable: …" and a disabled Claim; the claim message and the claiming state render', async () => {
      const loading = await render({ me: meFixture(), rules: live(), rewards: null })
      expect(loading).toContain('Claimable: …')
      expect(isDisabled(loading)).toBe(true)
      const busy = await render({ me: meFixture(), rules: live(), rewards: rewardsMeFixture(), claiming: true, claimMessage: 'Paid 2.4234567 XLM · tx abcdef01' })
      expect(busy).toContain('Claiming…')
      expect(busy).toContain('Paid 2.4234567 XLM · tx abcdef01')
    })

    it('item 9: "Verifying N recent actions…" while the outbox re-reports; singular at 1; absent at 0', async () => {
      expect(await render({ me: meFixture(), rules: rulesFixture(), verifying: 2 })).toContain('Verifying 2 recent actions…')
      expect(await render({ me: meFixture(), rules: rulesFixture(), verifying: 1 })).toContain('Verifying 1 recent action…')
      expect(await render({ me: meFixture(), rules: rulesFixture(), verifying: 0 })).not.toContain('Verifying')
    })
  })
})
