# Hotfix — Live reserve-snapshot writer for Soroswap & Aquarius (data accuracy)

Execution brief for Claude Code. Fixes the **frozen-TVL bug** found by the Lot E
fresh-clone proof (see `docs/evidence/lot-e/README.md`, "KNOWN ISSUE"): the Soroswap and
Aquarius metrics steps READ `reserve_snapshots`, but nothing on the live refresh path
writes those rows — production has computed their reserve TVL from **2026-03-19 reserve
amounts × live prices** ever since. This corrects displayed product data, so it outranks
every remaining polish item. Written 2026-08-13. Evidence: `docs/evidence/lot-e/`
(append a `hotfix-` note there — it closes the known issue that file opened).

## The fix (small by design — the data is already fetched)

Both venues' state fetchers ALREADY read live reserves every cycle
(`soroswap/fetch-pair-state.ts` → `get_reserves`; `aquarius/fetch-pool-state.ts` →
`get_reserves` + `get_tokens`) — the backfill logs show them. The gap is purely that no
persist step writes them to `reserve_snapshots`. Add that write:

1. In each venue's refresh path (`run-soroswap-pair-refresh.ts` /
   `run-aquarius-pool-refresh.ts` or their persist modules — follow where pool state
   lands today), persist one `reserve_snapshots` row per (entity, asset) per cycle from
   the just-fetched live reserves, mirroring how the Blend adapter writes its snapshots
   (same table, same conventions: raw + scaled amounts, decimals, `snapshot_at`).
2. The metrics computation must use the LATEST snapshot (verify it already does — if it
   pins the March row by any ordering quirk, fix the read to `order by snapshot_at desc
   limit 1` semantics).
3. Storage sanity: one row per asset per 15-min cycle across ~5 pools is trivial volume;
   note the retention question in the report (no pruning needed now — G4 recon showed
   Blend already accumulates 143d of history harmlessly, and pool-level history is
   exactly what the "Building history" charts want).

## Validation (the point of this hotfix is CORRECTNESS — prove it)

- Run the two refreshes locally; confirm fresh `reserve_snapshots` rows appear for every
  Soroswap/Aquarius pool with today's `snapshot_at`.
- **Cross-check the recomputed TVL against the venues' own UIs** (app.aquarius.finance
  pool pages / Soroswap analytics) — the numbers must land within normal price-movement
  tolerance. Record the before/after TVL per pool in the evidence note: the delta IS the
  measure of how wrong the frozen values were.
- Confirm knock-on consumers still behave: pool detail reserve bars, protocol totals,
  `network_tvl_snapshots` (the hero TVL will step-change if the frozen values were off —
  that visible step is honest and expected; note the date in the evidence).
- Builds green; existing tests green; `bootstrap:export` re-run afterwards so the
  committed core-registry carries current reserves for future fresh clones (and remove /
  demote the seed's reserve-snapshot section if the live writer makes it redundant —
  keep seeding ONLY what the first refresh cannot produce by itself).

## Out of scope

Any UI change · pruning/retention policy · other venues (Blend/native/DeFindex already
write or don't need snapshots) · the pool-level series endpoints (they'll simply start
seeing real points).
