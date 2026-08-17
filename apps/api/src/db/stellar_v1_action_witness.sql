-- apps/api/src/db/stellar_v1_action_witness.sql
--
-- R1 (Lot R — T3-D2): execution witnesses. One row per VERIFIED on-chain
-- execution of a qualifying action (SDEX swap or Blend deposit) by a wallet
-- known to us, verified server-side against Horizon (never trusted from the
-- client). This is the eligibility primitive for the reward faucet (R2) and,
-- standalone, turns the build-side adoption counters (action_events) into
-- settled-volume evidence.
--
-- Additive, idempotent (create … if not exists) — apply manually like the other
-- v1/v2/v3 schema files (see docs/runbooks.md "Apply raw SQL schemas").
--
-- tx_hash is the PRIMARY KEY: re-witnessing the same tx is a no-op by
-- construction (insert … on conflict do nothing), so the endpoint is idempotent
-- and a client may safely retry.
--
-- Failed verifications are NEVER stored — a row here means every check passed
-- (tx successful on Horizon, source is a known wallet, a qualifying op with a
-- matching source exists, and a matching Dig build event was recorded within
-- the linking window). The min-notional rule is stored PER ROW (threshold +
-- outcome) so faucet eligibility stays auditable even if the env threshold
-- changes later.
create table if not exists action_witnesses (
  tx_hash text primary key,                  -- lowercase hex, 64 chars
  network text not null,                     -- 'testnet' | 'mainnet'
  wallet_address text not null,              -- tx source; public on-chain data (same rationale as action_events)
  user_id uuid not null,                     -- owning user_wallets.user_id at verification time
  kind text not null,                        -- 'sdex-swap' | 'blend-deposit'
  op_summary jsonb not null,                 -- audit trail: qualifying op, legs, prices used
  notional_xlm numeric,                      -- XLM-equivalent at verification-time prices; NULL = could not price honestly
  min_notional_xlm numeric not null,         -- the threshold in force when verified
  meets_min_notional boolean not null,       -- notional_xlm is not null AND >= min_notional_xlm
  action_event_id bigint,                    -- the linked build row (action_events.id), if still present
  ledger_closed_at timestamptz not null,     -- tx close time per Horizon
  verified_at timestamptz not null default now()
);

create index if not exists idx_action_witnesses_wallet
  on action_witnesses(lower(wallet_address));

create index if not exists idx_action_witnesses_user
  on action_witnesses(user_id);

create index if not exists idx_action_witnesses_verified_at
  on action_witnesses(verified_at desc);
