-- apps/api/src/db/stellar_v8_campaign_perks.sql
--
-- Lot EP (post-grant, EP3): NON-MONETARY perks unlocked by points balance.
-- POINTS ONLY, no key, no payout, no token: a perk is a badge, an early-access
-- or a beta flag the web reads from GET /v1/campaign/me. Nothing here moves
-- funds or signs anything.
--
-- Depends on stellar_v6_campaign.sql (campaign_enrollments, points_ledger) and
-- is applied AFTER v7, by hand like every other schema file (docs/runbooks.md
-- "Apply raw SQL schemas"), BEFORE deploying the EP3 api. Additive and
-- idempotent (create table if not exists). v6 and v7 are unchanged.
--
-- How the award job uses it (apps/api/src/scripts/84-campaign-award.ts, step 4
-- "perks", the ONLY writer of this table):
--   for every enrolled wallet, balance = sum(points) over points_ledger;
--   insert the tiers whose threshold the balance reaches (PERK_TIERS in
--   modules/campaign/campaign-rules.ts: early-access 100, beta-features 500,
--   priority-rwa 1500) with ON CONFLICT DO NOTHING — a re-run grants nothing.
--
-- A perk once granted STAYS granted (founder decision, 2026-10-21): a later
-- negative adjust row that drops the balance below the threshold never deletes
-- a row here. Revocation is a founder-only manual SQL (docs/runbooks.md
-- "Revoke a perk"); no code path updates or deletes a row of this table.
--
-- points_at_grant records the balance the job saw when it granted the tier
-- (audit only; the balance itself is always sum(points), never stored).

create table if not exists wallet_perks (
  campaign int not null,
  address text not null
    constraint wallet_perks_address_check check (address ~ '^G[A-Z2-7]{55}$'),
  perk_key text not null
    constraint wallet_perks_perk_key_check check (perk_key in ('early-access', 'beta-features', 'priority-rwa')),
  granted_at timestamptz not null default now(),
  points_at_grant int not null
    constraint wallet_perks_points_at_grant_check check (points_at_grant >= 0),
  primary key (campaign, address, perk_key)
);

-- /me reads one wallet's perks; the metrics read counts by key.
create index if not exists idx_wallet_perks_campaign_key
  on wallet_perks(campaign, perk_key);
