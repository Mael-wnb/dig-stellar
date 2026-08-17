-- apps/api/src/db/stellar_v4_faucet.sql
--
-- R2 (Lot R — T3-D2): reward-faucet claims. THE MONEY PATH — one row per claim
-- attempt that passed eligibility, driving a single 5 XLM payout from DIG's own
-- hot treasury wallet (never user funds; see docs/security-invariants.md §9).
--
-- Additive, idempotent — apply manually like the other schema files (see
-- docs/runbooks.md "Apply raw SQL schemas"). Depends on action_witnesses
-- (stellar_v1_action_witness.sql).
--
-- Status machine (no other transitions exist):
--   pending → paid    (payout submitted and accepted; payout_tx_hash set)
--   pending → failed  (payout errored; failure_reason set. A failed row BLOCKS
--                      further claims by that wallet/user until founder review —
--                      payments are NEVER auto-retried, because an ambiguous
--                      failure, e.g. a submit timeout, may still have paid.)
-- A row STUCK in 'pending' > 5 min means the post-payout UPDATE failed (the
-- payout itself may or may not have happened): founder verifies the treasury's
-- outgoing payments on the explorer and resolves the row manually — same
-- procedure as a 'failed' row (R4 runbook).
--
-- One claim per wallet AND per user, EVER — DB-enforced via the two unique
-- indexes below, deliberately GLOBAL (not per-network): a wallet/user that
-- claimed during the testnet E2E cannot claim again after the mainnet flip
-- unless the founder clears the testnet rows first (runbook step at go-live).
-- Budget and velocity counts, by contrast, are network-scoped in the service.
create table if not exists faucet_claims (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,              -- the claiming (and payout destination) wallet
  user_id uuid not null,                     -- from the qualifying witness row
  witness_tx_hash text not null references action_witnesses(tx_hash),
  network text not null,                     -- 'testnet' | 'mainnet' (the paying network)
  status text not null default 'pending',    -- 'pending' | 'paid' | 'failed'
  reward_xlm numeric not null,               -- amount in force when the claim was made (auditable)
  payout_tx_hash text,                       -- set on paid
  failure_reason text,                       -- set on failed; never contains key material
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_faucet_claims_wallet
  on faucet_claims(lower(wallet_address));

create unique index if not exists uq_faucet_claims_user
  on faucet_claims(user_id);

create unique index if not exists uq_faucet_claims_witness
  on faucet_claims(witness_tx_hash);

create index if not exists idx_faucet_claims_network_created_at
  on faucet_claims(network, created_at desc);
