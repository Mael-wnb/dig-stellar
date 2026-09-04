// apps/web/src/composables/useOpsStatus.ts
// Lot ST: data machinery for the status view. Fetch on view enter + 60s poll
// while the view is visible (the view is v-if-mounted, so unmount = leave and
// the poll is cleared). F4 state predicates: loading / error / empty / ready —
// no forks per call site.
//
// The "last refresh age" is anchored on the SERVER's clocks
// (generatedAt − lastRunAt) and only ticked locally from the moment the
// payload arrived — never computed from the browser clock alone (skew).

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { fetchOpsStatus, type OpsStatusResponse } from '../api/ops'

const POLL_MS = 60_000
const TICK_MS = 10_000

export function useOpsStatus() {
  const data = ref<OpsStatusResponse | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  // Local monotonic-ish anchor: when the current payload was received.
  const receivedAtMs = ref<number | null>(null)
  const nowTick = ref(Date.now())

  let pollTimer: ReturnType<typeof setInterval> | null = null
  let tickTimer: ReturnType<typeof setInterval> | null = null

  async function load(initial = false) {
    if (initial) loading.value = true
    try {
      data.value = await fetchOpsStatus()
      receivedAtMs.value = Date.now()
      error.value = null
    } catch (err) {
      // Keep the last good payload on poll failures; only surface the error
      // state when there is nothing to show at all (F4: no forks).
      if (!data.value) {
        error.value = err instanceof Error ? err.message : 'Failed to load status'
      }
    } finally {
      loading.value = false
    }
  }

  const state = computed<'loading' | 'error' | 'empty' | 'ready'>(() => {
    if (loading.value) return 'loading'
    if (error.value && !data.value) return 'error'
    if (!data.value || data.value.overall.state === 'unknown') return 'empty'
    return 'ready'
  })

  // Age of the latest run in seconds: server-anchored, locally ticked.
  const lastRunAgeSeconds = computed<number | null>(() => {
    const d = data.value
    if (!d || !d.overall.lastRunAt || receivedAtMs.value === null) return null
    const serverAgeMs =
      new Date(d.generatedAt).getTime() - new Date(d.overall.lastRunAt).getTime()
    const localElapsedMs = nowTick.value - receivedAtMs.value
    return Math.max(0, Math.round((serverAgeMs + localElapsedMs) / 1000))
  })

  onMounted(() => {
    void load(true)
    pollTimer = setInterval(() => void load(false), POLL_MS)
    tickTimer = setInterval(() => {
      nowTick.value = Date.now()
    }, TICK_MS)
  })

  onUnmounted(() => {
    if (pollTimer) clearInterval(pollTimer)
    if (tickTimer) clearInterval(tickTimer)
  })

  return { data, state, error, lastRunAgeSeconds, reload: () => void load(true) }
}
