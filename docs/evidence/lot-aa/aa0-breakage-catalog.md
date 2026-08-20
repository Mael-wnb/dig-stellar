# AA0-b — Mobile breakage catalog

Date: 2026-08-20 · Lot AA recon (read-only) · captures in `captures/aa0/`

## Method

- Headless CDP (system Chrome via puppeteer-core), iPhone UA + touch emulation.
- Viewports: **390×844** (DPR 3), **768×1024**, **1024×768** (DPR 2).
- Local stack: web dev server + api against the local DB (data last refreshed
  2026-08-16, so every surface shows STALE freshness chips — which incidentally
  exercises the stale state everywhere).
- States swept: all 5 views × (disconnected + connected) × 3 viewports, plus the
  3 modals (Connect + Wallets Kit, AlertRule, Action in both swap and Blend
  kinds), TokenSelect drop-up (testnet swap), campaign **live** and **ended**.
- Connected state: localStorage-seeded session (existing local user with 4
  wallets, active signer + watch-only + Blend position). Pool detail:
  `#pool:blend-fixed-pool`.
- Campaign states reproduced via env on the local api process only
  (`FAUCET_ENABLED=true FAUCET_NETWORK=mainnet FAUCET_MAX_CLAIMS=60` +
  `FAUCET_STARTS_AT`/`FAUCET_ENDS_AT` future ⇒ live, past ⇒ ended). **Prod was
  not touched** beyond two read-only page loads for AA0-a.
- Automated probes per capture: elements extending past the viewport (minus
  legitimate `overflow-x` scroll containers), document h-scroll, console
  errors, sub-44px touch targets. Raw JSON: `captures/aa0/findings-live.json`,
  `findings-ended.json`, `shellsim/findings-shellsim.json`.
- **Shell-simulated series** (`captures/aa0/shellsim/`): same 390 sweep with the
  sidebar CSS-hidden at runtime — i.e. what AA1's off-canvas drawer will expose.
  This is what makes the per-view judgments below meaningful; in the unmodified
  app the shell defect masks everything else.

Known limits: emulation only (no dvh/keyboard/momentum verdicts — that is the
founder's real-device pass); faucet claim-panel post-action states need a signed
tx and were not reproduced (see §5); alerts feed/rules rendered their empty
states (no rules in the local DB).

## 1. Verdict summary

| Surface | 390×844 | 768×1024 | 1024×768 |
|---|---|---|---|
| App shell (sidebar + topbar) | **BLOCKING** | OK | OK |
| Dashboard content | OK-degraded | OK | OK |
| Protocols (cards + pools table) | Degraded | OK | OK |
| Pool detail | OK | OK | OK |
| Portfolio | OK-degraded | OK | OK |
| Alerts | **Degraded (worst view)** | OK | OK |
| ConnectModal (+ Wallets Kit) | OK-cosmetic | OK | OK |
| AlertRuleModal | Degraded | OK | OK |
| ActionModal swap / Blend | OK-degraded | OK | OK |
| Campaign surfaces (banner, widget notes) | OK | OK | OK |

At **768 and 1024 the app is already usable with zero geometric overflow and
zero console errors** (one local-env artifact aside, §6). The lot's blocking
problem is exactly one thing: the shell below ~lg.

## 2. BLOCKING — the shell at phone width

`captures/aa0/390x844/disconnected-dashboard.png` (same on every view/state)

- `AppSidebar` (`aside` fixed `w-[236px]`, `flex-shrink-0`, always in flow)
  keeps 236 of 390 px; every view renders in a ~154px strip.
- The topbar right cluster (bell + connect button) extends to x=492 on a 390
  viewport — the connect button is more than half off-screen (the probe's single
  recurring offender: `header … div.ml-auto.flex`, right edge 492–503px).
- The view title/subtitle wraps to 3 lines under the squeeze.
- Confirms the AA1 plan exactly (off-canvas drawer + burger + topbar
  compaction). With the sidebar out of flow (shellsim series), **every view and
  modal drops to zero geometric overflow at 390** — there is no second
  structural blocker hiding behind the shell.

## 3. Degraded (usable but bad) — per surface, at 390 unless noted

Founder arbitration items are marked **[AA2-ARB]**.

**Alerts view** — worst view (`shellsim/390x844/connected-alerts.png`)
- The Activity-feed header packs title + 3 filter chips + "+ New rule" into one
  row; the button's label wraps and the overflow word ("rule") **clips outside
  the card**. Borderline blocking for discoverability of rule creation (the
  in-card "+ Create rule" fallback still works). Needs a wrap/stack fix in AA2.

**AlertRuleModal** (`390x844/modal-alertrule.png`)
- "What to watch" renders 4 cards across at 390: text down to ~3-char lines,
  the 4th card ("Protocol") clips at the modal edge. Wants 2×2 at `sm` (AA3 —
  it is in the alert flow, not the campaign path, but it IS a modal → sheet
  treatment anyway).
- Wallet picker shows a half-clipped 5th row with no scroll affordance.

**Protocols view** (`shellsim/390x844/connected-protocols.png`)
- **[AA2-ARB]** The G3 adaptive pools table collapses to POOL + PROTOCOL columns
  at 390 — no TVL/APY/util numbers at all, i.e. the table keeps its shape but
  loses its point. Options: (a) `overflow-x-auto` + sticky first column keeping
  all columns (brief's default), (b) swap the PROTOCOL column for TVL on phones,
  (c) card rows. Founder call per the brief.
- Protocol summary cards form a horizontal peek-strip (next card visibly
  clipped). Works, but is it the intended pattern vs stacking? **[AA2-ARB]**
- Card metric labels ellipsize ("Avg supply …", "Avg borrow …") — cosmetic.

**Portfolio view** (`shellsim/390x844/connected-portfolio.png`)
- Wallet cards are a horizontal peek-strip; the brief's AA2 expectation is
  single-column. **[AA2-ARB]**
- Summary tiles 3-across are readable but tight; 4th tile clipped into the
  strip.
- The ⋯ wallet-management menu is click-driven (not hover) → tap-compatible ✔;
  its trigger is 38px (touch-target pass, §4).

**Dashboard** (`shellsim/390x844/connected-dashboard{,-bottom}.png`)
- H2 two-panel stack holds at 390; positions row, Assets/Position breakdown all
  legible. Campaign card fits with countdown + progress + both CTAs.
- Hero TVL curve renders very sparse at 390 — partly the short history (13
  snapshots), partly bar sizing; axis labels + methodology footnote wrap fine.
  Cosmetic/legibility pass in AA2.
- Bridge card (G-series): flow tiles fit; the Routes table header
  (`Route/Inflow/Outflow/NetShare/FLOW`) crowds and wraps awkwardly — cosmetic.
- Stat tiles (XLM price etc.) peek-strip like the other card rows.

**ActionModal** (`390x844/action-{swap,blend}-live.png`, `action-swap-testnet.png`)
- Fits at 390 (its `w-[520px] max-w-full` wrapper + overlay padding shrink
  correctly). Header, tabs, network toggle, widget forms all usable; "Add/Remove
  liquidity SOON" tab labels wrap to two cramped lines — cosmetic.
- TokenSelect drop-up inside the modal at 390: opens upward, panel fully
  on-screen (probe: top 342 / bottom 546 / right 323) —
  `action-swap-tokenselect-open.png`. Re-verify inside the AA3 bottom-sheet
  layout when it exists (the drop-up hugs the trigger, so a sheet changes the
  math).
- These captures are container-level observations only — **widgets stay
  byte-identical per the Lot AA invariant**; anything found here is fixed in
  wrappers.

**ConnectModal** (`390x844/modal-connect.png`)
- Fits (flex shrinks the declared `w-[420px]`). Watch-only input placeholder
  truncates mid-word ("Paste a G… Stellar addre") — cosmetic.
- Content issue (not layout): footer copy promises WalletConnect — see AA0-a;
  fold the honest-mobile-state change into AA3.

## 4. Touch targets (invariant: ≥44×44)

Sub-44px interactive elements are systemic, not incidental: 9–28 per view at
390 (samples in the findings JSON). Recurring: sidebar nav rows 207×38 (drawer
reuses them — AA1 should bump row height there), topbar bell 38×38, connect
button 82×38, modal close buttons 30×30, filter/dig-chip controls ~24–36px
tall, wallet-card Refresh/⋯ 38px, TokenSelect options ~42px. Recommendation:
one dedicated pass in AA2 raising shared control heights at `<sm` rather than
per-view tweaks.

## 5. Campaign-live / campaign-ended matrix (the 2026-08-17 incident class)

Verified both ways locally (api env flip, web untouched):

| Surface | Campaign LIVE | Campaign ENDED |
|---|---|---|
| Dashboard promo banner | Renders: LIMITED REWARD card, live countdown ("Ends in 48:33:18"), 60/60 progress, Swap/Supply CTAs — fits at 390/768/1024 | Banner fully absent; dashboard reflows cleanly, no gap artifact |
| Blend widget promo note | "Earn 5 XLM …" note above an **intact, complete supply form** (`390x844/action-blend-live.png`) | Note absent, **form still complete** (`390x844/action-blend-ended.png`) |
| Swap widget note | Testnet-only note + form unaffected | Same, minus promo |

The v-if/v-else regression class that caused the 2026-08-17 incident **does not
currently reproduce in either state** — good baseline to protect through AA2/AA3.

**Not reproduced (honest gap):** `FaucetClaimPanel` post-action states
(`checking / witness-failed / eligible / claiming / paid / ineligible` + the
cross-family hint). They mount only inside a widget's success block after a
real signed tx. Layout risk is low (narrow flex column of 12px text), but the
AA3 gate explicitly requires reproducing them before any merge touching that
render path — plan: one real testnet action (or a throwaway local harness) at
AA3 time, not during read-only recon.

## 6. Console errors

Zero console errors across all views/viewports/states, with one exception:
`GET /v1/actions/blend/position` → 403 inside the Blend ActionModal, every
viewport. **Local-env artifact**: my api process ran without the
`ACTIONS_MAINNET_*` flags (VPS sets them). Not a mobile or layout finding; no
action for Lot AA.

## 7. What is explicitly fine (don't spend the lot on it)

- 768×1024 and 1024×768: everything usable today; only the generic polish items
  above apply. AA1's `lg` breakpoint choice (sidebar visible at 1024) matches
  what the captures show.
- Pool detail at 390 (shell aside): stats grid stacks, chart + axis + footnote
  legible, Alert / Supply-Withdraw CTAs well sized.
- Modal teleports (H1) behave — overlays cover the full viewport at every size;
  no transformed-ancestor clipping seen.
- Freshness chips (STALE everywhere in this dataset) wrap cleanly at 390 on all
  surfaces.

## 8. Founder arbitration list (AA2 gate — decide per surface)

1. Pools table at phone width: sticky-col h-scroll (default) vs column swap vs
   cards — §3 Protocols.
2. Card strips (protocol cards, stat tiles, portfolio wallet cards): keep
   horizontal peek-strips vs stack to single column — §3.
3. Alerts feed header: proposed stack (title row / chips row / full-width New
   rule) — confirm.
4. Touch-target pass as one shared-controls change in AA2 — confirm approach.
5. Hero TVL curve at 390: accept sparse rendering while history accrues, or
   add a min-bar-width/area fill tweak in AA2.
