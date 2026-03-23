import { saveJson, nowIso } from "./00-common";
import { Networks } from "@stellar/stellar-sdk";
import { PoolV2 } from "@blend-capital/blend-sdk";

async function main() {
  const poolId =
    process.env.POOL_ID ??
    "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD";

  const userId =
    process.env.USER_ADDRESS ??
    "GDCRZPZYBZ24RHRO3WBPJGFDL7NDFKUQBS3ZDB6YGBJB3TGKMFYBQ3LD";

  const rpc =
    process.env.STELLAR_RPC_URL ??
    "https://mainnet.sorobanrpc.com";

  const network = {
    passphrase: Networks.PUBLIC,
    rpc,
  };

  const pool = await PoolV2.load(network, poolId);
  const user = await pool.loadUser(userId);

  const output = {
    generatedAt: nowIso(),
    poolId,
    userId,
    user,
  };

  console.dir(
    {
      poolId,
      userId,
      userKeys: user ? Object.keys(user) : [],
      user,
    },
    { depth: 8 }
  );

  await saveJson("35-blend-sdk-user-load.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});