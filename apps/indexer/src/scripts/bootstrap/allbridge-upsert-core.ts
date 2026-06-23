// apps/indexer/src/scripts/bootstrap/allbridge-upsert-core.ts
//
// One-shot bootstrap for the Allbridge bridge-flow adapter (T2-D3). Run once
// before the first refresh (locally now; on the VPS at deploy time, after
// applying stellar_v1_bridge.sql). Idempotent.
//
//   pnpm -C apps/indexer tsx src/scripts/bootstrap/allbridge-upsert-core.ts
import { nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import {
  ALLBRIDGE_BRIDGE_CONTRACT_ID,
  ALLBRIDGE_CHAIN,
  ALLBRIDGE_USDC_CLASSIC_ISSUER,
  ALLBRIDGE_USDC_CONTRACT_ID,
  ALLBRIDGE_USDC_DECIMALS,
  ALLBRIDGE_USDC_SYMBOL,
  ALLBRIDGE_VENUE_NAME,
  ALLBRIDGE_VENUE_SLUG,
} from '../../lib/protocols/allbridge/constants';

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    await client.query('begin');

    const venueRes = await client.query(
      `
      insert into venues (slug, name, chain, venue_type, metadata)
      values ($1, $2, $3, $4, $5::jsonb)
      on conflict (slug)
      do update set
        name = excluded.name,
        chain = excluded.chain,
        venue_type = excluded.venue_type,
        metadata = excluded.metadata,
        updated_at = now()
      returning id
      `,
      [
        ALLBRIDGE_VENUE_SLUG,
        ALLBRIDGE_VENUE_NAME,
        ALLBRIDGE_CHAIN,
        'bridge',
        JSON.stringify({
          source: 'allbridge-upsert-core',
          bridgeContract: ALLBRIDGE_BRIDGE_CONTRACT_ID,
        }),
      ]
    );

    const venueId = venueRes.rows[0].id as string;

    // USDC very likely already exists from other adapters — upsert idempotently
    // on contract_address, don't duplicate.
    const assetRes = await client.query(
      `
      insert into assets (chain, contract_address, asset_type, symbol, name, decimals, metadata)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      on conflict (contract_address)
      do update set
        chain = excluded.chain,
        asset_type = excluded.asset_type,
        symbol = excluded.symbol,
        decimals = excluded.decimals,
        updated_at = now()
      returning id
      `,
      [
        ALLBRIDGE_CHAIN,
        ALLBRIDGE_USDC_CONTRACT_ID,
        'soroban_token',
        ALLBRIDGE_USDC_SYMBOL,
        'USD Coin',
        ALLBRIDGE_USDC_DECIMALS,
        JSON.stringify({
          source: 'allbridge-upsert-core',
          classicIssuer: ALLBRIDGE_USDC_CLASSIC_ISSUER,
        }),
      ]
    );

    const assetId = assetRes.rows[0].id as string;

    await client.query('commit');

    console.log({
      completedAt: nowIso(),
      venueId,
      venueSlug: ALLBRIDGE_VENUE_SLUG,
      assetId,
      usdcContract: ALLBRIDGE_USDC_CONTRACT_ID,
    });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
