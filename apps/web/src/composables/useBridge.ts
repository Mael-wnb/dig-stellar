// apps/web/src/composables/useBridge.ts
import { ref, onMounted } from 'vue'
import {
  fetchBridgeSummary,
  fetchBridgeFlows,
  type BridgeSummaryResponse,
  type BridgeFlow,
  type BridgeWindow,
} from '../api/bridge'

// Larger slice so the recent-flows table can sort/page client-side (the API has
// no sort/cursor — only direction + limit ≤200). Still window-independent: this
// is a "recent feed", not a window-scoped aggregate.
const RECENT_FLOWS_LIMIT = 100

export function useBridge() {
  const summary = ref<BridgeSummaryResponse | null>(null)
  const flows = ref<BridgeFlow[]>([])
  const window = ref<BridgeWindow>('7d')

  const loading = ref(true)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null

    try {
      // summary is window-scoped; the recent feed is window-independent (latest N).
      const [summaryData, flowsData] = await Promise.all([
        fetchBridgeSummary(window.value),
        fetchBridgeFlows({ limit: RECENT_FLOWS_LIMIT }),
      ])
      summary.value = summaryData
      flows.value = flowsData.flows
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : 'Failed to load bridge flows'
    } finally {
      loading.value = false
    }
  }

  async function setWindow(next: BridgeWindow) {
    if (next === window.value) return
    window.value = next
    // Only the summary depends on the window; re-fetch just that to stay cheap.
    loading.value = true
    error.value = null
    try {
      summary.value = await fetchBridgeSummary(next)
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : 'Failed to load bridge flows'
    } finally {
      loading.value = false
    }
  }

  onMounted(load)

  return { summary, flows, window, loading, error, refresh: load, setWindow }
}
