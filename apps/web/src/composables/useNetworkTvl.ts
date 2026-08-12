// useNetworkTvl — G4 (Lot G / T3-D3). Fetches the network TVL 7-day series from
// GET /v1/network/tvl-series (served from G0's network_tvl_snapshots). Dumb
// fetch + state; the chart component owns the drawing. Gaps stay gaps — the API
// returns only the hours that have data, and the chart never bridges them.
import { ref, onMounted } from 'vue'
import { fetchNetworkTvlSeries } from '../api/network'
import type { NetworkTvlPoint, NetworkTvlSeriesResponse } from '../api/network'

export function useNetworkTvl() {
  const series = ref<NetworkTvlPoint[]>([])
  const meta = ref<NetworkTvlSeriesResponse['meta'] | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const res = await fetchNetworkTvlSeries()
      series.value = res.series
      meta.value = res.meta
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load TVL history'
    } finally {
      loading.value = false
    }
  }

  onMounted(() => void load())

  return { series, meta, loading, error, load }
}
