// apps/web/src/lib/advertisedBlendPool.ts
//
// Lot EP (EP4): the ONE place that decides which Blend pool a generic
// "Deposit" CTA acts on, and the action contexts the swap / deposit CTAs
// open. Pure and dependency-free (no fetch, no state) so GetStartedCard and
// EarnMoreCard share it and the spec can pin it. Extracted from
// GetStartedCard (Lot F): prefer the highest-APY Blend pool that actually
// reports a finite supply APY; null → the deposit opens on the network default.
import type { ActionContext } from '../composables/useModals'
import type { PoolListItem } from '../types/protocol'

export function pickAdvertisedBlendPool(pools: ReadonlyArray<PoolListItem>): PoolListItem | null {
  const blend = pools.filter(
    (p) =>
      p.protocol.id === 'blend' &&
      p.metrics.supplyApy !== null &&
      p.metrics.supplyApy !== undefined &&
      Number.isFinite(p.metrics.supplyApy),
  )
  blend.sort((a, b) => (b.metrics.supplyApy ?? 0) - (a.metrics.supplyApy ?? 0))
  return blend[0] ?? null
}

export function sdexSwapActionContext(): ActionContext {
  return { slug: 'sdex-swap', name: 'Swap XLM ↔ USDC', venue: 'Stellar DEX', kind: 'amm' }
}

/** A5: act on the advertised pool (undefined poolSlug → network default, as before A5). */
export function blendDepositActionContext(pool: PoolListItem | null): ActionContext {
  return {
    slug: pool?.id ?? 'blend',
    name: pool?.name ?? 'Blend pool',
    venue: pool?.protocol.name ?? 'Blend',
    kind: 'lending',
    poolSlug: pool?.id,
  }
}
