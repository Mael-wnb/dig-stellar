-- =========================================================
-- MULTIWALLET FOUNDATION
-- =========================================================

create table if not exists user_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  chain varchar(64) not null,
  address varchar(128) not null,
  label varchar(128),
  is_primary boolean not null default false,
  is_active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_user_wallets_user_chain_address
    unique (user_id, chain, address)
);

create index if not exists idx_user_wallets_user_id
  on user_wallets(user_id);

create index if not exists idx_user_wallets_user_chain
  on user_wallets(user_id, chain);

create index if not exists idx_user_wallets_chain_address
  on user_wallets(chain, address);



create table if not exists wallet_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_wallet_id uuid not null references user_wallets(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  asset_contract_id varchar(128),
  asset_symbol varchar(64),
  balance_raw numeric(78, 0) not null,
  balance_scaled numeric(38, 18),
  price_usd numeric(38, 18),
  balance_usd numeric(38, 18),
  snapshot_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_wallet_balance_snapshots_wallet_asset_snapshot
  on wallet_balance_snapshots(
    user_wallet_id,
    coalesce(asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(asset_contract_id, ''),
    snapshot_at
  );

create index if not exists idx_wallet_balance_snapshots_wallet_id
  on wallet_balance_snapshots(user_wallet_id);

create index if not exists idx_wallet_balance_snapshots_snapshot_at
  on wallet_balance_snapshots(snapshot_at desc);

create index if not exists idx_wallet_balance_snapshots_wallet_snapshot
  on wallet_balance_snapshots(user_wallet_id, snapshot_at desc);

create index if not exists idx_wallet_balance_snapshots_asset_id
  on wallet_balance_snapshots(asset_id);



create table if not exists wallet_protocol_positions (
  id uuid primary key default gen_random_uuid(),
  user_wallet_id uuid not null references user_wallets(id) on delete cascade,
  venue_id uuid references venues(id) on delete set null,
  entity_id uuid references entities(id) on delete set null,
  position_type varchar(64) not null,
  asset_id uuid references assets(id) on delete set null,
  asset_contract_id varchar(128),
  asset_symbol varchar(64),
  amount_raw numeric(78, 0),
  amount_scaled numeric(38, 18),
  amount_usd numeric(38, 18),
  snapshot_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_wallet_protocol_positions_wallet_id
  on wallet_protocol_positions(user_wallet_id);

create index if not exists idx_wallet_protocol_positions_snapshot_at
  on wallet_protocol_positions(snapshot_at desc);

create index if not exists idx_wallet_protocol_positions_wallet_snapshot
  on wallet_protocol_positions(user_wallet_id, snapshot_at desc);

create index if not exists idx_wallet_protocol_positions_venue_id
  on wallet_protocol_positions(venue_id);

create index if not exists idx_wallet_protocol_positions_entity_id
  on wallet_protocol_positions(entity_id);

create index if not exists idx_wallet_protocol_positions_type
  on wallet_protocol_positions(position_type);



-- =========================================================
-- T2-D1: ACTIVE-SIGNER DESIGNATION (active signer vs watch-only)
-- =========================================================
-- Singleton per user, DB-enforced (stronger than is_primary, which is only
-- app-maintained). Default false = watch-only, so every existing tracked wallet
-- becomes watch-only until explicitly promoted. Orthogonal to is_active (the
-- refresh gate) and is_primary (the showcase/default wallet) — do not merge.

alter table user_wallets
  add column if not exists is_active_signer boolean not null default false;

-- Stellar-only today, so (user_id) is the right singleton scope. Partial unique
-- index: at most one row per user may have is_active_signer = true.
create unique index if not exists user_wallets_one_signer_per_user
  on user_wallets (user_id) where is_active_signer;


-- =========================================================
-- T2-D1 Gap B: per-(wallet,pool) Blend risk summary
-- =========================================================
-- Health factor is first-class (D2's alert evaluator reads it flat — a value D2
-- will query must be a column, not jsonb). Per-asset supply/borrow rows live in
-- wallet_protocol_positions; this is the pool-level rollup. Snapshot-based (like
-- wallet_balance_snapshots) so D2 can read both current HF and the previous one
-- for delta detection. Mirrors the v1 split (reserve_snapshots per-asset vs
-- pool_metrics_latest per-pool).

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