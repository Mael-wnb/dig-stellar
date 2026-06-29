// apps/web/src/composables/useBridgeSeries.ts
//
// Daily net-flow series for the NetFlowChart. Kept separate from useBridge: the
// chart is its own component with its own 7-day view, so this avoids pulling the
// window summary + recent-flows feed it never uses. Window-independent — it is
// NOT wired to the 24h/7d/30d summary toggle.
import { ref, onMounted } from 'vue'
import { fetchBridgeSeries, type BridgeSeriesPoint } from '../api/bridge'

const SERIES_DAYS = 7

export function useBridgeSeries() {
  const series = ref<BridgeSeriesPoint[]>([])
  const updatedAt = ref<string | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const data = await fetchBridgeSeries({ days: SERIES_DAYS })
      series.value = data.series
      updatedAt.value = data.updatedAt
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : 'Failed to load net-flow series'
    } finally {
      loading.value = false
    }
  }

  onMounted(load)

  return { series, updatedAt, loading, error, refresh: load }
}
