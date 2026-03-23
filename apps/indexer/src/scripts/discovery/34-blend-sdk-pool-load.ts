import { saveJson, nowIso } from "./00-common";
import { Networks } from "@stellar/stellar-sdk";
import { PoolMetadata, PoolV2 } from "@blend-capital/blend-sdk";

async function main() {
  const poolId =
    process.env.POOL_ID ??
    "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD";

  const rpc =
    process.env.STELLAR_RPC_URL ??
    "https://mainnet.sorobanrpc.com";

  const network = {
    passphrase: Networks.PUBLIC,
    rpc,
  };

  const poolMetadata = await PoolMetadata.load(network, poolId);
  const pool = await PoolV2.load(network, poolId);

  const reserves =
    pool?.reserves instanceof Map
      ? Array.from(pool.reserves.entries()).map(([assetId, reserve]) => ({
          assetId,
          reserve,
        }))
      : [];

  const output = {
    generatedAt: nowIso(),
    poolId,
    poolMetadata,
    reserveCount: reserves.length,
    reserves,
  };

  console.dir(
    {
      poolId,
      metadataKeys: poolMetadata ? Object.keys(poolMetadata) : [],
      reserveCount: reserves.length,
      firstReserve: reserves[0] ?? null,
    },
    { depth: 8 }
  );

  await saveJson("34-blend-sdk-pool-load.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});