# H0 — Flows recon report (read-only, 2026-08-12)

Recon for the permanent-$0 "Inflows & outflows" section on pool detail.
DB used: local docker-compose Postgres (`postgresql://dig:dig@localhost:5432/dig_stellar`) —
`apps/api/.env` points at it; no remote `DATABASE_URL` exists in the repo's env files.

## 1 · Per-venue event coverage (`normalized_events`, 139,909 rows total)

| Protocol | Event key | Rows | Range | Last 7d |
|---|---|---|---|---|
| Aquarius (4 pools) | `AquariusPool:trade` | 62,779 | 2026-03-20 → 2026-08-09 | 2,830 |
| Aquarius | `AquariusPool:update_reserves` | 62,846 | same | 2,839 |
| Aquarius | **`AquariusPool:deposit_liquidity`** | **48** | 2026-03-20 → 2026-08-09 | 3 |
| Aquarius | **`AquariusPool:withdraw_liquidity`** | **45** | 2026-03-24 → 2026-08-06 | 6 |
| Aquarius | claim / rewards / config events | ~388 | — | — |
| Soroswap (2 pairs) | `SoroswapPair:swap` | 6,868 | 2026-03-19 → 2026-08-09 | 209 |
| Soroswap | `SoroswapPair:sync` | 6,868 | same | 209 |
| Soroswap | deposit / withdraw | **0** | — | — |
| Blend (`blend-fixed-pool` only) | `POOL:deposit` / `POOL:swap` / `POOL:exit_pool` | 39 / 23 / 2 | **2026-03-19 only** | 0 |
| Blend (other 3 pools) | any | **0** | — | — |
| stellar-native (60 pools) | any | **0** | — | — |
| DeFindex (3 vaults) | any | **0** | — | — |

The Blend rows are legacy (`metadata->>'source' = '28-blend-events-scaled'`, a one-day backfill
from a superseded script). The live `run-blend-pool-refresh.ts` has no event path — **Blend is
state-only, confirmed**.

## 2 · Suspicion 1 (Lot C hide rule): implemented and working — wrong predicate

- API coverage check: `apps/api/src/modules/stellar/stellar.service.ts:581-609` — covered =
  "≥1 deposit/withdraw-family event **ever**" (`FLOW_FAMILY_SQL`, lines 168-174: `event_key ilike
  '%deposit%' | '%withdraw%' | '%add_liquidity%' | '%remove_liquidity%' | '%exit_pool%'`).
- Frontend: `apps/web/src/components/views/PoolDetailView.vue:524` — `v-if="flows && flows.covered"`;
  `usePoolDetail.ts:51-53` hides on fetch failure.

66 of 73 pools correctly hide the section. The permanent-$0 appears on exactly **5 pools**:
the 4 Aquarius pools + `blend-fixed-pool`. Two failure modes:

**(a) Aquarius — covered=true, USD structurally 0.** All 93 liquidity rows have NULL
`token_in/out_asset_id` and `token_amount_in/out_scaled` (verified). The aggregation
(`stellar.service.ts:627-630`, `greatest(coalesce(in×price,0), coalesce(out×price,0))`)
therefore yields $0 for every event. Reproduced the exact API SQL for
`aquarius-native-usdc-pool` / 30d: correct day buckets, correct event counts, `usd = 0` on all.
Cause: `apps/indexer/src/lib/protocols/aquarius/normalize-pool-events.ts:144-158` only extracts
amounts for `trade`/`update_reserves`; every other event name falls through with the all-null
template and is persisted anyway. Amounts existed in the raw `decodedValue` but are dropped and
not kept in `metadata` — existing rows are unrepairable; only re-ingest within RPC retention.

**(b) blend-fixed-pool — covered=true from stale legacy data.** All 41 flow-family events are
from 2026-03-19, outside every 24h/7d/30d window → $0 forever. Bonus: `usePoolDetail.ts:38-39`
defaults pool detail to the highest-TVL Blend pool — this stale-covered pool is the first thing
anyone sees, explaining the "every pool shows $0" perception.

## 3 · Suspicion 2 (Soroswap swap-only): refuted on fetch, confirmed on normalize

`fetch-pair-events.ts:78-88` filters by contract only (no topic filter) — liquidity events WOULD
be fetched and persisted (idempotent `on conflict (contract_address, event_id) do nothing`).
Zero rows simply means none occurred in the ingestion windows since March (plausible — even the
busiest Aquarius pool saw 23 deposits in 5 months). But `normalize-pair-events.ts:81-106` only
extracts amounts for `swap`/`sync`: a liquidity event landing today would persist with NULL
amounts — the same $0 bug as Aquarius.

## 4 · H4 scope verdict

- **Scope 1 (hide rule) — needed as a refinement, not a build.** Predicate is too loose:
  require ≥1 flow event with computable USD (non-null amounts), and/or a recent horizon.
  That alone hides `blend-fixed-pool` (stale legacy) and Aquarius (until scope 3 lands).
  Purging/excluding the legacy `28-blend-events-scaled` rows also fixes the Blend case.
- **Scope 2 (aggregation fix) — not applicable.** Family classification, window binding, and
  pool→event mapping (`entity_id`) all check out; the query is correct — its inputs are NULL.
- **Scope 3 (normalizer extension) — the confirmed root cause and the real fix. Sized BELOW
  half a day.** Add `deposit_liquidity`/`withdraw_liquidity` branches to the Aquarius
  normalizer and `deposit`/`withdraw` to Soroswap's. Reusable as-is: `scale()` helper,
  pool-state decimals, idempotent persist, asset-id mapping keyed off `tokenIn`/`tokenOut`
  (set in the normalizer; no persist or API changes). Real work = confirming each liquidity
  event's `decodedValue` shape (both-legs events: store leg-0 as `in`, leg-1 as `out` — the
  API's max-of-legs already tolerates it). Caveats: no backfill beyond `getEvents` retention
  (~7 days); existing NULL rows stay NULL, so the scope-1 predicate must ignore amount-less
  rows or the $0 window returns. Honest-window copy per the bridge precedent.

Key files: `stellar.service.ts:150-174, 567-709` · `PoolDetailView.vue:265-267, 300-306,
522-585` · `usePoolDetail.ts:45-57` · `apps/web/src/api/pools.ts:23-30` ·
`aquarius/normalize-pool-events.ts:144-158` · `soroswap/normalize-pair-events.ts:81-106` ·
`soroswap/fetch-pair-events.ts:78-88`.
