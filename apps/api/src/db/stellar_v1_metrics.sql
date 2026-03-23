create table if not exists pool_metrics_latest (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  as_of timestamptz not null,
  metric_type text not null,
  tvl_usd numeric,
  volume_24h_usd numeric,
  fees_24h_usd numeric,
  total_supplied_usd numeric,
  total_borrowed_usd numeric,
  net_liquidity_usd numeric,
  total_backstop_credit_usd numeric,
  weighted_supply_apy numeric,
  weighted_borrow_apy numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(entity_id, metric_type)
);

create index if not exists idx_pool_metrics_latest_entity_id
  on pool_metrics_latest(entity_id);

create index if not exists idx_pool_metrics_latest_as_of
  on pool_metrics_latest(as_of desc);

create table if not exists protocol_metrics_latest (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  as_of timestamptz not null,
  tvl_usd numeric,
  volume_24h_usd numeric,
  fees_24h_usd numeric,
  avg_supply_apy numeric,
  avg_borrow_apy numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(venue_id)
);

create index if not exists idx_protocol_metrics_latest_venue_id
  on protocol_metrics_latest(venue_id);

create index if not exists idx_protocol_metrics_latest_as_of
  on protocol_metrics_latest(as_of desc);