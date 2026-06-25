# Data Model — As-Built

This document describes the actual database schema as deployed and verified in the codebase.
Three distinct families of tables coexist in the same Postgres instance.

---

## Overview

| Schema family | Tables | Defined in | Written by | Read by |
|---|---|---|---|---|
| **v1 — production pipeline** | `venues`, `entities`, `assets`, `entity_assets`, `normalized_events`, `pool_snapshots`, `reserve_snapshots`, `asset_prices`, `pool_metrics_latest`, `protocol_metrics_latest`, `sync_cursors` | `apps/api/src/db/stellar_v1.sql` + `stellar_v1_metrics.sql` | `job:refresh` pipeline (indexer) | `/v1/protocols`, `/v1/pools`, `/v1/pools/:slug` (StellarController) |
| **v1 — bridge flows** | `bridge_flows` | `apps/api/src/db/stellar_v1_bridge.sql` | `job:refresh` (Step 8 — `run-allbridge-bridge-refresh.ts`) | `/v1/bridge/*` (planned — on-read aggregation, T2-D3) |
| **v2 — wallet layer** | `user_wallets`, `wallet_balance_snapshots`, `wallet_protocol_positions`, `wallet_pool_health` | `apps/api/src/db/stellar_v2_multiwallet.sql` | wallet refresh scripts (`80-stellar-wallet-balance-snapshots.ts`, `81-stellar-wallet-blend-positions.ts`) | `/v1/wallets/*` (WalletsController) |
| **Prisma legacy** | `"Protocol"`, `"Venue"`, `"Snapshot"` | `packages/db/prisma/schema.prisma` + migration `20260312113641_init` | `run:blend`, `run:horizon`, `run:once` | `/protocols`, `/venues`, `/venues/:key/snapshots` (AppController) — **not served under `/v1/`** |

The v1 and v2 schemas are applied manually via the SQL files (no Prisma migration).
The Prisma schema is applied via `pnpm -C packages/db prisma:migrate`.

---

## Schema v1 — Production Pipeline

Defined in `apps/api/src/db/stellar_v1.sql` and `apps/api/src/db/stellar_v1_metrics.sql`.

### Entity-relationship summary

```
venues (1) ──< entities (N) ──< pool_snapshots
                    │         ──< reserve_snapshots ─── assets
                    │         ──< normalized_events
                    │         ──< pool_metrics_latest
                    │
              entity_assets >── assets ──< asset_prices
                    │
venues (1) ──< protocol_metrics_latest
```

### `venues`

Top-level protocol registry. One row per protocol (blend, soroswap, aquarius, stellar-native).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `slug` | text UNIQUE NOT NULL | e.g. `blend`, `soroswap`, `aquarius`, `stellar-native` |
| `name` | text NOT NULL | Display name |
| `chain` | text NOT NULL | e.g. `stellar-mainnet` |
| `venue_type` | text NOT NULL | e.g. `lending`, `amm`, `native-amm` |
| `metadata` | jsonb | Free-form protocol metadata |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | Updated on upsert |

No freshness field — venues are stable configuration, not time-series.

### `entities`

Individual pool or market instances within a venue. One row per pool/pair.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `venue_id` | uuid FK → `venues.id` CASCADE | |
| `slug` | text UNIQUE NOT NULL | e.g. `blend-main-pool`, `soroswap-xlm-usdc-pair` |
| `name` | text NOT NULL | Display name |
| `entity_type` | text NOT NULL | `lending_pool` or `amm_pool` |
| `contract_address` | text | Soroban contract ID or Horizon pool ID |
| `metadata` | jsonb | Protocol-specific metadata |
| `is_active` | boolean | Default true |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Indexes: `venue_id`, `contract_address`.

### `assets`

Token registry. One row per asset contract address.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `chain` | text NOT NULL | e.g. `stellar-mainnet` |
| `contract_address` | text UNIQUE NOT NULL | Soroban contract ID or native asset string |
| `asset_type` | text NOT NULL | e.g. `soroban_token` |
| `symbol` | text | |
| `name` | text | |
| `decimals` | integer | |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Index: `symbol`.

### `entity_assets`

Many-to-many join between entities and assets with a role qualifier.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `entity_id` | uuid FK → `entities.id` CASCADE | |
| `asset_id` | uuid FK → `assets.id` CASCADE | |
| `role` | text NOT NULL | `token0`, `token1`, `reserve` |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |

Unique constraint: `(entity_id, asset_id, role)`. Indexes: `entity_id`, `asset_id`.

### `normalized_events`

On-chain events decoded and normalized from Soroban RPC. Used for 24h volume and swap counts.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `venue_id` | uuid FK → `venues.id` CASCADE | |
| `entity_id` | uuid FK → `entities.id` CASCADE | |
| `contract_address` | text NOT NULL | |
| `event_id` | text NOT NULL | RPC event ID |
| `tx_hash` | text NOT NULL | |
| `ledger` | bigint NOT NULL | |
| `occurred_at` | timestamptz NOT NULL | **Freshness field.** From `ledgerClosedAt` in RPC response |
| `event_name` | text NOT NULL | e.g. `swap`, `trade` |
| `sub_event_name` | text | |
| `event_key` | text NOT NULL | e.g. `SoroswapPair:swap`, `AquariusPool:trade` |
| `caller_address` | text | |
| `token_in_asset_id` | uuid FK → `assets.id` SET NULL | |
| `token_out_asset_id` | uuid FK → `assets.id` SET NULL | |
| `token_amount_in_raw` | numeric | Raw on-chain units |
| `token_amount_out_raw` | numeric | |
| `token_amount_in_scaled` | numeric | Human-readable units |
| `token_amount_out_scaled` | numeric | |
| `in_successful_contract_call` | boolean | Default true |
| `metadata` | jsonb | Protocol-specific fields (fees, reserves, etc.) |
| `created_at` | timestamptz | |

Unique constraint: `(contract_address, event_id)`.
Indexes: `entity_id`, `occurred_at DESC`, `event_key`, `tx_hash`.

Written by: Soroswap and Aquarius adapters. Blend does **not** write to this table (uses `reserve_snapshots` instead).

### `pool_snapshots`

Point-in-time structural snapshot of a pool (pool-level metadata, not per-reserve).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `venue_id` | uuid FK → `venues.id` CASCADE | |
| `entity_id` | uuid FK → `entities.id` CASCADE | |
| `snapshot_at` | timestamptz NOT NULL | **Freshness field** |
| `pool_id` | text | Contract ID or Horizon pool ID |
| `pool_name` | text | |
| `reserve_count` | integer | |
| `total_events` | integer | |
| `total_deposits` | integer | |
| `total_swaps` | integer | |
| `total_exit_pool` | integer | |
| `unique_callers` | integer | |
| `metadata` | jsonb | Horizon-native fields (fee_bp, total_shares, total_trustlines, reserves array) |
| `created_at` | timestamptz | |

Unique constraint: `(entity_id, snapshot_at)`.
Indexes: `entity_id`, `snapshot_at DESC`.

Written by: Blend (`persist-pool-state`) and Stellar-native (`persist-pool-snapshots`).

### `reserve_snapshots`

Per-asset snapshot for lending pool reserves. Blend-only in current implementation.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `venue_id` | uuid FK → `venues.id` CASCADE | |
| `entity_id` | uuid FK → `entities.id` CASCADE | |
| `asset_id` | uuid FK → `assets.id` CASCADE | |
| `snapshot_at` | timestamptz NOT NULL | **Freshness field** |
| `symbol` | text | |
| `name` | text | |
| `decimals` | integer | |
| `enabled` | boolean | Reserve enabled flag |
| `d_supply_raw` | numeric | Debt supply, on-chain units |
| `b_supply_raw` | numeric | Collateral supply, on-chain units |
| `backstop_credit_raw` | numeric | |
| `d_supply_scaled` | numeric | Human-readable |
| `b_supply_scaled` | numeric | |
| `backstop_credit_scaled` | numeric | |
| `supply_cap_raw` | numeric | |
| `supply_cap_scaled` | numeric | |
| `borrow_apr` | numeric | |
| `est_borrow_apy` | numeric | |
| `supply_apr` | numeric | |
| `est_supply_apy` | numeric | |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |

Unique constraint: `(entity_id, asset_id, snapshot_at)`.
Indexes: `entity_id`, `asset_id`, `snapshot_at DESC`.

**Note:** `persistSoroswapPairMetrics` and `persistAquariusPoolMetrics` query `reserve_snapshots` for
TVL computation (reading `d_supply_scaled`), but neither Soroswap nor Aquarius writes to this table
in the current `job:refresh` pipeline. Their TVL will return 0 unless rows are seeded by a separate path.

### `asset_prices`

Time-series of token prices in USD. Multiple sources possible per asset.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `asset_id` | uuid FK → `assets.id` CASCADE | |
| `price_usd` | numeric NOT NULL | |
| `source` | text NOT NULL | e.g. `coingecko`, `soroswap-derived` |
| `observed_at` | timestamptz NOT NULL | **Freshness field** |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |

Unique constraint: `(asset_id, source, observed_at)`.
Indexes: `asset_id`, `observed_at DESC`.

Written by `62-price-reference-assets.ts` (CoinGecko) and `63-price-soroswap-derived.ts`.
The API reads the latest price per asset via `ORDER BY observed_at DESC LIMIT 1`.

### `pool_metrics_latest`

Latest derived metrics per entity — upserted on every refresh cycle. Not a time-series.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `venue_id` | uuid FK → `venues.id` CASCADE | |
| `entity_id` | uuid FK → `entities.id` CASCADE | |
| `as_of` | timestamptz NOT NULL | **Freshness field** — set to `nowIso()` at write time |
| `metric_type` | text NOT NULL | Currently always `latest` |
| `tvl_usd` | numeric | |
| `volume_24h_usd` | numeric | |
| `fees_24h_usd` | numeric | |
| `total_supplied_usd` | numeric | Blend only |
| `total_borrowed_usd` | numeric | Blend only |
| `net_liquidity_usd` | numeric | Blend only |
| `total_backstop_credit_usd` | numeric | Blend only |
| `weighted_supply_apy` | numeric | Blend only |
| `weighted_borrow_apy` | numeric | Blend only |
| `metadata` | jsonb | Breakdown and source info |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | Updated on upsert |

Unique constraint: `(entity_id, metric_type)` — exactly one active row per pool.
Indexes: `entity_id`, `as_of DESC`.

Primary read target for `GET /v1/pools` and `GET /v1/pools/:slug`.

### `protocol_metrics_latest`

Latest derived metrics aggregated at the venue (protocol) level. Upserted on every refresh.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `venue_id` | uuid FK → `venues.id` CASCADE | |
| `as_of` | timestamptz NOT NULL | **Freshness field** |
| `tvl_usd` | numeric | Sum of entity TVLs |
| `volume_24h_usd` | numeric | Sum of entity volumes |
| `fees_24h_usd` | numeric | Sum of entity fees |
| `avg_supply_apy` | numeric | TVL-weighted average (lending) |
| `avg_borrow_apy` | numeric | |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Unique constraint: `(venue_id)` — exactly one active row per protocol.
Indexes: `venue_id`, `as_of DESC`.

Written by `70-protocol-persist-metrics.ts`. Primary read target for `GET /v1/protocols`.

### `sync_cursors`

Ingestion state: tracks the last-processed ledger or cursor per data source.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `source` | text NOT NULL | e.g. protocol or script name |
| `cursor_key` | text NOT NULL | e.g. `last_ledger` |
| `cursor_value` | text NOT NULL | |
| `metadata` | jsonb | |
| `updated_at` | timestamptz | |

Unique constraint: `(source, cursor_key)`.

---

## Schema v1 — Bridge Flows (T2-D3)

Defined in `apps/api/src/db/stellar_v1_bridge.sql` (applied manually, like the other v1 files).
References v1 `venues` and `assets`.

### `bridge_flows`

One row per Allbridge Core bridge event on Stellar. Tracks **inflows** (other chain → Stellar,
the SCF claim) and **outflows** (Stellar → other chain, bonus) with per-counterparty-chain
attribution. Mono-token today (USDC — the only token Allbridge Core bridges on Stellar). Flows are
aggregated **on read** (no pre-computed `*_metrics_latest` table) — volume is low.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `venue_id` | uuid FK → `venues.id` CASCADE | the `allbridge` venue (`venue_type='bridge'`) |
| `direction` | text NOT NULL | `'inflow'` \| `'outflow'` |
| `counterparty_chain_id` | integer | Allbridge internal chain id (source for inflow, destination for outflow) |
| `counterparty_chain` | text | resolved symbol (`ETH`, `BAS`, `SOL`, …; `Unknown` if attribution failed) |
| `asset_id` | uuid FK → `assets.id` SET NULL | resolved from `token_contract_id`; nullable |
| `token_contract_id` | text NOT NULL | always the Stellar USDC SAC |
| `token_symbol` | text | `USDC` |
| `amount_raw` | numeric(78,0) NOT NULL | on-chain i128 units, as string. **Mixed precision by direction:** inflow is in USDC's native 7 decimals, outflow is in Allbridge's 3-decimal system precision |
| `amount_scaled` | numeric | per-direction: inflow `amount_raw / 10^7` (native USDC), outflow `amount_raw / 10^3` (Allbridge system precision). A single `/10^7` would over-scale every outflow by 10⁴ |
| `amount_usd` | numeric | via `asset_prices`; USDC falls back to $1 |
| `recipient` | text | Stellar recipient on inflow; null for foreign-chain byte addresses (stashed in `metadata`) |
| `nonce` | text | bridge message nonce |
| `contract_address` | text NOT NULL | the bridge contract id |
| `event_id` | text NOT NULL | Soroban RPC event id |
| `tx_hash` | text NOT NULL | |
| `ledger` | bigint NOT NULL | |
| `occurred_at` | timestamptz NOT NULL | **freshness** — `ledgerClosedAt` from RPC |
| `metadata` | jsonb | event name, raw recipient, `receive_token`, `receive_tokens` invocation args |
| `created_at` | timestamptz | default now() |

Dedup on rescan: unique `(contract_address, event_id)`, upsert `ON CONFLICT DO NOTHING` (events are
immutable). Indexes: `(occurred_at desc)`, `(direction, counterparty_chain_id, occurred_at desc)`
(the dashboard query), `(venue_id)`, `(asset_id)`.

**Inflow attribution:** `TokensReceived` events carry no source chain, so the indexer reads
`source_chain_id` from the `receive_tokens` host-function call args (one extra `getTransaction` per
inflow). Outflows read `destination_chain_id` directly from the `TokensSent` event.

**Coverage constraint:** Soroban RPC `getEvents` retains ~7 days, so this is a rolling recent-flows
view, not deep history.

---

## Schema v2 — Wallet Layer

Defined in `apps/api/src/db/stellar_v2_multiwallet.sql`.
References `assets` and `entities` from schema v1 (cross-schema FK via `asset_id`, `venue_id`, `entity_id`).

### `user_wallets`

One row per wallet address tracked in the system. `user_id` is a UUID minted client-side on first connect.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid NOT NULL | Client-generated; no users table |
| `chain` | varchar(64) NOT NULL | e.g. `stellar` |
| `address` | varchar(128) NOT NULL | Stellar public key |
| `label` | varchar(128) | Optional display label |
| `is_primary` | boolean | Showcase/default wallet. First wallet for a user is auto-primary. App-maintained singleton. |
| `is_active` | boolean | Refresh gate — the indexer only snapshots active wallets. Default true on every insert path. |
| `is_active_signer` | boolean NOT NULL default false | **T2-D1.** Active-signer designation: the single wallet that can sign actions (singleton per user). Default false = watch-only, so every tracked wallet is watch-only until promoted. Orthogonal to `is_primary` and `is_active` — never merged. Connecting a wallet via the Wallets Kit promotes it (singleton; demotes the previous). |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Unique constraint: `(user_id, chain, address)`.
Partial unique index `user_wallets_one_signer_per_user` on `(user_id) where is_active_signer` —
DB-enforces the active-signer singleton (stronger than the app-maintained `is_primary`).
Indexes: `user_id`, `(user_id, chain)`, `(chain, address)`.

### `wallet_balance_snapshots`

Time-series of token balances for a wallet. One row per (wallet, asset, snapshot_at).
Latest balance is resolved via `DISTINCT ON (user_wallet_id, asset_id, asset_contract_id) ORDER BY snapshot_at DESC`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_wallet_id` | uuid FK → `user_wallets.id` CASCADE | |
| `asset_id` | uuid FK → `assets.id` SET NULL | Nullable — not all assets are in the v1 registry |
| `asset_contract_id` | varchar(128) | Raw contract ID, always populated |
| `asset_symbol` | varchar(64) | Denormalized for display |
| `balance_raw` | numeric(78, 0) NOT NULL | On-chain units |
| `balance_scaled` | numeric(38, 18) | Human-readable |
| `price_usd` | numeric(38, 18) | Price at time of snapshot |
| `balance_usd` | numeric(38, 18) | `balance_scaled * price_usd` |
| `snapshot_at` | timestamptz NOT NULL | **Freshness field** |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |

Unique index: `(user_wallet_id, COALESCE(asset_id, zero-uuid), COALESCE(asset_contract_id, ''), snapshot_at)`.
Indexes: `user_wallet_id`, `snapshot_at DESC`, `(user_wallet_id, snapshot_at DESC)`, `asset_id`.

Written by `apps/indexer/src/scripts/wallets/80-stellar-wallet-balance-snapshots.ts`,
spawned on-demand by `POST /v1/wallets/:walletId/refresh`.

### `wallet_protocol_positions`

DeFi positions held by a wallet within a tracked entity. Linked to v1 `venues` and `entities`.
**Populated for Blend** (T2-D1 Gap B) by `81-stellar-wallet-blend-positions.ts`: one `supply` row
(collateral + non-collateral supply; `metadata.collateralEnabled` flags whether it backs borrows)
and/or one `borrow` row per reserve the wallet holds. `position_type` ∈ `supply` / `borrow`.
Amounts are in underlying-asset units (the Blend SDK's Float helpers, decimal-scaled via b/dRate);
`amount_raw` = `amount_scaled × 10^decimals`. Soroswap/Aquarius LP positions are not yet resolved.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_wallet_id` | uuid FK → `user_wallets.id` CASCADE | |
| `venue_id` | uuid FK → `venues.id` SET NULL | |
| `entity_id` | uuid FK → `entities.id` SET NULL | |
| `position_type` | varchar(64) NOT NULL | e.g. `supply`, `borrow` |
| `asset_id` | uuid FK → `assets.id` SET NULL | |
| `asset_contract_id` | varchar(128) | |
| `asset_symbol` | varchar(64) | |
| `amount_raw` | numeric(78, 0) | |
| `amount_scaled` | numeric(38, 18) | |
| `amount_usd` | numeric(38, 18) | |
| `snapshot_at` | timestamptz NOT NULL | **Freshness field** |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |

Indexes: `user_wallet_id`, `snapshot_at DESC`, `(user_wallet_id, snapshot_at DESC)`, `venue_id`, `entity_id`, `position_type`.

---

### `wallet_pool_health`

Per-(wallet, pool) Blend risk summary (T2-D1 Gap B). The **health factor is first-class** here
because D2's alert evaluator queries it flat — a queried value must be a column, not jsonb. This is
the pool-level rollup; the per-asset supply/borrow rows live in `wallet_protocol_positions`
(mirrors the v1 `reserve_snapshots` per-asset vs `pool_metrics_latest` per-pool split).
Snapshot-based, so D2 can read both the current HF and the previous one for delta detection.
Written by `81-stellar-wallet-blend-positions.ts`. Values come from the Blend SDK's
`PositionsEstimate` (never hand-rolled), denominated in USD via the pool's Reflector oracle.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_wallet_id` | uuid FK → `user_wallets.id` CASCADE | |
| `venue_id` | uuid FK → `venues.id` SET NULL | Blend venue |
| `entity_id` | uuid FK → `entities.id` SET NULL | the specific pool |
| `health_factor` | numeric | `effective_collateral / effective_liabilities`. **NULL = no debt** (no liabilities → ratio undefined, not liquidatable); D2 treats NULL as "no health alert applicable". Otherwise HF > 1 healthy, HF ≤ 1 liquidatable |
| `total_collateral_usd` | numeric | effective collateral (after collateral factors) |
| `total_debt_usd` | numeric | effective liabilities (after liability factors); `0` when no debt |
| `borrow_limit_usd` | numeric | remaining borrow capacity (nullable) |
| `net_apy` | numeric | optional, nullable |
| `positions_count` | integer | # of asset positions backing this row |
| `snapshot_at` | timestamptz NOT NULL | **Freshness field** |
| `metadata` | jsonb | poolSlug, raw supplied/borrowed USD, borrowLimit ratio |
| `created_at` | timestamptz | |

Indexes: `user_wallet_id`, `snapshot_at DESC`, `(user_wallet_id, snapshot_at DESC)`, and a partial
index on `health_factor WHERE health_factor IS NOT NULL` (D2's "wallets at risk" scan).
A wallet with **no** Blend position in a pool gets **no row** for that pool (empty rows are not written).

---

## Prisma Schema — Legacy (not served under /v1/)

Defined in `packages/db/prisma/schema.prisma`.
Applied via `pnpm -C packages/db prisma:migrate`.

These tables are **not part of the production data pipeline**. They are written by the legacy
top-level indexer scripts (`run:blend`, `run:horizon`, `run:once`) and served only by the
prefix-less AppController routes (`GET /protocols`, `GET /venues`, `GET /venues/:key/snapshots`).
The `/v1/*` endpoints do not read them. The Prisma client (`PrismaService`) is reused across all
controllers for its DB connection, but the v1/v2 controllers call `$queryRawUnsafe` against the
raw SQL tables rather than using the ORM models.

| Model | Prisma table name | Key columns |
|---|---|---|
| `Protocol` | `"Protocol"` | `id` (cuid), `key` (unique), `name`, `category`, `createdAt`, `updatedAt` |
| `Venue` | `"Venue"` | `id` (cuid), `protocolId` FK → Protocol, `key` (unique), `type`, `label`, `meta` (jsonb), `createdAt`, `updatedAt` |
| `Snapshot` | `"Snapshot"` | `id` (cuid), `venueId` FK → Venue, `ts` (timestamptz), `tvl`, `liquidity`, `volume`, `apy`, `utilization`, `inflow`, `outflow`, `netflow`, `data` (jsonb) |

Freshness field on Snapshot: `ts`.

These three tables are distinct from (and unrelated to) the `venues`, `entities`, and `pool_snapshots`
tables of schema v1, despite the conceptual similarity of their names.

---

## Freshness fields summary

| Table | Freshness column | Set by |
|---|---|---|
| `pool_snapshots` | `snapshot_at` | `new Date()` / `nowIso()` at write time |
| `reserve_snapshots` | `snapshot_at` | `nowIso()` at write time |
| `normalized_events` | `occurred_at` | `ledgerClosedAt` from Soroban RPC |
| `asset_prices` | `observed_at` | Write time |
| `pool_metrics_latest` | `as_of` | `nowIso()` at write time |
| `protocol_metrics_latest` | `as_of` | `nowIso()` at write time |
| `wallet_balance_snapshots` | `snapshot_at` | Write time |
| `wallet_protocol_positions` | `snapshot_at` | Write time |
| `wallet_pool_health` | `snapshot_at` | Write time |
| `"Snapshot"` (Prisma legacy) | `ts` | Write time |
