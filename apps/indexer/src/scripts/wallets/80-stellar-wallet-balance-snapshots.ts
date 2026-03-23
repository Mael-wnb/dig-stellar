// apps/indexer/src/scripts/wallets/80-stellar-wallet-balance-snapshots.ts
import 'dotenv/config';
import { createPgClient } from '../shared/db';
import { fetchJson, nowIso } from '../discovery/00-common';

type ActiveWalletRow = {
  id: string;
  user_id: string;
  address: string;
  chain: string;
  label: string | null;
};

type AssetRow = {
  id: string;
  contract_address: string | null;
  symbol: string | null;
  name: string | null;
  chain: string;
};

type PriceRow = {
  asset_id: string;
  price_usd: string | number | null;
};

type HorizonBalance = {
  balance: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  buying_liabilities?: string;
  selling_liabilities?: string;
};

type HorizonAccountResponse = {
  id: string;
  account_id: string;
  balances?: HorizonBalance[];
};

const STELLAR_NATIVE_CONTRACT =
  'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeSymbol(symbol?: string | null): string | null {
  if (!symbol) return null;
  const value = symbol.trim();
  return value ? value.toUpperCase() : null;
}

function isKnownHorizonNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('HTTP 404');
}

async function main() {
  const horizonUrl = process.env.HORIZON_URL ?? 'https://horizon.stellar.org';
  const client = createPgClient();
  await client.connect();

  try {
    const walletsRes = await client.query<ActiveWalletRow>(
      `
      select
        id,
        user_id,
        address,
        chain,
        label
      from user_wallets
      where chain = 'stellar'
        and is_active = true
      order by created_at asc
      `
    );

    const assetsRes = await client.query<AssetRow>(
      `
      select
        id,
        contract_address,
        symbol,
        name,
        chain
      from assets
      where chain = 'stellar-mainnet'
      `
    );

    const pricesRes = await client.query<PriceRow>(
      `
      select distinct on (asset_id)
        asset_id,
        price_usd
      from asset_prices
      order by asset_id, observed_at desc
      `
    );

    const priceByAssetId = new Map<string, number>();
    for (const row of pricesRes.rows) {
      const price = toNumber(row.price_usd);
      if (price !== null) {
        priceByAssetId.set(row.asset_id, price);
      }
    }

    const nativeAsset =
      assetsRes.rows.find((row) => row.contract_address === STELLAR_NATIVE_CONTRACT) ?? null;

    const symbolToAssets = new Map<string, AssetRow[]>();
    for (const row of assetsRes.rows) {
      const key = normalizeSymbol(row.symbol);
      if (!key) continue;
      if (!symbolToAssets.has(key)) symbolToAssets.set(key, []);
      symbolToAssets.get(key)!.push(row);
    }

    const snapshotAt = new Date();
    let processedWallets = 0;
    let insertedRows = 0;

    for (const wallet of walletsRes.rows) {
      try {
        const account = await fetchJson<HorizonAccountResponse>(
          `${horizonUrl.replace(/\/$/, '')}/accounts/${wallet.address}`
        );

        const balances = Array.isArray(account.balances) ? account.balances : [];

        for (const balance of balances) {
          const balanceScaled = toNumber(balance.balance);
          if (balanceScaled === null || balanceScaled <= 0) {
            continue;
          }

          let matchedAsset: AssetRow | null = null;
          let assetContractId: string | null = null;
          let assetSymbol: string | null = null;

          if (balance.asset_type === 'native') {
            matchedAsset = nativeAsset;
            assetContractId = nativeAsset?.contract_address ?? STELLAR_NATIVE_CONTRACT;
            assetSymbol = nativeAsset?.symbol ?? 'XLM';
          } else {
            const symbol = normalizeSymbol(balance.asset_code);
            assetSymbol = symbol;

            const candidates = symbol ? symbolToAssets.get(symbol) ?? [] : [];
            matchedAsset = candidates[0] ?? null;
            assetContractId = matchedAsset?.contract_address ?? null;
          }

          const priceUsd =
            matchedAsset && priceByAssetId.has(matchedAsset.id)
              ? priceByAssetId.get(matchedAsset.id) ?? null
              : null;

          const balanceUsd = priceUsd !== null ? balanceScaled * priceUsd : null;

          await client.query(
            `
            insert into wallet_balance_snapshots (
              user_wallet_id,
              asset_id,
              asset_contract_id,
              asset_symbol,
              balance_raw,
              balance_scaled,
              price_usd,
              balance_usd,
              snapshot_at,
              metadata
            )
            values (
              $1::uuid,
              $2::uuid,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9::timestamptz,
              $10::jsonb
            )
            on conflict (
              user_wallet_id,
              coalesce(asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
              coalesce(asset_contract_id, ''),
              snapshot_at
            )
            do update set
              asset_symbol = excluded.asset_symbol,
              balance_raw = excluded.balance_raw,
              balance_scaled = excluded.balance_scaled,
              price_usd = excluded.price_usd,
              balance_usd = excluded.balance_usd,
              metadata = excluded.metadata
            `,
            [
              wallet.id,
              matchedAsset?.id ?? null,
              assetContractId,
              assetSymbol,
              Math.round(balanceScaled * 10 ** 7).toString(), // fallback raw approximation
              balanceScaled,
              priceUsd,
              balanceUsd,
              snapshotAt.toISOString(),
              JSON.stringify({
                source: 'horizon',
                address: wallet.address,
                assetType: balance.asset_type,
                assetCode: balance.asset_code ?? null,
                assetIssuer: balance.asset_issuer ?? null,
                buyingLiabilities: balance.buying_liabilities ?? null,
                sellingLiabilities: balance.selling_liabilities ?? null,
              }),
            ]
          );

          insertedRows += 1;
        }

        processedWallets += 1;
      } catch (error) {
        console.error(`[wallet-balance-snapshots] failed for ${wallet.address}`);
        if (isKnownHorizonNotFound(error)) {
          console.error('Wallet not found on Horizon, skipping.');
        } else {
          console.error(error);
        }
      }
    }

    console.log({
      completedAt: nowIso(),
      chain: 'stellar',
      processedWallets,
      insertedRows,
      snapshotAt: snapshotAt.toISOString(),
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});