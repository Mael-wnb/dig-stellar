import { computed, onMounted, ref, watch } from 'vue'
import { fetchPoolById, fetchPools } from '../api/pools'
import { PROTOCOL_META } from '../data/protocolMeta'
import type { PoolListItem } from '../types/protocol'
import { mapPoolToDisplay } from '../mappers/poolMapper'
import type { PoolDisplay } from '../types/poolDisplay'

/* ──────────────────────────────────────────────── */
/* TYPES */
/* ──────────────────────────────────────────────── */

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

/* ──────────────────────────────────────────────── */
/* HELPERS */
/* ──────────────────────────────────────────────── */

function getProtocolMeta(protocolId: string) {
  return (
    PROTOCOL_META[protocolId] ?? {
      icon: '•',
      iconColor: '#D5FF2F',
      iconBg: '#1a1a1a',
    }
  )
}

/* ──────────────────────────────────────────────── */
/* MAIN COMPOSABLE */
/* ──────────────────────────────────────────────── */

export function useProtocol() {
  const pools = ref<PoolListItem[]>([])

  const selectedProtocolId = ref<string>('')
  const selectedPoolId = ref<string>('')

  const selectedPool = ref<PoolDisplay | null>(null)

  const loadingProtocols = ref(false)
  const loadingPoolDetail = ref(false)
  const error = ref<string | null>(null)

  /* ───────────────────────── */
  /* COMPUTED */
  /* ───────────────────────── */

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
    pools.value.filter(
      (pool) => pool.protocol.id === selectedProtocolId.value
    )
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

  /* ───────────────────────── */
  /* LOAD LIST */
  /* ───────────────────────── */

  async function loadPools() {
    loadingProtocols.value = true
    error.value = null

    try {
      const data = await fetchPools()

      // ✅ IMPORTANT : ne pas recréer les refs (évite flicker)
      pools.value = data

      if (!data.length) {
        selectedProtocolId.value = ''
        selectedPoolId.value = ''
        selectedPool.value = null
        return
      }

      if (
        !selectedProtocolId.value ||
        !data.some(p => p.protocol.id === selectedProtocolId.value)
      ) {
        selectedProtocolId.value = data[0].protocol.id
      }

      const poolsForProtocol = data.filter(
        (pool) => pool.protocol.id === selectedProtocolId.value
      )

      if (
        !selectedPoolId.value ||
        !poolsForProtocol.some(p => p.id === selectedPoolId.value)
      ) {
        selectedPoolId.value = poolsForProtocol[0]?.id ?? ''
      }

    } catch (err) {
      error.value =
        err instanceof Error ? err.message : 'Failed to load pools'
    } finally {
      loadingProtocols.value = false
    }
  }

  /* ───────────────────────── */
  /* LOAD DETAIL (FIXED) */
  /* ───────────────────────── */

  async function loadPoolDetail(poolId: string) {
    if (!poolId) return

    loadingPoolDetail.value = true
    error.value = null

    try {
      const data = await fetchPoolById(poolId)

      // ✅ NE MET PAS selectedPool à null → évite flicker
      selectedPool.value = mapPoolToDisplay(data)

    } catch (err) {
      error.value =
        err instanceof Error ? err.message : 'Failed to load pool detail'
      // ❌ ne pas reset selectedPool ici
    } finally {
      loadingPoolDetail.value = false
    }
  }

  /* ───────────────────────── */
  /* ACTIONS */
  /* ───────────────────────── */

  function selectProtocol(protocolId: string) {
    if (protocolId === selectedProtocolId.value) return

    selectedProtocolId.value = protocolId

    const poolsForProtocol = pools.value.filter(
      (pool) => pool.protocol.id === protocolId
    )

    selectedPoolId.value = poolsForProtocol[0]?.id ?? ''
  }

  function selectPool(poolId: string) {
    if (poolId === selectedPoolId.value) return
    selectedPoolId.value = poolId
  }

  /* ───────────────────────── */
  /* WATCHERS (FIXED) */
  /* ───────────────────────── */

  watch(selectedPoolId, (poolId) => {
    if (!poolId) return

    // ✅ laisse le DOM se stabiliser AVANT fetch
    requestAnimationFrame(() => {
      void loadPoolDetail(poolId)
    })
  })

  /* ───────────────────────── */
  /* INIT */
  /* ───────────────────────── */

  onMounted(() => {
    void loadPools()
  })

  /* ───────────────────────── */
  /* EXPORT */
  /* ───────────────────────── */

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
  }
}