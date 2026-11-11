-- apps/api/src/db/stellar_v9_rewards.sql
--
-- Lot EP (EP5): daily XLM rewards on top of points. THIS IS A MONEY
-- PATH: a second server-side payout key (the rewards treasury secret env, read by
-- exactly one file, modules/rewards/rewards-payout.service.ts) pays real XLM from a
-- DIG-owned treasury to enrolled wallets. Security model:
-- docs/security-invariants.md §12 (INV-12.1 .. INV-12.4). Decided 2026-10-21
-- (docs/decisions/2026-10-21-points-have-no-monetary-value.md, EP5 update).
--
-- Depends on stellar_v1.sql (pgcrypto / gen_random_uuid()) and
-- stellar_v6_campaign.sql (campaign_enrollments, points_ledger: the points of a
-- day are the positive ledger rows whose counted_day is that day). Applied
-- AFTER v8, by hand like every other schema file (docs/runbooks.md "Apply raw
-- SQL schemas"), BEFORE deploying the EP5 api. Additive and idempotent
-- (create … if not exists). v6, v7 and v8 are unchanged. Deploys dark:
-- REWARDS_ENABLED defaults off; while dark nothing is allocated, nothing is
-- claimable and the treasury is never queried.
--
-- How the two tables are written (and by whom):
--   * reward_allocations — ONE writer for inserts: the award job
--     (apps/api/src/scripts/84-campaign-award.ts, step 5 "rewards", through
--     RewardsRepository.allocateClosedDays). For a CLOSED UTC day D (D < today,
--     plus a short grace after midnight), once and only once per day:
--       share(wallet) = min(pool × pointsOnDay(wallet) / Σ pointsOnDay(all
--       enrolled, non-excluded wallets with points > 0), cap)
--     computed in integer stroops (floor), stored with the pool and the cap that
--     were used. The undistributed remainder stays in the treasury. Excluded
--     addresses (REWARDS_EXCLUDED_ADDRESSES, team wallets) are never allocated
--     and never counted in the Σ (INV-12.4). The primary key is the idempotency
--     key: a re-run inserts nothing; a day with any row is never re-allocated.
--   * reward_claims — written by POST /v1/campaign/rewards/claim ONLY
--     (modules/rewards/rewards.service.ts): one transaction locks the wallet's
--     campaign_enrollments row, inserts the claim as 'paying' and moves the
--     wallet's 'claimable' allocations to 'paying' with the claim id; then ONE
--     native XLM payment for the total (memo 'dig-points') is sent, and both the
--     claim and its allocations become 'paid' (tx_hash) or 'failed'
--     (failure_reason). A failed payout is NEVER auto-retried (an ambiguous
--     submit may still have paid): rows stay 'failed' until founder review
--     (docs/runbooks.md "Rewards treasury").
--
-- Status transitions only move forward (INV-12.3): claimable → paying → paid |
-- failed on allocations, paying → paid | failed on claims. No code path deletes
-- a row of either table or moves a status backwards; a founder resolution of a
-- failed claim is a documented manual SQL.
--
-- Amounts are numeric(12, 7): XLM with its 7 decimals (stroops), never a float.
-- Addresses carry the same CHECK as every v6 table (validated uppercase StrKey).

-- ---------------------------------------------------------------------------
-- 1. Claims — one row per user-initiated claim, one payment per claim (INV-12.2).
--    Created first because reward_allocations.claim_id references it.
-- ---------------------------------------------------------------------------
create table if not exists reward_claims (
  id uuid primary key default gen_random_uuid(),
  campaign int not null,
  address text not null
    constraint reward_claims_address_check check (address ~ '^G[A-Z2-7]{55}$'),
  total_xlm numeric(12, 7) not null
    constraint reward_claims_total_xlm_check check (total_xlm > 0),
  status text not null
    constraint reward_claims_status_check check (status in ('paying', 'paid', 'failed')),
  tx_hash text unique,                       -- the ONE payment's hash; set when paid
  failure_reason text,                       -- set when failed; never key material
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint reward_claims_paid_check check (status <> 'paid' or (tx_hash is not null and paid_at is not null))
);

-- /me reads one wallet's paid claims; the claim transaction reads its last claim
-- (rate limit: one claim per wallet per hour) and its in-progress claim.
create index if not exists idx_reward_claims_campaign_address_status
  on reward_claims(campaign, lower(address), status);

-- ---------------------------------------------------------------------------
-- 2. Allocations — one row per (campaign, closed UTC day, wallet) with a
--    positive share. The pool and the cap used that day are stored on the row
--    so a later change of the env values never rewrites history.
-- ---------------------------------------------------------------------------
create table if not exists reward_allocations (
  campaign int not null,
  day date not null,                         -- the CLOSED UTC day the points were counted on
  address text not null
    constraint reward_allocations_address_check check (address ~ '^G[A-Z2-7]{55}$'),
  points_day int not null                    -- Σ positive points_ledger.points with counted_day = day
    constraint reward_allocations_points_day_check check (points_day > 0),
  pool_xlm numeric(12, 7) not null           -- REWARDS_DAILY_POOL_XLM used for this day
    constraint reward_allocations_pool_xlm_check check (pool_xlm >= 0),
  cap_xlm numeric(12, 7) not null            -- REWARDS_DAILY_CAP_XLM used for this day
    constraint reward_allocations_cap_xlm_check check (cap_xlm >= 0),
  share_xlm numeric(12, 7) not null          -- min(pool × points / Σ points, cap), floored to a stroop
    constraint reward_allocations_share_xlm_check check (share_xlm > 0 and share_xlm <= cap_xlm),
  status text not null default 'claimable'
    constraint reward_allocations_status_check check (status in ('claimable', 'paying', 'paid', 'failed')),
  claim_id uuid references reward_claims(id), -- set when the row leaves 'claimable'
  created_at timestamptz not null default now(),
  primary key (campaign, day, address),
  constraint reward_allocations_claim_check check ((status = 'claimable') = (claim_id is null))
);

-- /me and the claim transaction read one wallet's rows by status; the award job
-- asks "is this day already allocated?" by (campaign, day).
create index if not exists idx_reward_allocations_campaign_address_status
  on reward_allocations(campaign, lower(address), status);

create index if not exists idx_reward_allocations_campaign_day
  on reward_allocations(campaign, day);

create index if not exists idx_reward_allocations_claim_id
  on reward_allocations(claim_id) where claim_id is not null;
