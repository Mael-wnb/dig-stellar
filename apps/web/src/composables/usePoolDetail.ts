// usePoolDetail — Lot C. Loads a single pool's detail (raw PoolDetailData, which
// carries ageSeconds/freshness) plus its inflows/outflows series for the
// pool-detail view. Slug comes from useView().activePoolId; when unset (e.g. the
// view is opened before the protocols list wires navigation in C3) it falls back
// to the highest-TVL Blend pool so the richest variant renders.

import { onMounted, ref, watch } from 'vue'
import {
  fetchPoolById,
  fetchPoolFlows,
  fetchPoolSeries,
  fetchPools,
} from '../api/pools'
import type { PoolDetailData, PoolFlows, PoolSeries } from '../types/protocol'
import { useView } from './useView'

export type FlowWindow = '24h' | '7d' | '30d'

export function usePoolDetail() {
  const { activePoolId } = useView()

  const pool = ref<PoolDetailData | null>(null)
  const flows = ref<PoolFlows | null>(null)
  const series = ref<PoolSeries | null>(null)
  const flowWindow = ref<FlowWindow>('30d')
  const loading = ref(true)
  const flowsLoading = ref(false)
  const error = ref<string | null>(null)
  const resolvedSlug = ref<string | null>(null)

  async function resolveSlug(): Promise<string | null> {
    if (activePoolId.value) return activePoolId.value
    try {
      const list = await fetchPools()
      const sorted = [...list].sort(
        (a, b) => (b.metrics.tvlUsd ?? 0) - (a.metrics.tvlUsd ?? 0),
      )
      const blend = sorted.find((p) => p.protocol.id === 'blend')
      return (blend ?? sorted[0])?.id ?? null
    } catch {
      return null
    }
  }

  async function loadFlows(): Promise<void> {
    const slug = resolvedSlug.value
    if (!slug) return
    flowsLoading.value = true
    try {
      flows.value = await fetchPoolFlows(slug, flowWindow.value)
    } catch {
      // Non-fatal: the flows section is supplementary. Hide it on failure.
      flows.value = null
    } finally {
      flowsLoading.value = false
    }
  }

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    const slug = await resolveSlug()
    resolvedSlug.value = slug
    if (!slug) {
      loading.value = false
      error.value = 'No pool available.'
      return
    }
    try {
      pool.value = await fetchPoolById(slug)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load pool.'
    } finally {
      loading.value = false
    }
    void loadFlows()
    void loadSeries()
  }

  async function loadSeries(): Promise<void> {
    const slug = resolvedSlug.value
    if (!slug) return
    try {
      series.value = await fetchPoolSeries(slug)
    } catch {
      // Non-fatal: fall back to the honest "building history" note.
      series.value = null
    }
  }

  function setFlowWindow(w: FlowWindow): void {
    if (w === flowWindow.value) return
    flowWindow.value = w
    void loadFlows()
  }

  watch(activePoolId, () => void load())
  onMounted(() => void load())

  return {
    pool,
    flows,
    series,
    flowWindow,
    loading,
    flowsLoading,
    error,
    resolvedSlug,
    setFlowWindow,
    reload: load,
  }
}
