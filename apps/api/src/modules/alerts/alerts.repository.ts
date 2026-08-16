// apps/api/src/modules/alerts/alerts.repository.ts
//
// D2 alerting — typed raw-SQL read/write helpers over the stellar_v3_alerting
// tables (alert_rules, alert_rule_state, notifications) plus the latest-per-key
// read of the append-only wallet_pool_health snapshot log.
//
// House style (mirrors wallets.service.ts / bridge.service.ts):
//   * raw SQL via PrismaService.$queryRawUnsafe (reads / RETURNING) and
//     $executeRawUnsafe (pure writes), positional $n params with ::casts;
//   * snake_case row types straight off the query, mapped to camelCase DTOs;
//   * numeric columns arrive as Prisma.Decimal → unwrap with toNumber().
//
// Scope: lot 1 = schema + read helpers only. NO endpoints, NO evaluator wiring,
// NO cron (lots 0/2). This module is intentionally not yet imported by
// app.module — it is consumed once the evaluator / notifications controller land.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

// numeric columns come back from $queryRawUnsafe as Prisma.Decimal; unwrap to a
// plain number (or null) so the API never emits Decimal objects. Mirrors the
// helper in wallets.service.ts / bridge.service.ts.
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'object' && value !== null) {
    if (
      'toString' in value &&
      typeof (value as { toString: unknown }).toString === 'function'
    ) {
      const n = Number((value as { toString: () => string }).toString());
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

// Canonical alert_rules column list (select / RETURNING). One source of truth so
// every read returns the same shape that mapRule() consumes.
const RULE_COLUMNS = `
  id, user_id, metric, user_wallet_id, pool_entity_id, asset_id,
  operator, threshold, cooldown_seconds, rearm_hysteresis,
  enabled, extra, created_at, updated_at
`;

// Canonical notifications column list (select).
const NOTIFICATION_COLUMNS = `
  id, user_id, rule_id, kind, title, body, payload, read_at, created_at
`;

// Notification feed pagination — mirrors the bridge recent-flows feed
// (DEFAULT_FLOW_LIMIT / MAX_FLOW_LIMIT in bridge.service.ts).
const DEFAULT_NOTIFICATION_LIMIT = 50;
const MAX_NOTIFICATION_LIMIT = 200;

// ---------------------------------------------------------------------------
// Row types (raw, snake_case — straight off the query)
// ---------------------------------------------------------------------------

// wallet_pool_health latest-per-key projection. Note: the source column is
// entity_id; we alias it to pool_entity_id to match the alerting vocabulary.
// user_id is joined in from user_wallets so the evaluator can match rules scoped
// to "all wallets of a user".
type LatestHealthRow = {
  user_wallet_id: string;
  pool_entity_id: string;
  user_id: string;
  health_factor: unknown; // numeric -> toNumber
  snapshot_at: unknown;
};

type AlertRuleRow = {
  id: string;
  user_id: string;
  metric: string;
  user_wallet_id: string | null;
  pool_entity_id: string | null;
  asset_id: string | null;
  operator: string;
  threshold: unknown;
  cooldown_seconds: number;
  rearm_hysteresis: unknown;
  enabled: boolean;
  extra: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type AlertRuleStateRow = {
  rule_id: string;
  user_wallet_id: string;
  pool_entity_id: string;
  status: string;
  last_value: unknown;
  last_evaluated_at: unknown;
  last_fired_at: unknown;
};

type NotificationRow = {
  id: string;
  user_id: string;
  rule_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  payload: unknown;
  read_at: unknown;
  created_at: unknown;
};

// ---------------------------------------------------------------------------
// Mapped DTOs (camelCase — what callers consume)
// ---------------------------------------------------------------------------

export type LatestPoolHealth = {
  userWalletId: string;
  poolEntityId: string;
  userId: string;
  healthFactor: number | null;
  snapshotAt: unknown;
};

export type AlertRule = {
  id: string;
  userId: string;
  metric: 'health_factor' | 'price' | 'tvl_drop_pct';
  userWalletId: string | null; // null = all wallets (health_factor family)
  poolEntityId: string | null; // null = all pools (health_factor family)
  assetId: string | null; // price family subject; null for other families
  operator: 'lt' | 'lte' | 'gt' | 'gte';
  threshold: number | null;
  cooldownSeconds: number;
  rearmHysteresis: number | null;
  enabled: boolean;
  extra: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

export type AlertRuleState = {
  ruleId: string;
  userWalletId: string;
  poolEntityId: string;
  status: 'ok' | 'breached';
  lastValue: number | null;
  lastEvaluatedAt: unknown;
  lastFiredAt: unknown;
};

// Fully-normalized create input (the service validates/defaults before calling).
export type CreateRuleInput = {
  metric: 'health_factor' | 'price' | 'tvl_drop_pct';
  operator: 'lt' | 'lte' | 'gt' | 'gte';
  threshold: number;
  cooldownSeconds: number;
  rearmHysteresis: number | null;
  userWalletId: string | null;
  poolEntityId: string | null;
  assetId: string | null;
  enabled: boolean;
};

// Partial patch — only keys present are written (an explicit `null` for a nullable
// column IS honored, e.g. clearing user_wallet_id back to "all wallets").
export type UpdateRuleInput = Partial<CreateRuleInput>;

export type Notification = {
  id: string;
  userId: string;
  ruleId: string | null;
  kind: 'alert_fired' | 'alert_resolved';
  title: string;
  body: string | null;
  payload: unknown;
  readAt: unknown;
  createdAt: unknown;
};

export type ListNotificationsOptions = {
  limit?: number;
  before?: string | null; // keyset cursor: created_at < before (ISO)
};

// Pool label parts for fire-time copy: the entity (pool) display name + the
// venue/protocol label reachable via entities.venue_id -> venues. slug feeds
// the notification's route hint (deep-link to the pool page).
export type PoolLabel = {
  name: string;
  venueLabel: string | null;
  slug: string | null;
};

// Lot N — generic edge state for wallet-less families (price; later pool
// families). subject_key is the family's subject id as text (price → asset_id).
export type AlertSubjectState = {
  ruleId: string;
  subjectKey: string;
  status: 'ok' | 'breached';
  lastValue: number | null;
  lastEvaluatedAt: unknown;
  lastFiredAt: unknown;
};

type AlertSubjectStateRow = {
  rule_id: string;
  subject_key: string;
  status: string;
  last_value: unknown;
  last_evaluated_at: unknown;
  last_fired_at: unknown;
};

// Latest observed USD price for one asset (asset_prices ⋈ assets).
export type LatestAssetPrice = {
  assetId: string;
  symbol: string | null;
  name: string | null;
  priceUsd: number | null;
  observedAt: unknown;
};

type LatestAssetPriceRow = {
  asset_id: string;
  symbol: string | null;
  name: string | null;
  price_usd: unknown;
  observed_at: unknown;
};

// Only assets priced recently count as "tracked" — an asset whose newest price
// is older than this is no longer on the refresh path and must not be offered
// for new price rules (honesty rule: creatable IFF the evaluator has data).
const PRICED_ASSET_MAX_AGE = '7 days';

// Lot N (N3) — the two-batch TVL window the tvl_drop_pct evaluator consumes.
export type PoolTvlWindow = {
  entityId: string;
  latestTvlUsd: number | null;
  prevTvlUsd: number | null;
  latestAt: unknown;
  prevAt: unknown;
};

type PoolTvlWindowRow = {
  entity_id: string;
  latest_tvl_usd: unknown;
  prev_tvl_usd: unknown;
  latest_at: unknown;
  prev_at: unknown;
};

// Lot N (N3) — a pool eligible for TVL-drop rules (modal target list).
export type TvlPool = {
  entityId: string;
  slug: string | null;
  name: string;
  venueName: string | null;
};

// Lot N (N2) — last-seen status of a monitored Blend pool (pool_status_state).
export type PoolStatusState = {
  entityId: string;
  statusCode: number;
  status: string;
  changedAt: unknown;
  seenAt: unknown;
};

type PoolStatusStateRow = {
  entity_id: string;
  status_code: number;
  status: string;
  changed_at: unknown;
  seen_at: unknown;
};

@Injectable()
export class AlertsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Strict latest-per-(wallet, pool) read of the append-only health snapshot log.
  // DISTINCT ON keyed by (user_wallet_id, entity_id), newest snapshot wins, with
  // created_at as the documented same-snapshot tiebreaker. `health_factor IS NOT
  // NULL` (a) excludes no-debt rows that can never breach and (b) keeps the
  // partial index wallet_pool_health_hf_idx eligible. `entity_id IS NOT NULL`
  // drops pool-less rows that cannot key alert_rule_state. user_id is joined in
  // so "all wallets of a user" rules can be matched without a second query.
  async latestPerKey(): Promise<LatestPoolHealth[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select distinct on (wph.user_wallet_id, wph.entity_id)
        wph.user_wallet_id,
        wph.entity_id as pool_entity_id,
        uw.user_id,
        wph.health_factor,
        wph.snapshot_at
      from wallet_pool_health wph
      join user_wallets uw on uw.id = wph.user_wallet_id
      where wph.health_factor is not null
        and wph.entity_id is not null
      order by
        wph.user_wallet_id,
        wph.entity_id,
        wph.snapshot_at desc,
        wph.created_at desc
      `
    )) as LatestHealthRow[];

    return rows.map((row) => ({
      userWalletId: row.user_wallet_id,
      poolEntityId: row.pool_entity_id,
      userId: row.user_id,
      healthFactor: toNumber(row.health_factor),
      snapshotAt: row.snapshot_at,
    }));
  }

  // All enabled rules (uses alert_rules_metric_enabled_idx). The evaluator loads
  // these once per sweep and resolves each against latestPerKey().
  async getEnabledRules(): Promise<AlertRule[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select ${RULE_COLUMNS}
      from alert_rules
      where enabled = true
      `
    )) as AlertRuleRow[];

    return rows.map((row) => this.mapRule(row));
  }

  // -------------------------------------------------------------------------
  // Rule CRUD (lot 3). OWNERSHIP INVARIANT: every read AND every mutation filters
  // on user_id IN ADDITION to id. A mutation on a rule the caller does not own
  // matches 0 rows → null/false → the service raises 404. No row of another user
  // is ever read or written.
  // -------------------------------------------------------------------------

  async createRule(userId: string, input: CreateRuleInput): Promise<AlertRule> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      insert into alert_rules (
        user_id, metric, user_wallet_id, pool_entity_id, asset_id,
        operator, threshold, cooldown_seconds, rearm_hysteresis, enabled
      ) values (
        $1::uuid, $2, $3::uuid, $4::uuid, $5::uuid,
        $6, $7, $8, $9, $10
      )
      returning ${RULE_COLUMNS}
      `,
      userId,
      input.metric,
      input.userWalletId,
      input.poolEntityId,
      input.assetId,
      input.operator,
      input.threshold,
      input.cooldownSeconds,
      input.rearmHysteresis,
      input.enabled
    )) as AlertRuleRow[];

    return this.mapRule(rows[0]);
  }

  async listRules(userId: string): Promise<AlertRule[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select ${RULE_COLUMNS}
      from alert_rules
      where user_id = $1::uuid
      order by created_at desc
      `,
      userId
    )) as AlertRuleRow[];

    return rows.map((row) => this.mapRule(row));
  }

  // Scoped read: id AND user_id. Returns null if the rule does not exist OR is not
  // owned by userId (the two are indistinguishable on purpose — no existence leak).
  async getRule(userId: string, id: string): Promise<AlertRule | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select ${RULE_COLUMNS}
      from alert_rules
      where id = $1::uuid
        and user_id = $2::uuid
      `,
      id,
      userId
    )) as AlertRuleRow[];

    return rows[0] ? this.mapRule(rows[0]) : null;
  }

  // Scoped partial update. Only the patch keys present are written; column names
  // come from a fixed whitelist (never user input), values are parameterized.
  // The WHERE clause carries id AND user_id, so a non-owner update touches 0 rows
  // and returns null.
  async updateRule(
    userId: string,
    id: string,
    patch: UpdateRuleInput
  ): Promise<AlertRule | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const add = (col: string, value: unknown, cast = '') => {
      sets.push(`${col} = $${i}${cast}`);
      params.push(value);
      i += 1;
    };

    if (patch.metric !== undefined) add('metric', patch.metric);
    if (patch.operator !== undefined) add('operator', patch.operator);
    if (patch.threshold !== undefined) add('threshold', patch.threshold);
    if (patch.cooldownSeconds !== undefined)
      add('cooldown_seconds', patch.cooldownSeconds);
    if (patch.rearmHysteresis !== undefined)
      add('rearm_hysteresis', patch.rearmHysteresis);
    if (patch.userWalletId !== undefined)
      add('user_wallet_id', patch.userWalletId, '::uuid');
    if (patch.poolEntityId !== undefined)
      add('pool_entity_id', patch.poolEntityId, '::uuid');
    if (patch.assetId !== undefined) add('asset_id', patch.assetId, '::uuid');
    if (patch.enabled !== undefined) add('enabled', patch.enabled);

    // No-op patch → return the current (still ownership-scoped) row.
    if (sets.length === 0) {
      return this.getRule(userId, id);
    }

    sets.push('updated_at = now()');

    const idParam = i;
    params.push(id);
    i += 1;
    const userParam = i;
    params.push(userId);
    i += 1;

    const rows = (await this.prisma.$queryRawUnsafe(
      `
      update alert_rules
      set ${sets.join(', ')}
      where id = $${idParam}::uuid
        and user_id = $${userParam}::uuid
      returning ${RULE_COLUMNS}
      `,
      ...params
    )) as AlertRuleRow[];

    return rows[0] ? this.mapRule(rows[0]) : null;
  }

  // Scoped delete: id AND user_id. ON DELETE CASCADE clears alert_rule_state.
  // Returns true only when exactly the caller's own row was removed.
  async deleteRule(userId: string, id: string): Promise<boolean> {
    const affected = (await this.prisma.$executeRawUnsafe(
      `
      delete from alert_rules
      where id = $1::uuid
        and user_id = $2::uuid
      `,
      id,
      userId
    )) as number;

    return affected > 0;
  }

  // Ownership guard for rule scoping: does this wallet belong to this user? Used
  // to reject a rule that tries to target someone else's wallet.
  async walletBelongsToUser(userId: string, walletId: string): Promise<boolean> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select 1 as ok
      from user_wallets
      where id = $1::uuid
        and user_id = $2::uuid
      limit 1
      `,
      walletId,
      userId
    )) as Array<{ ok: number }>;

    return rows.length > 0;
  }

  // Current state rows for one rule, keyed by (wallet, pool). Returns [] before
  // a rule's first evaluation.
  async getRuleState(ruleId: string): Promise<AlertRuleState[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select
        rule_id, user_wallet_id, pool_entity_id,
        status, last_value, last_evaluated_at, last_fired_at
      from alert_rule_state
      where rule_id = $1::uuid
      `,
      ruleId
    )) as AlertRuleStateRow[];

    return rows.map((row) => this.mapState(row));
  }

  // Upsert one concrete (rule, wallet, pool) evaluation outcome. PK
  // (rule_id, user_wallet_id, pool_entity_id) is the conflict target.
  // last_fired_at is only advanced when an actual fire happened (pass the new
  // timestamp); otherwise pass null to preserve the previous value via coalesce.
  async upsertRuleState(params: {
    ruleId: string;
    userWalletId: string;
    poolEntityId: string;
    status: 'ok' | 'breached';
    lastValue: number | null;
    lastEvaluatedAt: string; // ISO timestamp
    lastFiredAt: string | null; // ISO timestamp, or null to keep prior
  }): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `
      insert into alert_rule_state (
        rule_id, user_wallet_id, pool_entity_id,
        status, last_value, last_evaluated_at, last_fired_at
      ) values (
        $1::uuid, $2::uuid, $3::uuid,
        $4, $5, $6::timestamptz, $7::timestamptz
      )
      on conflict (rule_id, user_wallet_id, pool_entity_id) do update set
        status            = excluded.status,
        last_value        = excluded.last_value,
        last_evaluated_at = excluded.last_evaluated_at,
        last_fired_at     = coalesce(excluded.last_fired_at, alert_rule_state.last_fired_at)
      `,
      params.ruleId,
      params.userWalletId,
      params.poolEntityId,
      params.status,
      params.lastValue,
      params.lastEvaluatedAt,
      params.lastFiredAt
    );
  }

  // Append a notification to the user's feed. Returns the new row id.
  async insertNotification(params: {
    userId: string;
    ruleId: string | null;
    kind: 'alert_fired' | 'alert_resolved';
    title: string;
    body: string | null;
    payload: unknown;
  }): Promise<string> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      insert into notifications (
        user_id, rule_id, kind, title, body, payload
      ) values (
        $1::uuid, $2::uuid, $3, $4, $5, $6::jsonb
      )
      returning id
      `,
      params.userId,
      params.ruleId,
      params.kind,
      params.title,
      params.body,
      params.payload === null || params.payload === undefined
        ? null
        : JSON.stringify(params.payload)
    )) as Array<{ id: string }>;

    return rows[0].id;
  }

  // Batch pool-label lookup for fire-time copy: entity_id -> { entity name, venue
  // (protocol) label }. One query for a set of ids (never one query per
  // notification), joining venues so the caller can prefix the protocol name
  // (e.g. "Blend Fixed") without a second lookup. Missing ids simply aren't in the
  // map; the caller falls back to a short id.
  async getPoolLabels(entityIds: string[]): Promise<Map<string, PoolLabel>> {
    const ids = Array.from(new Set(entityIds.filter(Boolean)));
    if (ids.length === 0) return new Map();

    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select e.id, e.name, e.slug, v.name as venue_name, v.slug as venue_slug
      from entities e
      join venues v on v.id = e.venue_id
      where e.id = any($1::uuid[])
      `,
      ids
    )) as Array<{
      id: string;
      name: string | null;
      slug: string | null;
      venue_name: string | null;
      venue_slug: string | null;
    }>;

    const map = new Map<string, PoolLabel>();
    for (const row of rows) {
      // Prefer display names; fall back to slugs. (both names are NOT NULL today.)
      const name = (row.name ?? row.slug ?? '').trim();
      const venueLabel = (row.venue_name ?? row.venue_slug ?? '').trim() || null;
      if (name) map.set(row.id, { name, venueLabel, slug: row.slug });
    }
    return map;
  }

  // -------------------------------------------------------------------------
  // Lot N — price family reads/writes
  // -------------------------------------------------------------------------

  // Latest price per asset for the evaluator (one query for the whole sweep).
  // DISTINCT ON picks the newest observation across sources.
  async latestPricesByAsset(
    assetIds: string[]
  ): Promise<Map<string, LatestAssetPrice>> {
    const ids = Array.from(new Set(assetIds.filter(Boolean)));
    if (ids.length === 0) return new Map();

    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select distinct on (ap.asset_id)
        ap.asset_id, a.symbol, a.name, ap.price_usd, ap.observed_at
      from asset_prices ap
      join assets a on a.id = ap.asset_id
      where ap.asset_id = any($1::uuid[])
      order by ap.asset_id, ap.observed_at desc
      `,
      ids
    )) as LatestAssetPriceRow[];

    const map = new Map<string, LatestAssetPrice>();
    for (const row of rows) {
      map.set(row.asset_id, this.mapAssetPrice(row));
    }
    return map;
  }

  // The vetted asset list for the rule modal: every asset with a recent price
  // (see PRICED_ASSET_MAX_AGE), latest observation each, ordered by symbol.
  async listPricedAssets(): Promise<LatestAssetPrice[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select * from (
        select distinct on (ap.asset_id)
          ap.asset_id, a.symbol, a.name, ap.price_usd, ap.observed_at
        from asset_prices ap
        join assets a on a.id = ap.asset_id
        where ap.observed_at > now() - interval '${PRICED_ASSET_MAX_AGE}'
        order by ap.asset_id, ap.observed_at desc
      ) priced
      order by lower(coalesce(priced.symbol, priced.name, ''))
      `
    )) as LatestAssetPriceRow[];

    return rows.map((row) => this.mapAssetPrice(row));
  }

  // Current subject-state rows for one rule. Returns [] before first evaluation.
  async getSubjectState(ruleId: string): Promise<AlertSubjectState[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select rule_id, subject_key, status, last_value, last_evaluated_at, last_fired_at
      from alert_rule_subject_state
      where rule_id = $1::uuid
      `,
      ruleId
    )) as AlertSubjectStateRow[];

    return rows.map((row) => ({
      ruleId: row.rule_id,
      subjectKey: row.subject_key,
      status: row.status as AlertSubjectState['status'],
      lastValue: toNumber(row.last_value),
      lastEvaluatedAt: row.last_evaluated_at,
      lastFiredAt: row.last_fired_at,
    }));
  }

  // Upsert one (rule, subject) evaluation outcome — same last_fired_at coalesce
  // semantics as upsertRuleState.
  async upsertSubjectState(params: {
    ruleId: string;
    subjectKey: string;
    status: 'ok' | 'breached';
    lastValue: number | null;
    lastEvaluatedAt: string; // ISO timestamp
    lastFiredAt: string | null; // ISO timestamp, or null to keep prior
  }): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `
      insert into alert_rule_subject_state (
        rule_id, subject_key, status, last_value, last_evaluated_at, last_fired_at
      ) values (
        $1::uuid, $2, $3, $4, $5::timestamptz, $6::timestamptz
      )
      on conflict (rule_id, subject_key) do update set
        status            = excluded.status,
        last_value        = excluded.last_value,
        last_evaluated_at = excluded.last_evaluated_at,
        last_fired_at     = coalesce(excluded.last_fired_at, alert_rule_subject_state.last_fired_at)
      `,
      params.ruleId,
      params.subjectKey,
      params.status,
      params.lastValue,
      params.lastEvaluatedAt,
      params.lastFiredAt
    );
  }

  // -------------------------------------------------------------------------
  // Lot N (N3) — pool TVL windows over reserve_snapshots batches
  // -------------------------------------------------------------------------

  // Per pool: TVL of the LATEST complete batch vs the batch closest to 24h
  // before it. Batches are atomic per (entity, snapshot_at) since the
  // dead-reserves fix, so "the batch" is simply all rows sharing the newest
  // snapshot_at — never a per-asset latest (that resurrects removed reserves).
  // The supplied side mirrors compute-pool-metrics.ts: lending pools hold the
  // supplied amount in b_supply_scaled; AMM pools hold the reserve amount in
  // d_supply_scaled. Both batches are valued with the SAME latest price per
  // asset, so the ratio isolates real liquidity movement at current valuation.
  // The previous batch must sit 12–36h behind the latest one — closer would
  // fake a "24h" window, farther is a different claim; pools without such a
  // batch (young history, e.g. stellar-native which writes no reserve batches
  // at all) are simply absent from the result → the evaluator skips them.
  async getPoolTvlWindows(entityIds: string[]): Promise<Map<string, PoolTvlWindow>> {
    const ids = Array.from(new Set(entityIds.filter(Boolean)));
    if (ids.length === 0) return new Map();

    const rows = (await this.prisma.$queryRawUnsafe(
      `
      with batches as (
        select distinct rs.entity_id, rs.snapshot_at
        from reserve_snapshots rs
        where rs.entity_id = any($1::uuid[])
      ),
      latest as (
        select entity_id, max(snapshot_at) as snap
        from batches
        group by entity_id
      ),
      prev as (
        select b.entity_id, b.snapshot_at as snap,
               row_number() over (
                 partition by b.entity_id
                 order by abs(extract(epoch from (l.snap - interval '24 hours' - b.snapshot_at)))
               ) as rn
        from batches b
        join latest l using (entity_id)
        where b.snapshot_at <= l.snap - interval '12 hours'
          and b.snapshot_at >= l.snap - interval '36 hours'
      ),
      picked as (
        select l.entity_id, l.snap as latest_snap, p.snap as prev_snap
        from latest l
        join prev p on p.entity_id = l.entity_id and p.rn = 1
      ),
      tvl as (
        select rs.entity_id, rs.snapshot_at,
               sum(
                 coalesce(
                   case when v.venue_type = 'lending'
                     then rs.b_supply_scaled
                     else rs.d_supply_scaled
                   end, 0
                 ) * coalesce(px.price_usd, 0)
               ) as tvl_usd
        from reserve_snapshots rs
        join entities e on e.id = rs.entity_id
        join venues v on v.id = e.venue_id
        join picked pk on pk.entity_id = rs.entity_id
          and rs.snapshot_at in (pk.latest_snap, pk.prev_snap)
        left join lateral (
          select ap.price_usd from asset_prices ap
          where ap.asset_id = rs.asset_id
          order by ap.observed_at desc limit 1
        ) px on true
        group by rs.entity_id, rs.snapshot_at
      )
      select pk.entity_id,
             tl.tvl_usd as latest_tvl_usd,
             tp.tvl_usd as prev_tvl_usd,
             pk.latest_snap as latest_at,
             pk.prev_snap as prev_at
      from picked pk
      join tvl tl on tl.entity_id = pk.entity_id and tl.snapshot_at = pk.latest_snap
      join tvl tp on tp.entity_id = pk.entity_id and tp.snapshot_at = pk.prev_snap
      `,
      ids
    )) as PoolTvlWindowRow[];

    const map = new Map<string, PoolTvlWindow>();
    for (const row of rows) {
      map.set(row.entity_id, {
        entityId: row.entity_id,
        latestTvlUsd: toNumber(row.latest_tvl_usd),
        prevTvlUsd: toNumber(row.prev_tvl_usd),
        latestAt: row.latest_at,
        prevAt: row.prev_at,
      });
    }
    return map;
  }

  // Pools eligible for TVL-drop rules (the modal's vetted target list): active
  // entities with reserve-batch history on the live refresh path (last 7 days).
  // stellar-native and vaults write no reserve batches → naturally excluded.
  async listTvlPools(): Promise<TvlPool[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select e.id, e.slug, e.name, v.name as venue_name
      from entities e
      join venues v on v.id = e.venue_id
      where e.is_active = true
        and exists (
          select 1 from reserve_snapshots rs
          where rs.entity_id = e.id
            and rs.snapshot_at > now() - interval '7 days'
        )
      order by v.name, e.name
      `
    )) as Array<{
      id: string;
      slug: string | null;
      name: string | null;
      venue_name: string | null;
    }>;

    return rows.map((row) => ({
      entityId: row.id,
      slug: row.slug,
      name: (row.name ?? row.slug ?? '').trim() || `pool ${row.id.slice(0, 8)}`,
      venueName: row.venue_name,
    }));
  }

  // -------------------------------------------------------------------------
  // Lot N (N2) — pool-status protection reads/writes
  // -------------------------------------------------------------------------

  // Resolve pool registry slugs to entities.id (active entities only).
  async getEntityIdsBySlug(slugs: string[]): Promise<Map<string, string>> {
    const wanted = Array.from(new Set(slugs.filter(Boolean)));
    if (wanted.length === 0) return new Map();

    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select slug, id
      from entities
      where slug = any($1::text[])
        and is_active = true
      `,
      wanted
    )) as Array<{ slug: string; id: string }>;

    const map = new Map<string, string>();
    for (const row of rows) map.set(row.slug, row.id);
    return map;
  }

  // Last-seen status per monitored pool. Empty map before the seed run.
  async getPoolStatusStates(): Promise<Map<string, PoolStatusState>> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select entity_id, status_code, status, changed_at, seen_at
      from pool_status_state
      `
    )) as PoolStatusStateRow[];

    const map = new Map<string, PoolStatusState>();
    for (const row of rows) {
      map.set(row.entity_id, {
        entityId: row.entity_id,
        statusCode: row.status_code,
        status: row.status,
        changedAt: row.changed_at,
        seenAt: row.seen_at,
      });
    }
    return map;
  }

  async upsertPoolStatusState(params: {
    entityId: string;
    statusCode: number;
    status: string;
    changedAt: string; // ISO — when the label last changed (seed = first seen)
    seenAt: string; // ISO — this observation
  }): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `
      insert into pool_status_state (entity_id, status_code, status, changed_at, seen_at)
      values ($1::uuid, $2, $3, $4::timestamptz, $5::timestamptz)
      on conflict (entity_id) do update set
        status_code = excluded.status_code,
        status      = excluded.status,
        changed_at  = excluded.changed_at,
        seen_at     = excluded.seen_at
      `,
      params.entityId,
      params.statusCode,
      params.status,
      params.changedAt,
      params.seenAt
    );
  }

  // Users with a CURRENT position in each given pool: latest wallet_pool_health
  // row per (wallet, pool) — script 81 only writes a row when the wallet HAS a
  // position, so a wallet that exited stops producing rows; the freshness window
  // keeps long-gone positions from notifying forever. No HF filter here: a
  // supply-only position (health_factor NULL) is still affected by a status change.
  async usersWithPositionsByPool(
    entityIds: string[]
  ): Promise<Map<string, string[]>> {
    const ids = Array.from(new Set(entityIds.filter(Boolean)));
    if (ids.length === 0) return new Map();

    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select distinct latest.entity_id, uw.user_id
      from (
        select distinct on (wph.user_wallet_id, wph.entity_id)
          wph.user_wallet_id, wph.entity_id, wph.snapshot_at
        from wallet_pool_health wph
        where wph.entity_id = any($1::uuid[])
        order by wph.user_wallet_id, wph.entity_id, wph.snapshot_at desc
      ) latest
      join user_wallets uw on uw.id = latest.user_wallet_id
      where latest.snapshot_at > now() - interval '24 hours'
      `,
      ids
    )) as Array<{ entity_id: string; user_id: string }>;

    const map = new Map<string, string[]>();
    for (const row of rows) {
      const list = map.get(row.entity_id) ?? [];
      list.push(row.user_id);
      map.set(row.entity_id, list);
    }
    return map;
  }

  private mapAssetPrice(row: LatestAssetPriceRow): LatestAssetPrice {
    return {
      assetId: row.asset_id,
      symbol: row.symbol,
      name: row.name,
      priceUsd: toNumber(row.price_usd),
      observedAt: row.observed_at,
    };
  }

  // -------------------------------------------------------------------------
  // Notifications read API (lot 4). Same ownership invariant: every read and the
  // mark-read mutation filter on user_id.
  // -------------------------------------------------------------------------

  // Newest-first feed (matches the bridge recent-flows house shape: time-desc +
  // hard-capped limit). `before` is an optional keyset cursor on created_at.
  async listNotifications(
    userId: string,
    options: ListNotificationsOptions = {}
  ): Promise<Notification[]> {
    let safeLimit = DEFAULT_NOTIFICATION_LIMIT;
    if (
      typeof options.limit === 'number' &&
      Number.isFinite(options.limit) &&
      options.limit > 0
    ) {
      safeLimit = Math.min(Math.floor(options.limit), MAX_NOTIFICATION_LIMIT);
    }
    const before = options.before ?? null;

    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select ${NOTIFICATION_COLUMNS}
      from notifications
      where user_id = $1::uuid
        and ($2::timestamptz is null or created_at < $2::timestamptz)
      order by created_at desc
      limit $3
      `,
      userId,
      before,
      safeLimit
    )) as NotificationRow[];

    return rows.map((row) => this.mapNotification(row));
  }

  // Unread badge count (uses notifications_user_unread_idx).
  async countUnread(userId: string): Promise<number> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select count(*)::int as count
      from notifications
      where user_id = $1::uuid
        and read_at is null
      `,
      userId
    )) as Array<{ count: number }>;

    return rows[0]?.count ?? 0;
  }

  // Mark one notification read. Scoped by id AND user_id (ownership) AND read_at
  // IS NULL (idempotent). Returns true only when THIS call flipped it to read; an
  // already-read row OR a non-owned/absent row both return false — the service
  // disambiguates via notificationExists().
  async markRead(userId: string, id: string): Promise<boolean> {
    const affected = (await this.prisma.$executeRawUnsafe(
      `
      update notifications
      set read_at = now()
      where id = $1::uuid
        and user_id = $2::uuid
        and read_at is null
      `,
      id,
      userId
    )) as number;

    return affected > 0;
  }

  // Existence guard scoped to the owner (no read_at filter). Lets the service tell
  // "already read" (exists+owned → 200 no-op) from "not owned/absent" (→ 404).
  async notificationExists(userId: string, id: string): Promise<boolean> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select 1 as ok
      from notifications
      where id = $1::uuid
        and user_id = $2::uuid
      limit 1
      `,
      id,
      userId
    )) as Array<{ ok: number }>;

    return rows.length > 0;
  }

  // Mark every unread notification for the user read. Returns the count flipped.
  async markAllRead(userId: string): Promise<number> {
    const affected = (await this.prisma.$executeRawUnsafe(
      `
      update notifications
      set read_at = now()
      where user_id = $1::uuid
        and read_at is null
      `,
      userId
    )) as number;

    return affected;
  }

  private mapNotification(row: NotificationRow): Notification {
    return {
      id: row.id,
      userId: row.user_id,
      ruleId: row.rule_id,
      kind: row.kind as Notification['kind'],
      title: row.title,
      body: row.body,
      payload: row.payload,
      readAt: row.read_at,
      createdAt: row.created_at,
    };
  }

  private mapRule(row: AlertRuleRow): AlertRule {
    return {
      id: row.id,
      userId: row.user_id,
      metric: row.metric as AlertRule['metric'],
      userWalletId: row.user_wallet_id,
      poolEntityId: row.pool_entity_id,
      assetId: row.asset_id,
      operator: row.operator as AlertRule['operator'],
      threshold: toNumber(row.threshold),
      cooldownSeconds: row.cooldown_seconds,
      rearmHysteresis: toNumber(row.rearm_hysteresis),
      enabled: row.enabled,
      extra: row.extra,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapState(row: AlertRuleStateRow): AlertRuleState {
    return {
      ruleId: row.rule_id,
      userWalletId: row.user_wallet_id,
      poolEntityId: row.pool_entity_id,
      status: row.status as AlertRuleState['status'],
      lastValue: toNumber(row.last_value),
      lastEvaluatedAt: row.last_evaluated_at,
      lastFiredAt: row.last_fired_at,
    };
  }
}
