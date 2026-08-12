# G4 — Phase 1 recon: can we honestly reconstruct 7d network TVL? — T3-D3

Read-only investigation. **No G4 code.** Answers the two questions the brief posed
(snapshot retention + price-history reality) and gives a build verdict.

Data below is from the **local dev DB** (newest point 2026-08-09 — local cron isn't
running, so it's stale). The *cadence/freshness* numbers are local artifacts; the
**structural findings** (which venues have historized reserves) are schema-level and
hold in prod. A prod re-check of per-venue `reserve_snapshots` coverage is recommended
before building, but it cannot change the verdict without a new pipeline (see below).

## Q1 — Do reserve_snapshots / pool_snapshots cover 7+ days, for all 5 venues?

`reserve_snapshots` (per-asset scaled supply — the only table from which TVL can be
recomputed as `d_supply_scaled × price`):

```
venue     rows  span            distinct-days
blend     630   143 days        18
aquarius   10   25 min          1     (one-off March run)
soroswap    4   2.5 min         1     (one-off March run)
stellar-native  — not present —
defindex        — not present —
```

`pool_snapshots` holds **event counts** (`total_swaps`, `total_deposits`, `unique_callers`…)
— **no liquidity/TVL/reserve columns**. It cannot reconstruct TVL for any venue:

```
blend 143d/18d · stellar-native 66d/13d · defindex 7d/5d · aquarius 1d · soroswap 1d
```

→ Only **Blend** has a real multi-day reserve history. AMMs (Soroswap/Aquarius), native,
and DeFindex do **not** store historized reserves anywhere — their `tvl_usd` lives only
in `pool_metrics_latest`, which is **latest-only, overwritten every refresh cycle**.

## Q2 — Is asset price history available at snapshot times?

**Yes — `asset_prices` is historized**, not latest-only:

```
unique(asset_id, source, observed_at)
553 rows · 59 distinct timestamps · 12 assets · 143-day span · ~1 point per refresh cycle
```

Every asset carries ~57–59 historical points over the window. So past prices exist —
but at **cron cadence, not hourly**, and gappy.

## Verdict — full 7d reconstruction is NOT viable

- **Blend**: reconstructable (has historized reserves + prices), but only at irregular
  cron cadence (18 distinct days / 143), not a clean hourly curve.
- **Soroswap, Aquarius, stellar-native, DeFindex**: **not reconstructable** — no
  historized liquidity; latest-only TVL, overwritten each cycle.

A curve built from Blend alone would be labelled "network TVL" while representing 1 of 5
venues (Blend is a minority of the ~$232M total) — **dishonest as a network figure**.
There is no historized-reserves pipeline for the other four, and building one is out of
this lot's scope.

## Recommendation for G4 Phase 2

Serve `GET /v1/network/tvl-series` **from `network_tvl_snapshots` (G0)** — the honest,
whole-network figure captured once per refresh cycle from `sum(protocol_metrics_latest.tvl_usd)`.
The hero renders the brief's honest note **"building history since &lt;first G0 snapshot date&gt;"**;
the curve grows forward from G0's prod deploy. Gaps between cron ticks stay gaps
(never interpolated). This is exactly the fallback the brief anticipated (lot brief lines 99–101),
and it is now the recommended path — not a degraded one.

`meta.source` on the payload should therefore be `snapshots` (not `reconstructed`).
Bucket granularity = the refresh cadence; if prod cron is ~hourly the 7d window fills in
a week, if coarser the note keeps it honest. The big TVL number stays authoritative from
`/v1/network/stats`.
