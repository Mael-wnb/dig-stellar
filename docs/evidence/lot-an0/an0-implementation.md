# AN0 — Google Analytics 4, consent-first: implementation evidence (2026-10-21)

Scope: what Lot AN0 delivers on `feat/lot-an0` (uncommitted at the time of writing; the founder
commits) and the local runs that exercised it. `apps/web` only, no API change. The measurement id
is NOT in the repo: it is read at build time from `VITE_GA_MEASUREMENT_ID`, set in Vercel
(Production only). Every number below comes from a command output or a browser run of 2026-10-21
(Node 24.22.0, pnpm 10.32.1, Vite 8.0.2, Vitest 4.1.9), labelled.

## 1. Delivered

| Area | What |
|---|---|
| **Loader** | `apps/web/src/lib/analytics.ts`. `measurementId()` reads `import.meta.env.VITE_GA_MEASUREMENT_ID` (trimmed); empty → every export is a no-op and the banner never renders. `initAnalytics()` (called from `main.ts` before mount) pushes Consent Mode v2 defaults — `ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage` all `denied` — BEFORE anything else, restores a stored answer, and loads gtag.js only on a stored accept. gtag.js is injected with the id; `config` carries `send_page_view: true, anonymize_ip: true`. No ads features. |
| **Consent variant (design choice, flagged)** | The brief's step order (defaults → script → config) is the "advanced" Consent Mode, which still sends cookieless pings while denied. The brief also says "Decline → nothing is sent, ever" and the acceptance check is "nothing before Accept". Those win: the script is injected only after an accept ("basic" Consent Mode). Everything the brief lists still happens, in the same order, at accept time. A later decline flips the official per-id opt-out flag (`window['ga-disable-<id>'] = true`) and sends `consent update analytics_storage: denied`, so the already-loaded script goes silent for the rest of the page load. |
| **Banner** | `components/common/AnalyticsConsentBanner.vue`, mounted in `App.vue` at shell level. Fixed bottom bar, English, two buttons "Accept analytics" (accent) / "Decline" (ghost). Visible while `isAnalyticsConfigured() && (consent === null \|\| bannerOpen)`. Answer kept in `localStorage['dig_analytics_consent']` (`granted` \| `denied`), every read and write inside try/catch; a throwing storage degrades to "ask again next load". Copy verbatim from the brief. Re-openable from a tiny "Analytics" text link under the sidebar "Live / Stellar mainnet" row (also inside the mobile drawer, which renders the same `AppSidebar`). The link is hidden when no id is configured. |
| **Events** | Only after consent (`track()` returns early otherwise): explicit `page_view {page_location, page_title}` on every `useView` change (watch on `[view, activePoolId]` in `main.ts`; the initial page load is counted by `config`), `wallet_connect {provider}` (`useConnectFlow` after `setUserId`, provider = Kit module id such as `freighter` / `xbull`), `campaign_enroll` (`useCampaign.enroll`, on `res.enrolled`), `campaign_checkin` (`useCampaign.checkin`, on `res.checkedIn`), `swap_success {pair}` (`SdexSwapWidget` success branch, pair = `FROMCODE/TOCODE`), `deposit_success {pool}` (`BlendDepositCard` confirmed-deposit branch only, pool = client registry slug; withdraw and pending paths fire nothing). |
| **PII guard** | `sanitizeParams()` drops any parameter whose name normalises (lowercase, underscores removed) to `address`, `userid` or `handle`, and any string value matching `^G[A-Z2-7]{55}$`. Enforced inside `track()`, so no call site can leak by mistake. |
| **Spec** | `src/lib/analytics.spec.ts` — 10 tests: the three forbidden names in six spellings are dropped; a G-address value is dropped whatever its name; nothing at all happens with an empty id; defaults are denied and no event/config is pushed before an answer; a decline sends nothing and persists; an accept pushes `consent update` BEFORE `config` and then sanitized events; a stored accept restores silently; a later decline silences and sets `ga-disable-<id>`; a throwing localStorage never throws out. |
| **CSP** | Checked `apps/web/index.html` (no CSP meta), no `vercel.json` anywhere in the repo, `apps/web/public` (no `_headers`), and the deployed nginx config in `docs/evidence/lot-s/nginx-site-config-deployed.conf` (serves the API; HSTS / nosniff / X-Frame-Options / Referrer-Policy only, no CSP). **No Content-Security-Policy exists for the web, so nothing was changed.** If one is added later it needs `script-src https://www.googletagmanager.com`, `connect-src https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com`, `img-src https://*.google-analytics.com https://www.googletagmanager.com`. |
| **Env** | `apps/web/.env.example` documents the name with an empty value and the "never commit a G- id" rule; `src/env.d.ts` types it as optional. |
| **Docs** | `docs/current-state.md` (one Lot AN0 paragraph in the overview), this file. |

Untouched, said plainly: `apps/api`, `modules/actions`, the XDR validators, flags and whitelists.
The two widgets received exactly one `track(...)` line each inside their existing success branch
plus an import.

## 2. Build proof — no measurement id in the bundle

Vite inlines `import.meta.env.VITE_*` at build time; nothing in the source carries a `G-` literal.

Build WITHOUT the env var (production bundle as Preview / local would get it):

```
$ env | grep -c VITE_GA_MEASUREMENT_ID        → 0
$ pnpm -C apps/web build                       → vue-tsc -b && vite build … ✓ built in 651ms
$ grep -ro 'G-[A-Z0-9]\{4,\}' dist | wc -l     → 0
$ grep -o 'G-' dist/assets/*.js | wc -l        → 0
$ grep -ro 'VITE_GA_MEASUREMENT_ID' dist | wc -l → 0   (the name itself is inlined away)
$ grep -ro 'googletagmanager.com/gtag/js' dist --include='*.js' | wc -l → 1   (the loader code, inert without an id)
```

Control build WITH a dummy id, to prove the env path is the one the loader reads:

```
$ VITE_GA_MEASUREMENT_ID=G-TESTONLY pnpm -C apps/web build → ✓
$ grep -ro 'G-TESTONLY' dist --include='*.js' | wc -l → 1
```

(`dist/` is gitignored and was removed after each run.)

## 3. Tests

```
$ pnpm -C apps/web test
 Test Files  7 passed (7)
      Tests  133 passed (133)        ← 123 before AN0 + 10 in analytics.spec.ts
```

## 4. Browser run (local dev server, dummy id `G-TESTONLY`, Chrome, API down)

Started with `VITE_GA_MEASUREMENT_ID=G-TESTONLY pnpm dev --port 5190`; the id lived in the shell
only. Observed through the page's `dataLayer`, the network panel and `localStorage`:

| Step | Observed |
|---|---|
| Load `#dashboard`, no answer yet | banner shown (`an0-consent-banner.jpg`); `dataLayer = [consent default {all denied}]`; no `<script src*=googletagmanager>`; **zero** requests to any google host; `localStorage` empty. |
| Click **Accept analytics** | banner gone; `localStorage.dig_analytics_consent = granted`; `dataLayer` gains `consent update {analytics_storage: granted}` → `js` → `config G-TESTONLY {send_page_view: true, anonymize_ip: true}`; `GET https://www.googletagmanager.com/gtag/js?id=G-TESTONLY` 200; one `POST …/g/collect … en=page_view … gcs=G101 … ep.anonymize_ip=true` (503, the id is fake). |
| Click **Protocols** (hash-only view switch) | one explicit `event page_view {page_location: "http://localhost:5190/#protocols", page_title: …}` pushed; exactly one more `collect` with `dl=http://localhost:5190/#protocols`. Total page_view hits: 2 (initial + switch) — no duplicate from enhanced measurement on this run. Note the initial `dl` is `http://localhost/` (GA strips the fragment), which is why the explicit event matters: it is the only one carrying the view name. |
| Click sidebar **Analytics** link | banner re-opens. |
| Click **Decline** | banner gone; `localStorage = denied`; `dataLayer` gains `consent update {analytics_storage: denied}`; `window['ga-disable-G-TESTONLY'] === true`. |
| Click **Portfolio** after the decline | `location.hash = #portfolio`; **no** new `page_view` in `dataLayer`; `collect` request count unchanged (still 2). |
| Console | no errors or exceptions during the run. |

The DEV-only ownership-proof panel (not in production builds) was hidden in the page for the
screenshot only; nothing else was altered.

## 5. Manual check list for the founder (GA4 DebugView)

1. In Vercel → Project → Settings → Environment Variables: add `VITE_GA_MEASUREMENT_ID` =
   the property's `G-…` id, **Production only** (leave Preview and Development unset). Redeploy.
   A Preview deploy therefore stays analytics-free; to test on a Preview URL, set the variable
   for Preview temporarily and remove it afterwards.
2. Open the deployed site in a fresh profile or after clearing site data. Expect the banner at the
   bottom; in DevTools → Network, filter `google`: **nothing**. `localStorage.dig_analytics_consent`
   absent.
3. GA4 → Admin → DebugView. Put the browser in debug mode with the "Google Analytics Debugger"
   Chrome extension (the code deliberately sets no `debug_mode` flag). With the banner still
   unanswered: **no events** in DebugView.
4. Click **Accept analytics**. Expect in DebugView, within seconds: `page_view` (from `config`),
   then `page_view` again when switching views (check `page_location` carries `#protocols`,
   `#portfolio`, …). Also the `gtag/js` request (200) and `collect` POSTs (204) in Network.
5. Connect a wallet → `wallet_connect` with `provider` = `freighter` / `xbull` / … and **no**
   `address` / `userId` parameter (click the event in DebugView and read its parameters).
6. If the campaign is active: enrol → `campaign_enroll` (no parameters), check in →
   `campaign_checkin` (no parameters). Testnet swap → `swap_success` with `pair` only. Testnet
   Blend deposit → `deposit_success` with `pool` only.
7. Duplicate check: if every view switch shows **two** `page_view` events, GA4's enhanced
   measurement is also catching the `replaceState`. Fix in GA4 (not in code): Admin → Data
   streams → Web → Enhanced measurement → gear → untick "Page changes based on browser history
   events". The local run above showed no duplicate.
8. Click the sidebar **Analytics** link → **Decline**. Expect no further events in DebugView while
   navigating; reload → still no `gtag/js` request, banner stays hidden (`denied` persisted).
9. GA4 property hygiene (Admin, once): Google signals OFF, data retention as preferred, no
   ads linking. The code never sets ads consent to anything but `denied`.

## 6. Proposed commit split (founder commits)

1. `feat(web): GA4 loader with Consent Mode v2 defaults and consent banner` — `lib/analytics.ts`,
   `components/common/AnalyticsConsentBanner.vue`, `App.vue`, `main.ts` (init + page_view watch),
   `shell/AppSidebar.vue` (Analytics link), `env.d.ts`, `.env.example`.
2. `feat(web): analytics events at connect, campaign and action success points` —
   `useConnectFlow.ts`, `useCampaign.ts`, `SdexSwapWidget.vue`, `BlendDepositCard.vue`.
3. `test(web): analytics parameter hygiene and consent gate spec` — `lib/analytics.spec.ts`.
4. `docs(lot-an0): implementation evidence, current-state line` — this folder, `docs/current-state.md`.
