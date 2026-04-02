// src/composables/usePools.ts

import { computed, ref } from 'vue'
import { fetchPoolById, fetchPools } from '../api/pools'
import type { PoolDetailData, PoolListItem } from '../types/protocol'

export function usePools() {
  const pools = ref<PoolListItem[]>([])
  const selectedProtocolId = ref<string>('blend')
  const selectedPoolId = ref<string>('')
  const selectedPool = ref<PoolDetailData | null>(null)

  const loadingPools = ref(false)
  const loadingPoolDetail = ref(false)
  const error = ref<string | null>(null)

  const protocols = computed(() => {
    const seen = new Map<string, { id: string; name: string; type: string }>()
    for (const pool of pools.value) {
      if (!seen.has(pool.protocol.id)) {
        seen.set(pool.protocol.id, {
          id: pool.protocol.id,
          name: pool.protocol.name,
          type: pool.protocol.type,
        })
      }
    }
    return Array.from(seen.values())
  })

  const filteredPools = computed(() =>
    pools.value.filter((pool) => pool.protocol.id === selectedProtocolId.value)
  )

  async function loadPools() {
    loadingPools.value = true
    error.value = null

    try {
      const data = await fetchPools()
      pools.value = data

      if (!selectedProtocolId.value && data.length > 0) {
        selectedProtocolId.value = data[0].protocol.id
      }

      const availablePools = data.filter((p) => p.protocol.id === selectedProtocolId.value)

      if (availablePools.length > 0 && !selectedPoolId.value) {
        selectedPoolId.value = availablePools[0].id
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load pools'
    } finally {
      loadingPools.value = false
    }
  }

  async function loadSelectedPoolDetail() {
    if (!selectedPoolId.value) {
      selectedPool.value = null
      return
    }

    loadingPoolDetail.value = true
    error.value = null

    try {
      selectedPool.value = await fetchPoolById(selectedPoolId.value)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load pool detail'
    } finally {
      loadingPoolDetail.value = false
    }
  }

  async function selectProtocol(protocolId: string) {
    selectedProtocolId.value = protocolId

    const nextPools = pools.value.filter((pool) => pool.protocol.id === protocolId)
    selectedPoolId.value = nextPools[0]?.id ?? ''
    await loadSelectedPoolDetail()
  }

  async function selectPool(poolId: string) {
    selectedPoolId.value = poolId
    await loadSelectedPoolDetail()
  }

  return {
    pools,
    protocols,
    filteredPools,
    selectedProtocolId,
    selectedPoolId,
    selectedPool,
    loadingPools,
    loadingPoolDetail,
    error,
    loadPools,
    loadSelectedPoolDetail,
    selectProtocol,
    selectPool,
  }
}