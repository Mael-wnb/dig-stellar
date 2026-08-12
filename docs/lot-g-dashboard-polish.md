# Lot G — Dashboard & Protocols Polish (T3-D3) — Implementation Brief

Execution brief for Claude Code. Serves **T3-D3 "Final UI polish based on Mainnet feedback"**
— this batch traces to the founder's product review of 2026-08-12 (dashboard hero redundancy,
dead testnet/mainnet section, bridge chain marks, protocols-page alignment, mixed-type pool
table, and the missing 7-day TVL curve on the first screen). Written 2026-08-12 against
current `main`; re-verify file states before editing. Evidence: `docs/evidence/lot-g/`.

## Non-negotiables (unchanged from Lot F)

- `validateSwapXdr.ts` / `validateDepositXdr.ts` and the pre-sign validation flow: UNTOUCHED.
- Flags regime (`ACTIONS_MAINNET_*`, `VITE_ACTIONS_MAINNET_*`): untouched. G2 relocates an
  entry point; it does not touch any gate.
- Honest display: 0 = measured zero, "—" = structurally N/A, never synthesize a curve or
  smooth over gaps. `apps/web` fetches only `/v1/*`.
- Each step lands green independently (`pnpm -C apps/web test` 49/49 + both builds) with a
  capture to `docs/evidence/lot-g/`.

## G0 — Start persisting network TVL NOW (ship first, alone, today)

History cannot be built after the fact — it accumulates. Whatever G4's recon concludes,
every refresh cycle from today onward must leave a TVL point behind:

- New table (raw-SQL additive migration, v1 pipeline style): `network_tvl_snapshots`
  (`as_of timestamptz not null`, `tvl_usd numeric not null`, `protocol_count int not null`,
  primary key or unique on `as_of`). Prisma untouched.
- Indexer: at the end of step 7 (protocol metrics) — same script or a tiny trailing step —
  insert one row: the sum over `protocol_metrics_latest.tvl_usd` (the exact figure the hero
  shows) + the venue count. Idempotent per run (upsert on `as_of` truncated to the minute).
- This is a ~30-line change. Commit + deploy it (VPS: pull, apply migration, next cron tick
  writes the first point) BEFORE starting G1 — the curve's clock starts when this lands.

## G1 — Quick wins (presentational)

1. **Bridge chain logos.** The bridge section renders source chains as letter monograms
   ("S" for SOL…). Add a small client-side chain map (slug → logo) rendered through
   `BrandLogo` (monogram fallback for unmapped chains — never a broken image). Check the
   actual chain codes present in `/v1/bridge/*` (SOL/POL/CEL/BAS observed) and cover those;
   prefer bundled SVGs, same sourcing discipline as the F3 seed (record sources in a comment).
2. **Clickable tx hashes.** Every rendered transaction hash (bridge recent-flows feed,
   activity/notifications feed, pool-detail flows — sweep for any hash rendered as plain
   text) becomes a link to stellar.expert, network-aware (the pattern already exists in the
   action widgets). External link affordance (icon or underline), `target="_blank"`.
3. **Protocols page card alignment.** The per-type summary cards (Blend / Aquarius / DeFindex
   / Native / Soroswap) have ragged metric rows. Normalize: identical card grid, exactly
   three metric slots per card with consistent label/value baselines —
   lending: TVL · Avg supply APY · Avg borrow APY; AMM: TVL · 24h vol · 24h fees;
   vault: TVL · Avg APY · pool count (or "—" for the third slot — pick one and keep the
   grid rigid). Same font/size/alignment across all cards.

## G2 — Dashboard cleanup (decision: remove + compact button)

1. **Hero dedupe.** The hero currently repeats XLM price, stablecoin mcap and protocol count
   that the four stat tiles below already show. The hero keeps: total TVL (big number),
   freshness chip, and the G4 chart slot. The duplicated stats are removed from the hero
   only — the four tiles stay as they are.
2. **Remove the inline testnet/mainnet actions section**, replaced by a compact
   "Swap / Deposit" button (hero or topbar — match the design language) that opens the
   existing `ActionModal`. Before deleting, VERIFY and note in the evidence:
   - a swap remains reachable in ≤ 2 clicks from the dashboard;
   - the ActionModal's own network toggle (Lot C QA fix) still covers the testnet path —
     the removed section was the only other toggle host on the dashboard, confirm nothing
     else depended on it;
   - testnet swap + deposit E2E unchanged (flags unset behavior byte-identical);
   - the get-started card and pool-detail action buttons still work (they already use the
     modal).

## G3 — All-pools table: adaptive columns per tab (decision)

Kill the half-dash rows. The protocol filter tabs drive the column set:

- **"All" tab** — generic, dense: Pool (PairLogo) · Protocol · TVL · **Key metric**
  (type-aware single column: lending → Supply APY, AMM → 24h vol, vault → APY; header
  reads "Key metric" with the per-row label inline or a subtle suffix) · chevron.
- **Protocol tab selected** — full type-specific columns:
  lending: TVL · Supply APY · Borrow APY · Utilization;
  AMM: TVL · 24h vol · 24h fees (+ 24h swaps if cheap);
  vault: TVL · APY.
- Sorting stays, N/A-aware (existing precedent from the per-type metrics work); the "All"
  key-metric column sorts within comparable types without pretending APY and volume compare.
- No API change expected — `/v1/pools` already carries everything.

## G4 — Network TVL 7-day chart in the hero (the flagship — recon first)

The first screen's centerpiece. Two phases, STOP between them:

**Phase 1 — recon (30 min, report before building anything).** Answer with evidence:
- Does `reserve_snapshots` / `pool_snapshots` retention actually cover 7+ days, for all
  5 venues or only some?
- Is asset price history available at snapshot times (is `asset_prices` historized or
  latest-only)? Without historical prices, past TVL cannot be honestly reconstructed.
- Conclusion: full 7d reconstruction viable / partial (some venues) / not viable.

**Phase 2 — build per the recon verdict:**
- Endpoint `GET /v1/network/tvl-series` (API is the façade; on-read aggregation, no new
  runtime external calls): hourly buckets over 7d, payload includes `meta` (source:
  `reconstructed` | `snapshots`, `from`, `to`). Gaps stay gaps — never interpolate across
  missing cycles, never smooth.
- If reconstruction is NOT viable: serve the series from `network_tvl_snapshots` (G0) and
  the UI renders the honest note **"building history since <first snapshot date>"** under
  the chart (Lot C precedent). The chart grows day by day — that is acceptable and honest.
- Web: hero chart in the design language (reuse the BridgeChart stack/pattern), 7d window,
  tooltip with date + TVL, freshness chip unchanged. The big TVL number stays authoritative
  from `/v1/network/stats`.

## Sequencing

**G0 first, alone, deployed today** (its value is calendar time). Then G1 → G2 → G3 → G4,
each step: builds + tests green, capture to `docs/evidence/lot-g/`, commit. G4 phase 1
(recon) can run early in parallel with G1 if convenient — but no G4 code before its recon
report is reviewed.

## Definition of done

- G0 writing one row per refresh cycle in prod (verify two consecutive cron ticks).
- Bridge chains show real logos with safe fallback; every visible tx hash links to
  stellar.expert (network-aware).
- Protocol cards aligned on a rigid 3-slot grid.
- Hero deduplicated; actions section replaced by the compact button with all entry-point
  checks documented; testnet E2E re-verified once.
- Pools table renders adaptive columns per tab, N/A-aware sorting, no half-dash rows.
- TVL chart live on the hero — either 7d reconstructed or honest "building history since"
  from G0 snapshots, per the recon verdict.
- Evidence folder populated (before/after captures per step + the G4 recon note).
- Docs sync flagged: `current-state.md` (frontend + API + indexer sections),
  `status-board.md` T3-D3 row.

## Out of scope

Asset/pool-detail page review (next batch, per the founder) · KPI work (Paul owns it) ·
advisor re-review (after this lot) · light mode · mobile pass · Lot E observability
(separate brief) · any gate/validator change.
