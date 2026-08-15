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
import { PrismaService } from '../db/prisma.service';
import {
  AlertsRepository,
  type AlertRuleState,
} from '../modules/alerts/alerts.repository';
import { evaluate } from '../modules/alerts/evaluate';
import {
  buildPriceCopy,
  displaySymbol,
  formatAsOf,
  partitionRulesByFamily,
} from '../modules/alerts/families';

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

    console.log({
      completedAt: new Date().toISOString(),
      rulesEvaluated,
      rowsMatched,
      fired,
      resolved,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
