// apps/api/src/modules/alerts/evaluate.ts
//
// D2 alerting — the PURE rule evaluator. Deterministic, side-effect free, no DB,
// no clock read (`now` is injected). Given a rule, the current metric value, the
// prior persisted state and `now`, it returns the next status, what (if anything)
// to emit, and the next state to persist. All scheduling/dedup lives here as an
// edge-triggered state machine with cooldown + hysteresis (anti-flap).
//
// Operator-direction-generic: for health_factor the operators are lt/lte ("low is
// bad"), but gt/gte ("high is bad") are supported symmetrically.

import type { AlertRule, AlertRuleState } from './alerts.repository';

export type RuleEvalInput = {
  rule: AlertRule;
  current: number | null;
  prev: AlertRuleState | null;
  now: Date;
};

export type RuleEvalOutput = {
  nextStatus: 'ok' | 'breached';
  emit: 'alert_fired' | 'alert_resolved' | null;
  nextState: AlertRuleState;
};

// Threshold comparison. lt: v<t | lte: v<=t | gt: v>t | gte: v>=t.
function compare(v: number, op: AlertRule['operator'], t: number): boolean {
  switch (op) {
    case 'lt':
      return v < t;
    case 'lte':
      return v <= t;
    case 'gt':
      return v > t;
    case 'gte':
      return v >= t;
  }
}

// "Recovered" = the value has crossed back past the threshold by the recovery
// margin IN THE RECOVERY DIRECTION:
//   lt/lte  (low bad)  -> recovered when current >= threshold + margin
//   gt/gte  (high bad) -> recovered when current <= threshold - margin
function isRecovered(
  current: number,
  op: AlertRule['operator'],
  threshold: number,
  margin: number
): boolean {
  if (op === 'lt' || op === 'lte') {
    return current >= threshold + margin;
  }
  return current <= threshold - margin;
}

// Normalize an arbitrary timestamp value (Date | ISO string | epoch ms | null)
// to epoch milliseconds. Used for cooldown arithmetic on prev.lastFiredAt.
function toMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function evaluate(input: RuleEvalInput): RuleEvalOutput {
  const { rule, current, prev, now } = input;
  const op = rule.operator;
  // threshold is NOT NULL in the DB; coerce defensively. A NaN threshold makes
  // every comparison false → the rule simply never fires (safe).
  const threshold = rule.threshold ?? Number.NaN;
  const margin = rule.rearmHysteresis ?? 0;

  // The carried-forward fire timestamp, normalized to a Date (or null). Every
  // branch sets last_fired_at EXPLICITLY — we never rely on the repo's coalesce.
  const carriedMs = toMillis(prev?.lastFiredAt);
  const carriedFiredAt = carriedMs === null ? null : new Date(carriedMs);

  // Identity note: RuleEvalInput intentionally carries no (wallet, pool) key, so
  // nextState's identity is best-effort from prev. The caller (script 83) is the
  // source of truth for identity and passes the matched row's wallet/pool to
  // upsertRuleState; nextState here is authoritative only for status/value/timestamps.
  const build = (
    nextStatus: 'ok' | 'breached',
    emit: RuleEvalOutput['emit'],
    lastFiredAt: Date | null
  ): RuleEvalOutput => ({
    nextStatus,
    emit,
    nextState: {
      ruleId: rule.id,
      userWalletId: prev?.userWalletId ?? '',
      poolEntityId: prev?.poolEntityId ?? '',
      status: nextStatus,
      lastValue: current,
      lastEvaluatedAt: now,
      lastFiredAt,
    },
  });

  // 1. No debt (current === null) — health factor is undefined, never a breach.
  if (current === null) {
    if (prev?.status === 'breached') {
      return build('ok', 'alert_resolved', carriedFiredAt);
    }
    return build('ok', null, carriedFiredAt);
  }

  const breached = compare(current, op, threshold);

  // 2. Breached.
  if (breached) {
    if (!prev || prev.status === 'ok') {
      // Edge: ok/none -> breached. Fire now.
      return build('breached', 'alert_fired', now);
    }
    // Sustained breach: re-fire only after the cooldown has elapsed. A null
    // last_fired_at (breached but never recorded a fire) is treated as elapsed.
    const firedMs = toMillis(prev.lastFiredAt);
    const elapsed =
      firedMs === null
        ? true
        : now.getTime() - firedMs >= rule.cooldownSeconds * 1000;
    if (elapsed) {
      return build('breached', 'alert_fired', now);
    }
    return build('breached', null, carriedFiredAt);
  }

  // 3. Not breached AND current !== null.
  if (prev?.status === 'breached') {
    if (isRecovered(current, op, threshold, margin)) {
      return build('ok', 'alert_resolved', carriedFiredAt);
    }
    // In the hysteresis band: no longer breached, not yet recovered. HOLD the
    // breached status (anti-flap) and emit nothing.
    return build('breached', null, carriedFiredAt);
  }

  // prev ok / none and value is fine → steady ok.
  return build('ok', null, carriedFiredAt);
}
