// Lot EP (EP4, founder precision at STOP-AND-SHOW 1): the "Earn more" rows
// read their points from rules.actions and their counts from /me actionsToday,
// nothing computed in the component. Odd payload values prove it.
import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { meFixture, rulesFixture } from './earn.fixtures'
import { blendDepositActionContext, pickAdvertisedBlendPool } from '../../lib/advertisedBlendPool'
import type { PoolListItem } from '../../types/protocol'

// The shared advertised-pool state (no fetch in the runner): the SAME composable GetStartedCard reads.
const advertisedPool = ref<PoolListItem | null>(null)
vi.mock('../../composables/useAdvertisedBlendPool', () => ({
  useAdvertisedBlendPool: () => ({ advertisedPool, load: vi.fn() }),
}))

const { default: EarnMoreCard } = await import('./EarnMoreCard.vue')
const render = (props: Record<string, unknown>) => renderToString(createSSRApp(EarnMoreCard, props))

const pool = (id: string, supplyApy: number | null): PoolListItem =>
  ({ id, name: `Pool ${id}`, type: 'lending', chain: 'stellar', contractAddress: null, protocol: { id: 'blend', name: 'Blend' }, tokens: [], metrics: { supplyApy } }) as unknown as PoolListItem

describe('EarnMoreCard', () => {
  it('points come from rules.actions[kind].basePoints and counts from me.actionsToday[kind] — verbatim', async () => {
    const rules = rulesFixture({
      actions: {
        'sdex-swap': { basePoints: 73, dailyCap: 5, requiresMinNotional: true },
        'blend-deposit': { basePoints: 111, dailyCap: 3, requiresMinNotional: true },
        'blend-withdraw': { basePoints: 0, dailyCap: 0, requiresMinNotional: false },
      },
    })
    const me = meFixture({
      actionsToday: { 'sdex-swap': { counted: 2, cap: 9 }, 'blend-deposit': { counted: 1, cap: 4 } },
    })
    const html = await render({ me, rules })
    expect(html).toContain('+73 pts per verified swap · 2/9 today')
    expect(html).toContain('+111 pts per verified deposit · 1/4 today')
    // the cap shown is actionsToday.cap (9 / 4), not rules.dailyCap (5 / 3): the component picks neither nor sums anything
    expect(html).not.toContain('2/5 today')
    expect(html).not.toContain('1/3 today')
    // the only "+N pts" figures on the card are the two payload values
    expect(html.match(/\+\d+ pts/g)).toEqual(['+73 pts', '+111 pts'])
  })

  it('renders the founder wording with the default rules: "+50 pts per verified swap · 2/5 today" and the two CTAs', async () => {
    const html = await render({ me: meFixture(), rules: rulesFixture() })
    expect(html).toContain('+50 pts per verified swap · 2/5 today')
    expect(html).toContain('+100 pts per verified deposit · 0/3 today')
    expect(html).toContain('Open swap')
    expect(html).toContain('Open deposit')
  })

  it('pending pill per row from pendingByKind, only where > 0', async () => {
    const html = await render({ me: meFixture({ pendingByKind: { 'sdex-swap': 3, 'blend-deposit': 0 } }), rules: rulesFixture() })
    expect(html.match(/\d+ pending/g)).toEqual(['3 pending'])
    const none = await render({ me: meFixture(), rules: rulesFixture() })
    expect(none).not.toContain('pending</span>')
  })

  it('"Open deposit" acts on the SAME advertised Blend pool as the Get-started card (shared selection, no duplicate)', async () => {
    // the shared selection: highest finite supply APY among Blend pools (GetStartedCard rule since Lot F)
    const pools = [
      pool('blend-a', 0.02),
      pool('blend-best', 0.09),
      pool('blend-no-apy', null),
      { ...pool('not-blend', 0.5), protocol: { id: 'soroswap', name: 'Soroswap' } } as unknown as PoolListItem,
    ]
    const picked = pickAdvertisedBlendPool(pools)
    expect(picked?.id).toBe('blend-best')
    expect(blendDepositActionContext(picked)).toEqual({ slug: 'blend-best', name: 'Pool blend-best', venue: 'Blend', kind: 'lending', poolSlug: 'blend-best' })

    // the card opens exactly that context: the deposit button carries the advertised pool slug
    advertisedPool.value = picked
    const html = await render({ me: meFixture(), rules: rulesFixture() })
    expect(html).toMatch(/<button[^>]*data-pool-slug="blend-best"[^>]*>\s*Open deposit/)

    // no pool known → network default, same fallback as the Get-started card
    advertisedPool.value = null
    expect(blendDepositActionContext(null)).toEqual({ slug: 'blend', name: 'Blend pool', venue: 'Blend', kind: 'lending', poolSlug: undefined })
    const fallback = await render({ me: meFixture(), rules: rulesFixture() })
    expect(fallback).toMatch(/<button[^>]*data-pool-slug=""[^>]*>\s*Open deposit/)
  })

  it('states the minimum-amount rule once, and never a token / airdrop / reward word', async () => {
    const html = await render({ me: meFixture(), rules: rulesFixture() })
    expect(html.match(/Very small amounts below the minimum are not counted/g)).toHaveLength(1)
    expect(html).not.toMatch(/token|airdrop|reward|earn XLM/i)
  })
})
