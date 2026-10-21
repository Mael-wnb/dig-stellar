// useAdvertisedBlendPool — Lot EP (EP4). Module singleton holding the Blend
// pool a generic "Deposit" CTA advertises, picked by lib/advertisedBlendPool
// (the former GetStartedCard logic). Shared by GetStartedCard and the Earn
// "Earn more" card so both open the SAME pool. A fetch failure leaves null:
// the deposit still opens, on the network default pool, without an APY figure.
import { ref } from 'vue'
import { fetchPools } from '../api/pools'
import { pickAdvertisedBlendPool } from '../lib/advertisedBlendPool'
import type { PoolListItem } from '../types/protocol'

const advertisedPool = ref<PoolListItem | null>(null)
let inflight: Promise<void> | null = null

async function load(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      advertisedPool.value = pickAdvertisedBlendPool(await fetchPools())
    } catch {
      advertisedPool.value = null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function useAdvertisedBlendPool() {
  return { advertisedPool, load }
}
