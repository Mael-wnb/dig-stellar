# Dead reserves — TVL counted reserves the pools no longer have

Date: **2026-08-14**. Same discipline as the frozen-reserves hotfix (2026-08-13).
Found while building Lot A5 (`docs/evidence/lot-a5-blend-multipool.md` §1).

## The defect

Three pool-metric writers read `reserve_snapshots` with `distinct on (rs.asset_id)` — the
**latest row per asset** — so a reserve a pool had removed months ago kept contributing to TVL
forever. Its last row is still the newest row *for that asset*, even though it is absent from
every recent snapshot.

The API **read** path was already correct (it filters to the latest snapshot batch), which is why
the pool page contradicted itself: it listed Fixed's 3 live reserves next to a TVL computed over 6.

## §1 Atomicity — which filter is safe?

The filter choice depends on whether a pool's reserve rows are written as one complete batch.

**Per venue, from the code** (`lib/protocols/<venue>/persist-*.ts`):

| venue | one `snapshot_at` per pool per refresh? | wrapped in a transaction? |
|---|---|---|
| blend | ✅ `const snapshotAt = nowIso()` once, before the reserve loop | ❌ none (autocommit) |
| soroswap | ✅ same | ❌ none |
| aquarius | ✅ same | ❌ none |

There was **no `BEGIN`/`COMMIT` anywhere in the indexer**, and each persist function has exactly
one caller (`run-<venue>-*-refresh.ts`), so no outer transaction existed either.

**From the data**: every batch of every pool has a constant row count across its whole retained
history (Fixed 3, Orbit 4, Etherfuse 5, YieldBlox 8, all AMM pairs 2). **No partial batch has ever
occurred** — but nothing prevented one.

So: `snapshot_at` was already a reliable batch key, but batch *completeness* was observed, not
guaranteed. Strictly, the writes were **not atomic**.

### The decision

The brief's rule says non-atomic → use a recency window. I did something safer instead: **make the
writes atomic, then use the batch filter.**

Why not the recency window: it needs a cadence to size it against, and the cadence is not
dependable. Blend's median gap between refreshes is **26.7 min** but the p90 is **7.7 days**
(observed gaps: Aug 4 → 5 → 6 → 9 → 13). A window of "2 cycles" (~53 min) would collapse to the
batch filter after any real-world gap, and a window sized to survive those gaps (7+ days) would
keep counting a removed reserve for a week — i.e. either useless or sloppy, with a fuzzy constant
nobody can justify later.

Making the write atomic removes the reason to hedge: with an all-or-nothing batch, "latest
`snapshot_at`" *is* the pool's current reserve set, by construction rather than by luck.

## §2 The fix (all three writers together)

**Atomicity** — `BEGIN` / `COMMIT` / `ROLLBACK` around the reserve write in each of
`blend/persist-pool-state.ts`, `soroswap/persist-pair-reserves.ts`,
`aquarius/persist-pool-reserves.ts`. Venue/entity lookups and the contract-address precondition
were hoisted out (they are reads, not part of the batch).

**Batch filter** — the three readers now take the latest snapshot batch:

```sql
and rs.snapshot_at = (
  select max(rs2.snapshot_at) from reserve_snapshots rs2 where rs2.entity_id = rs.entity_id
)
```

- `lib/protocols/blend/compute-pool-metrics.ts`
- `scripts/ingest/66-soroswap-pool-metrics-v1.ts`
- `scripts/ingest/69-aquarius-persist-pool-metrics.ts`

No `distinct on (rs.asset_id)` reader remains in `apps/indexer` or `apps/api`.

### Atomicity proven, not assumed

A test injects a failure on the **2nd** reserve insert (a crash mid-batch) and checks the DB:

```
before: { batches: 6, rows: 12, latest: 2026-08-14 08:47:51.007+00 }
injected failure after 1 reserve row(s): simulated crash mid-batch
after : { batches: 6, rows: 12, latest: 2026-08-14 08:47:51.007+00 }
PASS — rolled back: no partial batch, latest snapshot_at unchanged
```

Mutation-tested — with the transaction removed (pre-fix behavior), the same injection leaves a
**1-row partial batch that becomes the latest `snapshot_at`**:

```
after : { batches: 7, rows: 13, latest: 2026-08-14 10:28:19.576+00 }
FAIL — a partial batch survived
```

That is precisely the undercount the batch filter would have caused on the old writers, and why
the transaction had to land in the same change. (Both test artifacts were deleted from the dev DB
and the pool re-refreshed; final integrity check below.)

## §3 Before / after

**Fix effect, isolated** — both queries run over the *same* current data, so market movement
cannot flatter the result:

| venue | pool | old query (per-asset) | new query (batch) | delta | dead reserves |
|---|---|---|---|---|---|
| blend | Fixed | $182,389,030 | $182,214,063 | **−$174,967** | CETES, TESOURO, USTRY |
| blend | Orbit | $285,976 | $190,769 | **−$95,207** | TESOURO, USDC |
| blend | YieldBlox | $3,136,988 | $3,136,988 | — | 0 |
| blend | Etherfuse | $163,846 | $163,846 | — | 0 |
| **blend** | **total** | | | **−$270,174** | |
| aquarius | all 4 pools | identical | identical | — | 0 |
| soroswap | both pairs | identical | identical | — | 0 |

Matches the Lot A5 prediction (−$270,173) to the dollar. Orbit's drop is **−33.3% of the old
number**, which is the same thing as removing the **+49.9% overcount** relative to the true value —
both figures describe the identical $95,207.

Aquarius and Soroswap are **byte-identical** old vs new: they had no dead reserves, so the change
is a no-op there today. They were still fixed in the same commit — leaving them on the buggy
pattern would desync the venues and the next removed AMM reserve would silently inflate TVL again.

**Stored metrics** (`pool_metrics_latest`, after re-running the real refresh for all 10 pools).
These include ~1 day of genuine market movement on top of the fix, so they do not equal the
isolated deltas above:

| venue | pool | before (2026-08-13) | after (2026-08-14) |
|---|---|---|---|
| blend | Fixed | $182,246,549 | $182,214,063 |
| blend | YieldBlox | $3,137,451 | $3,136,988 |
| blend | Orbit | $285,976 | **$190,769** |
| blend | Etherfuse | $163,465 | $163,846 |
| aquarius | (4 pools) | $28,671,040 | $28,431,324 |
| soroswap | (2 pairs) | $532,897 | $532,909 |

Protocol totals: **Blend $185,833,441 → $185,705,666**. Of that −$127,775, **−$270,174 is the fix**
and the remainder is a day of price/supply movement in the other direction.

**This drop is the number becoming true.** Like the +$8.57M step documented on 2026-08-13, the
2026-08-14 Blend step change of ≈ −$270k is a correction, not a loss of TVL, and any chart
spanning that date should be read with this note.

## §3b Cross-check against the venues' own sources

**Blend — live SDK read** (`PoolV2.load` + `PoolEstimate`, independent of our DB entirely):

| pool | ours (corrected) | Blend SDK | delta |
|---|---|---|---|
| Orbit | $190,769 | $190,767 | **+0.001%** |
| Etherfuse | $163,846 | $164,444 | −0.36% |
| Fixed | $182,214,063 | $188,811,582 | −3.49% |
| YieldBlox | $3,136,988 | $1,914,756 | **+63.8%** |

Orbit — the pool the fix changed most — now agrees with Blend's own read to **$2 on $190k**. That
is the strongest available confirmation that the corrected number is the true one.

**Aquarius — `amm-api.aqua.network`** (`liquidity_usd`, ÷1e7):

| pool | ours | aqua API | delta |
|---|---|---|---|
| native/USDC | $3,216,265 | $3,190,104 | +0.82% |
| PYUSD/USDC | $8,029,404 | $8,038,730 | −0.12% |
| xSolvBTC/SolvBTC | $10,522,722 | $10,581,118 | −0.55% |
| native/SolvBTC | $6,662,930 | $6,549,269 | +1.74% |

All within ±1.8% — expected drift between our price source and theirs.

### Separate discrepancy found, NOT fixed here

The Blend cross-check surfaces a **pre-existing, unrelated** gap on the two pools holding exotic
assets: **YieldBlox is +63.8%** vs the SDK and Fixed is −3.5%. Neither is caused by dead reserves
(both had 0), and neither moved in this change. The likely cause is our `asset_prices` source for
assets like AQUA / PYUSD / USDGLO / CETES / USTRY versus Blend's own oracle. Orbit and Etherfuse
matching closely shows the method and units are right, so this is a pricing-input issue, not a
formula one. **Worth its own lot** — flagged here so it is not mistaken for fallout from this fix.

## §4 The self-contradiction is gone

`GET /v1/pools/:slug`, reserves table vs the TVL on the same page:

| pool | reserves listed | Σ(supplied × price) | TVL shown | agreement |
|---|---|---|---|---|
| blend-fixed-pool | 3 — EURC, native, USDC | $182,214,063 | $182,214,063 | **+0.00%** |
| blend-orbit-pool | 4 — CETES, native, oUSD, USTRY | $190,769 | $190,769 | **+0.00%** |

Exact to the dollar. The page no longer lists 3 reserves beside a 6-asset TVL.

## Final integrity check

Every pool's latest batch equals its recent max batch size — no partial batch anywhere:

```
aquarius  (4 pools)  latest=2  recent_max=2
blend     Fixed 3/3 · Orbit 4/4 · Etherfuse 5/5 · YieldBlox 8/8
soroswap  (2 pairs)  latest=2  recent_max=2
```

## Verification

- `pnpm -C apps/api build` — green · `pnpm -C apps/api test` — 42/42
- `pnpm -C apps/web build` — green · `pnpm -C apps/web test` — 111/111
- `tsc --noEmit` on `apps/indexer` — no new errors (pre-existing `qa-reconcile.ts` +
  stellar-sdk `urijs` typing noise unchanged)
- Real refresh re-run for all 10 pools across the 3 venues; protocol metrics recomputed.

## Scope

Analytics read/write path only. No action path, validator, flag, schema or migration touched.
Historical `reserve_snapshots` rows are **kept** — a past batch was correct at its own time, so the
TVL history series (which groups by `snapshot_at`) stays honest; only "what is the pool's current
reserve set" changed.
