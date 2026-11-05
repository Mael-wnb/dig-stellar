# Lot B — Freshness System + DeFindex (T3-D1) — Evidence

Captured 2026-08-02 against a full local `job:refresh` on real Mainnet data. Serves
**T3-D1 — Mainnet Deployment & Freshness Tracking**.

## Definition-of-done status

| DoD item | Result |
|---|---|
| `pnpm -C apps/web test` | ✅ 23 passed (2 files) |
| `pnpm -C apps/web build` | ✅ green (vue-tsc + vite) |
| `pnpm -C apps/api build` | ✅ green (nest build) |
| `job:refresh` clean locally | ✅ exit 0 (`job-refresh-full.log`) |
| `/v1/protocols`: 5 protocols incl. `defindex`, non-null TVL, advancing `as_of`, `isStale=false` | ✅ see below |
| UI: freshness chip + stale badges (steady + forced-stale) | ✅ `FreshnessChip.vue` + `ProtocolTabs`/`PoolDetail`; drill below |
| Retry helper exercised + wired for every step | ✅ `retry-backoff-demo.log`; wired in `71-refresh-all-metrics.ts` |
| Docs updated (runbooks freshness + retry + drill) | ✅ `docs/runbooks.md` |

## B2 — DeFindex in the v1 pipeline

Vaults enumerated from `GET https://api.defindex.io/vault/discover?network=mainnet` (Bearer auth),
cross-checked with `GET /vault/{address}`. Seeded 3 (non-trivial TVL, real APY, +1 EURC for diversity):

| Entity | Vault | Underlying | TVL (post-refresh) | APY |
|---|---|---|---:|---:|
| `defindex-meru-usdc` | `CCA2ZJP5…F5HR` (Meru) | USDC | $17,902,060 | 7.15% |
| `defindex-beans-usdc` | `CBNKCU3H…B2S3` (Beans USDC) | USDC | $506,153 | 6.54% |
| `defindex-beans-eurc` | `CAIZ3NMN…K5OI` (Beans EURC) | EURC | $200,449 | 4.90% |

Post-refresh `/v1/protocols` (advancing `as_of` 2026-08-02T20:54, all `isStale=false`):

```
aquarius         tvl=$ 20,501,302  isStale=false
blend            tvl=$178,740,863  isStale=false
defindex         tvl=$ 18,608,662  isStale=false   ← NEW (protocol-level aggregate of the 3 vaults)
soroswap         tvl=$    546,610  isStale=false
stellar-native   tvl=$  5,301,098  isStale=false
```
`/v1/network/stats`: **protocolCount = 5**, `isStale=false`.

`job:refresh` log shows step **6b. Refresh DeFindex vaults + metrics** running all 3 vaults inside
the chain, then step 7 folding them into `protocol_metrics_latest` — see `job-refresh-full.log`.

**Venue-driven verification:** the only hardcoded list-of-4 was `70-protocol-persist-metrics.ts`
(added `'defindex'`). `protocolCount` is a dynamic `count(*)` over `protocol_metrics_latest`; the API
(`/v1/protocols`, `/v1/pools`) and web (`useProtocol` derives protocols from pools; `PROTOCOL_META`
already had `defindex` + logo) are venue-driven — no other change needed.

## B1 — Freshness

- **Steady state** (`freshness-steady-state.txt`): every protocol/pool payload carries
  `isStale=false` + `staleAfterSeconds=2700` (45m) in normal operation.
- **Forced-stale drill** (`freshness-forced-stale.txt`): the same real `as_of` rows evaluated by the
  API's `computeFreshness` helper flip `isStale=false → true` when the threshold drops from 45m to
  ~1.2s — the read-time flip that drives the amber UI chip/badges. (Unit-level, no server restart;
  the equivalent restart-based drill is in `runbooks.md`.)
- **Retry backoff** (`retry-backoff-demo.log`): a flaky step driven through the real
  `runTsxWithRetry` — attempt 1 fails → backoff 1350ms → attempt 2 fails → backoff 4200ms (×4 +
  jitter) → attempt 3 succeeds → "step recovered; refresh chain continues".
- The real `job:refresh` needed **0 retries** (all steps succeeded first try — expected on a healthy run).

## Files

- `job-refresh-full.log` — full local `job:refresh` output (exit 0).
- `freshness-steady-state.txt` — `/v1/protocols` + `/v1/pools?protocol=defindex`, steady state.
- `freshness-forced-stale.txt` — forced-stale drill (isStale flip).
- `retry-backoff-demo.log` — retry helper exercised (fail → backoff → recover).
