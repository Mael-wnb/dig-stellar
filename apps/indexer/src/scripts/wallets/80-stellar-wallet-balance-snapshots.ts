import 'dotenv/config';
import { createPgClient } from '../shared/db';
import { fetchJson, getEnv, nowIso } from '../discovery/00-common';

type HorizonBalance = {
  balance: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
};

type HorizonAccountResponse = {
  id: string;
  account_id: string;
  balances: HorizonBalance[];
};

type UserWalletRow = {
  id: string;
  user_id: string;
  chain: string;
  address: string;
  label: string | null;
  is_primary: boolean;
  is_active: boolean;
};

type AssetRow = {
  id: string;
  chain: string;
  contract_address: string | null;
  symbol: string | null;
  name: string | null;
};

type AssetPriceRow = {
  asset_id: string;
  price_usd: string;
};

function normalizeHorizonAssetContract(balance: HorizonBalance): string | null {
  if (balance.asset_type === 'native') {
    return 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
  }

  if (
    (balance.asset_type === 'credit_alphanum4' || balance.asset_type === 'credit_alphanum12') &&
    balance.asset_code &&
    balance.asset_issuer
  ) {
    return `${balance.asset_code}:${balance.asset_issuer}`;
  }

  return null;
}

function normalizeHorizonAssetSymbol(balance: HorizonBalance): string | null {
  if (balance.asset_type === 'native') return 'native';
  if (balance.asset_code) return balance.asset_code;
  return null;
}

function parseBalanceScaled(value: string | undefined | null): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function scaledToRawString(balanceScaled: number, decimals: number): string {
  if (!Number.isFinite(balanceScaled)) return '0';
  const factor = 10 ** decimals;
  return Math.round(balanceScaled * factor).toString();
}

async function main() {
  const horizonUrl = getEnv('HORIZON_URL');
  const chain = (process.env.WALLET_CHAIN ?? 'stellar').trim().toLowerCase();
  const snapshotAt = nowIso();

  const client = createPgClient();
  await client.connect();

  try {
    const walletsRes = await client.query<UserWalletRow>(
      `
      select
        id,
        user_id,
        chain,
        address,
        label,
        is_primary,
        is_active
      from user_wallets
      where chain = $1
        and is_active = true
      order by is_primary desc, created_at asc
      `,
      [chain]
    );

    const wallets = walletsRes.rows;

    const assetsRes = await client.query<AssetRow>(
      `
      select
        id,
        chain,
        contract_address,
        symbol,
        name
      from assets
      where chain = 'stellar-mainnet'
      `
    );

    const assetByContract = new Map<string, AssetRow>();
    for (const asset of assetsRes.rows) {
      if (asset.contract_address) {
        assetByContract.set(asset.contract_address, asset);
      }
    }

    const pricesRes = await client.query<AssetPriceRow>(
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
      const price = Number(row.price_usd);
      if (Number.isFinite(price)) {
        priceByAssetId.set(row.asset_id, price);
      }
    }

    let processedWallets = 0;
    let insertedRows = 0;

    for (const wallet of wallets) {
      const url = `${horizonUrl.replace(/\/$/, '')}/accounts/${wallet.address}`;
      let account: HorizonAccountResponse | null = null;

      try {
        account = await fetchJson<HorizonAccountResponse>(url, {
          headers: { accept: 'application/json' },
        });
      } catch (error) {
        console.error(`[wallet-balance-snapshots] failed for ${wallet.address}`);
        console.error(error);
        continue;
      }

      const balances = Array.isArray(account.balances) ? account.balances : [];

      for (const balance of balances) {
        const assetContractId = normalizeHorizonAssetContract(balance);
        const assetSymbol = normalizeHorizonAssetSymbol(balance);
        const asset = assetContractId ? assetByContract.get(assetContractId) ?? null : null;

        const decimals =
          balance.asset_type === 'native'
            ? 7
            : assetSymbol === 'SolvBTC' || assetSymbol === 'xSolvBTC'
              ? 8
              : 7;

        const balanceScaled = parseBalanceScaled(balance.balance);
        const balanceRaw = scaledToRawString(balanceScaled, decimals);

        const assetId = asset?.id ?? null;
        const priceUsd = assetId ? priceByAssetId.get(assetId) ?? null : null;
        const balanceUsd =
          priceUsd !== null && Number.isFinite(balanceScaled)
            ? balanceScaled * priceUsd
            : null;

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
            $5::numeric,
            $6::numeric,
            $7::numeric,
            $8::numeric,
            $9::timestamptz,
            $10::jsonb
          )
          on conflict (
            user_wallet_id,
            coalesce(asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
            coalesce(asset_contract_id, ''),
            snapshot_at
          )
          do nothing
          `,
          [
            wallet.id,
            assetId,
            assetContractId,
            assetSymbol,
            balanceRaw,
            balanceScaled,
            priceUsd,
            balanceUsd,
            snapshotAt,
            JSON.stringify({
              source: '80-stellar-wallet-balance-snapshots',
              address: wallet.address,
              horizonAssetType: balance.asset_type,
              horizonAssetCode: balance.asset_code ?? null,
              horizonAssetIssuer: balance.asset_issuer ?? null,
            }),
          ]
        );

        insertedRows += 1;
      }

      processedWallets += 1;
    }

    console.log({
      completedAt: snapshotAt,
      chain,
      processedWallets,
      insertedRows,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});