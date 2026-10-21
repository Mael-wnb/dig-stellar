// apps/web/src/main.ts
import { Buffer } from 'buffer'
import { createApp, watch } from 'vue'
import './style.css'
import App from './App.vue'
import { initAnalytics, trackPageView } from './lib/analytics'
import { useView } from './composables/useView'

if (!('Buffer' in globalThis)) {
  ;(globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer = Buffer
}

// Lot AN0: GA4 with Consent Mode v2. No-op unless VITE_GA_MEASUREMENT_ID is set
// at build time (Vercel Production only). The initial page_view comes from the
// gtag config; the hash-only view switch gets an explicit one here.
initAnalytics()
{
  const { view, activePoolId } = useView()
  watch([view, activePoolId], () => trackPageView())
}

createApp(App).mount('#app')