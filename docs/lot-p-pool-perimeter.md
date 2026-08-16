# Lot P — Pool Perimeter Expansion (Aquarius + Soroswap top pools)

Execution brief for Claude Code. Founder decision 2026-08-16: the indexed AMM
perimeter (~4 Aquarius + 1–2 Soroswap pools) reads as thin for a mainnet launch —
a product that claims DeFi analytics and lists ten pools does not look finished.
Expand to the venues' top pools by TVL while keeping the verification bar (the A2
rule) and the pricing honesty rule. NOT a money path — no action-path changes —
but this IS the data the whole product displays, so accuracy checks are
first-class. Evidence: `docs/evidence/lot-p/`.

## Why now / timing constraint

History builds from deploy: a pool added tonight has TVL/APY on its first refresh
(15 min), ~24h of chart history by tomorrow evening (the demo), and becomes
TVL-drop-alert eligible after 12–36h of batches. Every day of delay is a day of
history lost — this lot is genuinely deadline-sensitive, unlike most.

## Selection rules (the honesty gate)

- Candidate source: the venues' OWN APIs — `amm-api.aqua.network` for Aquarius,
  the Soroswap info API for Soroswap (both already used as cross-check sources in
  the frozen-TVL hotfix — reuse that access pattern).
- Include a pool IFF ALL of:
  1. TVL ≥ ~$50k on the venue's own figures (top-TVL first);
  2. EVERY asset in the pool exists in our `assets` table with a fresh price in
     `asset_prices` (≤ 7 days). A pool with one unpriced asset is EXCLUDED — a
     $0/"—" TVL reads as broken, which is the inverse of the problem we're fixing;
  3. the pool contract id is verified against the venue's own UI/API (A2 rule:
     unverifiable = excluded, never guessed).
- Cap: ~15 additions max this lot, top-TVL first, to bound refresh load. If the
  priced-asset filter leaves fewer, that IS the honest number — report the
  excluded pools with reasons (table: pool, TVL, excluding asset/cause).

## P0 — Inventory (report BEFORE seeding)

One table of candidates: venue · pool · assets · TVL (venue figure) · contract id
+ how it was verified · include/exclude + reason. Plus the current refresh
baseline duration (the step-summary numbers) for the before/after compare.
STOP-and-report — quick founder skim, continue on his go.

## P1 — Registry + seed

- Add the included pools through the Lot E bootstrap flow: `core-registry.json`
  stays the committed source of truth (`seed-core` / `registry-export` stay in
  sync — a fresh clone must get the new perimeter).
- `entities` rows: correct `venue_id`, `entity_type`, stable kebab slug, display
  name matching the venue's own naming, contract id, `is_active = true`.
- Logos: `seed-logos` where the assets already have them — no new logo sourcing.
- No SQL schema changes expected; if any turn out needed, additive per standard.

## P2 — Refresh validation (local first)

- Run the refresh chain; confirm each new pool produces reserve-snapshot batches
  (atomic per (entity, snapshot_at) — the dead-reserves invariant holds) and
  pool-metrics rows.
- Cross-check TVL per new pool vs the venue's own figure (~5% tolerance, same
  method as the frozen-TVL hotfix); document per pool in the evidence.
- Measure refresh duration before/after, per step. Budget: the total must stay
  comfortably inside the 15-min cadence (baseline ~177s). If the delta pushes the
  total past ~8 min, STOP and report rather than ship a cadence risk.
- Note anything unusual on memory (VPS is 1 vCPU / 1 GB); the writers are light
  HTTP + inserts, so nothing is expected.

## P3 — Product surface check

- Pools page: new pools render with honest states — TVL/APY where present,
  charts on the "building history since" pattern (G0), never fake backfill;
  nothing renders $0 for unpriced (should not occur given the selection rule).
- `/v1/alert-rules/tvl-pools` will reflect the new perimeter only after 12–36h of
  batches — SAY SO in the evidence, don't wait for it.
- Confirm no hardcoded pool lists remain anywhere in `apps/web` (the A5/N3
  sweeps removed the known ones — verify none regressed).

## Deploy

Indexer-only in the normal case: VPS pull + ONE seed run (document the exact
bootstrap command in evidence + runbooks) — the cron picks up the perimeter on
the next refresh. API restart only if API code changed; Vercel auto for web.
Post-deploy: `/v1/pools` count same evening; tvl-pools count + first charts the
next morning.

## Evidence — `docs/evidence/lot-p/`

Inventory table with per-pool verification · before/after pool counts per venue ·
TVL cross-check table · refresh timings before/after · excluded-pools table with
reasons. Docs flagged: `current-state.md` (§ perimeter), `status-board.md`
(T3-D1 note: perimeter widened), `runbooks.md` (seed command).

## Out of scope

New price sources / unpriced assets · new venues · DeFindex · stellar-native
pool modeling · any action-path change (Blend-only actions unchanged) · VPS
resize (separate op, founder-handled).
