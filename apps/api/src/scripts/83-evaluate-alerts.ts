// apps/api/src/scripts/83-evaluate-alerts.ts
//
// D2 alerting — lot 2 wiring (the side-effecting evaluator run). Lives in apps/api
// because it consumes the API's house DB handle (PrismaService) via the lot-1
// AlertsRepository plus the pure evaluate() function; both are apps/api modules,
// so a cross-package indexer script would have to duplicate the SQL. Invoked by
// the indexer orchestrator (script 82) AFTER the wallet-health sweep (script 81).
//
// Flow: load enabled rules, PARTITION THEM BY FAMILY (Lot N — a price rule must
// never enter the health-factor evaluator and vice versa), then per family:
// match each rule to its in-scope subjects, run the pure state machine, persist
// next state, and append a notification on every fire/resolve edge. Per-rule
// try/catch so one bad rule can't abort the sweep. No clock magic — a single
// `now` is injected into every evaluate() call.

import 'dotenv/config';
import { PoolV2 } from '@blend-capital/blend-sdk';
import { PrismaService } from '../db/prisma.service';
import {
  AlertsRepository,
  type AlertRuleState,
} from '../modules/alerts/alerts.repository';
import { evaluate } from '../modules/alerts/evaluate';
import {
  buildPoolStatusCopy,
  buildPriceCopy,
  buildTvlDropCopy,
  computeTvlDropPct,
  diffPoolStatus,
  displaySymbol,
  formatAsOf,
  partitionRulesByFamily,
} from '../modules/alerts/families';
import { derivePoolStatus } from '../modules/actions/actions.service';
import {
  MAINNET_BLEND_POOLS,
  getNetworkConfig,
} from '../modules/actions/network-registry';

const OPERATOR_SYMBOL: Record<string, string> = {
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
};

function stateKey(userWalletId: string, poolEntityId: string): string {
  return `${userWalletId}:${poolEntityId}`;
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

async function main() {
  const now = new Date();
  const prisma = new PrismaService();
  await prisma.$connect();
  const repo = new AlertsRepository(prisma);

  let rulesEvaluated = 0;
  let rowsMatched = 0;
  let fired = 0;
  let resolved = 0;

  try {
    const [rules, latest] = await Promise.all([
      repo.getEnabledRules(),
      repo.latestPerKey(),
    ]);

    // Resolve pool display labels ONCE for the whole sweep (one query for all
    // candidate pools, joined to venues), so fire-time copy never does a
    // per-notification lookup. Label reads as "<Protocol> <Pool>", e.g. "Blend
    // Fixed" — the venue/protocol prefix is derived (not hard-coded), so it stays
    // correct for future non-Blend venues.
    const poolLabels = await repo.getPoolLabels(
      latest.map((row) => row.poolEntityId),
    );
    const formatPoolLabel = (entityId: string): string => {
      const parts = poolLabels.get(entityId);
      // Degenerate case: no entity row at all -> short id, no prefix.
      if (!parts) return `pool ${entityId.slice(0, 8)}`;
      return parts.venueLabel
        ? `${parts.venueLabel} ${parts.name}`
        : parts.name;
    };

    // Family dispatch (Lot N). Unknown metrics (DB ahead of the code) are
    // skipped loudly — never evaluated against the wrong family's data.
    const families = partitionRulesByFamily(rules);
    if (families.unknown.length > 0) {
      console.warn(
        `[evaluate-alerts] skipping ${families.unknown.length} rule(s) with no evaluator: ` +
          families.unknown.map((r) => `${r.id} (${r.metric})`).join(', '),
      );
    }

    // ── Family 1: health_factor — rules matched against wallet-pool health rows.
    for (const rule of families.healthFactor) {
      rulesEvaluated += 1;
      try {
        // In-scope rows: same user, and wallet/pool either unconstrained (NULL =
        // all) or an exact match.
        const matched = latest.filter(
          (row) =>
            row.userId === rule.userId &&
            (rule.userWalletId === null ||
              row.userWalletId === rule.userWalletId) &&
            (rule.poolEntityId === null ||
              row.poolEntityId === rule.poolEntityId),
        );

        const priorState = await repo.getRuleState(rule.id);
        const stateMap = new Map<string, AlertRuleState>(
          priorState.map((s) => [stateKey(s.userWalletId, s.poolEntityId), s]),
        );

        for (const row of matched) {
          rowsMatched += 1;
          const prev =
            stateMap.get(stateKey(row.userWalletId, row.poolEntityId)) ?? null;

          const out = evaluate({
            rule,
            current: row.healthFactor,
            prev,
            now,
          });

          // Identity is authoritative from the matched row (evaluate cannot know
          // it when prev is null). last_fired_at is the explicit value evaluate
          // computed — the repo's coalesce becomes a no-op.
          await repo.upsertRuleState({
            ruleId: rule.id,
            userWalletId: row.userWalletId,
            poolEntityId: row.poolEntityId,
            status: out.nextStatus,
            lastValue: out.nextState.lastValue,
            lastEvaluatedAt: now.toISOString(),
            lastFiredAt: toIso(out.nextState.lastFiredAt),
          });

          if (out.emit !== null) {
            // Human-readable copy resolved AT WRITE TIME — a notification is an
            // immutable record, so we bake in the pool label + a rounded HF now.
            // payload keeps machine-grade values (full-precision HF); title/body
            // are human-grade (3-decimal HF). Wording is operator-direction-aware.
            const opSym = OPERATOR_SYMBOL[rule.operator] ?? rule.operator;
            const poolLabel = formatPoolLabel(row.poolEntityId);
            const lowIsBad = rule.operator === 'lt' || rule.operator === 'lte';
            const directionWord = lowIsBad ? 'dropped to' : 'rose to';
            const hf3 =
              row.healthFactor !== null ? row.healthFactor.toFixed(3) : 'n/a';
            // Honesty rule (Lot N): copy carries the observation's as_of.
            const asOfIso = toIso(row.snapshotAt);
            const asOfSuffix = asOfIso
              ? ` — as of ${formatAsOf(new Date(asOfIso), now)}`
              : '';

            const payload = {
              walletId: row.userWalletId,
              poolEntityId: row.poolEntityId,
              poolLabel,
              metric: rule.metric,
              value: row.healthFactor, // full precision (machine-grade)
              threshold: rule.threshold,
              operator: rule.operator,
              asOf: asOfIso,
              // Route hint for the web feed (new notifications only): the
              // subject of a wallet-health alert lives on the portfolio view.
              link: { view: 'portfolio' },
            };

            const title =
              out.emit === 'alert_fired'
                ? `Health factor warning: ${poolLabel}`
                : `Health factor recovered: ${poolLabel}`;
            const body =
              out.emit === 'alert_fired'
                ? `${poolLabel} health factor ${directionWord} ${hf3} (alert threshold ${opSym} ${rule.threshold})${asOfSuffix}.`
                : `${poolLabel} health factor back to ${hf3}${asOfSuffix}.`;

            await repo.insertNotification({
              userId: rule.userId,
              ruleId: rule.id,
              kind: out.emit,
              title,
              body,
              payload,
            });

            if (out.emit === 'alert_fired') fired += 1;
            else resolved += 1;
          }
        }
      } catch (error) {
        // One bad rule must not abort the whole sweep.
        console.error(`[evaluate-alerts] rule ${rule.id} failed`);
        console.error(error);
      }
    }

    // ── Family 2: price — one subject per rule (its asset), edge state in
    // alert_rule_subject_state. Latest prices loaded once for the whole family.
    const priceMap = await repo.latestPricesByAsset(
      families.price
        .map((r) => r.assetId)
        .filter((id): id is string => id !== null),
    );

    for (const rule of families.price) {
      rulesEvaluated += 1;
      try {
        // Shape is service-enforced; skip defensively rather than mis-evaluate.
        if (rule.assetId === null || rule.threshold === null) continue;

        const px = priceMap.get(rule.assetId);
        if (!px || px.priceUsd === null) {
          // No observed price → neither fire nor resolve; state untouched.
          console.warn(
            `[evaluate-alerts] price rule ${rule.id}: no recent price for asset ${rule.assetId} — skipped`,
          );
          continue;
        }
        rowsMatched += 1;

        const subjectStates = await repo.getSubjectState(rule.id);
        const prevSubject =
          subjectStates.find((s) => s.subjectKey === rule.assetId) ?? null;
        // Adapt to the evaluator's prev shape — identity fields are unused here
        // (the subject key is authoritative at persist time, like wallet/pool
        // for the health family).
        const prev: AlertRuleState | null = prevSubject
          ? {
              ruleId: prevSubject.ruleId,
              userWalletId: '',
              poolEntityId: '',
              status: prevSubject.status,
              lastValue: prevSubject.lastValue,
              lastEvaluatedAt: prevSubject.lastEvaluatedAt,
              lastFiredAt: prevSubject.lastFiredAt,
            }
          : null;

        const out = evaluate({ rule, current: px.priceUsd, prev, now });

        await repo.upsertSubjectState({
          ruleId: rule.id,
          subjectKey: rule.assetId,
          status: out.nextStatus,
          lastValue: out.nextState.lastValue,
          lastEvaluatedAt: now.toISOString(),
          lastFiredAt: toIso(out.nextState.lastFiredAt),
        });

        if (out.emit !== null) {
          const symbol = displaySymbol(px.symbol, px.name, px.assetId);
          const asOfIso = toIso(px.observedAt);
          const copy = buildPriceCopy({
            emit: out.emit,
            symbol,
            operator: rule.operator,
            threshold: rule.threshold,
            value: px.priceUsd,
            asOf: asOfIso ? new Date(asOfIso) : now,
            now,
          });

          await repo.insertNotification({
            userId: rule.userId,
            ruleId: rule.id,
            kind: out.emit,
            title: copy.title,
            body: copy.body,
            payload: {
              assetId: rule.assetId,
              symbol,
              metric: rule.metric,
              value: px.priceUsd, // full precision (machine-grade)
              threshold: rule.threshold,
              operator: rule.operator,
              asOf: asOfIso,
              // No route hint: assets have no page of their own (honest).
            },
          });

          if (out.emit === 'alert_fired') fired += 1;
          else resolved += 1;
        }
      } catch (error) {
        console.error(`[evaluate-alerts] rule ${rule.id} failed`);
        console.error(error);
      }
    }

    // ── Family 3: tvl_drop_pct (N3) — pool TVL drop % over the ~24h batch
    // window. Source: reserve_snapshots complete batches (latest vs closest to
    // 24h before it), TVL formula mirroring compute-pool-metrics — NOT the
    // /series logic. Edge state in alert_rule_subject_state keyed by the pool.
    const tvlPoolIds = Array.from(
      new Set(
        families.tvlDrop
          .map((r) => r.poolEntityId)
          .filter((id): id is string => id !== null)
      )
    );
    const tvlWindows = await repo.getPoolTvlWindows(tvlPoolIds);
    const tvlPoolLabels = await repo.getPoolLabels(tvlPoolIds);

    for (const rule of families.tvlDrop) {
      rulesEvaluated += 1;
      try {
        // Shape is service-enforced; skip defensively rather than mis-evaluate.
        if (rule.poolEntityId === null || rule.threshold === null) continue;

        const win = tvlWindows.get(rule.poolEntityId);
        if (!win || win.latestTvlUsd === null || win.prevTvlUsd === null) {
          // Not enough batch history for an honest 24h claim — never fire.
          console.warn(
            `[evaluate-alerts] tvl rule ${rule.id}: no 24h batch window for pool ${rule.poolEntityId} — skipped`
          );
          continue;
        }

        const latestIso = toIso(win.latestAt);
        const prevIso = toIso(win.prevAt);
        if (latestIso === null || prevIso === null) continue;
        const latestAt = new Date(latestIso);
        const prevAt = new Date(prevIso);

        // Stale-pipeline guard: if the newest batch is over a day old the
        // "drop over 24h" claim is dead data — skip, state untouched.
        if (now.getTime() - latestAt.getTime() > 24 * 3600 * 1000) {
          console.warn(
            `[evaluate-alerts] tvl rule ${rule.id}: latest batch ${latestIso} is stale — skipped`
          );
          continue;
        }

        const dropPct = computeTvlDropPct(win.prevTvlUsd, win.latestTvlUsd);
        if (dropPct === null) continue;

        const subjectStates = await repo.getSubjectState(rule.id);
        const prevSubject =
          subjectStates.find((s) => s.subjectKey === rule.poolEntityId) ?? null;
        const prev: AlertRuleState | null = prevSubject
          ? {
              ruleId: prevSubject.ruleId,
              userWalletId: '',
              poolEntityId: '',
              status: prevSubject.status,
              lastValue: prevSubject.lastValue,
              lastEvaluatedAt: prevSubject.lastEvaluatedAt,
              lastFiredAt: prevSubject.lastFiredAt,
            }
          : null;

        const out = evaluate({ rule, current: dropPct, prev, now });

        await repo.upsertSubjectState({
          ruleId: rule.id,
          subjectKey: rule.poolEntityId,
          status: out.nextStatus,
          lastValue: out.nextState.lastValue,
          lastEvaluatedAt: now.toISOString(),
          lastFiredAt: toIso(out.nextState.lastFiredAt),
        });

        if (out.emit !== null) {
          const labelParts = tvlPoolLabels.get(rule.poolEntityId);
          const poolLabel = labelParts
            ? labelParts.venueLabel
              ? `${labelParts.venueLabel} ${labelParts.name}`
              : labelParts.name
            : `pool ${rule.poolEntityId.slice(0, 8)}`;
          const windowHours = Math.round(
            (latestAt.getTime() - prevAt.getTime()) / 3600000
          );

          const copy = buildTvlDropCopy({
            emit: out.emit,
            poolLabel,
            dropPct,
            prevTvlUsd: win.prevTvlUsd,
            latestTvlUsd: win.latestTvlUsd,
            thresholdPct: rule.threshold,
            windowHours,
            asOf: latestAt,
            now,
          });

          await repo.insertNotification({
            userId: rule.userId,
            ruleId: rule.id,
            kind: out.emit,
            title: copy.title,
            body: copy.body,
            payload: {
              poolEntityId: rule.poolEntityId,
              poolLabel,
              metric: rule.metric,
              value: dropPct, // full precision (machine-grade)
              threshold: rule.threshold,
              operator: rule.operator,
              tvlPrevUsd: win.prevTvlUsd,
              tvlLatestUsd: win.latestTvlUsd,
              windowHours,
              asOf: latestIso,
              // The subject of a TVL alert is the pool's page.
              link: labelParts?.slug
                ? { view: 'pool', poolId: labelParts.slug }
                : undefined,
            },
          });

          if (out.emit === 'alert_fired') fired += 1;
          else resolved += 1;
        }
      } catch (error) {
        console.error(`[evaluate-alerts] rule ${rule.id} failed`);
        console.error(error);
      }
    }

    // ── System family: pool status (N2) — AUTOMATIC protection, no user rule.
    // Load the mainnet Blend pools' live status (PoolV2.load × 4 — same read
    // path as A5b; derivePoolStatus is the single code→label mapping), diff
    // against pool_status_state, and on a real change notify every user with a
    // current tracked-wallet position in that pool. First observation of a pool
    // seeds silently. RPC failure for a pool = skip it this sweep, state kept.
    let poolStatusChanges = 0;
    let poolStatusNotified = 0;
    try {
      const cfg = getNetworkConfig('mainnet');
      const slugToEntity = await repo.getEntityIdsBySlug(
        MAINNET_BLEND_POOLS.map((p) => p.slug)
      );
      const prevStates = await repo.getPoolStatusStates();

      for (const entry of MAINNET_BLEND_POOLS) {
        const entityId = slugToEntity.get(entry.slug);
        if (!entityId) {
          console.warn(
            `[evaluate-alerts] pool-status: no active entity for ${entry.slug} — skipped`
          );
          continue;
        }

        let statusCode: number;
        try {
          const pool = await PoolV2.load(
            { passphrase: cfg.networkPassphrase, rpc: cfg.rpcUrl },
            entry.poolId
          );
          statusCode = pool.metadata.status;
        } catch (error) {
          console.error(
            `[evaluate-alerts] pool-status: PoolV2.load failed for ${entry.slug} — skipped`
          );
          console.error(error);
          continue;
        }

        const status = derivePoolStatus(statusCode);
        const prev = prevStates.get(entityId) ?? null;
        const outcome = diffPoolStatus(prev?.status ?? null, status.label);

        await repo.upsertPoolStatusState({
          entityId,
          statusCode: status.code,
          status: status.label,
          changedAt:
            outcome === 'changed' || outcome === 'suppressed' || prev === null
              ? now.toISOString()
              : (toIso(prev.changedAt) ?? now.toISOString()),
          seenAt: now.toISOString(),
        });

        if (outcome !== 'changed' || prev === null) continue;
        poolStatusChanges += 1;

        const poolLabel = `Blend ${entry.label}`;
        const copy = buildPoolStatusCopy({
          poolLabel,
          from: prev.status,
          to: status.label,
        });
        const affected = await repo.usersWithPositionsByPool([entityId]);
        const userIds = affected.get(entityId) ?? [];

        for (const userId of userIds) {
          await repo.insertNotification({
            userId,
            ruleId: null, // automatic protection — not a user rule
            kind: copy.kind,
            title: copy.title,
            body: copy.body,
            payload: {
              metric: 'pool_status',
              poolEntityId: entityId,
              poolLabel,
              from: prev.status,
              to: status.label,
              statusCode: status.code,
              supplyBlocked: status.supplyBlocked,
              withdrawBlocked: status.withdrawBlocked,
              asOf: now.toISOString(),
              // The subject of a pool-status alert is the pool's page.
              link: { view: 'pool', poolId: entry.slug },
            },
          });
          poolStatusNotified += 1;
        }
      }
    } catch (error) {
      // The automatic family must never abort the user-rule families' summary.
      console.error('[evaluate-alerts] pool-status stage failed');
      console.error(error);
    }

    console.log({
      completedAt: new Date().toISOString(),
      rulesEvaluated,
      rowsMatched,
      fired,
      resolved,
      poolStatusChanges,
      poolStatusNotified,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
