-- apps/api/src/db/stellar_v5_faucet_campaign2.sql
--
-- Lot R2 (T3-D2): reward campaign #2 — per-FAMILY first-action rewards.
-- Campaign 2 grants one reward per action family ('swap' | 'blend-supply')
-- instead of one per wallet ever: first verified swap AND first verified Blend
-- supply each earn the reward (max 2 claims per wallet). Everything else about
-- the money path (witness-gating, brakes, isolation — security-invariants §9)
-- is unchanged.
--
-- Apply manually like the other schema files (docs/runbooks.md "Apply raw SQL
-- schemas"), BEFORE deploying the campaign-2 API build. Idempotent; campaign-1
-- rows are preserved untouched as evidence (only labeled, never rewritten).
--
-- What changes:
--   1. faucet_claims.campaign       — which campaign the claim counts against.
--      Existing rows are campaign 1 (the column arrives with default 1, then
--      the default is dropped so new inserts must be explicit).
--   2. faucet_claims.action_family  — 'swap' | 'blend-supply', derived for
--      existing rows from the qualifying witness kind (sdex-swap -> swap,
--      blend-deposit -> blend-supply; withdraws never qualified).
--   3. Uniqueness moves from (wallet) / (user) GLOBAL to
--      (wallet, action_family, campaign) / (user, action_family, campaign).
--      The per-witness unique index is UNCHANGED: every claim still consumes a
--      distinct Horizon-verified executed tx, so a campaign-1 witness can never
--      pay twice. The campaign-2 "new execution only" rule (witness executed at
--      or after FAUCET_STARTS_AT) is enforced in the service on top of this.
--
-- Still deliberately NOT per-network (same caveat as v4): testnet E2E rows for
-- a (wallet, family) block the same claim after the mainnet flip — the founder
-- clears testnet rows before activation (runbook step, unchanged).

alter table faucet_claims add column if not exists campaign int not null default 1;
alter table faucet_claims add column if not exists action_family text not null default 'any';

-- Label existing (campaign-1) rows with the family of their qualifying witness.
-- Only rows still carrying the arrival placeholder are touched — re-running is
-- a no-op and campaign-2 rows (always inserted with an explicit family) are
-- never rewritten.
update faucet_claims fc
set action_family = case aw.kind
  when 'sdex-swap' then 'swap'
  when 'blend-deposit' then 'blend-supply'
  else 'any'
end
from action_witnesses aw
where aw.tx_hash = fc.witness_tx_hash
  and fc.action_family = 'any';

-- New inserts must state campaign + family explicitly — no silent mislabeling.
alter table faucet_claims alter column campaign drop default;
alter table faucet_claims alter column action_family drop default;

-- Uniqueness: one claim per (wallet, family, campaign) AND per (user, family,
-- campaign). Replaces the campaign-1 global one-per-wallet/user indexes.
drop index if exists uq_faucet_claims_wallet;
drop index if exists uq_faucet_claims_user;

create unique index if not exists uq_faucet_claims_wallet_family_campaign
  on faucet_claims(lower(wallet_address), action_family, campaign);

create unique index if not exists uq_faucet_claims_user_family_campaign
  on faucet_claims(user_id, action_family, campaign);
