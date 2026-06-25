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
// Scope: Blend only. No Soroswap/Aquarius LP positions (post-beta). No alerting
// (that's D2). This script just produces the data.

import 'dotenv/config';
import { createPgClient } from '../shared/db';
import { nowIso } from '../discovery/00-common';
import { fetchBlendUserPositions } from '../../lib/protocols/blend/fetch-user-positions';
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

function toRawAmount(scaled: number, decimals: number): string | null {
  if (!Number.isFinite(scaled) || !Number.isFinite(decimals)) return null;
  // BigInt-safe enough for our magnitudes; positions are small relative to 2^53.
  return BigInt(Math.round(scaled * 10 ** decimals)).toString();
}

async function main() {
  const targetWalletId = getTargetWalletId();
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
    let processedWallets = 0;
    let positionRows = 0;
    let healthRows = 0;

    for (const wallet of walletsRes.rows) {
      processedWallets += 1;

      for (const pool of poolsRes.rows) {
        try {
          const positions = await fetchBlendUserPositions({
            poolId: pool.contract_address,
            userAddress: wallet.address,
          });

          // No position in this pool → write nothing for this pool.
          if (!positions.hasPosition) continue;

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
          healthRows += 1;
        } catch (error) {
          // One pool/RPC hiccup must not abort the whole run.
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
      positionRows,
      healthRows,
      snapshotAt,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
