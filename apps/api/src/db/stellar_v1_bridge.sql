-- Allbridge Core bridge flows (T2-D3). Idempotent, applied manually like stellar_v1*.sql.
create table if not exists bridge_flows (
  id                     uuid primary key default gen_random_uuid(),
  venue_id               uuid not null references venues(id) on delete cascade,
  direction              text not null,                 -- 'inflow' | 'outflow'
  counterparty_chain_id  integer,                       -- allbridgeChainId (source for inflow, destination for outflow)
  counterparty_chain     text,                          -- resolved symbol: 'ETH','BAS','ARB','SOL','TRX',...
  asset_id               uuid references assets(id) on delete set null,
  token_contract_id      text not null,
  token_symbol           text,
  amount_raw             numeric(78, 0) not null,  -- raw on-chain i128; MIXED precision: inflow=7 native USDC decimals, outflow=3 Allbridge system precision
  amount_scaled          numeric,                  -- amount_raw / 10^7 on inflow, / 10^3 on outflow (per-direction; see allbridge/normalize-bridge-events.ts)
  amount_usd             numeric,
  recipient              text,
  nonce                  text,
  contract_address       text not null,
  event_id               text not null,
  tx_hash                text not null,
  ledger                 bigint not null,
  occurred_at            timestamptz not null,
  metadata               jsonb,
  created_at             timestamptz not null default now()
);

create unique index if not exists bridge_flows_contract_event_uq on bridge_flows (contract_address, event_id);
create index if not exists bridge_flows_occurred_at_idx on bridge_flows (occurred_at desc);
create index if not exists bridge_flows_dir_chain_idx on bridge_flows (direction, counterparty_chain_id, occurred_at desc);
create index if not exists bridge_flows_venue_idx on bridge_flows (venue_id);
create index if not exists bridge_flows_asset_idx on bridge_flows (asset_id);
