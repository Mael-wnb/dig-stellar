// apps/indexer/src/scripts/wallets/81-stellar-wallet-blend-positions.ts
//
// Resolve every tracked wallet's BLEND positions (signer AND watch-only —
// positions are public on-chain) and persist:
//   - per-asset supply/borrow rows  -> wallet_protocol_positions
//   - one per-(wallet,pool) health row -> wallet_pool_health (health factor)
//
// Mirrors 80-stellar-wallet-balance-snapshots.ts for wallet selection and the
// 71-refresh pipeline for Blend-pool discovery. Blend-specific logic stays in
// the adapter (lib/protocols/blend/fetch-user-positions + resolve-user-health).
//
// Lot RP (RP1) — RPC budget. The sweep used to load the pool AND its oracle
// again for every wallet × pool (12 RPC calls each, 9 of them `lastprice`
// simulations), i.e. 12 × wallets × pools calls per run. It now loads each pool
// + oracle ONCE per run and reads the wallets' `Positions` ledger entries in
// batches (one getLedgerEntries call per POSITIONS_BATCH_SIZE wallets), so a run
// costs (pools × one pool/oracle load) + ceil(wallets / batch) × pools calls. The
// rows written are the same (same builder, same SDK estimate, same SQL); the
// only semantic change is that every wallet of a pool is now valued against ONE
// pool/oracle view instead of a view re-read seconds apart per wallet.
//
// Failure contract: a pool whose load fails is skipped for the run (its wallets
// keep their previous rows; the other pools are still persisted) and the run
// EXITS 1, so 82 does not evaluate alerts on partial data. Before RP1 a failing
// (wallet, pool) read was skipped silently and the run exited 0; with one load
// serving every wallet the blast radius is a whole pool, hence the abort.
//
// Observability: `lib/ops-capture` is the FIRST import so every RPC call is
// sampled (target + method) and flushed to OPS_METRICS_FILE when the parent
// (82-run-wallet-alert-job.ts) sets it; 82 persists the summary as
// rpc_metrics_runs rows with job = 'wallet-alert'.
//
// Scope: Blend only. No Soroswap/Aquarius LP positions (post-beta). No alerting
// (that's D2). This script just produces the data.

import '../../lib/ops-capture';
import 'dotenv/config';
import type { Client as PgClient } from 'pg';
import { createPgClient } from '../shared/db';
import { nowIso } from '../discovery/00-common';
import {
  POSITIONS_BATCH_SIZE,
  fetchBlendUsersPositionsBatch,
  loadBlendPoolContext,
  type BlendUserPositions,
} from '../../lib/protocols/blend/fetch-user-positions';
import { resolveBlendUserHealth } from '../../lib/protocols/blend/resolve-user-health';

type ActiveWalletRow = {
  id: string;
  address: string;
};

type BlendPoolRow = {
  entity_id: string;
  slug: string;
  contract_address: string;
};

type AssetRow = {
  id: string;
  contract_address: string | null;
  symbol: string | null;
};

function getTargetWalletId(): string | null {
  const value =
    process.env.WALLET_ID?.trim() ?? process.env.USER_WALLET_ID?.trim() ?? null;
  return value && value.length ? value : null;
}

/** Wallets per getLedgerEntries request (RP1). Env override for experiments only. */
function getPositionsBatchSize(): number {
  const raw = Number(process.env.BLEND_POSITIONS_BATCH_SIZE ?? POSITIONS_BATCH_SIZE);
  return Number.isFinite(raw) && raw >= 1 ? Math.min(200, Math.floor(raw)) : POSITIONS_BATCH_SIZE;
}

function toRawAmount(scaled: number, decimals: number): string | null {
  if (!Number.isFinite(scaled) || !Number.isFinite(decimals)) return null;
  // BigInt-safe enough for our magnitudes; positions are small relative to 2^53.
  return BigInt(Math.round(scaled * 10 ** decimals)).toString();
}

/**
 * Persist one wallet's positions in one pool: per-asset supply/borrow rows plus
 * the pool-level health row. Unchanged SQL and metadata from the per-wallet
 * version — only the call site moved. Returns the row counts written.
 */
async function persistWalletPoolPositions(params: {
  client: PgClient;
  wallet: ActiveWalletRow;
  pool: BlendPoolRow;
  blendVenueId: string | null;
  positions: BlendUserPositions;
  assetByContract: Map<string, AssetRow>;
  snapshotAt: string;
}): Promise<{ positionRows: number; healthRows: number }> {
  const { client, wallet, pool, blendVenueId, positions, assetByContract, snapshotAt } = params;
  let positionRows = 0;

  const health = resolveBlendUserHealth(positions);

  // --- per-asset supply/borrow rows ---
  for (const r of positions.reserves) {
    const asset = assetByContract.get(r.assetId) ?? null;

    const suppliedScaled = r.collateral + r.supply;
    const suppliedUsd =
      r.collateralUsd !== null || r.supplyUsd !== null
        ? (r.collateralUsd ?? 0) + (r.supplyUsd ?? 0)
        : null;

    if (suppliedScaled > 0) {
      await client.query(
        `insert into wallet_protocol_positions (
           user_wallet_id, venue_id, entity_id, position_type,
           asset_id, asset_contract_id, asset_symbol,
           amount_raw, amount_scaled, amount_usd, snapshot_at, metadata
         ) values (
           $1::uuid, $2::uuid, $3::uuid, 'supply',
           $4::uuid, $5, $6,
           $7, $8, $9, $10::timestamptz, $11::jsonb
         )`,
        [
          wallet.id,
          blendVenueId,
          pool.entity_id,
          asset?.id ?? null,
          r.assetId,
          asset?.symbol ?? null,
          toRawAmount(suppliedScaled, r.decimals),
          suppliedScaled,
          suppliedUsd,
          snapshotAt,
          JSON.stringify({
            source: 'blend-sdk',
            poolId: pool.contract_address,
            poolSlug: pool.slug,
            collateralEnabled: r.collateral > 0,
            collateral: r.collateral,
            supply: r.supply,
            priceUsd: r.priceUsd,
          }),
        ]
      );
      positionRows += 1;
    }

    if (r.liabilities > 0) {
      await client.query(
        `insert into wallet_protocol_positions (
           user_wallet_id, venue_id, entity_id, position_type,
           asset_id, asset_contract_id, asset_symbol,
           amount_raw, amount_scaled, amount_usd, snapshot_at, metadata
         ) values (
           $1::uuid, $2::uuid, $3::uuid, 'borrow',
           $4::uuid, $5, $6,
           $7, $8, $9, $10::timestamptz, $11::jsonb
         )`,
        [
          wallet.id,
          blendVenueId,
          pool.entity_id,
          asset?.id ?? null,
          r.assetId,
          asset?.symbol ?? null,
          toRawAmount(r.liabilities, r.decimals),
          r.liabilities,
          r.liabilitiesUsd,
          snapshotAt,
          JSON.stringify({
            source: 'blend-sdk',
            poolId: pool.contract_address,
            poolSlug: pool.slug,
            priceUsd: r.priceUsd,
          }),
        ]
      );
      positionRows += 1;
    }
  }

  // --- one pool-level health row ---
  await client.query(
    `insert into wallet_pool_health (
       user_wallet_id, venue_id, entity_id,
       health_factor, total_collateral_usd, total_debt_usd,
       borrow_limit_usd, net_apy, positions_count, snapshot_at, metadata
     ) values (
       $1::uuid, $2::uuid, $3::uuid,
       $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::jsonb
     )`,
    [
      wallet.id,
      blendVenueId,
      pool.entity_id,
      health.healthFactor,
      health.totalCollateralUsd,
      health.totalDebtUsd,
      health.borrowCapUsd,
      health.netApy,
      positions.reserves.length,
      snapshotAt,
      JSON.stringify({
        source: 'blend-sdk',
        poolId: pool.contract_address,
        poolSlug: pool.slug,
        totalSuppliedUsd: health.totalSuppliedUsd,
        totalBorrowedUsd: health.totalBorrowedUsd,
        borrowLimit: health.borrowLimit,
      }),
    ]
  );

  return { positionRows, healthRows: 1 };
}

async function main() {
  const targetWalletId = getTargetWalletId();
  const batchSize = getPositionsBatchSize();
  const client = createPgClient();
  await client.connect();

  try {
    // --- wallet selection (same gate as script 80) ---
    const walletsRes = targetWalletId
      ? await client.query<ActiveWalletRow>(
          `select id, address from user_wallets
           where chain = 'stellar' and is_active = true and id = $1::uuid
           order by created_at asc`,
          [targetWalletId]
        )
      : await client.query<ActiveWalletRow>(
          `select id, address from user_wallets
           where chain = 'stellar' and is_active = true
           order by created_at asc`
        );

    // --- Blend venue + active lending pools (same discovery as 71-refresh) ---
    const venueRes = await client.query<{ id: string }>(
      `select id from venues where slug = 'blend' limit 1`
    );
    const blendVenueId = venueRes.rows[0]?.id ?? null;

    const poolsRes = await client.query<BlendPoolRow>(
      `select e.id as entity_id, e.slug, e.contract_address
       from entities e
       join venues v on v.id = e.venue_id
       where v.slug = 'blend'
         and e.entity_type = 'lending_pool'
         and e.is_active = true
         and e.contract_address is not null
       order by e.slug asc`
    );

    // --- asset map: reserve contract -> DB asset (id + symbol) ---
    const assetsRes = await client.query<AssetRow>(
      `select id, contract_address, symbol from assets where chain = 'stellar-mainnet'`
    );
    const assetByContract = new Map<string, AssetRow>();
    for (const a of assetsRes.rows) {
      if (a.contract_address) assetByContract.set(a.contract_address, a);
    }

    const snapshotAt = nowIso();
    const wallets = walletsRes.rows;
    const processedWallets = wallets.length;
    const addresses = wallets.map((w) => w.address);
    let positionRows = 0;
    let healthRows = 0;
    let rpcBatches = 0;
    let poolsSkipped = 0;

    // Pool-major order (RP1): one pool/oracle load per pool, then every wallet
    // of that pool in batched ledger-entry reads. One pool/RPC hiccup must not
    // abort the other pools — skip the pool for this run, keep its previous rows.
    for (const pool of poolsRes.rows) {
      let positionsByAddress: Map<string, BlendUserPositions>;
      try {
        const context = await loadBlendPoolContext({ poolId: pool.contract_address });
        positionsByAddress = await fetchBlendUsersPositionsBatch({
          context,
          userAddresses: addresses,
          batchSize,
        });
        rpcBatches += Math.ceil(new Set(addresses).size / batchSize);
      } catch (error) {
        poolsSkipped += 1;
        console.error(`[blend-positions] failed for pool ${pool.slug} — skipped this run`);
        console.error(error);
        continue;
      }

      for (const wallet of wallets) {
        const positions = positionsByAddress.get(wallet.address);
        // No position in this pool → write nothing for this pool.
        if (!positions || !positions.hasPosition) continue;

        try {
          const written = await persistWalletPoolPositions({
            client,
            wallet,
            pool,
            blendVenueId,
            positions,
            assetByContract,
            snapshotAt,
          });
          positionRows += written.positionRows;
          healthRows += written.healthRows;
        } catch (error) {
          // One wallet's write must not abort the whole run.
          console.error(
            `[blend-positions] failed for wallet ${wallet.id} pool ${pool.slug}`
          );
          console.error(error);
        }
      }
    }

    console.log({
      completedAt: nowIso(),
      chain: 'stellar',
      targetWalletId,
      processedWallets,
      blendPools: poolsRes.rows.length,
      poolsSkipped,
      positionsBatchSize: batchSize,
      rpcBatches,
      positionRows,
      healthRows,
      snapshotAt,
    });

    // A pool skipped for RPC reasons makes this a PARTIAL run: every wallet of
    // that pool kept its previous health row. Exit non-zero so the 82
    // orchestrator does NOT run the evaluator on partial data (its contract:
    // a non-zero 81 aborts the evaluator). The rows of the pools that did load
    // are persisted and serve the API; alerts resume on the next sweep.
    if (poolsSkipped > 0) {
      console.error(`[blend-positions] ${poolsSkipped} pool(s) skipped this run — partial data, exiting 1 so the evaluator is not run`);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
