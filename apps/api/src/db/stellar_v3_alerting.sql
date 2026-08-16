-- =========================================================
-- T1-D2 / D2: IN-APP ALERTING ENGINE  (net-new)
-- =========================================================
-- Raw, idempotent SQL — applied with `psql -f` AFTER the v1 + v2 files (this
-- references user_wallets from stellar_v2_multiwallet.sql and entities from
-- stellar_v1.sql; the pgcrypto extension / gen_random_uuid() come from
-- stellar_v1.sql). Read from the API via prisma.$queryRawUnsafe (no ORM).
--
-- Design follows docs/alerting/probe-01..03:
--   * wallet_pool_health is append-only (PK id, no unique key); the evaluator
--     reads latest-per-(wallet,pool) and compares against the rules below.
--   * health_factor is numeric NULL = "no debt" → rules only fire on debt-bearing
--     rows (NULL is never a breach). The read helper filters health_factor IS NOT
--     NULL so the partial index wallet_pool_health_hf_idx is used.
--   * Scope key is user_wallets.user_id; there is NO users table, so user_id is a
--     plain uuid with no FK (default user is the hardcoded 00000000-...-001).
--
-- Verified against the real schema (step 0):
--   uuid generator = gen_random_uuid() (pgcrypto, stellar_v1.sql:1)
--   wallet_pool_health pool column = entity_id uuid → entities(id); so the pool
--   reference here is a uuid named pool_entity_id (entities IS first-class, but
--   per spec pool_entity_id is left as a plain typed column — no FK; see note).

-- ---------------------------------------------------------
-- 1. alert_rules — a user's alert definition
-- ---------------------------------------------------------
-- user_wallet_id NULL  = applies to ALL of the user's wallets.
-- pool_entity_id NULL  = applies to ALL pools.
-- A rule is resolved against concrete (wallet, pool) snapshots at evaluation time.
create table if not exists alert_rules (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,                                       -- scope key (no users table → no FK)
  metric            text not null check (metric in ('health_factor')),
  user_wallet_id    uuid references user_wallets(id) on delete cascade,  -- NULL = all wallets
  pool_entity_id    uuid,                                                -- NULL = all pools (entities.id; plain uuid, see header note)
  operator          text not null check (operator in ('lt', 'lte', 'gt', 'gte')),
  threshold         numeric not null,
  cooldown_seconds  integer not null default 3600,
  rearm_hysteresis  numeric,                                             -- optional re-arm band; NULL = re-arm on plain recovery
  enabled           boolean not null default true,
  extra             jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists alert_rules_user_idx
  on alert_rules (user_id);
-- Evaluator scans only enabled rules of a given metric → partial index on enabled:
create index if not exists alert_rules_metric_enabled_idx
  on alert_rules (metric) where enabled;

-- ---------------------------------------------------------
-- 2. alert_rule_state — per concrete (rule, wallet, pool) evaluation state
-- ---------------------------------------------------------
-- One row per concrete (wallet, pool) a rule actually evaluated. Drives edge-
-- triggering (ok → breached fires; breached → ok resolves) + cooldown/re-arm, so
-- a sustained breach does not re-fire every sweep. PK columns are NOT NULL by
-- definition, which is correct: state always references a concrete observed pool.
create table if not exists alert_rule_state (
  rule_id            uuid not null references alert_rules(id) on delete cascade,
  user_wallet_id     uuid not null references user_wallets(id) on delete cascade,
  pool_entity_id     uuid not null,                                       -- concrete pool (entities.id; plain uuid, see header note)
  status             text not null check (status in ('ok', 'breached')),
  last_value         numeric,
  last_evaluated_at  timestamptz not null,
  last_fired_at      timestamptz,
  primary key (rule_id, user_wallet_id, pool_entity_id)
);

-- ---------------------------------------------------------
-- 3. notifications — the user-facing feed (read/unread)
-- ---------------------------------------------------------
-- rule_id ON DELETE SET NULL: deleting a rule must NOT erase the user's history.
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,                                             -- scope key (no users table → no FK)
  rule_id     uuid references alert_rules(id) on delete set null,
  kind        text not null check (kind in ('alert_fired', 'alert_resolved')),
  title       text not null,
  body        text,
  payload     jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on notifications (user_id, created_at desc);
-- Unread badge / "what's new" query → partial index on unread:
create index if not exists notifications_user_unread_idx
  on notifications (user_id) where read_at is null;

-- =========================================================
-- Lot N (N1) — PRICE family: metric widening + asset subject + generic edge state
-- =========================================================
-- Additive + idempotent (drop-if-exists then recreate for the CHECK). Applied
-- with `psql -f` on top of the tables above.

-- 4a. Widen the metric family list. The inline CHECK on alert_rules.metric got
-- the auto-generated name alert_rules_metric_check. N3 adds 'tvl_drop_pct'
-- (pool TVL drop % over ~24h; subject = pool_entity_id, edge state in
-- alert_rule_subject_state keyed by the pool entity id).
alter table alert_rules drop constraint if exists alert_rules_metric_check;
alter table alert_rules add constraint alert_rules_metric_check
  check (metric in ('health_factor', 'price', 'tvl_drop_pct'));

-- 4b. Price rules reference an asset (assets.id, stellar_v1.sql). Plain typed
-- uuid, no FK — same convention as pool_entity_id (see header note). NULL for
-- every non-price family.
alter table alert_rules add column if not exists asset_id uuid;

-- ---------------------------------------------------------
-- 5. alert_rule_subject_state — edge state for wallet-less families
-- ---------------------------------------------------------
-- alert_rule_state's PK requires a NOT NULL user_wallet_id (with FK), which
-- wallet-less families (price; later pool-TVL / APY) cannot key into. This is
-- the generic sibling: one row per (rule, subject), where subject_key is the
-- family's subject id as text (price → asset_id; pool families → entity_id).
-- Same edge semantics as alert_rule_state (fire on crossing, resolve on return).
create table if not exists alert_rule_subject_state (
  rule_id            uuid not null references alert_rules(id) on delete cascade,
  subject_key        text not null,
  status             text not null check (status in ('ok', 'breached')),
  last_value         numeric,
  last_evaluated_at  timestamptz not null,
  last_fired_at      timestamptz,
  primary key (rule_id, subject_key)
);

-- ---------------------------------------------------------
-- 6. pool_status_state — last-seen Blend pool status (Lot N / N2)
-- ---------------------------------------------------------
-- The automatic pool-status protection has NO alert_rules row (it is not a user
-- rule), so its last-seen state gets its own tiny table. One row per monitored
-- pool entity; the first observation seeds silently (no retroactive firing).
-- status is the derived A5b label at observation time; status_code the raw
-- on-chain metadata.status it was derived from.
create table if not exists pool_status_state (
  entity_id    uuid primary key,      -- entities.id of the pool (plain uuid, see header note)
  status_code  integer not null,
  status       text not null,
  changed_at   timestamptz not null,  -- when the label last changed (seed = first seen)
  seen_at      timestamptz not null   -- last observation
);
