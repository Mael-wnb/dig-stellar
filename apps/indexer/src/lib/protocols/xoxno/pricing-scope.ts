// apps/indexer/src/lib/protocols/xoxno/pricing-scope.ts
//
// Which XOXNO market assets may take the scoped aggregator price fallback —
// the ONE predicate shared by the fetch (decides which keys are sent to
// controller.get_market_indexes_detailed at all) and the persist (decides
// which rows may be written as source 'xoxno-aggregator').
//
// Eligible: the asset has NO rule in shared/pricing-config.ts, or carries the
// explicit `{ kind: 'external', source: 'xoxno-aggregator' }` marker. An asset
// with an own rule (coingecko / oracle / pool / derived / manual) is never read
// from the aggregator, so own-priced markets cost zero aggregator calls
// (production requirement, Lot XO 2026-10-30).
import { PRICING_RULES_BY_SYMBOL, type PricingRule } from '../../../scripts/shared/pricing-config';
import { XOXNO_AGGREGATOR_PRICE_SOURCE } from './types';

export function pricingRuleForSymbol(symbol: string): PricingRule | undefined {
  const key = symbol.trim();
  return PRICING_RULES_BY_SYMBOL[key] ?? PRICING_RULES_BY_SYMBOL[key.toUpperCase()];
}

export function isAggregatorFallbackEligible(symbol: string): boolean {
  const rule = pricingRuleForSymbol(symbol);
  return !rule || (rule.kind === 'external' && rule.source === XOXNO_AGGREGATOR_PRICE_SOURCE);
}
