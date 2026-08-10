-- stellar_v1_logos.sql — F3 (Lot F): backend-served brand/asset logos.
--
-- Additive + idempotent: safe to run on an existing v1 DB that predates the
-- logo_url columns now inlined in stellar_v1.sql. Prisma models are untouched
-- (v1 raw-SQL pipeline only). Values are populated by the one-shot seed:
--   pnpm -C apps/indexer bootstrap:logos  (scripts/bootstrap/seed-logos.ts)

alter table if exists venues add column if not exists logo_url text;
alter table if exists assets add column if not exists logo_url text;
