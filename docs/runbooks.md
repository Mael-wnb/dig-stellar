# Dig Stellar Runbooks

## Purpose
This document captures practical procedures used regularly during development and operations.

---

## Node version (read first)

The repo runs on **Node 24** (active LTS; Lot AC migration, 2026-08-21 — Node 20 hit upstream
EOL on 2026-04-30). A `.nvmrc` pinned to `24` lives at the repo root; `engines` floors every
workspace at `>=24` (web pins `24.x` for Vercel). Default is set via `nvm alias default 24`.
Before any build/dev command, ensure Node 24 is active:

```bash
export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh" && nvm use
```

After switching Node majors, always re-run a fresh `pnpm install`: native bindings
(`bufferutil`, `secp256k1`, `@rolldown/binding-*`, …) are compiled per Node ABI and must be
rebuilt for the active major.

---

## Local development

### Start frontend (`apps/web`)
```bash
export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh" && nvm use
pnpm -C apps/web dev      # Vite dev server, http://localhost:5173
pnpm -C apps/web build    # vue-tsc typecheck + vite build (must be on Node 24)
```

Frontend env (`apps/web/.env`):
```
VITE_API_BASE="http://localhost:3000"     # local API; prod = https://stellar-api.getdig.ai
VITE_STELLAR_NETWORK="PUBLIC"             # initial default only; the Mainnet/Testnet toggle is the
                                          # runtime source of truth (useNetwork → kit.setNetwork)
```

### Start API (`apps/api`)
```bash
pnpm -C apps/api start:dev    # NestJS, http://localhost:3000
pnpm -C apps/api build        # nest build
```
Restart `start:dev` after changing a service/module so the new code is loaded.

**Version stamp (E1, Lot E).** `GET /health` reports `version` from the `GIT_SHA` env var.
On the VPS, export it when (re)starting the API after a deploy so the running version is visible:
```bash
export GIT_SHA=$(git rev-parse --short HEAD)   # then: pm2 restart api --update-env
```
Unset, `/health` reports `"version": "unknown"`; that means the deploy procedure was skipped.

### Run indexer scripts (`apps/indexer`)
Runner is `tsx` (no build step).
```bash
# Full production refresh (canonical entry point): 72 → 71 → all per-protocol steps
pnpm -C apps/indexer job:refresh

# A single ingest step directly (example: network stats)
pnpm -C apps/indexer exec tsx src/scripts/ingest/73-network-stats-refresh.ts

# Bootstrap on a fresh database (E4, Lot E): seeds the WHOLE vetted perimeter
# (6 venues, all non-stellar-native entities, assets, links) from the committed
# registries/core-registry.json. Idempotent. Replaces the legacy per-protocol
# upserts below for first-time setup.
pnpm -C apps/indexer bootstrap:core
pnpm -C apps/indexer bootstrap:logos

# Regenerate the committed registry from a live DB (run on the source
# deployment after onboarding a new pool/vault, commit the JSON):
pnpm -C apps/indexer bootstrap:export

# Widening the AMM pool perimeter (Lot P procedure, Aug 2026): after a git pull
# that changes core-registry.json, ONE seed run picks up the new perimeter;
# the cron's next job:refresh does the rest (first cycle: reserve snapshots +
# metrics; derived soroswap prices follow on the SECOND cycle by design).
pnpm -C apps/indexer bootstrap:core && pnpm -C apps/indexer bootstrap:logos

# Legacy per-protocol upserts (kept for reference; their tmp/discovery registry
# inputs are ephemeral and no longer exist, so prefer bootstrap:core):
pnpm -C apps/indexer tsx src/scripts/bootstrap/defindex-upsert-core.ts   # T3-D1: venue 'defindex' + 3 mainnet vault entities
pnpm -C apps/indexer tsx src/scripts/bootstrap/allbridge-upsert-core.ts  # T2-D3: venue 'allbridge' + USDC asset
```

### Onboarding DeFindex vaults (T3-D1)

`defindex-upsert-core.ts` seeds the `defindex` venue + the selected mainnet vault entities
(`entity_type = 'yield_vault'`, `venue_type = 'vault'`) with their underlying asset (USDC/EURC SAC,
`role = 'underlying'`). The vault set is enumerated from DeFindex's own API:
`GET https://api.defindex.io/vault/discover?network=mainnet` (Bearer `DEFINDEX_API_KEY`), picking
non-trivial-TVL vaults with a real APY; addresses + seed-time evidence are in the bootstrap's header
comment. After seeding, `71-refresh-all-metrics` discovers them by DB query
(`entities join venues where v.slug='defindex' and is_active`) and refreshes each per cycle via
`run-defindex-refresh.ts` (SDK `getVaultInfo` → TVL from `totalManagedFunds`, priced through the
`asset_prices` pipeline; `getVaultAPY` → stored as a **fraction** in `weighted_supply_apy`). The step
is **non-fatal** and runs before step 7 so `70-protocol-persist-metrics` folds DeFindex into
`protocol_metrics_latest` (→ `/v1/protocols`, `protocolCount = 5`). Env: `DEFINDEX_API_KEY`,
`DEFINDEX_API_URL` (default `https://api.defindex.io`). `DEFINDEX_VAULTS` in `.env` is only for the
legacy Prisma `run:defindex` script; the live v1 path is DB-driven, not that var.

```bash
# Re-enumerate mainnet vaults (evidence / picking a new vault to seed)
curl -s "https://api.defindex.io/vault/discover?network=mainnet" -H "Authorization: Bearer $DEFINDEX_API_KEY" | jq .

# Refresh one vault directly (idempotent)
ENTITY_SLUG=defindex-meru-usdc \
DEFINDEX_VAULT_ADDRESS=CCA2ZJP5BVRXYTQH4FAGHCAUMRYCXVC4CRYC2NXHWMR7TIVX36U7F5HR \
  pnpm -C apps/indexer exec tsx src/scripts/ingest/run-defindex-refresh.ts
```

### Onboarding an additional Blend pool (the actual seed path)

`blend-upsert-core.ts` only seeds the **fixed** pool (from a generated discovery registry).
The other Blend entities (orbit, etherfuse, **yieldblox**) are seeded by running the pool refresh
**once** with the pool's contract id: `persistBlendPoolState` upserts the entity (`is_active = true`)
plus its reserves/assets read on-chain. After that, `71-refresh-all-metrics` discovers it by DB query
(`entities join venues where v.slug='blend' and is_active`) and keeps it fresh with no further action.

```bash
# Seed YieldBlox (idempotent; re-running just refreshes it)
ENTITY_SLUG=blend-yieldblox-pool \
BLEND_POOL_ID=CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS \
  pnpm -C apps/indexer exec tsx src/scripts/ingest/run-blend-pool-refresh.ts
```

The known active Blend pools are catalogued in `apps/indexer/src/config/stellar-targets.json`
(documentation only; no code reads it). **Forex** is listed there as `status: excluded` (frozen
oracle) and must never be seeded as active. After seeding, confirm any new reserve assets are priced
(`PRICING_RULES_BY_SYMBOL` in `scripts/shared/pricing-config.ts`); unpriced reserves show null/0 USD
but the health factor stays correct (it comes from Blend's on-chain Reflector oracle, not the price
pipeline). `BLEND_POOL_ID` in `.env` is only a default for the discovery/probe scripts (75/76).

### Wallet alert sweep (D2): periodic evaluator

The alerting engine runs as a periodic sweep (no broker, no in-process scheduler): one OS-cron
entry calls the orchestrator, which refreshes every active wallet's `wallet_pool_health` (script 81,
no `WALLET_ID` → all wallets) and then runs the pure evaluator (script 83, in `apps/api`), which
writes `notifications` on each fire/resolve edge.
```bash
# Canonical entry point (82 → 81 → 83):
pnpm -C apps/indexer job:wallet-alert
```
Example crontab (VPS): every 15 min, offset from `job:refresh` so they don't collide.
End-to-end alert latency ≈ this interval + the web's notification poll (~30-60s):
```cron
# m         h  dom mon dow  command
  7,22,37,52 *  *   *   *    export PATH=/root/.nvm/versions/node/v24.19.0/bin:$PATH && cd /root/dig-stellar && pnpm -C apps/indexer job:wallet-alert >> /var/log/dig/wallet-alert.log 2>&1
```
(Matches the real VPS crontab — repo at `/root/dig-stellar`, Node 24 tree exported because the
non-interactive cron PATH has an old node. An earlier version of this example showed
`/srv/dig-stellar`, which never matched the VPS.)
Prereq: `stellar_v3_alerting.sql` applied. A non-zero exit from the health refresh (81) aborts the
evaluator (83) for that run and logs; stale/half-written health rows are never evaluated.

---

## Database

### Connect with psql
```bash
psql "postgresql://dig:dig@localhost:5432/dig_stellar"
```

### Apply raw SQL schemas (manual; no migration runner for v1/v2)
The v1/v2 schemas are applied by hand. The DDL is idempotent (`create table if not exists`), so
re-running is safe.
```bash
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1.sql
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1_metrics.sql
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1_bridge.sql
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v2_multiwallet.sql
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v3_alerting.sql   # D2 alerting: alert_rules, alert_rule_state, notifications (depends on v1 entities + v2 user_wallets)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1_network_tvl.sql   # G0 (T3-D3): network_tvl_snapshots, one TVL point per refresh cycle (written at tail of step 7)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1_ops_metrics.sql   # E2 (Lot E, T3-D3): rpc_metrics_runs + refresh_step_runs, written at end of each job:refresh; R1 adds action_events.metadata (re-run once)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1_action_witness.sql # R1 (Lot R, T3-D2): action_witnesses, verified execution witnesses (apply BEFORE deploying the R1 api)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v4_faucet.sql   # R2 (Lot R, T3-D2): faucet_claims (money path, depends on action_witnesses); deploys dark (FAUCET_ENABLED unset)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v5_faucet_campaign2.sql # Lot R2: campaign 2, campaign/action_family columns + per-family uniqueness (apply BEFORE the campaign-2 api build)
```
Manually-applied schemas (local AND VPS): `stellar_v1.sql`, `stellar_v1_metrics.sql`,
`stellar_v1_bridge.sql` (Allbridge bridge flows, T2-D3), `stellar_v2_multiwallet.sql`,
`stellar_v3_alerting.sql` (D2 alerting; must be applied AFTER v1 + v2),
`stellar_v1_network_tvl.sql` (G0 network-TVL history, T3-D3),
`stellar_v1_ops_metrics.sql` (E2 ops observability, T3-D3; R1 added the
`action_events.metadata` column: re-run once BEFORE deploying the R1 api, or the
fire-and-forget adoption inserts start failing silently),
`stellar_v1_action_witness.sql` (R1 execution witnesses, T3-D2, Lot R).
Note: when a new table **or column** is added to one of these files (e.g. `network_stats_latest`
in `stellar_v1_metrics.sql`, `bridge_flows` in `stellar_v1_bridge.sql`, or the T2-D1
`is_active_signer` column + `user_wallets_one_signer_per_user` index, or the T2-D1 Gap B
`wallet_pool_health` table in `stellar_v2_multiwallet.sql`),
re-run that file once; the statements are idempotent (`add column if not exists`,
`create … if not exists`), so re-applying on local AND VPS is safe.

After applying `stellar_v1_bridge.sql`, run the Allbridge bootstrap once (creates the
`allbridge` venue + USDC asset) before the first refresh:
```bash
pnpm -C apps/indexer tsx src/scripts/bootstrap/allbridge-upsert-core.ts
```

### Useful checks
```bash
# Latest protocol metrics + freshness
psql "postgresql://dig:dig@localhost:5432/dig_stellar" \
  -c "select venue_id, tvl_usd, as_of from protocol_metrics_latest order by as_of desc;"

# Network stats (single 'global' row)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" \
  -c "select scope, as_of, xlm_price_usd, stellar_tvl_usd, usdc_supply_usd from network_stats_latest;"

# Wallets + latest balance snapshots
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -c "select * from user_wallets;"
psql "postgresql://dig:dig@localhost:5432/dig_stellar" \
  -c "select user_wallet_id, asset_symbol, balance_usd, snapshot_at from wallet_balance_snapshots order by snapshot_at desc limit 20;"
```

---

## Ops endpoints (Lot E, T3-D3)

Public read-only observability: no auth, and they must never leak secrets, env values or
internal URLs (targets/steps are fixed internal labels; `version` is the short GIT_SHA only).

- `GET /health`: enriched liveness with `status` (`ok` | `degraded`), `version` (GIT_SHA),
  `uptimeSeconds`, `db.ok`/`db.latencyMs`, per-venue `freshness` (same 45-min read-time rule as
  the product reads), `lastRefreshAt` (max `as_of` in `network_tvl_snapshots`). Always HTTP 200
  with a readable `status`: `degraded` when the DB errors or any venue is stale; HTTP 503 only
  when the DB itself is unreachable.
  **Known expected-dormant venue: `allbridge` (`asOf: null` / stale is NOT an indexer bug).**
  Allbridge Core has been paused since the 2026-07-20 Solana flash-loan exploit (~$1.65M, their
  second since 2023; LPs urged to withdraw; no relaunch announced as of 2026-08-20) — there are
  simply no bridge events to ingest. The dashboard bridge card frames this honestly as an
  upstream pause (self-clearing banner). If Allbridge relaunches, this note is the trigger to
  re-enable freshness expectations for the venue.
- `GET /v1/ops/metrics`: refresh-pipeline RPC latency + error rates over a 24h window, from
  `rpc_metrics_runs` / `refresh_step_runs` (written by 71 at end of each `job:refresh`).
  Error rate is aggregated (`sum(errors)/sum(calls)`, sound to aggregate); latency percentiles
  are strictly per-run (never averaged). Known boundary: captures the INDEXER's outbound calls;
  the API process's own Horizon calls (actions preflight) are not captured.
- `GET /v1/ops/adoption` (E3): adoption counters. Wallets tracked (total / signers / watch-only,
  distinct users, from `user_wallets`) + actions built by kind/network (24h/7d/total, from
  `action_events`, one row per successful server-side build) + distinct acting addresses.
  Honest boundary (stated in the payload): counts server-side BUILDS; on-chain submission is
  client-side (non-custodial), so executed-tx evidence stays the manual hash list. No backfill:
  counters start at deploy.

```bash
# Incident history, one query instead of grepping cron logs (E2):
psql "postgresql://dig:dig@localhost:5432/dig_stellar" \
  -c "select run_at, step, status, duration_ms, left(message, 80) from refresh_step_runs where status = 'FAILED' order by run_at desc limit 20;"
```

---

## Data freshness & retries (T3-D1)

**Freshness is computed at read time in the API**: no new indexer state. Every `/v1/*` payload that
carries an `as_of` (protocols, pools, pool detail, `/v1/network/stats`) also returns:
- `isStale: boolean | null`: `true` when `now − as_of` exceeds the threshold; `null` when `as_of`
  is unknown (no metrics row yet). `stale` is kept as a backward-compatible alias of `isStale`.
- `staleAfterSeconds: number`: the configured threshold, so the UI can label it ("older than 45m").

**Threshold:** `FRESHNESS_STALE_AFTER_MINUTES` (API env, default **45** = 3× the 15-min cron; one
missed cycle is tolerated, two is stale). Legacy `STALE_THRESHOLD_MINUTES` is honoured as a fallback.
Helper: `apps/api/src/common/freshness.ts` (env read per-call, so a drill needs no code change).

**UI:** a freshness chip on the Protocol View header ("Updated Xm ago" → amber "Stale: data older
than 45m" when the selected protocol has any stale pool), an amber "Stale" badge on stale protocol
tabs, and the chip on `PoolDetail` when a pool is stale (`FreshnessChip.vue`).

**Retries (indexer):** every step of `71-refresh-all-metrics` runs through
`runTsxWithRetry` (`scripts/shared/retry.ts`): 3 attempts, exponential backoff **5s → 20s** + jitter,
each retry logged with the step label (`[retry] <label> attempt N/3 failed; backing off Nms`).
Per-protocol-entity steps retry per entity. Steps that must stay non-fatal (Aquarius / DeFindex /
Allbridge / network-stats) keep their `try/catch`: retries happen INSIDE first, catch-and-log is
the last resort.

### Forced-stale drill (evidence)

Prove the read-time stale flip without pausing the cron:
```bash
# Set the threshold tiny and restart the API (PM2 re-reads env); the UI chip turns amber.
FRESHNESS_STALE_AFTER_MINUTES=1 pnpm -C apps/api start:dev   # or: pm2 restart api --update-env
curl -s http://localhost:3000/v1/protocols | jq '.[] | {id, isStale, staleAfterSeconds}'
# ...screenshot the amber "Stale" chip/badges, then restore (unset the env / pm2 restart) and re-screenshot recovery.
```
Unit-level equivalent (no restart), evaluating real `as_of` rows at two thresholds: see
`docs/evidence/lot-b/`.

---

## Network stats (`/v1/network/stats`)

DB-backed since this session. Flow: indexer step `73-network-stats-refresh` fetches the external
providers (CoinGecko / DefiLlama / stellar.expert / Horizon) and upserts a single row into
`network_stats_latest` (scope `'global'`); the API does a single SELECT. The step is wired
non-fatally into `job:refresh` (step 8), so a provider outage never breaks the whole refresh.

To refresh manually then verify:
```bash
pnpm -C apps/indexer exec tsx src/scripts/ingest/73-network-stats-refresh.ts
curl -s localhost:3000/v1/network/stats | jq
```
Known issue: `activeWallets` and `dexVolume24hUsd` come back `null`; the stellar.expert summary
endpoint returns 404 (pre-existing; needs a corrected endpoint). `updatedAt` is the row's `as_of`,
not request time.

---

## Smart Transaction Builder (T1-D3, Testnet)

End-to-end swap from the UI: connect Freighter (set the extension to **Test Net**), flip the
network toggle to **Testnet** → the "Testnet Actions" section shows the SDEX swap widget. The widget
calls `POST /v1/actions/sdex/swap` (multi-op XDR: `ChangeTrust` + `PathPaymentStrictSend`), signs
in-wallet via Stellar Wallets Kit, and submits to the Testnet RPC.

Test the backend endpoint directly:
```bash
curl -s -X POST http://localhost:3000/v1/actions/sdex/swap \
  -H "Content-Type: application/json" \
  -d '{"address":"G...","fromAsset":"XLM","toAsset":"USDC","amount":"10","minReceive":"0.1","network":"testnet"}' | jq
```
Notes:
- Swap is gated Testnet-only by default (disabled + notice on Mainnet). Mainnet is ungated via the
  controlled regime below (T3-D2, Lot A1); with the flags unset, behavior is exactly the above.
- On Testnet the swap op may fail with `pathPaymentStrictSendTooFewOffers`: no SDEX liquidity for
  the pair on Testnet, not a code bug (`ChangeTrust` op 1 still succeeds).
- Fund a Testnet account via Friendbot; sign with Freighter set to Test Net.

---

## Mainnet actions (T3-D2): gating regime

Ungating Mainnet actions is **not** removing the Testnet-only guard; it is replacing it with a
controlled regime. See `docs/security-invariants.md` §4 (the review checklist) and the implementation
briefs `docs/lot-a1-mainnet-swap.md` (swap) + `docs/lot-a2-blend-mainnet.md` (Blend deposit). The
**swap and the Blend deposit each have their OWN kill-switch**, so they ungate independently.

**Environment flags** (all default to today's Testnet-only behavior when unset):

| Var | App | Default | Effect |
|-----|-----|---------|--------|
| `ACTIONS_MAINNET_ENABLED` | api | unset → OFF | Swap kill-switch (INV-4.1). `"true"` lets `sdex/*` `network:"mainnet"` through; otherwise → **403**. |
| `ACTIONS_MAINNET_BLEND_ENABLED` | api | unset → OFF | Blend kill-switch (Lot A2), independent of the swap. `"true"` lets `blend/deposit`, `blend/withdraw` **and** `blend/position` `network:"mainnet"` through; otherwise → **403**. The withdraw (Lot A3) rides this same switch; there is no separate withdraw flag. |
| `ACTIONS_MAINNET_MAX_SEND_XLM` | api | `100` | Per-transaction cap (INV-4.2). Over-cap `sdex/swap` **and** `blend/deposit` → **400**. Deliberately **not** applied to `blend/withdraw` (INV-2.15). |
| `ACTIONS_MAINNET_RPC_URL` | api | `https://mainnet.sorobanrpc.com` | Soroban RPC override for the mainnet swap **and** Blend paths. |
| `ACTIONS_INCLUSION_FEE_STROOPS` | api | `10000` | Per-operation inclusion-fee **bid** on every built envelope (Blend deposit/withdraw, trustline, SDEX swap). A bid, not a price: the network charges the market-clearing rate (100 stroops off-surge), so a high bid costs nothing in practice. `BASE_FEE` (100) here caused a real mainnet `txInsufficientFee` rejection under surge pricing (2026-08-14). Keep ≤ 50,000: above that the client gates (swap ≤ 100,000 total over up to 2 ops) fail closed and refuse to sign. Values below 100 are ignored. |
| `VITE_ACTIONS_MAINNET_ENABLED` | web | unset → OFF | UX only: reveals the mainnet swap surface. NOT enforcement. |
| `VITE_ACTIONS_MAINNET_BLEND_ENABLED` | web | unset → OFF | UX only: reveals the mainnet Blend card (supply AND withdraw tabs). NOT enforcement. |

Mainnet enforcement lives in `apps/api` (`actions.controller.ts` + `network-registry.ts`): the two
kill-switches, the shared per-transaction cap, the swap asset whitelist (native XLM + Circle USDC
only, INV-4.3), and the Blend deposit asset whitelist (XLM | USDC only). The web VITE flags only
toggle UI; the API rejects mainnet regardless when its flag is off.

**Ungating procedure** (record the result, date + commit SHA + checker, as T3-D2 evidence):

1. Run the full `docs/security-invariants.md` checklist top to bottom.
2. Re-verify the Circle USDC **mainnet** issuer on BOTH sides: `MAINNET_USDC_ISSUER` in
   `apps/api/src/modules/actions/network-registry.ts` AND `apps/web/src/config/mainnetSwapPairs.ts`.
   They MUST match (currently `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`).
3. Set `ACTIONS_MAINNET_ENABLED=true` on the VPS, restart PM2.
4. `curl` validation (mainnet):
   ```bash
   # quote OK
   curl -s -X POST $API/v1/actions/sdex/quote -H "Content-Type: application/json" \
     -d '{"fromAsset":"XLM","toAsset":"USDC","amount":"10","network":"mainnet"}' | jq
   # over-cap swap → 400
   curl -s -X POST $API/v1/actions/sdex/swap -H "Content-Type: application/json" \
     -d '{"address":"G...","fromAsset":"XLM","toAsset":"USDC","amount":"1000000","minReceive":"0.1","network":"mainnet"}' | jq
   # non-whitelisted asset → 400
   curl -s -X POST $API/v1/actions/sdex/quote -H "Content-Type: application/json" \
     -d '{"fromAsset":"XLM","toAsset":{"code":"AQUA","issuer":"G..."},"amount":"10","network":"mainnet"}' | jq
   # flag OFF (before step 3, or after rollback) → 403
   ```
5. Set `VITE_ACTIONS_MAINNET_ENABLED=true` on Vercel, redeploy.
6. Do ONE small real capped swap from the dashboard; keep the tx hash as the T3-D2 evidence starter.

**Rollback**: unset `ACTIONS_MAINNET_ENABLED` on the VPS and restart PM2; the API returns to 403 on
mainnet immediately, independent of the web deploy.

### Blend deposit ungating (Lot A2)

The deposit ungates on its OWN switch (`ACTIONS_MAINNET_BLEND_ENABLED`), independently of the swap.
Its 2-step trustline-gated path is already proven E2E on testnet; this is the mainnet extension.

1. Run the full `docs/security-invariants.md` checklist top to bottom (record date + commit SHA + checker).
2. Re-verify the Blend **Fixed pool** id + reserve **SACs** on BOTH sides (`MAINNET_BLEND_POOL` /
   `MAINNET_USDC_SAC` / `MAINNET_XLM_SAC` in `apps/api/src/modules/actions/network-registry.ts` AND
   `apps/web/src/config/blendPools.ts`) against the prod DB (`entities` where venue=Blend →
   `blend-fixed-pool`; `reserve_snapshots` for its USDC/native reserves) **and** blend.capital. The
   SACs are the deterministic contract ids of `USDC:GA5ZSE…` and native XLM on Pubnet (cross-check
   with `Asset(...).contractId(Networks.PUBLIC)`). Confirm it is a **V2** pool.
3. Set `ACTIONS_MAINNET_BLEND_ENABLED=true` on the VPS, restart PM2.
4. `curl` validation (mainnet), using a real funded address:
   ```bash
   # flag OFF (before step 3, or after rollback) → 403
   curl -s -X POST $API/v1/actions/blend/deposit -H "Content-Type: application/json" \
     -d '{"address":"G...","asset":"XLM","amount":"5","network":"mainnet"}' | jq
   # flag ON, XLM deposit → returns xdr + simulation.success:true
   # USDC without the classic trustline → trustlineRequired:true + changetrustXdr (deposit xdr empty)
   # over-cap → 400
   curl -s -X POST $API/v1/actions/blend/deposit -H "Content-Type: application/json" \
     -d '{"address":"G...","asset":"XLM","amount":"1000000","network":"mainnet"}' | jq
   # EURC (or any non XLM/USDC asset) → 400
   curl -s -X POST $API/v1/actions/blend/deposit -H "Content-Type: application/json" \
     -d '{"address":"G...","asset":"EURC","amount":"5","network":"mainnet"}' | jq
   ```
5. Set `VITE_ACTIONS_MAINNET_BLEND_ENABLED=true` on Vercel, redeploy.
6. Do ONE small real deposit (a few XLM) from the dashboard. The client gate
   (`apps/web/src/lib/validateDepositXdr.ts`) validates the XDR against `config/blendPools.ts`
   before EVERY signing prompt. Verify the new position appears in the portfolio above (T2-D1
   resolver picks up the Blend position + health factor) AND on blend.capital. Record the tx hash
   in `docs/evidence/`; it is the "vault/lending" evidence for T3-D2 criterion 1.

**Rollback**: unset `ACTIONS_MAINNET_BLEND_ENABLED` on the VPS and restart PM2; `blend/deposit`,
`blend/withdraw` and `blend/position` all return to 403 on mainnet immediately, independent of the
swap flag and the web deploy.

### Blend withdraw ungating (Lot A3)

The withdraw ships behind the **same** switch as the deposit: flipping
`ACTIONS_MAINNET_BLEND_ENABLED` ungates both, so there is nothing extra to enable. Its testnet
money path is proven E2E (supply `b199a1d7…` + withdraw `322d760e…`, both confirmed on-chain; see
`docs/evidence/lot-a3-blend-withdraw.md`).

Deliberate difference from the deposit: **there is no amount cap on a withdraw** (INV-2.15): it
returns the user's own funds to their own wallet, and a cap could strand a position larger than it.
Do not "fix" this by adding one.

`curl` validation (mainnet), after the deposit ungating above:
```bash
# flag OFF → 403 (withdraw AND the position read ride the same switch)
curl -s -X POST $API/v1/actions/blend/withdraw -H "Content-Type: application/json" \
  -d '{"address":"G...","asset":"XLM","amount":"5","network":"mainnet"}' | jq
curl -s -X POST $API/v1/actions/blend/position -H "Content-Type: application/json" \
  -d '{"address":"G...","network":"mainnet"}' | jq
# flag ON, position read → collateral / supply / liabilities per asset, live from chain
# flag ON, withdraw within the position → xdr + simulation.success:true
# withdraw with NO position → simulation.success:false, xdr:"" (nothing signable)
# EURC (or any non XLM/USDC asset) → 400
```

Then do ONE small real pair from the dashboard: supply a few XLM, then Withdraw → Max. The client
gate (`validateWithdrawXdr`) validates the XDR against `config/blendPools.ts` before the signing
prompt, pinning `WithdrawCollateral`. Verify the position drops in the portfolio and on
blend.capital, and record BOTH hashes in `docs/evidence/lot-a3-blend-withdraw.md`; they are the
T3-D2 bonus evidence pair.

Expect a **dust remainder** after a Max withdraw (a few stroops): collateral accrues interest
between the position read and apply. That is correct behavior, not a bug.

---

### Blend multi-pool: adding or ungating a pool (Lot A5)

Since A5, supply + withdraw work on **every pool in the registry**, not just Fixed. Both registries
must agree, entry for entry:

- API: `apps/api/src/modules/actions/network-registry.ts` → `MAINNET_BLEND_POOLS`
- Web: `apps/web/src/config/blendPools.ts` → `MAINNET_BLEND_POOLS`

The client one is what the signing gate pins; a divergence between them is a **security bug**, not
config drift.

**Before adding a pool** (never from memory; the A2 rule: an id that cannot be verified is
EXCLUDED, not guessed):

1. Confirm it is in the indexed perimeter (`entities` × `venues.slug='blend'`,
   `entity_type='lending_pool'`, `is_active`). A pool the product does not list is out of scope.
2. Verify the contract id against Blend itself. `mainnet.blend.capital` is a client-rendered SPA
   (a fetch returns an empty shell), so verify on-chain instead (stronger, and reproducible):
   - the official **V2 pool factory** (`CDSYOAVXFY7SM5S64IZPPPYB4GVGGLMQVFREPSQQEZVIWXX5R23G4QSU`,
     from docs.blend.capital) must answer `is_pool(<id>) = true`;
   - the pool should appear in the **backstop reward zone**
     (`CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7`), Blend governance recognition;
   - stellar.expert should report the **same wasm hash** as the vetted Fixed pool;
   - `PoolV2.load` must succeed (this IS the V2 confirmation; the builder uses `PoolContractV2`),
     and its `metadata.name` is the label to use.
3. Read the pool's reserves **live via the SDK** to decide its asset list. Do **NOT** read
   `reserve_snapshots`: it retains rows for reserves a pool no longer has (Orbit still has a
   2026-04-01 USDC row but no USDC reserve on-chain), so a DB-derived list would offer a deposit
   that fails at simulation.
4. Add the entry to BOTH registries, then run `pnpm -C apps/web test`; the cross-pool red tests
   iterate the real registry, so a new pool is automatically covered by the pairwise pinning tests.

`curl` validation per pool (mainnet):
```bash
# unknown slug → 400 (never a silent fallback to another pool)
curl -s -X POST $API/v1/actions/blend/deposit -H "Content-Type: application/json" \
  -d '{"address":"G...","asset":"XLM","amount":"1","network":"mainnet","pool":"blend-nope"}' | jq
# asset the pool has no reserve for → 400 naming the pool (e.g. Orbit + USDC)
curl -s -X POST $API/v1/actions/blend/deposit -H "Content-Type: application/json" \
  -d '{"address":"G...","asset":"USDC","amount":"1","network":"mainnet","pool":"blend-orbit-pool"}' | jq
# position read echoes the pool it actually read + that pool's assets
curl -s -X POST $API/v1/actions/blend/position -H "Content-Type: application/json" \
  -d '{"address":"G...","network":"mainnet","pool":"blend-yieldblox-pool"}' | jq '.poolSlug, .assets'
# no "pool" key at all → the default (Fixed), i.e. pre-A5 behavior
# flag OFF → 403 for EVERY pool (the kill-switch is checked before pool resolution)
```

---

## Wallet troubleshooting
- Test wallet connect: connect via the header button (Stellar Wallets Kit); pick Freighter.
- After a page reload, the kit re-selects the connected provider (`restoreWalletSession` +
  defensive `setWallet` before signing); this fixes the "xBull opens instead of Freighter" bug.
- Refresh a wallet's balances: `POST /v1/wallets/:walletId/refresh` (spawns the indexer balance
  snapshot script).
- Inspect: `user_wallets`, `wallet_balance_snapshots` (see Database checks above).

---

## Common debug situations

- **Frontend build fails with `CustomEvent is not defined`** → you're on an old Node (18); `nvm use` (Node 24).
- **`/v1/...` returns 404 from the widget** → the frontend is hitting the wrong API base; check
  `apps/web/.env` `VITE_API_BASE` points at the running API (local = `http://localhost:3000`).
- **API returns all-`null` numeric fields from a raw-SQL read** → Postgres `numeric` columns come back
  as `Prisma.Decimal` objects via `$queryRawUnsafe`; the mapper must unwrap them (`toNumber()` /
  `toString()` → `Number`), as in `network.service.ts` / `stellar.service.ts`.
- **Freighter refuses to sign ("transaction is on Main Net")** → the toggle/kit network and the
  Freighter extension network must match; set both to Testnet for T1-D3.
- **Stale protocol data in UI** → check `as_of` freshness in `*_metrics_latest`; re-run
  `pnpm -C apps/indexer job:refresh`.

## Reward faucet (Lot R, T3-D2)

The faucet pays 5 XLM from a DIG-owned hot wallet after a verified qualifying action
(security model: `docs/security-invariants.md` §9). Everything defaults DARK
(`FAUCET_ENABLED` unset).

### Setup (founder, one-time per network)

1. Generate the keypair **locally** (never in chat, never committed):
   `node -e "const {Keypair}=require('@stellar/stellar-sdk');const k=Keypair.random();console.log(k.publicKey());console.log(k.secret())"`
2. Fund the public address with **exactly 200 XLM** from treasury (the hard exposure cap:
   never more; refills are manual and deliberate).
3. VPS env (`apps/api/.env`): `FAUCET_SECRET_KEY=<secret>`, `FAUCET_NETWORK=testnet|mainnet`,
   optional `FAUCET_REWARD_XLM` / `FAUCET_MAX_CLAIMS` / `FAUCET_HOURLY_CLAIM_CAP` /
   `FAUCET_MIN_NOTIONAL_XLM`. Leave `FAUCET_ENABLED` unset until go-live.
4. Apply `stellar_v1_action_witness.sql` + `stellar_v4_faucet.sql` (see "Apply raw SQL schemas").
5. nginx: `/v1/actions/witness` is already covered by the strict `location /v1/actions/` zone;
   put `POST /v1/faucet/claim` in the strict zone but keep `GET /v1/faucet/eligibility` in the
   general zone; it is polled by the promo surfaces and the strict zone starves it (learned in
   the 2026-08-17 incident; see `docs/deployment.md` zones).

### Campaign 2 (Lot R2): per-family rewards

Campaign 2 pays per action FAMILY: first verified swap AND first verified Blend supply each
earn 5 XLM (max 2 claims per wallet), budget 60 claims. Evidence:
`docs/evidence/lot-r2/testnet-e2e.md`.

1. Apply `stellar_v5_faucet_campaign2.sql` BEFORE deploying/restarting the campaign-2 api
   build (it relabels campaign-1 rows and swaps the unique indexes to per-(wallet, family,
   campaign); idempotent).
2. Fund the treasury with the campaign budget (302 XLM for 60 × 5 + fees), founder-side.
3. Activation env, all three together: `FAUCET_MAX_CLAIMS=60`, `FAUCET_STARTS_AT=<ISO now>`,
   `FAUCET_ENDS_AT=<ISO now+48h>`, then `FAUCET_ENABLED=true` + pm2 restart.
   `FAUCET_STARTS_AT` is REQUIRED and fail-closed: without it the campaign stays inactive
   (`campaign-not-started`); only witnesses whose tx executed at/after it qualify, so
   campaign-1 actions can never be replayed for a campaign-2 reward.

### Go-live sequence (mainnet)

1. **Clear testnet E2E claim rows first**: the unique indexes (per wallet/user + family +
   campaign since v5) are GLOBAL across networks:
   `delete from faucet_claims where network = 'testnet';`
2. Set `FAUCET_NETWORK=mainnet`, `FAUCET_ENABLED=true`, restart the api (pm2).
3. Founder executes ONE real qualifying action + claim as the go-live proof; verify the payout
   hash and the `/v1/ops/metrics` faucet block.

### Operate

- **Watch a drain**: `/v1/ops/metrics` → `faucet` block (`claims.paid24h`, `remainingClaims`,
  `treasurySpendableXlm`). Payouts auto-halt when spendable < reward.
- **Pause**: set `FAUCET_ENABLED=false` + restart. The promo surfaces disappear by themselves.
- **Drain back to treasury**: pause first, then send the balance back with a normal payment
  from the hot wallet (or account-merge if retiring the wallet for good).
- **`failed` claim row**: the payout errored; `failure_reason` says whether it MAY have paid
  (ambiguous submit). Verify the treasury's outgoing payments on stellar.expert. If it paid:
  set the row `paid` with the real `payout_tx_hash`. If it did not: either delete the row
  (frees the wallet/user to claim again) or leave it (permanently blocks them). NEVER resubmit
  blindly: that is the double-pay path.
- **Row stuck in `pending` > 5 min**: the post-payout UPDATE failed; same explorer-verify
  procedure as `failed`, then resolve the row manually.
