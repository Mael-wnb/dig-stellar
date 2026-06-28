# Dig Stellar — Runbooks

## Purpose
This document captures practical procedures used regularly during development and operations.

---

## Node version (read first)

The frontend build (`apps/web`) uses Vite 8, which requires **Node 20+** (Node 18 fails with
`CustomEvent is not defined`). A `.nvmrc` pinned to `20` lives at the repo root. Default is set via
`nvm alias default 20`. Before any build/dev command, ensure Node 20 is active:

```bash
export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh" && nvm use
```

If a fresh `pnpm install` is needed under Node 20 (e.g. to fetch native bindings like
`@rolldown/binding-darwin-arm64` that were skipped under Node 18): `pnpm install`.

---

## Local development

### Start frontend (`apps/web`)
```bash
export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh" && nvm use
pnpm -C apps/web dev      # Vite dev server, http://localhost:5173
pnpm -C apps/web build    # vue-tsc typecheck + vite build (must be on Node 20)
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

### Run indexer scripts (`apps/indexer`)
Runner is `tsx` (no build step).
```bash
# Full production refresh (canonical entry point): 72 → 71 → all per-protocol steps
pnpm -C apps/indexer job:refresh

# A single ingest step directly (example: network stats)
pnpm -C apps/indexer exec tsx src/scripts/ingest/73-network-stats-refresh.ts

# Bootstrap (run once per protocol before first refresh)
pnpm -C apps/indexer tsx src/scripts/bootstrap/blend-upsert-core.ts
pnpm -C apps/indexer tsx src/scripts/bootstrap/soroswap-upsert-core.ts
pnpm -C apps/indexer tsx src/scripts/bootstrap/aquarius-upsert-core.ts
```

### Onboarding an additional Blend pool (the actual seed path)

`blend-upsert-core.ts` only seeds the **fixed** pool (from a generated discovery registry).
The other Blend entities (orbit, etherfuse, **yieldblox**) are seeded by running the pool refresh
**once** with the pool's contract id — `persistBlendPoolState` upserts the entity (`is_active = true`)
plus its reserves/assets read on-chain. After that, `71-refresh-all-metrics` discovers it by DB query
(`entities join venues where v.slug='blend' and is_active`) and keeps it fresh with no further action.

```bash
# Seed YieldBlox (idempotent — re-running just refreshes it)
ENTITY_SLUG=blend-yieldblox-pool \
BLEND_POOL_ID=CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS \
  pnpm -C apps/indexer exec tsx src/scripts/ingest/run-blend-pool-refresh.ts
```

The known active Blend pools are catalogued in `apps/indexer/src/config/stellar-targets.json`
(documentation only — no code reads it). **Forex** is listed there as `status: excluded` (frozen
oracle) and must never be seeded as active. After seeding, confirm any new reserve assets are priced
(`PRICING_RULES_BY_SYMBOL` in `scripts/shared/pricing-config.ts`); unpriced reserves show null/0 USD
but the health factor stays correct (it comes from Blend's on-chain Reflector oracle, not the price
pipeline). `BLEND_POOL_ID` in `.env` is only a default for the discovery/probe scripts (75/76).

### Wallet alert sweep (D2) — periodic evaluator

The alerting engine runs as a periodic sweep (no broker, no in-process scheduler): one OS-cron
entry calls the orchestrator, which refreshes every active wallet's `wallet_pool_health` (script 81,
no `WALLET_ID` → all wallets) and then runs the pure evaluator (script 83, in `apps/api`), which
writes `notifications` on each fire/resolve edge.
```bash
# Canonical entry point (82 → 81 → 83):
pnpm -C apps/indexer job:wallet-alert
```
Example crontab (VPS) — every 15 min, offset from `job:refresh` so they don't collide.
End-to-end alert latency ≈ this interval + the web's notification poll (~30–60s):
```cron
# m         h  dom mon dow  command
  7,22,37,52 *  *   *   *    cd /srv/dig-stellar && pnpm -C apps/indexer job:wallet-alert >> /var/log/dig/wallet-alert.log 2>&1
```
Prereq: `stellar_v3_alerting.sql` applied. A non-zero exit from the health refresh (81) aborts the
evaluator (83) for that run and logs — stale/half-written health rows are never evaluated.

---

## Database

### Connect with psql
```bash
psql "postgresql://dig:dig@localhost:5432/dig_stellar"
```

### Apply raw SQL schemas (manual — no migration runner for v1/v2)
The v1/v2 schemas are applied by hand. The DDL is idempotent (`create table if not exists`), so
re-running is safe.
```bash
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1.sql
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1_metrics.sql
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1_bridge.sql
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v2_multiwallet.sql
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v3_alerting.sql   # D2 alerting: alert_rules, alert_rule_state, notifications (depends on v1 entities + v2 user_wallets)
```
Manually-applied schemas (local AND VPS): `stellar_v1.sql`, `stellar_v1_metrics.sql`,
`stellar_v1_bridge.sql` (Allbridge bridge flows — T2-D3), `stellar_v2_multiwallet.sql`,
`stellar_v3_alerting.sql` (D2 alerting — must be applied AFTER v1 + v2).
Note: when a new table **or column** is added to one of these files (e.g. `network_stats_latest`
in `stellar_v1_metrics.sql`, `bridge_flows` in `stellar_v1_bridge.sql`, or the T2-D1
`is_active_signer` column + `user_wallets_one_signer_per_user` index, or the T2-D1 Gap B
`wallet_pool_health` table in `stellar_v2_multiwallet.sql`),
re-run that file once — the statements are idempotent (`add column if not exists`,
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
Known issue: `activeWallets` and `dexVolume24hUsd` come back `null` — the stellar.expert summary
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
- Swap is gated Testnet-only in the UI (disabled + notice on Mainnet); Mainnet actions are T3-D2.
- On Testnet the swap op may fail with `pathPaymentStrictSendTooFewOffers` — no SDEX liquidity for
  the pair on Testnet, not a code bug (`ChangeTrust` op 1 still succeeds).
- Fund a Testnet account via Friendbot; sign with Freighter set to Test Net.

---

## Wallet troubleshooting
- Test wallet connect: connect via the header button (Stellar Wallets Kit); pick Freighter.
- After a page reload, the kit re-selects the connected provider (`restoreWalletSession` +
  defensive `setWallet` before signing) — fixes the "xBull opens instead of Freighter" bug.
- Refresh a wallet's balances: `POST /v1/wallets/:walletId/refresh` (spawns the indexer balance
  snapshot script).
- Inspect: `user_wallets`, `wallet_balance_snapshots` (see Database checks above).

---

## Common debug situations

- **Frontend build fails with `CustomEvent is not defined`** → you're on Node 18; `nvm use` (Node 20).
- **`/v1/...` returns 404 from the widget** → the frontend is hitting the wrong API base; check
  `apps/web/.env` `VITE_API_BASE` points at the running API (local = `http://localhost:3000`).
- **API returns all-`null` numeric fields from a raw-SQL read** → Postgres `numeric` columns come back
  as `Prisma.Decimal` objects via `$queryRawUnsafe`; the mapper must unwrap them (`toNumber()` /
  `toString()` → `Number`), as in `network.service.ts` / `stellar.service.ts`.
- **Freighter refuses to sign ("transaction is on Main Net")** → the toggle/kit network and the
  Freighter extension network must match; set both to Testnet for T1-D3.
- **Stale protocol data in UI** → check `as_of` freshness in `*_metrics_latest`; re-run
  `pnpm -C apps/indexer job:refresh`.
