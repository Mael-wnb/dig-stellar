// apps/web/src/composables/useView.ts
//
// Tiny module-scoped view switch (no vue-router in this app — mirrors the
// useNetwork / useAppUser shared-ref pattern). App.vue reads `view`; the header
// flips it via setView. Two views today: the dashboard and the Alerts page.

import { ref } from 'vue'

export type AppView = 'dashboard' | 'alerts'

const view = ref<AppView>('dashboard')

export function useView() {
  function setView(next: AppView) {
    view.value = next
  }
  return { view, setView }
}
