// apps/api/src/modules/alerts/evaluate.spec.ts
//
// Table-driven coverage of the pure evaluator state machine (evaluate.ts).
// Jest (ts-jest) — run: pnpm -C apps/api test evaluate

import { evaluate, RuleEvalInput } from './evaluate';
import type { AlertRule, AlertRuleState } from './alerts.repository';

const NOW = new Date('2026-06-28T12:00:00.000Z');

// Base "low is bad" health-factor rule: fire when HF < 1.10, re-arm at +0.15,
// cooldown 1h.
function hfRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'rule-1',
    userId: 'user-1',
    metric: 'health_factor',
    userWalletId: null,
    poolEntityId: null,
    operator: 'lt',
    threshold: 1.1,
    cooldownSeconds: 3600,
    rearmHysteresis: 0.15,
    enabled: true,
    extra: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function state(overrides: Partial<AlertRuleState> = {}): AlertRuleState {
  return {
    ruleId: 'rule-1',
    userWalletId: 'wallet-1',
    poolEntityId: 'pool-1',
    status: 'ok',
    lastValue: null,
    lastEvaluatedAt: NOW,
    lastFiredAt: null,
    ...overrides,
  };
}

function input(over: Partial<RuleEvalInput>): RuleEvalInput {
  return { rule: hfRule(), current: null, prev: null, now: NOW, ...over };
}

const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('evaluate — health factor state machine', () => {
  type Case = {
    name: string;
    in: RuleEvalInput;
    emit: 'alert_fired' | 'alert_resolved' | null;
    nextStatus: 'ok' | 'breached';
    // optional assertion on whether last_fired_at advanced to `now`
    firedAtIsNow?: boolean;
    firedAtCarried?: boolean; // equals prev.lastFiredAt
  };

  const cases: Case[] = [
    {
      name: 'ok -> breach: fires (edge)',
      in: input({ current: 1.0, prev: state({ status: 'ok', lastValue: 1.3 }) }),
      emit: 'alert_fired',
      nextStatus: 'breached',
      firedAtIsNow: true,
    },
    {
      name: 'null prev -> breach: fires (first ever evaluation)',
      in: input({ current: 1.0, prev: null }),
      emit: 'alert_fired',
      nextStatus: 'breached',
      firedAtIsNow: true,
    },
    {
      name: 'breach -> breach within cooldown: silent',
      in: input({
        current: 1.0,
        prev: state({ status: 'breached', lastFiredAt: minsAgo(10) }),
      }),
      emit: null,
      nextStatus: 'breached',
      firedAtCarried: true,
    },
    {
      name: 'breach -> breach after cooldown: re-fires',
      in: input({
        current: 1.0,
        prev: state({ status: 'breached', lastFiredAt: minsAgo(90) }),
      }),
      emit: 'alert_fired',
      nextStatus: 'breached',
      firedAtIsNow: true,
    },
    {
      name: 'breach -> hysteresis band: holds breached, no emit (anti-flap)',
      // threshold 1.10, margin 0.15 -> recovered only at >= 1.25; 1.20 is in band
      in: input({
        current: 1.2,
        prev: state({ status: 'breached', lastFiredAt: minsAgo(5) }),
      }),
      emit: null,
      nextStatus: 'breached',
      firedAtCarried: true,
    },
    {
      name: 'breach -> recovered past re-arm: resolves',
      in: input({
        current: 1.3, // >= 1.10 + 0.15
        prev: state({ status: 'breached', lastFiredAt: minsAgo(5) }),
      }),
      emit: 'alert_resolved',
      nextStatus: 'ok',
      firedAtCarried: true,
    },
    {
      name: 'breach -> no debt (null): resolves',
      in: input({
        current: null,
        prev: state({ status: 'breached', lastFiredAt: minsAgo(5) }),
      }),
      emit: 'alert_resolved',
      nextStatus: 'ok',
      firedAtCarried: true,
    },
    {
      name: 'ok -> no debt (null): noop',
      in: input({ current: null, prev: state({ status: 'ok' }) }),
      emit: null,
      nextStatus: 'ok',
    },
    {
      name: 'ok -> ok (healthy): noop',
      in: input({ current: 2.0, prev: state({ status: 'ok' }) }),
      emit: null,
      nextStatus: 'ok',
    },
    {
      name: 'breached but null last_fired_at: treated as elapsed -> fires',
      in: input({
        current: 1.0,
        prev: state({ status: 'breached', lastFiredAt: null }),
      }),
      emit: 'alert_fired',
      nextStatus: 'breached',
      firedAtIsNow: true,
    },
    // --- symmetric gt/gte direction ("high is bad") ---
    {
      name: 'gt high-is-bad ok -> breach: fires',
      in: input({
        rule: hfRule({ operator: 'gt', threshold: 100, rearmHysteresis: 10 }),
        current: 150,
        prev: state({ status: 'ok' }),
      }),
      emit: 'alert_fired',
      nextStatus: 'breached',
      firedAtIsNow: true,
    },
    {
      name: 'gt high-is-bad breach -> band (95): holds, no emit',
      // threshold 100, margin 10 -> recovered only at <= 90; 95 is in band
      in: input({
        rule: hfRule({ operator: 'gt', threshold: 100, rearmHysteresis: 10 }),
        current: 95,
        prev: state({ status: 'breached', lastFiredAt: minsAgo(5) }),
      }),
      emit: null,
      nextStatus: 'breached',
      firedAtCarried: true,
    },
    {
      name: 'gte high-is-bad breach -> recovered (85): resolves',
      in: input({
        rule: hfRule({ operator: 'gte', threshold: 100, rearmHysteresis: 10 }),
        current: 85, // <= 100 - 10
        prev: state({ status: 'breached', lastFiredAt: minsAgo(5) }),
      }),
      emit: 'alert_resolved',
      nextStatus: 'ok',
      firedAtCarried: true,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const out = evaluate(c.in);
      expect(out.emit).toBe(c.emit);
      expect(out.nextStatus).toBe(c.nextStatus);
      expect(out.nextState.status).toBe(c.nextStatus);
      // last_value mirrors current on every branch
      expect(out.nextState.lastValue).toBe(c.in.current);
      // last_evaluated_at is always now
      expect(out.nextState.lastEvaluatedAt).toBe(NOW);

      if (c.firedAtIsNow) {
        expect(out.nextState.lastFiredAt).toEqual(NOW);
      }
      if (c.firedAtCarried) {
        const prevFired = c.in.prev?.lastFiredAt ?? null;
        if (prevFired === null) {
          expect(out.nextState.lastFiredAt).toBeNull();
        } else {
          expect((out.nextState.lastFiredAt as Date).getTime()).toBe(
            new Date(prevFired as string | Date).getTime()
          );
        }
      }
    });
  }

  it('cooldown boundary: exactly cooldown elapsed re-fires', () => {
    const out = evaluate(
      input({
        current: 1.0,
        prev: state({ status: 'breached', lastFiredAt: minsAgo(60) }), // exactly 3600s
      })
    );
    expect(out.emit).toBe('alert_fired');
    expect(out.nextState.lastFiredAt).toEqual(NOW);
  });

  it('null threshold never fires (defensive)', () => {
    const out = evaluate(
      input({
        rule: hfRule({ threshold: null }),
        current: 0.0,
        prev: state({ status: 'ok' }),
      })
    );
    expect(out.emit).toBeNull();
    expect(out.nextStatus).toBe('ok');
  });
});
