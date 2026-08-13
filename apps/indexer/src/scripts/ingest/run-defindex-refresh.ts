// apps/indexer/src/scripts/ingest/run-defindex-refresh.ts
//
// Refresh one DeFindex vault into the v1 product pipeline. Per-vault, driven by
// env (ENTITY_SLUG + DEFINDEX_VAULT_ADDRESS), mirroring run-blend-pool-refresh /
// run-aquarius-pool-refresh. Called once per active `defindex` entity by
// 71-refresh-all-metrics.ts. NOT the legacy src/run-defindex.ts (Prisma).
// E2 (Lot E): install RPC latency/error capture BEFORE any HTTP-touching import.
import '../../lib/ops-capture';

import 'dotenv/config';

import { DefindexSDK } from '@defindex/sdk';
import { createPgClient } from '../shared/db';
import { fetchDefindexVault } from '../../lib/protocols/defindex/fetch-vault';
import { persistDefindexVaultMetrics } from '../../lib/protocols/defindex/persist-vault-metrics';

async function main() {
  const vaultAddress = process.env.DEFINDEX_VAULT_ADDRESS?.trim();
  const entitySlug = process.env.ENTITY_SLUG?.trim();

  if (!vaultAddress) {
    throw new Error('Missing DEFINDEX_VAULT_ADDRESS');
  }

  if (!entitySlug) {
    throw new Error('Missing ENTITY_SLUG');
  }

  const apiKey = process.env.DEFINDEX_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing DEFINDEX_API_KEY');
  }

  const baseUrl = process.env.DEFINDEX_API_URL?.trim() || 'https://api.defindex.io';

  console.log('=== DeFindex vault refresh ===');
  console.log({ vaultAddress, entitySlug });

  const sdk = new DefindexSDK({ apiKey, baseUrl, timeout: 30000 });

  const fetched = await fetchDefindexVault({ sdk, vaultAddress });

  const client = createPgClient();
  await client.connect();

  try {
    const persisted = await persistDefindexVaultMetrics({
      client,
      entitySlug,
      expectedVaultAddress: vaultAddress,
      fetched,
    });

    console.log(persisted);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
