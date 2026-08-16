# Lot N — N3 Evidence: POOL TVL-DROP alerts (2026-08-15)

Builds + tests green: **api 78/78** (71 + 7 new N3 specs), **web 111/111**, both
builds clean. Live smoke passed (fire → cooldown → resolve on synthetic 24h
batches; honest stale-skip on real stale data). Working tree = N3-only diff
(N1+N2 founder-committed as 0345f3c / 741175a).

## Backend

- **Family**: `tvl_drop_pct` — user rule: pool (required `pool_entity_id`) +
  drop threshold % over a ~24h window. Metric CHECK widened (additive SQL,
  applied locally — **VPS re-apply covers N1+N2+N3 in one `psql -f`**). Edge
  state reuses `alert_rule_subject_state` (subject = pool entity id). No new
  tables.
- **Observed value** = drop % between the latest complete `reserve_snapshots`
  batch and the batch closest to 24h before it (positive = fell). The pure
  `evaluate()` machine is reused unchanged: fires on crossing (operator gte),
  cooldown prevents re-fire, resolves when back within threshold.
- **Evaluator source per the N0 decision**: complete batches only (atomic per
  snapshot_at since the dead-reserves fix), TVL formula **mirrors
  `compute-pool-metrics.ts`** — lending pools: supplied = `b_supply_scaled`;
  AMM pools: reserve = `d_supply_scaled` (verified against the writers). NOT
  the `/series` logic. Both batches valued with the same latest price per
  asset, so the ratio isolates real liquidity movement at current valuation.
- **Honesty guards** (all verified live):
  - previous batch must sit 12–36h behind the latest (young history → skip,
    never a fake "24h" claim);
  - latest batch older than 24h (stale pipeline) → skip, logged;
  - the copy carries the ACTUAL window hours and the batch `as_of`.
- **Validation**: pool required; wallet/asset must be null; operator restricted
  to gt/gte; threshold must be > 0 (an lt or 0 threshold would breach
  permanently on a stable pool). Enforced on create AND merged-patch.
- **New endpoint**: `GET /v1/alert-rules/tvl-pools` — vetted target list =
  active entities with reserve-batch history in the last 7 days (10 today:
  Blend ×4, Aquarius ×4, Soroswap ×2 — stellar-native excluded naturally, it
  writes no reserve batches).
- **Copy** (brief format): fired "Blend Fixed TVL −15.0% over 24h
  ($182.2M → $154.9M) — as of 16:46 UTC."; resolved "…back within your 10%
  threshold: −3.0% over 24h…". Payload carries machine-grade drop/threshold/TVLs
  /windowHours/asOf + pool-page route hint.

## Web

- Venue scope's **TVL delta is now creatable**; targets = the REAL vetted pool
  list from `/tvl-pools` (the hardcoded sample pools are gone — no more
  decorative fakes); honest empty state if the list is empty.
- TVL condition wording is one-directional and honest: single operator "drops
  by more than" X% (backend gte), default threshold 10%.
- Rules list renders TVL rules ("Blend Fixed · TVL drop",
  `tvl_drop ≥ 10% / 24h · Blend Fixed`); feed maps `tvl_drop_pct` fires to
  warning severity under the Critical filter, trend icon, pool deep-link.

## Live smoke (local stack)

1. `GET /v1/alert-rules/tvl-pools` → 10 pools, native absent.
2. Create rule (Fixed, gte 10%) → ok; missing pool / lt operator / zero
   threshold → three distinct 400s.
3. Run on REAL stale local data (latest batch >24h old) → **skipped with a
   stale warning, no fire** — the honesty guard in action.
4. Synthetic batches (baseline 24h ago; "now" at −15%) → **fired**:
   "Blend Fixed TVL −15.0% over 24h ($182.2M → $154.9M) — as of 16:46 UTC."
5. Re-run → silent (edge state held).
6. Recovery batch (−3% vs baseline) → **resolved**: "back within your 10%
   threshold: −3.0% over 24h ($182.2M → $176.7M)".
7. Synthetic rows deleted (metadata marker), smoke rule deleted, subject state
   cascaded to 0.

## Notes

- Blend TVL here = total supplied (b_supply × price), consistent with
  `compute-pool-metrics`; the `/series` d_supply flag from N0 remains open,
  untouched.
- Deploy: VPS psql re-apply + API build/restart + web deploy; no cron change.
