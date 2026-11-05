# Probe 01 — Read Model for the In-App Alerting Engine (D2)

**Type:** read-only recon. No files (other than this report) were modified; no migrations
were created or run; the DB was not mutated.

**Method:** every claim below is quoted from the actual source. Where a thing could not be
established, it is stated as such explicitly.

**Sources inspected:**
- `apps/api/src/db/stellar_v2_multiwallet.sql` (raw SQL v2 schema — authoritative for the wallet layer)
- `apps/indexer/src/scripts/wallets/81-stellar-wallet-blend-positions.ts` (write path)
- `apps/indexer/src/lib/protocols/blend/resolve-user-health.ts` (HF computation)
- `apps/api/src/modules/wallets/wallets.service.ts` (read path)
- `docs/deployment.md`, `docs/runbooks.md`, `docs/data-model.md` (how schema is applied)
- `packages/db/prisma/migrations/` (Prisma — legacy, see §5)

---

## 1. `wallet_pool_health` table

### 1a. Exact DDL

Defined **only** in raw SQL — `apps/api/src/db/stellar_v2_multiwallet.sql:133-155`. There is
**no TypeORM entity and no Prisma model** for this table (see §5). Verbatim:

```sql
create table if not exists wallet_pool_health (
  id                   uuid primary key default gen_random_uuid(),
  user_wallet_id       uuid not null references user_wallets(id) on delete cascade,
  venue_id             uuid references venues(id) on delete set null,    -- blend venue
  entity_id            uuid references entities(id) on delete set null,  -- the specific pool
  health_factor        numeric,            -- NULL = no debt (not liquidatable) / undefined
  total_collateral_usd numeric,            -- effective collateral (after collateral factors)
  total_debt_usd       numeric,            -- effective liabilities
  borrow_limit_usd     numeric,            -- remaining borrow capacity (nullable)
  net_apy              numeric,            -- optional, nullable
  positions_count      integer,            -- # of asset positions backing this row
  snapshot_at          timestamptz not null,   -- freshness
  metadata             jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists wallet_pool_health_wallet_idx on wallet_pool_health (user_wallet_id);
create index if not exists wallet_pool_health_snap_idx   on wallet_pool_health (snapshot_at desc);
create index if not exists wallet_pool_health_wallet_snap_idx
  on wallet_pool_health (user_wallet_id, snapshot_at desc);
-- D2 will scan "wallets at risk" — partial index on real (debt-bearing) health factors:
create index if not exists wallet_pool_health_hf_idx
  on wallet_pool_health (health_factor) where health_factor is not null;
```

**Columns (type / nullability):**

| column | type | nullable | notes |
|---|---|---|---|
| `id` | uuid | NOT NULL | PK, default `gen_random_uuid()` |
| `user_wallet_id` | uuid | NOT NULL | FK → `user_wallets(id)` **ON DELETE CASCADE** |
| `venue_id` | uuid | nullable | FK → `venues(id)` ON DELETE SET NULL |
| `entity_id` | uuid | nullable | FK → `entities(id)` ON DELETE SET NULL — the pool |
| `health_factor` | numeric | **nullable** | NULL = no debt (see §2) |
| `total_collateral_usd` | numeric | nullable | effective collateral |
| `total_debt_usd` | numeric | nullable | effective liabilities |
| `borrow_limit_usd` | numeric | nullable | remaining borrow capacity |
| `net_apy` | numeric | nullable | |
| `positions_count` | integer | nullable | |
| `snapshot_at` | timestamptz | NOT NULL | freshness key |
| `metadata` | jsonb | nullable | (no default — unlike the other v2 tables which default `'{}'::jsonb`) |
| `created_at` | timestamptz | NOT NULL | default `now()` |

- **PK:** `id` only.
- **UNIQUE constraints:** **NONE.** There is no unique constraint on
  `(user_wallet_id, entity_id, snapshot_at)` or any natural key. This is the single most
  important fact for D2 — see the PIVOT below and §1c.
- **Indexes:** the four listed above (`_wallet_idx`, `_snap_idx`, `_wallet_snap_idx`, and the
  partial `_hf_idx` on `health_factor where health_factor is not null`).
- **FKs:** `user_wallet_id` (CASCADE), `venue_id` (SET NULL), `entity_id` (SET NULL).

### 1b. CRITICAL PIVOT — time-series append-only, NOT current-state upsert

**It is append-only time-series, but NOT a Timescale hypertable.** Evidence:

1. **No upsert, no unique key.** The write is a plain `INSERT` with no `ON CONFLICT`
   (`81-stellar-wallet-blend-positions.ts:197-226`):
   ```
   await client.query(
     `insert into wallet_pool_health (
        user_wallet_id, venue_id, entity_id,
        health_factor, total_collateral_usd, total_debt_usd,
        borrow_limit_usd, net_apy, positions_count, snapshot_at, metadata
      ) values ( ... )`,
     [...]
   );
   ```
   No `ON CONFLICT … DO UPDATE`. Combined with the absence of any UNIQUE constraint (§1a),
   **every refresh appends new rows** — the same `(wallet, pool)` accumulates one row per run,
   distinguished by `snapshot_at`. This is identical to the `wallet_balance_snapshots` /
   `wallet_protocol_positions` pattern and is called out in the schema comment
   (`stellar_v2_multiwallet.sql:127-131`): *"Snapshot-based (like wallet_balance_snapshots) so
   D2 can read both current HF and the previous one for delta detection."*

2. **No Timescale.** `grep -niE "create_hypertable|timescale|hypertable"` across all `*.sql`
   and `*.ts` returns **zero matches**. It is a plain Postgres table. `snapshot_at` is NOT in
   the PK (PK is `id` alone). So: time-series by convention (append + `snapshot_at`), not by a
   hypertable mechanism.

**Bottom line:** treat `wallet_pool_health` as an **append-only snapshot log**. The current
state of a `(wallet, pool)` is its row with the greatest `snapshot_at`. The previous state
(for delta/threshold-crossing detection) is the second-greatest — the table is explicitly
designed to support that.

### 1c. Existing "latest per key" read strategy (reusable)

There is **no view, no continuous aggregate, and no DISTINCT-ON helper** for
`wallet_pool_health` specifically. But the API already implements latest-snapshot reads two
ways in `wallets.service.ts`, and both rely on a **whole-refresh-atomicity assumption** worth
understanding before D2 reuses them:

- **Per-wallet (all pools)** — `getWalletPositions`, `wallets.service.ts:837-862`:
  ```sql
  with latest as (
    select max(snapshot_at) as snap
    from wallet_pool_health
    where user_wallet_id = $1::uuid
  )
  select ... from wallet_pool_health h
  join latest l on h.snapshot_at = l.snap
  where h.user_wallet_id = $1::uuid
  ```
- **Cross-wallet for a user (portfolio)** — `getPortfolioOverview`, `wallets.service.ts:692-719`:
  ```sql
  with latest as (
    select h.user_wallet_id, max(h.snapshot_at) as snap
    from wallet_pool_health h
    join user_wallets uw on uw.id = h.user_wallet_id
    where uw.user_id = $1::uuid
    group by h.user_wallet_id
  )
  select ... from wallet_pool_health h
  join latest l on l.user_wallet_id = h.user_wallet_id and l.snap = h.snapshot_at
  ...
  ```

**Caveat for D2:** both queries take `max(snapshot_at)` **per wallet, not per (wallet, pool)**,
then return *all* rows at that timestamp. This is correct **only because script 81 writes every
pool for a wallet in a single run sharing one `snapshotAt`** (`81-...:96` `const snapshotAt =
nowIso();` is computed once, before the wallet/pool loops, and reused for every insert). It also
means a pool the wallet has **exited** correctly disappears (it's absent from the newest
snapshot). If D2 ever needs strict per-(wallet,pool) latest independent of that atomicity
assumption, use `distinct on (user_wallet_id, entity_id) … order by … snapshot_at desc,
created_at desc` — the codebase already uses exactly this `distinct on (...key...) order by …
snapshot_at desc, created_at desc` idiom for balances/positions (`wallets.service.ts:640-676`,
`777-801`). `created_at` is the documented tiebreaker for same-`snapshot_at` rows.

---

## 2. `health_factor` column — write path & no-debt semantics

### 2a. Type + nullability
`numeric`, **nullable** (`stellar_v2_multiwallet.sql:138`).

### 2b. WRITE path (computation → persistence)
- **Computed** in `apps/indexer/src/lib/protocols/blend/resolve-user-health.ts:30-57`. It does
  **not** hand-roll Blend math; it builds the SDK's `PositionsEstimate` and divides effective
  collateral by effective liabilities:
  ```ts
  const totalDebtUsd = estimate.totalEffectiveLiabilities;
  const totalCollateralUsd = estimate.totalEffectiveCollateral;
  const healthFactor =
    totalDebtUsd > 0 ? totalCollateralUsd / totalDebtUsd : null;
  ```
- **Persisted** in `81-stellar-wallet-blend-positions.ts:206-210` — `health.healthFactor` is
  bound straight into the `insert` (param `$4`), no transformation.

### 2c. CRITICAL — value stored when a position has no debt: **NULL**

Quoted directly (`resolve-user-health.ts:42-45`):
```ts
// No debt → HF undefined (division by zero). Store NULL, never Infinity or a
// sentinel — D2 treats NULL as "no liability, no health alert applicable".
const healthFactor =
  totalDebtUsd > 0 ? totalCollateralUsd / totalDebtUsd : null;
```

So **no-debt ⇒ `NULL`**. Never `Infinity`, never a large-number sentinel, never `0`. The
semantic is fixed and documented in two places: the resolver comment above, the column comment
(`stellar_v2_multiwallet.sql:138` `-- NULL = no debt …`), and the type comment
(`resolve-user-health.ts:18-19`): *"HF > 1 healthy; HF <= 1 liquidatable."*

**Consequences for D2:**
- A "health factor below X" rule must treat `NULL` as **not-applicable / no-fire**, not as
  `0` or `-∞`. (`0` would falsely trip a low-HF alarm on a supply-only, zero-risk position.)
- The partial index `wallet_pool_health_hf_idx … where health_factor is not null` is purpose-built
  for exactly the evaluator scan "debt-bearing positions whose HF < threshold" — use it (keep the
  `health_factor is not null` predicate in the WHERE so the planner picks the partial index).
- The API read path already sorts NULLs last for HF (`compareHealthFactorAscNullsLast`,
  referenced `wallets.service.ts:740-742`), consistent with "NULL = safe / no alert."

---

## 3. Scope mapping for rules

### 3a. user→wallet mapping
**Yes** — `user_wallets` (`stellar_v2_multiwallet.sql:5-19`) is the mapping. `user_id uuid not
null` per row; a user owns many wallets. Uniqueness is `(user_id, chain, address)`
(`uq_user_wallets_user_chain_address`). All wallet-layer tables FK to `user_wallets(id)`, so the
path to a user is always `… → user_wallets.user_id`. There is no separate `users` table in the
v2 SQL (user identity is an external/opaque uuid; `WalletsController` is keyed by `userId`).

### 3b. signer vs watch-only (from D1 Gap A)
Represented by `is_active_signer boolean not null default false`
(`stellar_v2_multiwallet.sql:114-120`), added by an `alter table` in the same file:
```sql
alter table user_wallets
  add column if not exists is_active_signer boolean not null default false;
create unique index if not exists user_wallets_one_signer_per_user
  on user_wallets (user_id) where is_active_signer;
```
- `is_active_signer = false` ⇒ **watch-only** (the default; every tracked wallet starts here).
- `is_active_signer = true` ⇒ the **active signer**, and a **DB-enforced singleton per user**
  (partial unique index). Comment (`:109-112`): it is *orthogonal* to `is_active` (the refresh
  gate) and `is_primary` (the showcase/default wallet) — **do not merge these three flags.**
- Relevant to D2: positions/health are indexed for **both** signer and watch-only wallets
  (`81-…` header: *"signer AND watch-only — positions are public on-chain"*, and the wallet
  selection gate is `is_active = true`, **not** `is_active_signer`). So an alert can legitimately
  target a watch-only wallet. Whether a *low-HF alert* on a watch-only wallet should also offer a
  "rebalance" action is a product question — the data supports alerting on both; only the
  *action/signing* step is signer-gated.

### 3c. finest rule grain supported by the real schema
Each `wallet_pool_health` row is keyed (in practice) by `(user_wallet_id, entity_id)` =
**(wallet, pool)** at a `snapshot_at`. So the natural grains, finest → coarsest:

1. **(wallet, pool)** — finest. One `wallet_pool_health` row. `health_factor` lives here.
   *(`venue_id` is always Blend today, so (wallet, pool) ≈ (wallet, venue, pool).)*
2. **(wallet, all pools)** — aggregate over a wallet's rows (the `getWalletPositions` shape).
3. **(user, pool) across the user's wallets** — join `wallet_pool_health → user_wallets` on
   `user_id`, filter `entity_id`. Supported (the portfolio query already joins this way).
4. **(user, all wallets, all pools)** — coarsest; the portfolio rollup.

Sub-(wallet,pool) grain (per-asset) exists in `wallet_protocol_positions` (`position_type`
`supply`/`borrow` per `asset_id`), but **HF is only defined at pool level** — there is no
per-asset health factor. So **(wallet, pool) is the finest grain for a health-factor rule.**

---

## 4. Existing alerting scaffolding → **NONE. Start net-new.**

`grep -niE "\b(alert|rule|notification|cooldown|last_fired|dedup)"` across `apps/api` and
`apps/indexer`:
- **No** `alert`, `rule`, `notification`, `cooldown`, `last_fired`, or `dedup` table, entity,
  module, or enum anywhere.
- The only `rule` hits are unrelated: pricing rules in
  `apps/indexer/src/scripts/ingest/62-price-reference-assets.ts` (a `PricingRule` discriminated
  union for asset price sourcing — not alerting).
- No NestJS `AlertsModule`/`NotificationsModule`; the wallet feature is `WalletsController` +
  `WalletsService` only.

**Conclusion: D2 alerting is net-new.** No dedup/cooldown/last-fired primitive exists to extend.

---

## 5. Migration tooling + convention

Two parallel mechanisms — and the wallet layer uses the **raw SQL** one:

- **Raw SQL (authoritative for v1 + v2, including `wallet_pool_health`).** Plain `.sql` files in
  `apps/api/src/db/`, applied **manually via `psql -f`**, in order, idempotently (`create table
  if not exists`, `add column if not exists`, `create index if not exists`). From
  `docs/deployment.md:24-27` / `docs/runbooks.md:96-99`:
  ```
  psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1.sql
  psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_metrics.sql
  psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_bridge.sql
  psql "$DATABASE_URL" -f apps/api/src/db/stellar_v2_multiwallet.sql
  ```
  There is **no migration runner, no versioned/timestamped filenames, no down-migrations** for
  this family. Files are layered by concern (`_v1`, `_v1_metrics`, `_v1_bridge`,
  `_v2_multiwallet`); newer schema is appended either to the relevant file or as a new
  `stellar_*.sql` file, written idempotently so re-running is safe.

- **Prisma migrations (legacy — DO NOT use for D2).** `packages/db/prisma/migrations/` has a
  single `20260312113641_init/` covering only the legacy `Protocol`/`Venue`/`Snapshot` tables
  (PascalCase, `AppController` path). Per CLAUDE.md, Prisma models are **legacy/parallel, not
  served to the product**; the Prisma client elsewhere is used only as a raw-SQL connection
  (`$queryRawUnsafe`). `wallet_pool_health` has **no** Prisma model and must not get one.

**Convention for new D2 tables:** add a new raw SQL file (e.g.
`apps/api/src/db/stellar_v3_alerting.sql`) — or extend `stellar_v2_multiwallet.sql` if D2 is
considered part of the wallet layer — using `create table if not exists` / `create index if not
exists`, snake_case names, `uuid primary key default gen_random_uuid()`, `timestamptz … default
now()`, `jsonb metadata`, and FK `… references user_wallets(id) on delete cascade`. Then add the
`psql -f` line to `docs/deployment.md` and `docs/runbooks.md`. Read it from the API via
`prisma.$queryRawUnsafe`, exactly like `WalletsService`.

---

## DECISIONS UNBLOCKED

### (a) Rule scope grain — **store rules at (wallet, pool), evaluate at any coarser grain**
The finest unit with a health factor is **(wallet, pool)** (= `wallet_pool_health` row;
`venue_id` is implied since Blend is the only venue). Recommendation:
- Let a rule **target** `(user_id, optional wallet_id, optional entity_id/pool)`. NULL wallet =
  "all the user's wallets"; NULL pool = "all pools." This covers grains 1–4 in §3c with one
  table and matches how the API already filters (by `user_id`, optionally by `wallet_id`).
- Make `user_id` the mandatory anchor (every rule belongs to a user). FK the optional
  `user_wallet_id` to `user_wallets(id) on delete cascade` so deleting a wallet cleans up its
  rules.
- Don't model per-asset rules in D2 — HF is pool-level; per-asset is out of scope and
  `wallet_protocol_positions` has no HF.
- Watch-only wallets are valid alert targets (data is indexed for them). Only the *action/sign*
  follow-up is signer-gated — keep alerting and signing concerns separate.

### (b) Read strategy for the evaluator — **latest-per-(wallet,pool) via DISTINCT ON, keyed off the snapshot log**
`wallet_pool_health` is append-only (no upsert, no unique key, no Timescale — §1b). The
evaluator should read **current state = newest row per (wallet, pool)** and, for
threshold-crossing/edge-triggered alerts, the **previous row** too (the table was explicitly
built for this).
- Reuse the existing idiom but make it per-pool and robust to partial writes:
  ```sql
  select distinct on (h.user_wallet_id, h.entity_id)
         h.user_wallet_id, h.entity_id, h.health_factor, h.snapshot_at, ...
  from wallet_pool_health h
  join user_wallets uw on uw.id = h.user_wallet_id
  where uw.user_id = $1::uuid
    and h.health_factor is not null          -- lets the partial index do the work
  order by h.user_wallet_id, h.entity_id, h.snapshot_at desc, h.created_at desc;
  ```
  This is stricter than the API's `max(snapshot_at) per wallet` (§1c), which is safe only under
  whole-refresh atomicity; `distinct on` per pool is safe regardless and uses the documented
  `snapshot_at desc, created_at desc` tiebreaker.
- For edge-triggering, fetch the two newest rows per `(wallet, pool)` (window
  `row_number() over (partition by user_wallet_id, entity_id order by snapshot_at desc,
  created_at desc)` and keep `rn <= 2`) and fire only on a **crossing** (was ≥ threshold, now <
  threshold) rather than on every evaluation while below — this is the natural dedup primitive
  given there's no `last_fired` table yet (§4).
- Don't build a continuous aggregate / hypertable for D2 — volume is tiny (one row per wallet ×
  pool × refresh) and none exists; a plain query against the partial index is sufficient.

### (c) NULL / no-debt HF semantics — **NULL means "no liability → no health alert applicable"**
Fixed by the write path (§2c): no-debt ⇒ `NULL`, never a sentinel. The evaluator MUST:
- Treat `health_factor IS NULL` as **no-fire** for any low-HF rule (it is a supply-only / zero-risk
  position, the *safest* state — never the most dangerous).
- Keep `health_factor IS NOT NULL` in the WHERE so the planner uses
  `wallet_pool_health_hf_idx`.
- Interpret thresholds as: **HF ≤ 1 liquidatable, HF > 1 healthy** (per
  `resolve-user-health.ts:18-19`); a sensible default warn band is something like `1.0 < HF <
  1.25` — but the exact threshold is a product decision, not a schema constraint.
- For a NULL→non-NULL transition (user took on debt) or non-NULL→NULL (user fully repaid), decide
  per rule whether that's an informational event; the snapshot log supports detecting it but the
  current low-HF rule type should simply ignore NULL.
