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
```
Manually-applied schemas (local AND VPS): `stellar_v1.sql`, `stellar_v1_metrics.sql`,
`stellar_v1_bridge.sql` (Allbridge bridge flows — T2-D3), `stellar_v2_multiwallet.sql`.
Note: when a new table is added to one of these files (e.g. `network_stats_latest` in
`stellar_v1_metrics.sql`, or `bridge_flows` in `stellar_v1_bridge.sql`), re-run that file once
to create it.

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
