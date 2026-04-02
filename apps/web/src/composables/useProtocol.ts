// src/composables/useProtocol.ts
import { computed, onMounted, ref, watch } from 'vue'
import { fetchPoolById, fetchPools } from '../api/pools'
import { PROTOCOL_META } from '../data/protocolMeta'
import type { PoolDetailData, PoolListItem } from '../types/protocol'

export interface ProtocolOption {
  id: string
  name: string
  type: string
}

export interface ProtocolDisplay extends ProtocolOption {
  icon: string
  iconColor: string
  iconBg: string
}

function getProtocolMeta(protocolId: string) {
  return (
    PROTOCOL_META[protocolId] ?? {
      icon: '•',
      iconColor: '#D5FF2F',
      iconBg: '#1a1a1a',
    }
  )
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

  const protocolDisplays = computed<ProtocolDisplay[]>(() =>
    protocols.value.map((protocol) => ({
      ...protocol,
      ...getProtocolMeta(protocol.id),
    }))
  )

  const protocolPools = computed(() =>
    pools.value.filter((pool) => pool.protocol.id === selectedProtocolId.value)
  )

  const selectedProtocol = computed<ProtocolDisplay | null>(() => {
    const protocol = protocols.value.find(
      (item) => item.id === selectedProtocolId.value
    )

    if (!protocol) return null

    return {
      ...protocol,
      ...getProtocolMeta(protocol.id),
    }
  })

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

      const hasCurrentProtocol = data.some(
        (pool) => pool.protocol.id === selectedProtocolId.value
      )

      if (!selectedProtocolId.value || !hasCurrentProtocol) {
        selectedProtocolId.value = data[0].protocol.id
      }

      const poolsForProtocol = data.filter(
        (pool) => pool.protocol.id === selectedProtocolId.value
      )

      const hasCurrentPool = poolsForProtocol.some(
        (pool) => pool.id === selectedPoolId.value
      )

      if (!selectedPoolId.value || !hasCurrentPool) {
        selectedPoolId.value = poolsForProtocol[0]?.id ?? ''
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

  function selectProtocol(protocolId: string) {
    selectedProtocolId.value = protocolId

    const firstPool = pools.value.find((pool) => pool.protocol.id === protocolId)
    selectedPoolId.value = firstPool?.id ?? ''
  }

  function selectPool(poolId: string) {
    selectedPoolId.value = poolId
  }

  watch(selectedPoolId, (poolId) => {
    void loadPoolDetail(poolId)
  })

  onMounted(() => {
    void loadPools()
  })

  return {
    pools,
    protocols,
    protocolDisplays,
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