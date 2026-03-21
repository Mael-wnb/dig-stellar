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