// apps/web/src/composables/useView.ts
//
// Module-scoped view switch (no vue-router — mirrors the useNetwork / useAppUser
// shared-ref pattern). Lot C extends the two-view switch to the five design
// views + a pool-detail sub-view. `pool` is reached from `protocols` by
// selecting a pool; the sidebar keeps "Protocols" highlighted while on it.
//
// Beta-first rationale (Lot C): a router is not warranted — there is no
// deep-linking/URL requirement in scope and only five views, so a shared ref is
// the smaller, lower-risk change.

import { ref, watch } from 'vue'

export type AppView =
  | 'dashboard'
  | 'protocols'
  | 'pool'
  | 'portfolio'
  | 'alerts'

const VIEWS: AppView[] = ['dashboard', 'protocols', 'pool', 'portfolio', 'alerts']

// Lightweight hash sync (NOT a router): the URL hash mirrors the active view so
// a refresh keeps you where you were, and a view is shareable/deep-linkable
// (`#pool:blend-fixed-pool`). Five views + a shared ref — no route table, no
// navigation guards, no dependency.
function parseHash(): { view: AppView; poolId: string | null } | null {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash.replace(/^#\/?/, '')
  if (!raw) return null
  const [name, poolId] = raw.split(':')
  if (!VIEWS.includes(name as AppView)) return null
  return { view: name as AppView, poolId: poolId || null }
}

const initial = parseHash()
const view = ref<AppView>(initial?.view ?? 'dashboard')

// The pool slug/id currently open in the `pool` sub-view. Set when navigating
// from a protocol/pool row; read by the pool-detail view.
const activePoolId = ref<string | null>(initial?.poolId ?? null)

// Keep the hash in sync with the active view (write-through).
if (typeof window !== 'undefined') {
  watch([view, activePoolId], ([v, pid]) => {
    const next = v === 'pool' && pid ? `#pool:${pid}` : `#${v}`
    if (window.location.hash !== next) {
      history.replaceState(null, '', next)
    }
  })
}

export function useView() {
  function setView(next: AppView) {
    view.value = next
  }

  // Open the pool-detail sub-view for a given pool id.
  function openPool(poolId: string) {
    activePoolId.value = poolId
    view.value = 'pool'
  }

  return { view, activePoolId, setView, openPool }
}
