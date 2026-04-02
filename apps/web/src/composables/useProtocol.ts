// src/composables/useProtocol.ts
import { computed, onMounted, ref, watch } from 'vue'
import { fetchPoolById, fetchPools } from '../api/pools'
import type { PoolDetailData, PoolListItem } from '../types/protocol'

export interface ProtocolOption {
  id: string
  name: string
  type: string
}

export function useProtocol() {
  const pools = ref<PoolListItem[]>([])
  const selectedProtocolId = ref<string>('')
  const selectedPoolId = ref<string>('')
  const selectedPool = ref<PoolDetailData | null>(null)

  const loadingProtocols = ref(false)
  const loadingPoolDetail = ref(false)
  const error = ref<string | null>(null)

  const protocols = computed<ProtocolOption[]>(() => {
    const map = new Map<string, ProtocolOption>()

    for (const pool of pools.value) {
      if (!map.has(pool.protocol.id)) {
        map.set(pool.protocol.id, {
          id: pool.protocol.id,
          name: pool.protocol.name,
          type: pool.protocol.type,
        })
      }
    }

    return Array.from(map.values())
  })

  const protocolPools = computed(() =>
    pools.value.filter((pool) => pool.protocol.id === selectedProtocolId.value)
  )

  const selectedProtocol = computed(() =>
    protocols.value.find((protocol) => protocol.id === selectedProtocolId.value)
  )

  async function loadPools() {
    loadingProtocols.value = true
    error.value = null

    try {
      const data = await fetchPools()
      pools.value = data

      if (!data.length) {
        selectedProtocolId.value = ''
        selectedPoolId.value = ''
        selectedPool.value = null
        return
      }

      if (!selectedProtocolId.value) {
        selectedProtocolId.value = data[0].protocol.id
      }

      const firstPoolForProtocol = data.find(
        (pool) => pool.protocol.id === selectedProtocolId.value
      )

      if (!selectedPoolId.value && firstPoolForProtocol) {
        selectedPoolId.value = firstPoolForProtocol.id
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load pools'
    } finally {
      loadingProtocols.value = false
    }
  }

  async function loadPoolDetail(poolId: string) {
    if (!poolId) {
      selectedPool.value = null
      return
    }

    loadingPoolDetail.value = true
    error.value = null

    try {
      selectedPool.value = await fetchPoolById(poolId)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load pool detail'
      selectedPool.value = null
    } finally {
      loadingPoolDetail.value = false
    }
  }

  async function selectProtocol(protocolId: string) {
    selectedProtocolId.value = protocolId

    const firstPool = pools.value.find((pool) => pool.protocol.id === protocolId)
    selectedPoolId.value = firstPool?.id ?? ''
  }

  async function selectPool(poolId: string) {
    selectedPoolId.value = poolId
  }

  watch(selectedPoolId, async (poolId) => {
    await loadPoolDetail(poolId)
  })

  onMounted(async () => {
    await loadPools()
    if (selectedPoolId.value) {
      await loadPoolDetail(selectedPoolId.value)
    }
  })

  return {
    pools,
    protocols,
    protocolPools,
    selectedProtocolId,
    selectedPoolId,
    selectedProtocol,
    selectedPool,
    loadingProtocols,
    loadingPoolDetail,
    error,
    selectProtocol,
    selectPool,
    reloadPools: loadPools,
  }
}