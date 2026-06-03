import "dotenv/config";

import { createPgClient } from "../shared/db";

import { fetchHorizonPools } from "../../lib/protocols/stellar-native/fetch-pools";

import { persistHorizonPools } from "../../lib/protocols/stellar-native/persist-pools";

import { persistHorizonPoolSnapshots } from "../../lib/protocols/stellar-native/persist-pool-snapshots";

import { persistStellarNativePoolMetrics }
from "../../lib/protocols/stellar-native/persist-pool-metrics";

async function main() {
  const client = createPgClient();

  await client.connect();

  try {
    const result =
      await fetchHorizonPools(50);

    console.log(
      `Found ${result.count} Horizon pools`
    );

    const entities =
      await persistHorizonPools(
        client,
        result.pools
      );

    const snapshots =
      await persistHorizonPoolSnapshots(
        client,
        result.pools
      );

    const metrics =
      await persistStellarNativePoolMetrics(
        client
      );
  
    console.log({
      entities,
      snapshots,
      metrics,
    });
  } finally {
    await client.end();
  }
}

main().catch(console.error);