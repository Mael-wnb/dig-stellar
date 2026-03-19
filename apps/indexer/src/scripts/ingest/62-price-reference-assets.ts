import { nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { inferStablePrice } from '../shared/pricing';

async function fetchJson(url: string, headers?: Record<string, string>) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${url}`);
  }
  return res.json();
}

async function fetchNativeUsdPrice(): Promise<number> {
  const apiKey = process.env.COINGECKO_API_KEY;
  const headers: Record<string, string> = {};

  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey;
  }

  const data = await fetchJson(
    'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
    headers
  );

  const price = data?.stellar?.usd;
  if (typeof price !== 'number') {
    throw new Error('Could not fetch XLM/USD price');
  }

  return price;
}

function inferManualPrice(symbol: string): { priceUsd: number | null; source: string; metadata: Record<string, unknown> } {
  const s = symbol.toUpperCase();

  const stable = inferStablePrice(s);
  if (stable !== null) {
    return {
      priceUsd: stable,
      source: 'manual_stable',
      metadata: {
        confidence: 'high',
        method: 'hardcoded_stable_assumption',
      },
    };
  }

  if (s === 'EURC') {
    return {
      priceUsd: 1.08,
      source: 'manual_eurc_fallback',
      metadata: {
        confidence: 'medium',
        method: 'temporary_manual_eurc_usd',
        note: 'Replace later with FX-backed EUR/USD source',
      },
    };
  }

  return {
    priceUsd: null,
    source: 'unknown',
    metadata: {},
  };
}

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    const observedAt = nowIso();

    const assetsRes = await client.query(
      `
      select id, contract_address, symbol, name
      from assets
      where chain = 'stellar-mainnet'
      order by symbol asc nulls last
      `
    );

    const nativeUsd = await fetchNativeUsdPrice();

    let inserted = 0;

    for (const asset of assetsRes.rows as Array<{
      id: string;
      contract_address: string;
      symbol: string | null;
      name: string | null;
    }>) {
      const symbol = asset.symbol ?? '';
      let priceUsd: number | null = null;
      let source = 'manual';
      let metadata: Record<string, unknown> = {};

      if (symbol.toLowerCase() === 'native') {
        priceUsd = nativeUsd;
        source = 'coingecko_xlm_usd';
        metadata = {
          confidence: 'high',
          method: 'direct_native_price',
        };
      } else {
        const manual = inferManualPrice(symbol);
        priceUsd = manual.priceUsd;
        source = manual.source;
        metadata = manual.metadata;
      }

      if (priceUsd === null) continue;

      await client.query(
        `
        insert into asset_prices (asset_id, price_usd, source, observed_at, metadata)
        values ($1, $2, $3, $4, $5::jsonb)
        on conflict (asset_id, source, observed_at) do nothing
        `,
        [asset.id, priceUsd, source, observedAt, JSON.stringify(metadata)]
      );

      inserted += 1;
      console.log(symbol || asset.contract_address, '=>', priceUsd, source);
    }

    console.log({
      completedAt: observedAt,
      inserted,
      nativeUsd,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});