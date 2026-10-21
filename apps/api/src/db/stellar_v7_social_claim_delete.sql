-- apps/api/src/db/stellar_v7_social_claim_delete.sql
--
-- Lot EP (post-grant, EP2): SOFT delete for self-declared social task claims
-- (recon §9.4 — a person must be able to remove their X handle, user-supplied
-- PII, before launch). POINTS ONLY, no key, no payout.
--
-- Depends on stellar_v6_campaign.sql (social_task_claims, points_ledger) and is
-- applied AFTER it, by hand like every other schema file (docs/runbooks.md
-- "Apply raw SQL schemas"), BEFORE deploying the EP2 api. Additive and
-- idempotent (add column if not exists, drop/create index if (not) exists).
-- stellar_v6_campaign.sql itself is unchanged: the points_ledger FK and its
-- reference CHECK stay exactly as deployed.
--
-- How DELETE /v1/campaign/social/:id uses it (modules/campaign/social-claims.queries.ts),
-- in ONE transaction under the wallet's campaign_enrollments row lock:
--   1. update social_task_claims set deleted_at = now(), handle_normalized = 'deleted'
--      where id = $1 and deleted_at is null          -- the handle leaves the row
--   2. insert the negative 'adjust:social-delete' points_ledger row whose
--      adjusts_id points at the row that credited the claim (append-only ledger)
-- The credited ledger row keeps its social_claim_id (the claim row still exists).
--
-- The two v6 unique indexes become PARTIAL (deleted_at is null), so:
--   * a wallet may claim the same task again after deleting its claim
--     (the GROSS daily cap in code still applies: a deleted claim's points
--     still count toward that UTC day);
--   * the handle is free for its owner to re-declare, and the scrubbed
--     'deleted' value never collides because deleted rows are outside the index.

alter table social_task_claims
  add column if not exists deleted_at timestamptz;

drop index if exists uq_social_task_claims_address_task;
create unique index if not exists uq_social_task_claims_address_task_active
  on social_task_claims(campaign, lower(address), task_key)
  where deleted_at is null;

drop index if exists uq_social_task_claims_task_handle;
create unique index if not exists uq_social_task_claims_task_handle_active
  on social_task_claims(campaign, task_key, handle_normalized)
  where deleted_at is null;
