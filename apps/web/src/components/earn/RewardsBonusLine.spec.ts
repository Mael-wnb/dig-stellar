// Lot EP (EP5): the bonus line is static copy gated by rules.rewards.enabled —
// never a percentage, never an amount, absent when disabled or on an older API.
import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import RewardsBonusLine from './RewardsBonusLine.vue'
import { rulesFixture } from './earn.fixtures'

const render = (props: Record<string, unknown>) => renderToString(createSSRApp(RewardsBonusLine, props))

describe('RewardsBonusLine', () => {
  it('enabled → exactly the founder line, no %, no number, even with odd pool values in the rules', async () => {
    const rules = rulesFixture({ rewards: { enabled: true, dailyPoolXlm: 137, dailyCapXlm: 7.5, minClaimXlm: 1 } })
    const html = await render({ rules })
    expect(html).toContain('Dig bonus: XLM paid daily from the points pool (see Earn)')
    expect(html).toContain('data-testid="rewards-bonus"')
    expect(html).not.toContain('%')
    expect(html).not.toContain('137')
    expect(html).not.toContain('7.5')
    expect(html).not.toMatch(/APY/i)
  })

  it('disabled, absent (older API), or no rules at all → nothing rendered', async () => {
    expect(await render({ rules: rulesFixture({ rewards: { enabled: false, dailyPoolXlm: 100, dailyCapXlm: 5, minClaimXlm: 1 } }) })).not.toContain('Dig bonus')
    const older = rulesFixture()
    delete (older as { rewards?: unknown }).rewards
    expect(await render({ rules: older })).not.toContain('Dig bonus')
    expect(await render({ rules: null })).not.toContain('Dig bonus')
  })
})
