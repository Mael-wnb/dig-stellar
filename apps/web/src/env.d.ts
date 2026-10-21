/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Lot AN0: GA4 measurement id. Empty/unset = analytics fully off. Never committed. */
  readonly VITE_GA_MEASUREMENT_ID?: string
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}