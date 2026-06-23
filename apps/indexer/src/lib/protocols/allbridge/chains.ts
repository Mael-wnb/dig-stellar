// apps/indexer/src/lib/protocols/allbridge/chains.ts
//
// Allbridge internal chain id -> chain. Source: Core API /token-info (.chainId per chain).
export const ALLBRIDGE_CHAIN_ID_MAP: Record<number, { symbol: string; name: string }> = {
  1: { symbol: 'ETH', name: 'Ethereum' },
  2: { symbol: 'BSC', name: 'BNB Chain' },
  3: { symbol: 'TRX', name: 'Tron' },
  4: { symbol: 'SOL', name: 'Solana' },
  5: { symbol: 'POL', name: 'Polygon' },
  6: { symbol: 'ARB', name: 'Arbitrum' },
  7: { symbol: 'SRB', name: 'Stellar (Soroban)' }, // self — should not appear as a counterparty
  8: { symbol: 'AVA', name: 'Avalanche' },
  9: { symbol: 'BAS', name: 'Base' },
  10: { symbol: 'OPT', name: 'Optimism' },
  11: { symbol: 'CEL', name: 'Celo' },
  12: { symbol: 'SNC', name: 'Sonic' },
  13: { symbol: 'SUI', name: 'Sui' },
  14: { symbol: 'UNI', name: 'Unichain' },
  15: { symbol: 'ALG', name: 'Algorand' },
  16: { symbol: 'STX', name: 'Stacks' },
  17: { symbol: 'LIN', name: 'Linea' },
};

export function resolveChain(chainId: number | null | undefined): {
  symbol: string;
  name: string;
} {
  if (chainId === null || chainId === undefined) {
    return { symbol: 'Unknown', name: 'Unknown' };
  }
  return (
    ALLBRIDGE_CHAIN_ID_MAP[chainId] ?? {
      symbol: `CHAIN_${chainId}`,
      name: `Unknown (${chainId})`,
    }
  );
}
