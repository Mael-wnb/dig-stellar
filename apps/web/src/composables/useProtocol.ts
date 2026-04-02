// apps/web/src/composables/useProtocol.ts
import { ref, computed } from 'vue'
import { PROTOCOLS } from '../data/protocols'
import type { Protocol, Pool } from '../data/protocols'

export function useProtocol() {
  const selectedProtocolId = ref<string>(PROTOCOLS[0].id)
  const selectedPoolId = ref<string>(PROTOCOLS[0].pools[0].id)

  const selectedProtocol = computed<Protocol | undefined>(() =>
    PROTOCOLS.find((p: Protocol) => p.id === selectedProtocolId.value)
  )

  const selectedPool = computed<Pool | undefined>(() =>
    selectedProtocol.value?.pools.find((p: Pool) => p.id === selectedPoolId.value)
  )

  function selectProtocol(protocolId: string): void {
    selectedProtocolId.value = protocolId
    const proto = PROTOCOLS.find((p: Protocol) => p.id === protocolId)
    if (proto?.pools?.length) {
      selectedPoolId.value = proto.pools[0].id
    }
  }

  function selectPool(poolId: string): void {
    selectedPoolId.value = poolId
  }

  return {
    protocols: PROTOCOLS,
    selectedProtocolId,
    selectedPoolId,
    selectedProtocol,
    selectedPool,
    selectProtocol,
    selectPool,
  }
}