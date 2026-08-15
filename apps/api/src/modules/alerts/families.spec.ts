// apps/api/src/modules/alerts/families.spec.ts
//
// Lot N — family dispatch + price copy. The dispatch tests are the N1 safety
// contract: a price rule must NEVER reach the health-factor evaluator and vice
// versa (before the dispatch existed, script 83 matched every enabled rule
// against health rows regardless of metric).

import {
  buildPriceCopy,
  displaySymbol,
  formatAsOf,
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

  it('a metric with no evaluator lands in unknown (skipped, never evaluated)', () => {
    const future = rule('tvl_drop_pct');
    const out = partitionRulesByFamily([future]);
    expect(out.healthFactor).toHaveLength(0);
    expect(out.price).toHaveLength(0);
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
    expect(body).toBe('XLM crossed above $0.1700 — $0.1712 at 14:32 UTC.');
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
    expect(body).toBe('XLM is back below $0.1700 — $0.1690 at 14:47 UTC.');
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
    expect(body).toBe('EURC crossed below $1.10 — $1.08 at 09:00 UTC.');
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
