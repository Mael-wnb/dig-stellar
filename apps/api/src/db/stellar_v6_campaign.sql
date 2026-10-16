-- apps/api/src/db/stellar_v6_campaign.sql
--
-- Lot EP (post-grant, EP1): Earn & Points campaign tables. POINTS ONLY — points
-- have no monetary value, are not convertible to money or tokens, and unlock
-- non-monetary perks. Nothing in this file (or in modules/campaign/) moves
-- funds or signs anything; the faucet treasury (security-invariants §9) stays
-- the only server-side key and is not referenced here.
--
-- Depends on:
--   * stellar_v1.sql                 — pgcrypto / gen_random_uuid()
--   * stellar_v2_multiwallet.sql     — user_id semantics (the beta "user" is the
--                                      user_wallets.user_id grouping key; there is
--                                      NO users table, so no FK, same as v3 alerting)
--   * stellar_v1_action_witness.sql  — action_witnesses: the ONLY source of
--                                      on-chain points (Horizon-verified executions);
--                                      FK target of points_ledger.witness_tx_hash and
--                                      referrals.credited_tx_hash
--
-- Apply AFTER stellar_v5_faucet_campaign2.sql, by hand like every other schema
-- file (docs/runbooks.md "Apply raw SQL schemas"), BEFORE deploying the EP1 api.
-- Additive, idempotent (create … if not exists). Deploys dark: the campaign
-- module is gated by CAMPAIGN_ENABLED (default off) + CAMPAIGN_STARTS_AT
-- (fail-closed when unset); the /v1/auth/* proof primitive is always on.
--
-- Addresses: every address column carries CHECK (address ~ '^G[A-Z2-7]{55}$'),
-- i.e. the validated uppercase StrKey form (the API trims and rejects anything
-- else with a 400). The lower(address) indexes stay for consistency with
-- action_witnesses, so a mixed-case duplicate could never slip past a unique
-- index even if the CHECK were ever relaxed.
--
-- "Day" is always UTC, explicitly: (now() at time zone 'utc')::date in SQL,
-- utcDay() in campaign-rules.ts. Never the session time zone.
--
-- Table order below is dependency order: points_ledger references
-- social_task_claims, so social_task_claims is created first.

-- ---------------------------------------------------------------------------
-- 1. Signed-nonce challenges (ownership proof, step 1). One row per challenge
--    served; the server rebuilds the message from THIS row before verifying,
--    never from the client's copy. Short TTL; single use. Consumption is ONE
--    atomic statement (no select-then-update):
--      update wallet_auth_challenges set used_at = now()
--       where nonce = $1 and address = $2 and used_at is null and expires_at > now()
--      returning message;
--    A failed verify also burns the nonce (used_at is set before the signature
--    check), so a wrong signature cannot be retried against the same challenge.
-- ---------------------------------------------------------------------------
create table if not exists wallet_auth_challenges (
  nonce text primary key,                    -- 32 hex chars, server-generated
  address text not null
    constraint wallet_auth_challenges_address_check check (address ~ '^G[A-Z2-7]{55}$'),
  message text not null,                     -- the exact text handed to the wallet
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz                        -- set by the atomic consume statement (success OR failure)
);

create index if not exists idx_wallet_auth_challenges_expires_at
  on wallet_auth_challenges(expires_at);

-- ---------------------------------------------------------------------------
-- 2. Ownership proofs (ownership proof, step 2). A row = the wallet's key signed
--    our challenge; verified with the PUBLIC key only
--    (modules/campaign/verify-wallet-signature.ts). user_id is the beta user the
--    proof is bound to; NULL when the proof was made without a session (the
--    wallet-connect recovery flow binds it on consumption: consumed_at set,
--    single use, max age RECOVERY_PROOF_MAX_AGE_SECONDS = 600).
--    This table is also the only honest "wallet connected with proof" event.
-- ---------------------------------------------------------------------------
create table if not exists wallet_ownership_proofs (
  id uuid primary key default gen_random_uuid(),
  address text not null
    constraint wallet_ownership_proofs_address_check check (address ~ '^G[A-Z2-7]{55}$'),
  user_id uuid,                              -- bound user; NULL = unbound (recovery flow)
  provider text,                             -- wallet kit provider id (e.g. 'freighter'); display only
  nonce text not null,                       -- the consumed challenge
  signature_variant text not null            -- which SEP-43 byte form the wallet signed
    constraint wallet_ownership_proofs_variant_check check (signature_variant in ('raw', 'sha256')),
  verified_at timestamptz not null default now(),
  consumed_at timestamptz                    -- set when an unbound proof is consumed by wallet-connect recovery
);

create unique index if not exists uq_wallet_ownership_proofs_address_user
  on wallet_ownership_proofs(lower(address), user_id) where user_id is not null;

create unique index if not exists uq_wallet_ownership_proofs_nonce
  on wallet_ownership_proofs(nonce);

create index if not exists idx_wallet_ownership_proofs_address
  on wallet_ownership_proofs(lower(address));

-- ---------------------------------------------------------------------------
-- 3. Enrollments. One per (campaign, wallet). Requires a proof for
--    (address, user_id) — enforced in the service, never assumed.
--    This row is also the per-wallet LOCK for every daily-capped write made
--    through the API (check-in, social claims): one transaction does
--    SELECT … FOR UPDATE on it, then counts, then inserts.
-- ---------------------------------------------------------------------------
create table if not exists campaign_enrollments (
  id uuid primary key default gen_random_uuid(),
  campaign int not null,
  address text not null
    constraint campaign_enrollments_address_check check (address ~ '^G[A-Z2-7]{55}$'),
  user_id uuid not null,
  referral_code text not null,               -- this wallet's own shareable code
  referred_by_code text,                     -- the code used at enrolment, if any (audit; referrals holds the link)
  enrolled_at timestamptz not null default now()
);

create unique index if not exists uq_campaign_enrollments_campaign_address
  on campaign_enrollments(campaign, lower(address));

create unique index if not exists uq_campaign_enrollments_campaign_code
  on campaign_enrollments(campaign, referral_code);

-- ---------------------------------------------------------------------------
-- 4. Social task claims (EP2 writes; created now so the schema ships once, and
--    because points_ledger references it). Self-declared in v1 (no X API).
--    One claim per task per wallet AND one handle per task across wallets =
--    one X handle per wallet. handle_normalized is user-supplied PII: never
--    logged, never in a public payload.
-- ---------------------------------------------------------------------------
create table if not exists social_task_claims (
  id uuid primary key default gen_random_uuid(),
  campaign int not null,
  address text not null
    constraint social_task_claims_address_check check (address ~ '^G[A-Z2-7]{55}$'),
  task_key text not null                     -- closed set in campaign-rules.ts (SOCIAL_TASKS)
    constraint social_task_claims_task_check check (task_key in ('x-follow', 'x-repost', 'community-join')),
  handle_normalized text not null,           -- lowercase, leading '@' stripped
  status text not null default 'self-declared',
  claimed_at timestamptz not null default now()
);

create unique index if not exists uq_social_task_claims_address_task
  on social_task_claims(campaign, lower(address), task_key);

create unique index if not exists uq_social_task_claims_task_handle
  on social_task_claims(campaign, task_key, handle_normalized);

-- ---------------------------------------------------------------------------
-- 5. Points ledger — APPEND-ONLY. No update/delete path exists in code; a
--    correction is a negative 'adjust:<note>' row whose adjusts_id points at
--    the row being corrected. base_points + multiplier + points are stored per
--    row so a later change of the constants never rewrites history.
--
--    Every reason family has exactly ONE typed reference column, enforced by
--    points_ledger_reference_check, so Postgres holds referential integrity:
--      action:*         witness_tx_hash  → action_witnesses(tx_hash)
--      streak:daily     checkin_day      (the UTC day)
--      social:<task>    social_claim_id  → social_task_claims(id)
--      referral:*       referral_referee (the referee address; one row per side)
--      adjust:<note>    adjusts_id       → points_ledger(id), nullable
--    The partial unique indexes below are the idempotency keys of each award
--    (the award job and the API insert … on conflict do nothing).
--
--    Balance is ALWAYS sum(points) over this table (served from
--    idx_points_ledger_campaign_address). There is no stored balance column.
-- ---------------------------------------------------------------------------
create table if not exists points_ledger (
  id bigint generated always as identity primary key,
  campaign int not null,
  address text not null
    constraint points_ledger_address_check check (address ~ '^G[A-Z2-7]{55}$'),
  user_id uuid,
  reason text not null
    constraint points_ledger_reason_check check (
      reason ~ '^(action:(sdex-swap|blend-deposit|blend-withdraw)|streak:daily|social:(x-follow|x-repost|community-join)|referral:(referrer|referee)|adjust:.+)$'
    ),
  base_points int not null
    constraint points_ledger_base_points_check check (base_points >= 0),
  multiplier numeric(4, 2) not null default 1
    constraint points_ledger_multiplier_check check (multiplier >= 1 and multiplier <= 2),
  points int not null                        -- the credited value (round(base * multiplier))
    constraint points_ledger_points_check check (points >= 0 or reason like 'adjust:%'),
  witness_tx_hash text references action_witnesses(tx_hash),   -- action:*
  social_claim_id uuid references social_task_claims(id),      -- social:*
  checkin_day date,                                            -- streak:daily (UTC day)
  referral_referee text                                        -- referral:referrer / referral:referee
    constraint points_ledger_referral_referee_check check (referral_referee is null or referral_referee ~ '^G[A-Z2-7]{55}$'),
  adjusts_id bigint references points_ledger(id),              -- adjust:* (the corrected row), nullable
  counted_day date,                          -- UTC day the award counts against (daily caps)
  created_at timestamptz not null default now(),
  constraint points_ledger_reference_check check (
    case
      when reason like 'action:%'
        then witness_tx_hash is not null and num_nonnulls(social_claim_id, checkin_day, referral_referee, adjusts_id) = 0
      when reason = 'streak:daily'
        then checkin_day is not null and num_nonnulls(witness_tx_hash, social_claim_id, referral_referee, adjusts_id) = 0
      when reason like 'social:%'
        then social_claim_id is not null and num_nonnulls(witness_tx_hash, checkin_day, referral_referee, adjusts_id) = 0
      when reason like 'referral:%'
        then referral_referee is not null and num_nonnulls(witness_tx_hash, social_claim_id, checkin_day, adjusts_id) = 0
      when reason like 'adjust:%'
        then num_nonnulls(witness_tx_hash, social_claim_id, checkin_day, referral_referee) = 0
      else false
    end
  )
);

create unique index if not exists uq_points_ledger_witness
  on points_ledger(campaign, reason, witness_tx_hash) where witness_tx_hash is not null;

create unique index if not exists uq_points_ledger_social_claim
  on points_ledger(campaign, reason, social_claim_id) where social_claim_id is not null;

create unique index if not exists uq_points_ledger_checkin
  on points_ledger(campaign, reason, lower(address), checkin_day) where checkin_day is not null;

create unique index if not exists uq_points_ledger_referral
  on points_ledger(campaign, reason, referral_referee) where referral_referee is not null;

create index if not exists idx_points_ledger_campaign_address
  on points_ledger(campaign, lower(address));

create index if not exists idx_points_ledger_campaign_address_day
  on points_ledger(campaign, lower(address), counted_day);

-- ---------------------------------------------------------------------------
-- 6. Daily check-ins. One per (campaign, wallet, UTC day). Streak length is
--    derived at read time from consecutive days; the multiplier table is a code
--    constant. address is the validated uppercase form (CHECK), so the plain PK
--    is the uniqueness. Written only under the enrollment row lock (§3).
-- ---------------------------------------------------------------------------
create table if not exists wallet_daily_checkins (
  campaign int not null,
  address text not null
    constraint wallet_daily_checkins_address_check check (address ~ '^G[A-Z2-7]{55}$'),
  day date not null,                         -- UTC day
  created_at timestamptz not null default now(),
  primary key (campaign, address, day)
);

-- ---------------------------------------------------------------------------
-- 7. Referrals. Linked at enrolment (referred_by_code); credited by the award
--    job ONLY when the referee has a Horizon-verified witness that closed at or
--    after linked_at and inside the campaign window. Self-referral is rejected
--    in code and by the check constraint.
-- ---------------------------------------------------------------------------
create table if not exists referrals (
  campaign int not null,
  referee_address text not null
    constraint referrals_referee_address_check check (referee_address ~ '^G[A-Z2-7]{55}$'),
  referrer_address text not null
    constraint referrals_referrer_address_check check (referrer_address ~ '^G[A-Z2-7]{55}$'),
  code text not null,
  linked_at timestamptz not null default now(),
  credited_at timestamptz,
  credited_tx_hash text references action_witnesses(tx_hash),
  primary key (campaign, referee_address),
  constraint referrals_no_self_referral check (referee_address <> referrer_address)
);

create index if not exists idx_referrals_campaign_referrer
  on referrals(campaign, referrer_address);
