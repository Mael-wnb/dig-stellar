// apps/web/src/main.ts
import { Buffer } from 'buffer'
import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

if (!('Buffer' in globalThis)) {
  ;(globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer = Buffer
}

createApp(App).mount('#app')