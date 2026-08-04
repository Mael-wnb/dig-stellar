// apps/indexer/src/lib/protocols/defindex/fetch-vault.ts
import { DefindexSDK, SupportedNetworks } from '@defindex/sdk';
import type { DefindexVaultFetch, DefindexVaultHolding } from './types';

// Read a single mainnet vault via the DeFindex SDK:
//   getVaultInfo  -> totalManagedFunds (underlying asset + amount) + name/symbol
//   getVaultAPY   -> 7-day APY (percent)
// The SDK is a thin HTTP client over api.defindex.io (Bearer auth via apiKey).
export async function fetchDefindexVault(params: {
  sdk: DefindexSDK;
  vaultAddress: string;
}): Promise<DefindexVaultFetch> {
  const { sdk, vaultAddress } = params;

  const info = (await sdk.getVaultInfo(
    vaultAddress,
    SupportedNetworks.MAINNET
  )) as {
    name?: string | null;
    symbol?: string | null;
    totalManagedFunds?: Array<{
      asset?: string;
      total_amount?: string | number | null;
      idle_amount?: string | number | null;
      invested_amount?: string | number | null;
    }> | null;
  };

  const apyResp = (await sdk.getVaultAPY(
    vaultAddress,
    SupportedNetworks.MAINNET
  )) as { apy?: number | null };

  const holdings: DefindexVaultHolding[] = [];

  for (const fund of info.totalManagedFunds ?? []) {
    if (!fund?.asset) continue;

    // Prefer total_amount; fall back to idle + invested if the field is absent.
    const total =
      fund.total_amount !== undefined && fund.total_amount !== null
        ? String(fund.total_amount)
        : String(
            BigInt(String(fund.idle_amount ?? '0')) +
              BigInt(String(fund.invested_amount ?? '0'))
          );

    holdings.push({
      assetContract: fund.asset,
      rawAmount: total,
    });
  }

  const apyPct =
    typeof apyResp?.apy === 'number' && Number.isFinite(apyResp.apy)
      ? apyResp.apy
      : null;

  return {
    vaultAddress,
    name: info.name ?? null,
    symbol: info.symbol ?? null,
    apyPct,
    holdings,
  };
}
