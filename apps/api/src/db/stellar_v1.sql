create extension if not exists pgcrypto;

create table if not exists venues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  chain text not null,
  venue_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists entities (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  slug text not null unique,
  name text not null,
  entity_type text not null,
  contract_address text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_entities_venue_id on entities(venue_id);
create index if not exists idx_entities_contract_address on entities(contract_address);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  chain text not null,
  contract_address text not null unique,
  asset_type text not null,
  symbol text,
  name text,
  decimals integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_assets_symbol on assets(symbol);

create table if not exists entity_assets (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  role text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(entity_id, asset_id, role)
);

create index if not exists idx_entity_assets_entity_id on entity_assets(entity_id);
create index if not exists idx_entity_assets_asset_id on entity_assets(asset_id);

create table if not exists normalized_events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  contract_address text not null,
  event_id text not null,
  tx_hash text not null,
  ledger bigint not null,
  occurred_at timestamptz not null,
  event_name text not null,
  sub_event_name text,
  event_key text not null,
  caller_address text,
  token_in_asset_id uuid references assets(id) on delete set null,
  token_out_asset_id uuid references assets(id) on delete set null,
  token_amount_in_raw numeric,
  token_amount_out_raw numeric,
  token_amount_in_scaled numeric,
  token_amount_out_scaled numeric,
  in_successful_contract_call boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(contract_address, event_id)
);

create index if not exists idx_normalized_events_entity_id on normalized_events(entity_id);
create index if not exists idx_normalized_events_occurred_at on normalized_events(occurred_at desc);
create index if not exists idx_normalized_events_event_key on normalized_events(event_key);
create index if not exists idx_normalized_events_tx_hash on normalized_events(tx_hash);

create table if not exists pool_snapshots (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  snapshot_at timestamptz not null,
  pool_id text,
  pool_name text,
  reserve_count integer,
  total_events integer,
  total_deposits integer,
  total_swaps integer,
  total_exit_pool integer,
  unique_callers integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(entity_id, snapshot_at)
);

create index if not exists idx_pool_snapshots_entity_id on pool_snapshots(entity_id);
create index if not exists idx_pool_snapshots_snapshot_at on pool_snapshots(snapshot_at desc);

create table if not exists reserve_snapshots (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  snapshot_at timestamptz not null,
  symbol text,
  name text,
  decimals integer,
  enabled boolean,
  d_supply_raw numeric,
  b_supply_raw numeric,
  backstop_credit_raw numeric,
  d_supply_scaled numeric,
  b_supply_scaled numeric,
  backstop_credit_scaled numeric,
  supply_cap_raw numeric,
  supply_cap_scaled numeric,
  borrow_apr numeric,
  est_borrow_apy numeric,
  supply_apr numeric,
  est_supply_apy numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(entity_id, asset_id, snapshot_at)
);

create index if not exists idx_reserve_snapshots_entity_id on reserve_snapshots(entity_id);
create index if not exists idx_reserve_snapshots_asset_id on reserve_snapshots(asset_id);
create index if not exists idx_reserve_snapshots_snapshot_at on reserve_snapshots(snapshot_at desc);

create table if not exists asset_prices (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  price_usd numeric not null,
  source text not null,
  observed_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(asset_id, source, observed_at)
);

create index if not exists idx_asset_prices_asset_id on asset_prices(asset_id);
create index if not exists idx_asset_prices_observed_at on asset_prices(observed_at desc);

create table if not exists sync_cursors (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  cursor_key text not null,
  cursor_value text not null,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(source, cursor_key)
);