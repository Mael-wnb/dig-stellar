// apps/web/src/lib/analytics.spec.ts
//
// Lot AN0: the two guarantees the loader gives the privacy rule.
//   1. `track()` drops any parameter named address / userId / handle (any
//      casing, with or without underscores) and any Stellar-key-shaped value.
//   2. Nothing reaches gtag unless a measurement id is configured AND consent
//      is granted — not before the banner is answered, not after a decline.
// Runs in the node environment with a minimal fake `window`; the real gtag.js
// is never loaded (no `document` here, and the lib guards on it).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetAnalyticsForTests,
  initAnalytics,
  isAnalyticsConfigured,
  sanitizeParams,
  setAnalyticsConsent,
  track,
  trackPageView,
} from './analytics'

type FakeWindow = {
  dataLayer?: unknown[]
  gtag?: (...args: unknown[]) => void
  location: { href: string }
  localStorage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void }
}

const G_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

function makeWindow(store: Record<string, string> = {}): FakeWindow {
  return {
    location: { href: 'http://localhost/#dashboard' },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = v
      },
    },
  }
}

/** Every gtag call recorded on the fake dataLayer, as plain arrays. */
function calls(w: FakeWindow): unknown[][] {
  return (w.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>))
}

function eventCalls(w: FakeWindow): unknown[][] {
  return calls(w).filter((c) => c[0] === 'event')
}

describe('analytics — parameter hygiene', () => {
  it('drops parameters named address / userId / handle in any spelling', () => {
    const out = sanitizeParams({
      provider: 'freighter',
      address: G_ADDRESS,
      Address: 'x',
      userId: 'u-1',
      user_id: 'u-2',
      USERID: 'u-3',
      handle: '@someone',
      HANDLE: '@other',
      pair: 'XLM/USDC',
    })
    expect(out).toEqual({ provider: 'freighter', pair: 'XLM/USDC' })
  })

  it('drops a Stellar-key-shaped value whatever the parameter name', () => {
    const out = sanitizeParams({ pool: 'blend-fixed-pool', wallet: G_ADDRESS, note: 'ok' })
    expect(out).toEqual({ pool: 'blend-fixed-pool', note: 'ok' })
  })

  it('returns an empty object for undefined params', () => {
    expect(sanitizeParams(undefined)).toEqual({})
  })
})

describe('analytics — consent gate', () => {
  let w: FakeWindow

  beforeEach(() => {
    __resetAnalyticsForTests()
    w = makeWindow()
    vi.stubGlobal('window', w)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    __resetAnalyticsForTests()
  })

  it('does nothing at all when VITE_GA_MEASUREMENT_ID is empty', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', '')
    expect(isAnalyticsConfigured()).toBe(false)
    initAnalytics()
    setAnalyticsConsent('granted')
    track('wallet_connect', { provider: 'freighter' })
    trackPageView()
    expect(w.dataLayer).toBeUndefined()
    expect(w.gtag).toBeUndefined()
  })

  it('sets the Consent Mode v2 defaults to denied and sends no event before an answer', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TESTONLY')
    initAnalytics()
    expect(calls(w)).toEqual([
      [
        'consent',
        'default',
        {
          ad_storage: 'denied',
          ad_user_data: 'denied',
          ad_personalization: 'denied',
          analytics_storage: 'denied',
        },
      ],
    ])
    track('wallet_connect', { provider: 'freighter' })
    trackPageView()
    expect(eventCalls(w)).toEqual([])
    // No config either: gtag.js is only wired up after an accept.
    expect(calls(w).some((c) => c[0] === 'config')).toBe(false)
  })

  it('sends nothing after a decline, and persists the answer', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TESTONLY')
    const store: Record<string, string> = {}
    w = makeWindow(store)
    vi.stubGlobal('window', w)
    initAnalytics()
    setAnalyticsConsent('denied')
    track('swap_success', { pair: 'XLM/USDC' })
    trackPageView()
    expect(eventCalls(w)).toEqual([])
    expect(calls(w).some((c) => c[0] === 'config')).toBe(false)
    expect(store.dig_analytics_consent).toBe('denied')
  })

  it('after an accept: grants analytics_storage, configures the id, then sends sanitized events', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TESTONLY')
    initAnalytics()
    setAnalyticsConsent('granted')

    const all = calls(w)
    expect(all).toContainEqual(['consent', 'update', { analytics_storage: 'granted' }])
    expect(all).toContainEqual(['config', 'G-TESTONLY', { send_page_view: true, anonymize_ip: true }])
    // consent update must precede config
    const iUpdate = all.findIndex((c) => c[0] === 'consent' && c[1] === 'update')
    const iConfig = all.findIndex((c) => c[0] === 'config')
    expect(iUpdate).toBeLessThan(iConfig)

    track('wallet_connect', { provider: 'xbull', address: G_ADDRESS, userId: 'u-1' })
    expect(eventCalls(w)).toEqual([['event', 'wallet_connect', { provider: 'xbull' }]])

    trackPageView()
    const pv = eventCalls(w).find((c) => c[1] === 'page_view')
    expect(pv?.[2]).toEqual({ page_location: 'http://localhost/#dashboard', page_title: '' })
  })

  it('restores a stored accept on init without asking again', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TESTONLY')
    w = makeWindow({ dig_analytics_consent: 'granted' })
    vi.stubGlobal('window', w)
    initAnalytics()
    expect(calls(w).some((c) => c[0] === 'config')).toBe(true)
    track('campaign_checkin')
    expect(eventCalls(w)).toEqual([['event', 'campaign_checkin', {}]])
  })

  it('a later decline silences an already-loaded script', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TESTONLY')
    initAnalytics()
    setAnalyticsConsent('granted')
    setAnalyticsConsent('denied')
    track('campaign_enroll')
    expect(eventCalls(w)).toEqual([])
    expect((w as unknown as Record<string, unknown>)['ga-disable-G-TESTONLY']).toBe(true)
  })

  it('survives a throwing localStorage', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TESTONLY')
    w = makeWindow()
    w.localStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    vi.stubGlobal('window', w)
    expect(() => initAnalytics()).not.toThrow()
    expect(() => setAnalyticsConsent('granted')).not.toThrow()
    track('campaign_enroll')
    expect(eventCalls(w)).toEqual([['event', 'campaign_enroll', {}]])
  })
})
