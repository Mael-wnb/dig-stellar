// apps/indexer/src/scripts/ingest/63-price-soroswap-derived.ts
// E2 (Lot E): install RPC latency/error capture BEFORE any HTTP-touching import.
import '../../lib/ops-capture';

import { nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { safeDivide } from '../shared/pricing';
import { priceMaxAgeMinutes } from '../shared/prices';
import { PRICING_RULES_BY_SYMBOL } from '../shared/pricing-config';
import { judgeCandidate, pairCandidate } from '../shared/xlm-price';

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getTargetEntitySlug(): string {
  return process.env.ENTITY_SLUG?.trim() || 'soroswap-native-usdc-pair';
}

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    const observedAt = nowIso();
    const entitySlug = getTargetEntitySlug();

    const pairRes = await client.query(
      `
      select
        e.id as entity_id,
        e.slug as entity_slug
      from entities e
      where e.slug = $1
      limit 1
      `,
      [entitySlug]
    );

    if (!(pairRes.rowCount ?? 0)) {
      throw new Error(`Missing entity: ${entitySlug}`);
    }

    const snapshotRes = await client.query(
      `
      select distinct on (rs.asset_id)
        rs.asset_id,
        rs.symbol,
        rs.d_supply_scaled,
        rs.snapshot_at
      from reserve_snapshots rs
      join entities e on e.id = rs.entity_id
      where e.slug = $1
      order by rs.asset_id, rs.snapshot_at desc, rs.created_at desc
      `,
      [entitySlug]
    );

    if ((snapshotRes.rowCount ?? 0) < 2) {
      // First cycle after seeding a new pair: the derived-price step runs
      // BEFORE the soroswap reserve writer, so a just-seeded pair has no
      // snapshots yet. Skip instead of failing — the pair prices on the next
      // cycle once run-soroswap-pair-refresh has written its first reserves.
      console.log({
        completedAt: nowIso(),
        entitySlug,
        inserted: 0,
        skipped: `no reserve snapshots yet (${snapshotRes.rowCount ?? 0}/2) — expected on the first cycle after seeding`,
      });
      return;
    }

    const reserves = snapshotRes.rows as Array<{
      asset_id: string;
      symbol: string | null;
      d_supply_scaled: string | null;
      snapshot_at: Date;
    }>;

    // Only FRESH rows count as "already priced" (price-sources v2): a stale row must
    // not block the derivation any more. Same threshold as the venue freshness rule.
    const maxAgeMinutes = priceMaxAgeMinutes();
    const latestPricesRes = await client.query(
      `
      select distinct on (ap.asset_id)
        ap.asset_id,
        ap.price_usd,
        ap.source,
        ap.observed_at
      from asset_prices ap
      where ap.observed_at > now() - ($1::text || ' minutes')::interval
      order by ap.asset_id, ap.observed_at desc
      `,
      [String(maxAgeMinutes)]
    );

    const latestPriceByAsset = new Map<string, number>();
    for (const row of latestPricesRes.rows as Array<{ asset_id: string; price_usd: string | number }>) {
      latestPriceByAsset.set(row.asset_id, Number(row.price_usd));
    }

    const r0 = reserves[0];
    const r1 = reserves[1];

    const reserve0 = toNumber(r0.d_supply_scaled);
    const reserve1 = toNumber(r1.d_supply_scaled);

    const price0 = latestPriceByAsset.get(r0.asset_id) ?? null;
    const price1 = latestPriceByAsset.get(r1.asset_id) ?? null;

    let inserted = 0;
    const now = new Date(observedAt);

    // Exactly one leg priced (fresh) → derive the other, under the step-1 guards
    // (freshness of the reserves, quote side ≥ 50k USD, no third hop). Never for an
    // asset with a pricing-config rule: step 1 owns it, including its rejection.
    const derive = async (
      target: typeof r0,
      targetReserve: number,
      quote: typeof r0,
      quoteReserve: number,
      quotePriceUsd: number
    ) => {
      const targetSymbol = (target.symbol ?? '').trim();
      if (!targetSymbol) return;
      if (PRICING_RULES_BY_SYMBOL[targetSymbol] ?? PRICING_RULES_BY_SYMBOL[targetSymbol.toUpperCase()]) {
        console.log(`${targetSymbol}: has a pricing rule — step 1 owns it, not derived here`);
        return;
      }
      const candidate = pairCandidate({
        pool: entitySlug,
        targetSymbol,
        targetReserve,
        quoteSymbol: (quote.symbol ?? '').trim(),
        quoteReserve,
        quotePriceUsd,
        observedAt: new Date(target.snapshot_at),
      });
      if (!candidate) {
        console.log(`${targetSymbol}: quote ${quote.symbol} is neither USDC nor XLM — not derived (third hop)`);
        return;
      }
      const verdict = judgeCandidate(candidate, now, null);
      if (verdict.priceUsd === null) {
        console.log(`${targetSymbol}: rejected — ${verdict.rejected}`);
        return;
      }
      await client.query(
        `
        insert into asset_prices (asset_id, price_usd, source, observed_at, metadata)
        values ($1, $2, $3, $4, $5::jsonb)
        on conflict (asset_id, source, observed_at) do nothing
        `,
        [
          target.asset_id,
          verdict.priceUsd,
          candidate.source,
          observedAt,
          JSON.stringify({
            confidence: 'medium',
            method: candidate.hops === 1 ? 'pool_implied_vs_usdc' : 'pool_implied_vs_xlm',
            pool: entitySlug,
            quoteKind: candidate.quoteKind,
            hops: candidate.hops,
            assetReserve: candidate.assetReserve,
            quoteReserveUsd: candidate.quoteReserveUsd,
            reservesObservedAt: candidate.observedAt.toISOString(),
            derivedFrom: quote.symbol,
          }),
        ]
      );
      inserted += 1;
      console.log(`price source: ${targetSymbol} onchain (${candidate.source}) => ${verdict.priceUsd} (derived from ${quote.symbol} via ${entitySlug})`);
    };

    if (reserve0 !== null && reserve1 !== null && price0 !== null && price1 === null) {
      await derive(r1, reserve1, r0, reserve0, price0);
    }
    if (reserve0 !== null && reserve1 !== null && price1 !== null && price0 === null) {
      await derive(r0, reserve0, r1, reserve1, price1);
    }

    console.log({
      completedAt: observedAt,
      entitySlug,
      inserted,
      reserve0: { symbol: r0.symbol, amount: reserve0, price: price0 },
      reserve1: { symbol: r1.symbol, amount: reserve1, price: price1 },
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});