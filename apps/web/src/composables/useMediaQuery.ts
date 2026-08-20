// useMediaQuery — AA2 (Lot AA). Tiny reactive matchMedia wrapper for the few
// places where responsive behavior can't be expressed in CSS alone (e.g. the
// pools table's column SET changes below `sm` — founder arbitration decision 1).
// Presentation-only: consumers must never change data logic based on it.
import { onBeforeUnmount, ref, type Ref } from 'vue'

export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false)

  if (typeof window !== 'undefined' && 'matchMedia' in window) {
    const mql = window.matchMedia(query)
    matches.value = mql.matches
    const onChange = (e: MediaQueryListEvent) => {
      matches.value = e.matches
    }
    mql.addEventListener('change', onChange)
    onBeforeUnmount(() => mql.removeEventListener('change', onChange))
  }

  return matches
}
