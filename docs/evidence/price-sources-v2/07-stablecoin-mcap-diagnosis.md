# `stableMcapUsd` halved between 2026-09-29 and 2026-10-15 — read-only diagnosis

Observation (founder, `/v1/network/stats`): `stableMcapUsd` 945 741 273 on 2026-09-29 →
**460 991 127** on 2026-10-15 14:50Z, while `usdcSupplyUsd` reads 444 201 061. Nothing was
modified; every figure below was read on 2026-10-15 from the workstation.

**Conclusion.** The **current value (461.0 M) is the consistent one**: it equals the sum of
DefiLlama's per-coin Stellar figures (USDC 434.3 M + YLDS 25.2 M + small USD stables) and sits
next to `usdcSupplyUsd` 444.2 M from an independent source (stellar.expert). It is the **old
value (~945 M) that was inflated about ×2 by the source** — DefiLlama has since corrected its
Stellar series retroactively (its own history now reads 398.6 M for 2026-09-29). Nothing in
our pipeline changed on that path.

## 1. Where the number comes from

Step 9 (`apps/indexer/src/scripts/ingest/73-network-stats-refresh.ts`, `safeGetStableMcap`)
does one GET on **DefiLlama** `https://stablecoins.llama.fi/stablecoinchains`, picks the row
`name === 'Stellar'` and stores `totalCirculatingUSD.peggedUSD` as is (no transformation, no
aggregation of ours). `usdcSupplyUsd` comes from a different source (stellar.expert, the USDC
issuer's supply). The API serves the stored row (`network_stats_latest`) without touching it.

## 2. What the source says today

Live `stablecoinchains`, Stellar row (14:5xZ):
```
{"totalCirculatingUSD":{"peggedUSD":460991127.27527964,"peggedEUR":22621626.39,"peggedJPY":211709.50,"peggedCHF":3573.82,"peggedAUD":1924838.39},"name":"Stellar"}
```
= exactly the value we serve. Per-coin breakdown (`/stablecoins`, `chainCirculating.Stellar`,
USD-pegged only):

| Coin | Stellar circulating (USD) |
|---|---|
| USDC | 434 284 430 |
| YLDS (Figure) | 25 223 617 |
| USDV (Valtorum) | 1 100 000 |
| USDGLO | 252 633 |
| ZUSD | 110 139 |
| **sum** | **460 970 820** |

The sum of the per-coin figures reproduces the chain total: today's number is **complete and
internally consistent** on DefiLlama's side (USDC 434 M vs stellar.expert 444 M is the usual
few-percent gap between DefiLlama's circulating definition and the raw issued supply).

## 3. What happened to the 945 M

DefiLlama's own daily history of the Stellar chain (`/stablecoincharts/Stellar`), **as
restated today**, reads 398.6 M for 2026-09-29 (and 349–427 M across the whole window
2026-09-21 → 10-14, 456 M on 10-15):

```
2026-09-28 401451020   2026-09-29 398569569   2026-09-30 404638533   2026-10-01 426818635
2026-10-02 423174431   2026-10-03 372933772   …   2026-10-14 424241202   2026-10-15 456105253
```

Yet on 2026-09-29 the live endpoint returned 945.7 M to prod and **937.7 M to the local run at
15:45Z** (`network_stats_latest` in the local DB: `stable_mcap_usd 937741273.84`, `usdc_supply
382336827.66`). So the number did not halve: **DefiLlama restated its Stellar series by about
−540 M** some time after 2026-09-29, and its history was rewritten accordingly. The per-coin
histories available today (USDC, YLDS, SBC) show no such amount on Stellar at any date, which
is consistent with a mis-attributed coin (or a double count) having been removed from the
chain retroactively; the restated data no longer carries its trace, no Wayback snapshot of
the endpoint exists around 2026-09-29, and DefiLlama publishes no changelog for it. The exact
coin cannot be named from public data.

Ruled out: a change in our code on that path (none since Lot G), a partial response (the
per-coin sum matches), a unit or peg-type mix-up (we read `peggedUSD` only; EUR / JPY / CHF /
AUD pegs are separate keys).

## 4. Follow-ups (no change tonight)

(a) **Next lot**: label the dashboard tile with its source — "Stablecoins on Stellar
(DefiLlama)" — so the reader knows whose definition the figure is.
(b) **Later, not now**: compute the Stellar USD-pegged sum from DefiLlama's per-coin rows
(`/stablecoins`, `chainCirculating.Stellar`) and store the composition in
`network_stats_latest.metadata`; add a restatement guard (> 25 % run-over-run → log + a
counter on the `#status` "Price sources" line, value still served). No SQL.
(c) **Tomorrow, with the TVL correction note**: every published mention of a ~900 M+
stablecoin figure must be corrected (the source inflated it ×2). Search of `docs/` on
2026-10-15, nothing modified — see §5.

## 5. Published mentions of the inflated figure (`docs/`, read-only search)

Searched on 2026-10-15 (`grep` over `docs/**/*.md`): the field names `stableMcapUsd` /
`stable_mcap`, any nine-digit figure starting with 9, and "stablecoin(s)" next to an M / B
amount. **No committed document quotes the inflated figure** (the only nine-digit hit is an
unrelated balance in `docs/evidence/lot-h/h6-position-breakdown-2026-08-13.md:70`). The
figure was only ever served live, never written into a grant document or an evidence file.

The one user-facing surface is the dashboard tile:
- `apps/web/src/components/views/DashboardView.vue:96` — `{ label: 'Stablecoin MCap', value:
  formatUsd(netRaw.value.stableMcapUsd), delta: 'live' }` (and the composable
  `apps/web/src/composables/useNetworkStats.ts:128-129`): the tile showed ~$945 M from the
  source between 2026-09-29 and the restatement, and shows $461 M now. Follow-up (a) relabels
  it with its source; nothing to correct in `docs/`.
