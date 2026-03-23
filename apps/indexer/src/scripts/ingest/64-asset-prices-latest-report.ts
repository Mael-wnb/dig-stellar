import { createPgClient } from '../shared/db';

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    const res = await client.query(
      `
      select distinct on (a.id)
        a.symbol,
        a.name,
        a.contract_address,
        ap.price_usd,
        ap.source,
        ap.observed_at
      from assets a
      left join asset_prices ap on ap.asset_id = a.id
      where a.chain = 'stellar-mainnet'
      order by a.id, ap.observed_at desc nulls last
      `
    );

    console.table(res.rows);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});