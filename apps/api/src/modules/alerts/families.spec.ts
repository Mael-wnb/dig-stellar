// apps/api/src/modules/alerts/families.spec.ts
//
// Lot N — family dispatch + price copy. The dispatch tests are the N1 safety
// contract: a price rule must NEVER reach the health-factor evaluator and vice
// versa (before the dispatch existed, script 83 matched every enabled rule
// against health rows regardless of metric).

import {
  apyRuleSide,
  buildApyCopy,
  buildPoolStatusCopy,
  buildPriceCopy,
  buildTvlDropCopy,
  computeTvlDropPct,
  diffPoolStatus,
  displaySymbol,
  formatApyPct,
  formatAsOf,
  formatDropPct,
  formatUsdCompact,
  formatUsdPrice,
  partitionRulesByFamily,
} from './families';
import { evaluate } from './evaluate';
import type { AlertRule } from './alerts.repository';

const NOW = new Date('2026-08-15T14:32:00Z');

function rule(metric: string, overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    userId: '00000000-0000-0000-0000-000000000001',
    metric: metric as AlertRule['metric'],
    userWalletId: null,
    poolEntityId: null,
    assetId: null,
    operator: 'lt',
    threshold: 1.25,
    cooldownSeconds: 3600,
    rearmHysteresis: null,
    enabled: true,
    extra: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('partitionRulesByFamily (cross-family dispatch)', () => {
  it('a price rule never enters the health-factor bucket', () => {
    const price = rule('price', { operator: 'gt', threshold: 0.17 });
    const out = partitionRulesByFamily([price]);
    expect(out.healthFactor).toHaveLength(0);
    expect(out.price).toEqual([price]);
    expect(out.unknown).toHaveLength(0);
  });

  it('a health-factor rule never enters the price bucket', () => {
    const hf = rule('health_factor');
    const out = partitionRulesByFamily([hf]);
    expect(out.price).toHaveLength(0);
    expect(out.healthFactor).toEqual([hf]);
    expect(out.unknown).toHaveLength(0);
  });

  it('mixed input splits cleanly and preserves order within a family', () => {
    const hf1 = rule('health_factor');
    const p1 = rule('price', { operator: 'gt', threshold: 0.17 });
    const hf2 = rule('health_factor', { threshold: 1.1 });
    const out = partitionRulesByFamily([hf1, p1, hf2]);
    expect(out.healthFactor).toEqual([hf1, hf2]);
    expect(out.price).toEqual([p1]);
  });

  it('a tvl-drop rule lands in its own bucket, never health/price (N3)', () => {
    const tvl = rule('tvl_drop_pct', { operator: 'gte', threshold: 10 });
    const out = partitionRulesByFamily([tvl]);
    expect(out.healthFactor).toHaveLength(0);
    expect(out.price).toHaveLength(0);
    expect(out.tvlDrop).toEqual([tvl]);
    expect(out.unknown).toHaveLength(0);
  });

  it('supply/borrow APY rules land in the shared apy bucket, never elsewhere (N4)', () => {
    const supply = rule('supply_apy', { operator: 'gt', threshold: 8 });
    const borrow = rule('borrow_apy', { operator: 'gte', threshold: 12 });
    const out = partitionRulesByFamily([supply, borrow]);
    expect(out.healthFactor).toHaveLength(0);
    expect(out.price).toHaveLength(0);
    expect(out.tvlDrop).toHaveLength(0);
    expect(out.apy).toEqual([supply, borrow]);
    expect(out.unknown).toHaveLength(0);
  });

  it('a metric with no evaluator lands in unknown (skipped, never evaluated)', () => {
    const future = rule('volume_spike_pct');
    const out = partitionRulesByFamily([future]);
    expect(out.healthFactor).toHaveLength(0);
    expect(out.price).toHaveLength(0);
    expect(out.tvlDrop).toHaveLength(0);
    expect(out.apy).toHaveLength(0);
    expect(out.unknown).toEqual([future]);
  });
});

describe('price family reuses the edge-triggered state machine', () => {
  const priceRule = rule('price', {
    operator: 'gt',
    threshold: 0.17,
    cooldownSeconds: 3600,
  });

  it('fires on the upward crossing edge', () => {
    const out = evaluate({
      rule: priceRule,
      current: 0.1712,
      prev: null,
      now: NOW,
    });
    expect(out.emit).toBe('alert_fired');
    expect(out.nextStatus).toBe('breached');
  });

  it('does not double-fire while the price stays beyond the threshold (cooldown)', () => {
    const first = evaluate({
      rule: priceRule,
      current: 0.1712,
      prev: null,
      now: NOW,
    });
    const fiveMinLater = new Date(NOW.getTime() + 5 * 60 * 1000);
    const second = evaluate({
      rule: priceRule,
      current: 0.18,
      prev: first.nextState,
      now: fiveMinLater,
    });
    expect(second.emit).toBeNull();
    expect(second.nextStatus).toBe('breached');
  });

  it('resolves on the return edge', () => {
    const first = evaluate({
      rule: priceRule,
      current: 0.1712,
      prev: null,
      now: NOW,
    });
    const later = new Date(NOW.getTime() + 10 * 60 * 1000);
    const back = evaluate({
      rule: priceRule,
      current: 0.169,
      prev: first.nextState,
      now: later,
    });
    expect(back.emit).toBe('alert_resolved');
    expect(back.nextStatus).toBe('ok');
  });
});

describe('price copy (observed value + as_of, honesty rules)', () => {
  it('fired copy carries the observed price and its as_of time', () => {
    const { title, body } = buildPriceCopy({
      emit: 'alert_fired',
      symbol: 'XLM',
      operator: 'gt',
      threshold: 0.17,
      value: 0.1712,
      asOf: new Date('2026-08-15T14:32:00Z'),
      now: NOW,
    });
    expect(title).toBe('Price alert: XLM above $0.1700');
    expect(body).toBe('XLM crossed above $0.1700: $0.1712 at 14:32 UTC.');
  });

  it('resolved copy states the return direction with the observed price', () => {
    const { title, body } = buildPriceCopy({
      emit: 'alert_resolved',
      symbol: 'XLM',
      operator: 'gt',
      threshold: 0.17,
      value: 0.169,
      asOf: new Date('2026-08-15T14:47:00Z'),
      now: new Date('2026-08-15T14:47:30Z'),
    });
    expect(title).toBe('Price alert resolved: XLM back below $0.1700');
    expect(body).toBe('XLM is back below $0.1700: $0.1690 at 14:47 UTC.');
  });

  it('a below-threshold rule words the directions the other way around', () => {
    const { body } = buildPriceCopy({
      emit: 'alert_fired',
      symbol: 'EURC',
      operator: 'lt',
      threshold: 1.1,
      value: 1.08,
      asOf: new Date('2026-08-15T09:00:00Z'),
      now: NOW,
    });
    expect(body).toBe('EURC crossed below $1.10: $1.08 at 09:00 UTC.');
  });

  it('an as_of older than 24h shows its full date', () => {
    expect(formatAsOf(new Date('2026-08-10T09:10:00Z'), NOW)).toBe(
      '2026-08-10 09:10 UTC',
    );
    expect(formatAsOf(new Date('2026-08-15T09:10:00Z'), NOW)).toBe('09:10 UTC');
  });

  it('formats sub-dollar prices with 4 decimals, others with 2', () => {
    expect(formatUsdPrice(0.1712)).toBe('$0.1712');
    expect(formatUsdPrice(1.08)).toBe('$1.08');
  });

  it('displays the native lumen symbol as XLM', () => {
    expect(displaySymbol('native', 'Stellar Lumens', 'abc')).toBe('XLM');
    expect(displaySymbol('AQUA', null, 'abc')).toBe('AQUA');
    expect(displaySymbol(null, null, '12345678-dead-beef')).toBe(
      'asset 12345678',
    );
  });
});

describe('tvl-drop family (N3) — drop computation, edge reuse, copy', () => {
  it('computes the drop % (positive = fell, negative = grew, null on no base)', () => {
    expect(computeTvlDropPct(8_000_000, 7_000_000)).toBeCloseTo(12.5);
    expect(computeTvlDropPct(8_000_000, 8_240_000)).toBeCloseTo(-3);
    expect(computeTvlDropPct(0, 1_000_000)).toBeNull();
    expect(computeTvlDropPct(-5, 3)).toBeNull();
  });

  it('reuses the edge machine: fires on crossing the drop threshold, no double-fire, resolves', () => {
    const tvlRule = rule('tvl_drop_pct', {
      operator: 'gte',
      threshold: 10,
      cooldownSeconds: 3600,
    });
    const first = evaluate({ rule: tvlRule, current: 12.5, prev: null, now: NOW });
    expect(first.emit).toBe('alert_fired');

    const stillDown = evaluate({
      rule: tvlRule,
      current: 13.1,
      prev: first.nextState,
      now: new Date(NOW.getTime() + 15 * 60 * 1000),
    });
    expect(stillDown.emit).toBeNull();
    expect(stillDown.nextStatus).toBe('breached');

    const recovered = evaluate({
      rule: tvlRule,
      current: 4.2,
      prev: first.nextState,
      now: new Date(NOW.getTime() + 30 * 60 * 1000),
    });
    expect(recovered.emit).toBe('alert_resolved');
    expect(recovered.nextStatus).toBe('ok');
  });

  it('fired copy matches the brief: drop %, window, compact USD range, as_of', () => {
    const { title, body } = buildTvlDropCopy({
      emit: 'alert_fired',
      poolLabel: 'Blend Fixed',
      dropPct: 12.4,
      prevTvlUsd: 8_000_000,
      latestTvlUsd: 7_000_000,
      thresholdPct: 10,
      windowHours: 24,
      asOf: new Date('2026-08-15T14:32:00Z'),
      now: NOW,
    });
    expect(title).toBe('TVL drop: Blend Fixed −12.4% over 24h');
    expect(body).toBe(
      'Blend Fixed TVL −12.4% over 24h ($8.0M → $7.0M), as of 14:32 UTC.',
    );
  });

  it('resolved copy states the threshold it came back within', () => {
    const { title, body } = buildTvlDropCopy({
      emit: 'alert_resolved',
      poolLabel: 'Blend Fixed',
      dropPct: 3.1,
      prevTvlUsd: 8_000_000,
      latestTvlUsd: 7_752_000,
      thresholdPct: 10,
      windowHours: 25,
      asOf: new Date('2026-08-15T14:32:00Z'),
      now: NOW,
    });
    expect(title).toBe('TVL drop resolved: Blend Fixed back within 10%');
    expect(body).toBe(
      'Blend Fixed TVL is back within your 10% threshold: −3.1% over 25h ($8.0M → $7.8M), as of 14:32 UTC.',
    );
  });

  it('a growth window is displayed with a plus sign', () => {
    expect(formatDropPct(-3.2)).toBe('+3.2%');
    expect(formatDropPct(12.4)).toBe('−12.4%');
  });

  it('formats compact USD across magnitudes', () => {
    expect(formatUsdCompact(8_000_000)).toBe('$8.0M');
    expect(formatUsdCompact(950_300)).toBe('$950.3K');
    expect(formatUsdCompact(12.4)).toBe('$12.40');
    expect(formatUsdCompact(2_100_000_000)).toBe('$2.1B');
  });
});

describe('apy family (N4) — percent conversion, copy, edge reuse', () => {
  it('maps the metric to its side', () => {
    expect(apyRuleSide('supply_apy')).toBe('supply');
    expect(apyRuleSide('borrow_apy')).toBe('borrow');
  });

  it('formats APY percent with 2 decimals', () => {
    expect(formatApyPct(8.4)).toBe('8.40%');
    expect(formatApyPct(0.0011)).toBe('0.00%');
  });

  it('fired copy carries observed value, threshold and as_of', () => {
    const { title, body } = buildApyCopy({
      emit: 'alert_fired',
      poolLabel: 'Blend Fixed',
      side: 'supply',
      operator: 'gt',
      thresholdPct: 8,
      valuePct: 8.4,
      asOf: new Date('2026-08-16T09:12:00Z'),
      now: new Date('2026-08-16T09:15:00Z'),
    });
    expect(title).toBe('Supply APY alert: Blend Fixed at 8.40%');
    expect(body).toBe(
      'Blend Fixed supply APY rose to 8.40% (alert threshold > 8%), as of 09:12 UTC.',
    );
  });

  it('a falls-below borrow rule words the direction the other way', () => {
    const { body } = buildApyCopy({
      emit: 'alert_fired',
      poolLabel: 'Blend Fixed',
      side: 'borrow',
      operator: 'lt',
      thresholdPct: 5,
      valuePct: 4.1,
      asOf: new Date('2026-08-16T09:12:00Z'),
      now: new Date('2026-08-16T09:15:00Z'),
    });
    expect(body).toBe(
      'Blend Fixed borrow APY dropped to 4.10% (alert threshold < 5%), as of 09:12 UTC.',
    );
  });

  it('resolved copy states the value it came back to', () => {
    const { title, body } = buildApyCopy({
      emit: 'alert_resolved',
      poolLabel: 'Blend Fixed',
      side: 'supply',
      operator: 'gt',
      thresholdPct: 8,
      valuePct: 7.1,
      asOf: new Date('2026-08-16T10:00:00Z'),
      now: new Date('2026-08-16T10:02:00Z'),
    });
    expect(title).toBe('Supply APY back: Blend Fixed at 7.10%');
    expect(body).toBe(
      'Blend Fixed supply APY back to 7.10%, as of 10:00 UTC.',
    );
  });

  it('reuses the edge machine over percent values (fire above, resolve back)', () => {
    const apyRule = rule('supply_apy', { operator: 'gt', threshold: 8 });
    const first = evaluate({ rule: apyRule, current: 8.4, prev: null, now: NOW });
    expect(first.emit).toBe('alert_fired');
    const back = evaluate({
      rule: apyRule,
      current: 7.1,
      prev: first.nextState,
      now: new Date(NOW.getTime() + 20 * 60 * 1000),
    });
    expect(back.emit).toBe('alert_resolved');
  });
});

describe('pool-status family (N2) — automatic protection edge logic', () => {
  it('SEED RUN IS SILENT: the first observation records state and never notifies', () => {
    expect(diffPoolStatus(null, 'Active')).toBe('seed');
    expect(diffPoolStatus(null, 'Frozen')).toBe('seed');
    // even a "bad" first status is a seed, not an event — no retroactive firing
    expect(diffPoolStatus(null, 'Unknown')).toBe('seed');
  });

  it('an unchanged status stays silent sweep after sweep', () => {
    expect(diffPoolStatus('Active', 'Active')).toBe('unchanged');
    expect(diffPoolStatus('Frozen', 'Frozen')).toBe('unchanged');
  });

  it('a real transition between known labels notifies', () => {
    expect(diffPoolStatus('Active', 'Frozen')).toBe('changed');
    expect(diffPoolStatus('Active', 'On-Ice')).toBe('changed');
    expect(diffPoolStatus('On-Ice', 'Active')).toBe('changed');
  });

  it('transitions involving Unknown are recorded but never notified (RPC noise)', () => {
    expect(diffPoolStatus('Active', 'Unknown')).toBe('suppressed');
    expect(diffPoolStatus('Unknown', 'Active')).toBe('suppressed');
  });

  it('degradation copy carries the transition and the A5b action consequences', () => {
    const { kind, title, body } = buildPoolStatusCopy({
      poolLabel: 'Blend YieldBlox',
      from: 'Active',
      to: 'Frozen',
    });
    expect(kind).toBe('alert_fired');
    expect(title).toBe('Pool status: Blend YieldBlox is now Frozen');
    expect(body).toBe(
      'Blend YieldBlox pool status changed: Active → Frozen. Supplies and borrowing are disabled; withdrawals remain available.',
    );
  });

  it('On-Ice copy states borrowing blocked but supplies still open', () => {
    const { kind, body } = buildPoolStatusCopy({
      poolLabel: 'Blend Orbit',
      from: 'Active',
      to: 'On-Ice',
    });
    expect(kind).toBe('alert_fired');
    expect(body).toBe(
      'Blend Orbit pool status changed: Active → On-Ice. Borrowing is disabled; supplies and withdrawals remain available.',
    );
  });

  it('a return to Active reads as a resolve', () => {
    const { kind, title, body } = buildPoolStatusCopy({
      poolLabel: 'Blend Orbit',
      from: 'Frozen',
      to: 'Active',
    });
    expect(kind).toBe('alert_resolved');
    expect(title).toBe('Pool status: Blend Orbit is Active again');
    expect(body).toBe(
      'Blend Orbit pool status changed: Frozen → Active. All actions are available again.',
    );
  });
});
