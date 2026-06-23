# Repository Structure — As-Built

Navigation map of the actual monorepo layout. Describes where logic lives, how data flows,
and how the pieces connect. Verified against the code — do not update this doc from memory.

---

## Monorepo layout

```
dig-stellar/
├── apps/
│   ├── api/           NestJS 11 — the UI-facing HTTP API
│   ├── indexer/       Ingestion jobs — writes to Postgres via raw SQL and Prisma
│   └── web/           Vue 3 + Vite — product UI
├── packages/
│   └── db/            Prisma schema + migrations (legacy Prisma schema only)
└── docs/              Source-of-truth documentation
```

Package manager: **pnpm** (indexer pins `pnpm@10.32.x`). No repo-wide build or test script —
each app owns its own.

---

## apps/api

**NestJS 11 + Prisma 5 (as DB connection only for raw SQL) + Postgres**

```
apps/api/src/
├── app.controller.ts          GET /protocols  /venues  /venues/:key/snapshots
│                              Reads: Prisma ORM models (Protocol, Venue, Snapshot) — LEGACY
├── app.module.ts
├── app.service.ts             (unused stub)
├── main.ts
├── db/
│   ├── prisma.service.ts      Shared PrismaClient — used as connection for $queryRawUnsafe
│   ├── stellar_v1.sql         DDL: venues, entities, assets, entity_assets,
│   │                               normalized_events, pool_snapshots, reserve_snapshots,
│   │                               asset_prices, sync_cursors
│   ├── stellar_v1_metrics.sql DDL: pool_metrics_latest, protocol_metrics_latest
│   ├── stellar_v2_multiwallet.sql  DDL: user_wallets, wallet_balance_snapshots,
│   │                               wallet_protocol_positions
│   └── seed_blend_v1.sql      Manual seed helper (not applied automatically)
└── modules/
    ├── stellar/
    │   ├── stellar.controller.ts   GET /v1/protocols  /v1/pools  /v1/pools/:slug
    │   └── stellar.service.ts      Reads: raw SQL v1 (venues, entities, pool_metrics_latest,
    │                               reserve_snapshots, asset_prices, normalized_events,
    │                               entity_assets, assets, protocol_metrics_latest)
    ├── wallets/
    │   ├── wallets.controller.ts   GET/POST/PATCH/DELETE /v1/wallets/*
    │   └── wallets.service.ts      Reads/writes: raw SQL v2 (user_wallets,
    │                               wallet_balance_snapshots, wallet_protocol_positions)
    │                               On refresh: spawns indexer script 80-stellar-wallet-balance-snapshots.ts
    └── network/
        ├── network.controller.ts   GET /v1/network/stats
        └── network.service.ts      NO database access — fetches external APIs live:
                                    CoinGecko, api.llama.fi, stablecoins.llama.fi,
                                    api.stellar.expert, horizon.stellar.org/fee_stats
```

### API controller → schema mapping

| Route prefix | Controller | Schema accessed |
|---|---|---|
| `/protocols`, `/venues`, `/venues/:key/snapshots` | AppController | **Prisma ORM** — `"Protocol"`, `"Venue"`, `"Snapshot"` |
| `/v1/protocols` | StellarController | **Raw SQL v1** — `venues`, `protocol_metrics_latest` |
| `/v1/pools`, `/v1/pools/:slug` | StellarController | **Raw SQL v1** — `entities`, `venues`, `pool_metrics_latest`, `reserve_snapshots`, `asset_prices`, `normalized_events`, `entity_assets`, `assets` |
| `/v1/wallets/*` | WalletsController | **Raw SQL v2** — `user_wallets`, `wallet_balance_snapshots`, `wallet_protocol_positions` |
| `/v1/network/stats` | NetworkController | **No DB** — external HTTP only |

---

## apps/indexer

**Runner: tsx. No build step. Entry points called directly with `pnpm tsx src/...`.**

```
apps/indexer/src/
├── run-once.ts          npm run:once  — seed Prisma tables (Protocol/Venue/Snapshot) — LEGACY
├── run-blend.ts         npm run:blend — Blend → Prisma Snapshot — LEGACY PATH
├── run-horizon.ts       npm run:horizon — Horizon activity → Prisma Snapshot — LEGACY PATH
├── run-defindex.ts      npm run:defindex — scaffolded, not validated, out of scope for T1-D1
│
├── lib/
│   └── protocols/       Protocol adapter logic (fetch / normalize / persist)
│       ├── blend/
│       │   ├── fetch-pool-state.ts       Soroban RPC via @blend-capital/blend-sdk
│       │   ├── persist-pool-state.ts     → venues, entities, assets, entity_assets,
│       │   │                                pool_snapshots, reserve_snapshots
│       │   ├── compute-pool-metrics.ts   Computes TVL/APY from reserve_snapshots + asset_prices
│       │   └── persist-pool-metrics.ts   → pool_metrics_latest
│       ├── soroswap/
│       │   ├── fetch-pair-state.ts       Soroban RPC (simulateContractRead: token_0, token_1, get_reserves)
│       │   ├── fetch-pair-events.ts      Soroban RPC (getEvents)
│       │   ├── normalize-pair-events.ts  → SoroswapNormalizedEventRow[]
│       │   ├── persist-pair-events.ts    → normalized_events
│       │   └── persist-pair-metrics.ts   → pool_metrics_latest (reads reserve_snapshots + asset_prices)
│       ├── aquarius/
│       │   ├── fetch-pool-state.ts       Soroban RPC (simulateContractRead: get_info, get_reserves, get_tokens)
│       │   ├── fetch-pool-events.ts      Soroban RPC (getEvents)
│       │   ├── normalize-pool-events.ts  → AquariusNormalizedEventRow[]
│       │   ├── persist-pool-events.ts    → normalized_events
│       │   └── persist-pool-metrics.ts   → pool_metrics_latest (reads reserve_snapshots + asset_prices)
│       └── stellar-native/
│           ├── fetch-pools.ts            Horizon REST GET /liquidity_pools
│           ├── persist-pools.ts          → entities, entity_assets
│           ├── persist-pool-snapshots.ts → pool_snapshots
│           ├── persist-pool-metrics.ts   → pool_metrics_latest (reads pool_snapshots + asset_prices)
│           ├── asset-utils.ts
│           └── types.ts
│
└── scripts/
    ├── discovery/       Exploration and onboarding scripts (numbered 01–73)
    ├── bootstrap/       One-time setup scripts (upsert venue/entity/asset seed data)
    ├── shared/          db.ts, lookup.ts, prices.ts, pricing.ts, pricing-config.ts, scaling.ts
    ├── wallets/         80-stellar-wallet-balance-snapshots.ts (wallet balance refresh)
    └── ingest/          Executable refresh scripts (see classification below)
```

---

## Canonical refresh chain

`pnpm -C apps/indexer job:refresh` is the production entry point.

```
job:refresh
  └── 72-run-refresh-job.ts          Sets env vars (STELLAR_RPC_URL, LEDGER_LOOKBACK, etc.)
        └── 71-refresh-all-metrics.ts  Orchestrator — spawns steps sequentially:
              │
              ├── Step 1  62-price-reference-assets.ts
              │           Fetches CoinGecko prices for known assets → asset_prices
              │
              ├── Step 2  63-price-soroswap-derived.ts  (once per soroswap entity)
              │           Derives prices from Soroswap reserves → asset_prices
              │
              ├── Step 3  run-blend-pool-refresh.ts  (once per lending_pool entity)
              │           → lib/protocols/blend/{fetch-pool-state, persist-pool-state,
              │                                   compute-pool-metrics, persist-pool-metrics}
              │           Writes: venues, entities, assets, entity_assets,
              │                   pool_snapshots, reserve_snapshots, pool_metrics_latest
              │
              ├── Step 4  run-soroswap-pair-refresh.ts  (once per amm_pool entity)
              │           → lib/protocols/soroswap/{fetch-pair-state, fetch-pair-events,
              │                                     normalize-pair-events, persist-pair-events,
              │                                     persist-pair-metrics}
              │           Writes: normalized_events, pool_metrics_latest
              │
              ├── Step 5  run-aquarius-pool-refresh.ts  (once per amm_pool entity)
              │           → lib/protocols/aquarius/{fetch-pool-state, fetch-pool-events,
              │                                    normalize-pool-events, persist-pool-events,
              │                                    persist-pool-metrics}
              │           Writes: normalized_events, pool_metrics_latest
              │           Note: errors are caught and logged, not fatal to the job
              │
              ├── Step 6  run-stellar-native-refresh.ts
              │           → lib/protocols/stellar-native/{fetch-pools, persist-pools,
              │                                            persist-pool-snapshots, persist-pool-metrics}
              │           Source: Horizon /liquidity_pools (top 50 by desc order)
              │           Writes: entities, entity_assets, pool_snapshots, pool_metrics_latest
              │
              ├── Step 7  70-protocol-persist-metrics.ts
              │           Aggregates pool_metrics_latest → protocol_metrics_latest
              │           Covers: blend, soroswap, aquarius
              │
              ├── Step 8  run-allbridge-bridge-refresh.ts  (single bridge contract; non-fatal)
              │           → lib/protocols/allbridge/{fetch-bridge-events, normalize-bridge-events,
              │                                       persist-bridge-flows}
              │           Source: Soroban RPC getEvents on the Allbridge Core bridge contract
              │                   (inflow source chain via the receive_tokens invocation args)
              │           Writes: bridge_flows
              │
              └── Step 9  73-network-stats-refresh.ts  (external providers; non-fatal)
                          Writes: network_stats_latest
```

Pool/entity discovery for steps 3–5 comes from a DB query in 71 (`select from entities join venues where v.slug = $1`), not from env vars. Entities must already exist in the DB (seeded by bootstrap scripts or prior onboarding).

---

## scripts/ingest/ — file classification

Three distinct categories of files exist in `apps/indexer/src/scripts/ingest/`.
**Do not delete any file.** Legacy files are retained as reference.

### (a) Active refresh — called by 71-refresh-all-metrics.ts

| File | Called at step |
|---|---|
| `62-price-reference-assets.ts` | Step 1 |
| `63-price-soroswap-derived.ts` | Step 2 |
| `run-blend-pool-refresh.ts` | Step 3 |
| `run-soroswap-pair-refresh.ts` | Step 4 |
| `run-aquarius-pool-refresh.ts` | Step 5 |
| `run-stellar-native-refresh.ts` | Step 6 |
| `70-protocol-persist-metrics.ts` | Step 7 |
| `run-allbridge-bridge-refresh.ts` | Step 8 (Allbridge bridge flows; non-fatal) |
| `73-network-stats-refresh.ts` | Step 9 (non-fatal) |

### (b) Active onboarding — referenced in the Soroswap pair onboarding checklist

These files are not called programmatically by the refresh pipeline, but are required steps in
the manual onboarding workflow for adding a new Soroswap pair.
The checklist is generated by `scripts/discovery/72-soroswap-onboard-from-token-pair.ts`
(which prints `nextCommands` to stdout and JSON — it does not spawn them automatically).

| File | Role in onboarding |
|---|---|
| `soroswap-insert-events.ts` | Backfill historical events for a new pair |
| `soroswap-insert-snapshots.ts` | Seed initial reserve snapshots |
| `66-soroswap-pool-metrics-v1.ts` | Compute initial pool metrics |
| `69-soroswap-persist-pool-metrics.ts` | Persist computed metrics to pool_metrics_latest |

The full onboarding sequence also uses scripts from `scripts/discovery/` (55→61) and
`scripts/bootstrap/soroswap-upsert-core.ts`.

### (c) Legacy — not referenced by any active script or onboarding path

These are superseded by the current lib/protocols-based pipeline. Retained for reference.

| File | Superseded by |
|---|---|
| `64-asset-prices-latest-report.ts` | Inline in 71 pipeline |
| `65-blend-pool-metrics-v1.ts` | `run-blend-pool-refresh.ts` + lib/protocols/blend |
| `66-aquarius-pool-metrics-v1.ts` | `run-aquarius-pool-refresh.ts` + lib/protocols/aquarius |
| `67-protocol-metrics-v1.ts` | `70-protocol-persist-metrics.ts` |
| `68-blend-persist-pool-metrics.ts` | `run-blend-pool-refresh.ts` step |
| `69-aquarius-persist-pool-metrics.ts` | `run-aquarius-pool-refresh.ts` step |
| `69-soroswap-persist-pool-metrics.ts` | `run-soroswap-pair-refresh.ts` step (except when used in onboarding, see above) |
| `aquarius-insert-events.ts` | `run-aquarius-pool-refresh.ts` |
| `aquarius-insert-snapshots.ts` | `run-aquarius-pool-refresh.ts` |
| `blend-insert-events.ts` | `run-blend-pool-refresh.ts` |
| `blend-insert-snapshots.ts` | `run-blend-pool-refresh.ts` |
| `run-aquarius-refresh.ts` | `run-aquarius-pool-refresh.ts` (note: distinct filename) |
| `run-soroswap-refresh.ts` | `run-soroswap-pair-refresh.ts` (note: distinct filename) |
| `soroswap-insert-events.ts` | See (b) — onboarding only |
| `soroswap-insert-snapshots.ts` | See (b) — onboarding only |

Note: `soroswap-insert-events.ts` and `soroswap-insert-snapshots.ts` appear in both (b) and (c)
because they are legacy in the refresh path but live in the onboarding path.

---

## scripts/discovery/ — exploration and onboarding tooling

Numbered scripts (01–73) used during protocol exploration and pair onboarding. Not part of the
recurring refresh job. Notable active ones:

| File | Purpose |
|---|---|
| `00-common.ts` | Shared utilities (rpcCall, simulateContractRead, nowIso, loadJson, saveJson) |
| `71-soroswap-resolve-pair-from-token-pair.ts` | Resolve a Soroswap pair ID from two token addresses |
| `72-soroswap-onboard-from-token-pair.ts` | Generate the onboarding command checklist for a new pair |
| `73-soroswap-dump-pairs-token-map.ts` | Dump known pair → token mappings |

---

## scripts/bootstrap/ — one-time setup

Run once per protocol to seed `venues`, `entities`, and `assets` before the refresh pipeline
can operate. The refresh job queries these rows to find which pools to refresh.

| File | Writes |
|---|---|
| `blend-upsert-core.ts` | venues + entities + assets for Blend |
| `soroswap-upsert-core.ts` | venues + entities + assets for Soroswap |
| `aquarius-upsert-core.ts` | venues + entities + assets for Aquarius |
| `allbridge-upsert-core.ts` | `allbridge` venue (`venue_type='bridge'`) + USDC asset (no entities — single bridge contract) |

Stellar-native entities are created dynamically by `run-stellar-native-refresh.ts` itself (no bootstrap required).

---

## packages/db

Contains only the Prisma schema and its single migration. This manages the **legacy** tables
(`"Protocol"`, `"Venue"`, `"Snapshot"`) only. The v1/v2 raw SQL schemas are applied manually
from `apps/api/src/db/`.

```
packages/db/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│       └── 20260312113641_init/migration.sql
└── package.json
```

---

## Data source summary

| Protocol | State source | Event source | Written by |
|---|---|---|---|
| Blend | Soroban RPC (`@blend-capital/blend-sdk`) | — (no events, uses pool state) | `run-blend-pool-refresh.ts` |
| Soroswap | Soroban RPC (`simulateContractRead`) | Soroban RPC (`getEvents`) | `run-soroswap-pair-refresh.ts` |
| Aquarius | Soroban RPC (`simulateContractRead`) | Soroban RPC (`getEvents`) | `run-aquarius-pool-refresh.ts` |
| Stellar-native | Horizon REST (`/liquidity_pools`) | — | `run-stellar-native-refresh.ts` |
| Allbridge (bridge) | — (event-driven) | Soroban RPC (`getEvents` + `getTransaction` for inflow source chain) | `run-allbridge-bridge-refresh.ts` |
| Asset prices | CoinGecko REST + Soroswap-derived | — | `62-price-reference-assets.ts`, `63-price-soroswap-derived.ts` |
| Wallet balances | Horizon REST (`/accounts/:id`) | — | `80-stellar-wallet-balance-snapshots.ts` |

---

## Common commands (confirmed from package.json)

```bash
# Local services
docker compose up -d                        # postgres:16 (5432) + redis:7 (6379)

# Database — raw SQL schemas (apply manually)
psql $DATABASE_URL -f apps/api/src/db/stellar_v1.sql
psql $DATABASE_URL -f apps/api/src/db/stellar_v1_metrics.sql
psql $DATABASE_URL -f apps/api/src/db/stellar_v2_multiwallet.sql

# Database — Prisma legacy schema
pnpm -C packages/db prisma:migrate
pnpm -C packages/db prisma:generate
pnpm -C packages/db prisma:studio

# Indexer — production refresh (canonical entry point)
pnpm -C apps/indexer job:refresh            # 72 → 71 → all steps

# Indexer — bootstrap (run once per protocol before first refresh)
pnpm -C apps/indexer tsx src/scripts/bootstrap/blend-upsert-core.ts
pnpm -C apps/indexer tsx src/scripts/bootstrap/soroswap-upsert-core.ts
pnpm -C apps/indexer tsx src/scripts/bootstrap/aquarius-upsert-core.ts

# Indexer — legacy top-level (Prisma tables, not v1 pipeline)
pnpm -C apps/indexer run:once               # Prisma seed
pnpm -C apps/indexer run:blend              # Prisma Blend snapshot
pnpm -C apps/indexer run:horizon            # Prisma Horizon snapshot
pnpm -C apps/indexer run:defindex           # scaffolded, not validated

# API
pnpm -C apps/api start:dev
pnpm -C apps/api build
pnpm -C apps/api lint
pnpm -C apps/api test

# Web
pnpm -C apps/web dev
pnpm -C apps/web build                      # also runs vue-tsc typecheck
```

---

## Key entry points — quick reference

| Purpose | File |
|---|---|
| API routes overview | `apps/api/src/app.controller.ts` (legacy) + `apps/api/src/modules/stellar/stellar.controller.ts` |
| v1 DB queries | `apps/api/src/modules/stellar/stellar.service.ts` |
| Wallet DB queries | `apps/api/src/modules/wallets/wallets.service.ts` |
| Refresh orchestrator | `apps/indexer/src/scripts/ingest/71-refresh-all-metrics.ts` |
| Refresh entry point | `apps/indexer/src/scripts/ingest/72-run-refresh-job.ts` |
| Blend adapter | `apps/indexer/src/lib/protocols/blend/` |
| Soroswap adapter | `apps/indexer/src/lib/protocols/soroswap/` |
| Aquarius adapter | `apps/indexer/src/lib/protocols/aquarius/` |
| Stellar-native adapter | `apps/indexer/src/lib/protocols/stellar-native/` |
| Allbridge bridge adapter | `apps/indexer/src/lib/protocols/allbridge/` |
| v1 schema DDL | `apps/api/src/db/stellar_v1.sql` + `stellar_v1_metrics.sql` |
| v2 schema DDL | `apps/api/src/db/stellar_v2_multiwallet.sql` |
| Prisma schema (legacy) | `packages/db/prisma/schema.prisma` |
