// apps/web/src/lib/analytics.ts
//
// Lot AN0: Google Analytics 4, minimal and consent-first.
//
// Does NOTHING when `VITE_GA_MEASUREMENT_ID` is empty (local, preview, tests):
// no script, no dataLayer, no banner. The id is read from the env at build
// time by Vite and is never written in the repo (Vercel, Production only).
//
// Consent model (Consent Mode v2, "basic" variant): the consent defaults are
// set to denied BEFORE gtag.js is loaded, and gtag.js is only injected once the
// person has accepted. A declined (or unanswered) banner therefore sends
// nothing at all, not even the cookieless pings the "advanced" variant would
// emit. Changing one's mind after an accept flips the official per-id opt-out
// flag (`ga-disable-<id>`) so the already-loaded script goes silent.
//
// Privacy rule enforced here, not at the call sites: `track()` drops any
// parameter whose name is address / userId / handle (case- and underscore-
// insensitive) and any string value shaped like a Stellar public key. No
// wallet address, user id or social handle ever reaches GA.

import { readonly, ref } from 'vue'

export type AnalyticsConsent = 'granted' | 'denied'
export type AnalyticsParams = Record<string, string | number | boolean | null | undefined>

export const ANALYTICS_CONSENT_COPY =
  'We use Google Analytics to count visits and which features are used. ' +
  'No wallet address or handle is ever sent.'

const STORAGE_KEY = 'dig_analytics_consent'

// Parameter names that must never be sent, compared after lowercasing and
// stripping underscores (so `userId`, `user_id`, `USERID` all match).
const FORBIDDEN_PARAM_NAMES: ReadonlySet<string> = new Set(['address', 'userid', 'handle'])
// Belt and braces: a Stellar public key as a VALUE is dropped whatever its name.
const STELLAR_PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/

type GtagFn = (...args: unknown[]) => void

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: GtagFn
  }
}

/** The GA4 measurement id from the build env, or null when analytics is off. */
export function measurementId(): string | null {
  const raw: unknown = import.meta.env.VITE_GA_MEASUREMENT_ID
  const id = typeof raw === 'string' ? raw.trim() : ''
  return id.length > 0 ? id : null
}

export function isAnalyticsConfigured(): boolean {
  return measurementId() !== null
}

// Module-scoped state (the useView / useNetwork shared-ref pattern).
const consent = ref<AnalyticsConsent | null>(null)
const bannerOpen = ref(false)
let initialized = false
let scriptLoaded = false

/** The person's answer: 'granted' | 'denied' | null (not answered yet). */
export const analyticsConsent = readonly(consent)
/** True while the banner is force-opened from the "Analytics" link. */
export const analyticsBannerOpen = readonly(bannerOpen)

function readStoredConsent(): AnalyticsConsent | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v === 'granted' || v === 'denied' ? v : null
  } catch {
    return null
  }
}

function writeStoredConsent(value: AnalyticsConsent): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Storage unavailable (private mode, blocked): the answer lives for this
    // page load only and the banner asks again next time. Acceptable.
  }
}

// Google's snippet pushes the `arguments` object (not an array) onto the
// dataLayer; gtag.js only recognises commands in that shape.
function ensureGtag(): GtagFn {
  window.dataLayer = window.dataLayer ?? []
  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() {
      window.dataLayer!.push(arguments)
    }
  }
  return window.gtag
}

function loadScript(id: string): void {
  if (scriptLoaded) return
  scriptLoaded = true
  const g = ensureGtag()
  g('js', new Date())
  g('config', id, { send_page_view: true, anonymize_ip: true })
  if (typeof document === 'undefined') return
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
  document.head.appendChild(s)
}

function activate(id: string): void {
  const g = ensureGtag()
  // Re-enable in case a previous decline (this page load) set the opt-out flag.
  ;(window as unknown as Record<string, unknown>)[`ga-disable-${id}`] = false
  g('consent', 'update', { analytics_storage: 'granted' })
  loadScript(id)
}

function deactivate(id: string): void {
  if (!scriptLoaded) return // nothing was ever loaded: nothing to silence
  ensureGtag()('consent', 'update', { analytics_storage: 'denied' })
  ;(window as unknown as Record<string, unknown>)[`ga-disable-${id}`] = true
}

/**
 * Call once at app start (main.ts). No-op without a measurement id or outside
 * a browser. Sets the Consent Mode v2 defaults (all denied) before anything
 * else, restores a stored answer, and loads gtag.js only on a stored accept.
 */
export function initAnalytics(): void {
  if (initialized || typeof window === 'undefined') return
  const id = measurementId()
  if (!id) return
  initialized = true

  ensureGtag()('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  })

  consent.value = readStoredConsent()
  if (consent.value === 'granted') activate(id)
}

/** Banner answer. Persisted; an accept loads gtag.js, a decline keeps it off. */
export function setAnalyticsConsent(value: AnalyticsConsent): void {
  bannerOpen.value = false
  consent.value = value
  if (typeof window === 'undefined') return
  writeStoredConsent(value)
  const id = measurementId()
  if (!id || !initialized) return
  if (value === 'granted') activate(id)
  else deactivate(id)
}

/** Re-open the banner so a person can change their answer. */
export function openAnalyticsBanner(): void {
  bannerOpen.value = true
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/_/g, '')
}

/** Drops forbidden names and Stellar-key-shaped values. Exported for the spec. */
export function sanitizeParams(params: AnalyticsParams | undefined): AnalyticsParams {
  const out: AnalyticsParams = {}
  if (!params) return out
  for (const [key, value] of Object.entries(params)) {
    if (FORBIDDEN_PARAM_NAMES.has(normalizeName(key))) continue
    if (typeof value === 'string' && STELLAR_PUBLIC_KEY_RE.test(value)) continue
    if (value === undefined) continue
    out[key] = value
  }
  return out
}

function canSend(): boolean {
  return initialized && consent.value === 'granted' && typeof window !== 'undefined'
}

/** Custom event. Silent unless analytics is configured AND consent is granted. */
export function track(name: string, params?: AnalyticsParams): void {
  if (!canSend()) return
  ensureGtag()('event', name, sanitizeParams(params))
}

/**
 * Explicit page_view for the hash-only view switch (useView). GA4 enhanced
 * measurement may or may not catch `history.replaceState` on a hash change;
 * this makes a view change count either way. The initial page load is counted
 * by `config` (`send_page_view: true`), not here.
 */
export function trackPageView(): void {
  if (!canSend()) return
  ensureGtag()('event', 'page_view', {
    page_location: window.location.href,
    page_title: typeof document === 'undefined' ? '' : document.title,
  })
}

/** Test-only: reset the module state between specs. */
export function __resetAnalyticsForTests(): void {
  initialized = false
  scriptLoaded = false
  consent.value = null
  bannerOpen.value = false
}
