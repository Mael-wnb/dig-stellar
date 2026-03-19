import type { Client } from 'pg';

export async function getLatestAssetPricesMap(client: Client): Promise<Map<string, number>> {
  const res = await client.query(
    `
    select distinct on (ap.asset_id)
      ap.asset_id,
      ap.price_usd
    from asset_prices ap
    order by ap.asset_id, ap.observed_at desc
    `
  );

  return new Map<string, number>(
    res.rows.map((row: { asset_id: string; price_usd: string }) => [
      row.asset_id,
      Number(row.price_usd),
    ])
  );
}