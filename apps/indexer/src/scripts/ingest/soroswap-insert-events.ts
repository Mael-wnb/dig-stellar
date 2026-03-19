import { Client } from "pg";
import { loadJson, nowIso } from "../discovery/00-common";

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL?.replace("?schema=public", "") ??
    "postgresql://dig:dig@localhost:5432/dig_stellar";

  const eventsFile = await loadJson<any>("58-soroswap-active-pair-events-normalized.json");
  const registry = await loadJson<any>("59-soroswap-final-registry.json");
  if (!eventsFile || !registry) throw new Error("Missing 58 or 59 Soroswap files");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const venueRes = await client.query(`select id from venues where slug = 'soroswap' limit 1`);
    const entityRes = await client.query(
      `select id from entities where slug = 'soroswap-native-usdc-pair' limit 1`
    );

    if (!venueRes.rowCount || !entityRes.rowCount) {
      throw new Error("Missing soroswap venue or soroswap-native-usdc-pair entity");
    }

    const venueId = venueRes.rows[0].id;
    const entityId = entityRes.rows[0].id;

    const assetRes = await client.query(
      `select id, contract_address from assets where chain = 'stellar-mainnet'`
    );
    const assetIdByContract = new Map<string, string>();
    for (const row of assetRes.rows) assetIdByContract.set(row.contract_address, row.id);

    let processed = 0;

    for (const row of eventsFile.rows ?? []) {
      await client.query(
        `
        insert into normalized_events (
          venue_id,
          entity_id,
          contract_address,
          event_id,
          tx_hash,
          ledger,
          occurred_at,
          event_name,
          sub_event_name,
          event_key,
          caller_address,
          token_in_asset_id,
          token_out_asset_id,
          token_amount_in_raw,
          token_amount_out_raw,
          token_amount_in_scaled,
          token_amount_out_scaled,
          in_successful_contract_call,
          metadata
        )
        values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
          $12,$13,$14,$15,$16,$17,$18,$19::jsonb
        )
        on conflict (contract_address, event_id) do nothing
        `,
        [
          venueId,
          entityId,
          row.pairId,
          row.eventId,
          row.txHash,
          row.ledger,
          row.occurredAt,
          row.eventName,
          row.subEventName,
          row.eventKey,
          null,
          row.token0 ? assetIdByContract.get(row.token0) ?? null : null,
          row.token1 ? assetIdByContract.get(row.token1) ?? null : null,
          row.reserve0Raw,
          row.reserve1Raw,
          row.reserve0Scaled,
          row.reserve1Scaled,
          true,
          JSON.stringify({ source: "58-soroswap-active-pair-events-normalized" }),
        ]
      );
      processed += 1;
    }

    console.log({ completedAt: nowIso(), processed });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});