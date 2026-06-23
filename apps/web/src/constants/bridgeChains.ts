// apps/web/src/constants/bridgeChains.ts
//
// Web-side display map: Allbridge source/destination chain SYMBOL -> pretty
// name. The API returns the symbol + chainId only (it must not import the
// indexer's chain map — cross-app coupling). Fallback: show the raw symbol.
const CHAIN_NAMES: Record<string, string> = {
  ETH: 'Ethereum',
  BSC: 'BNB Chain',
  TRX: 'Tron',
  SOL: 'Solana',
  POL: 'Polygon',
  ARB: 'Arbitrum',
  AVA: 'Avalanche',
  BAS: 'Base',
  OPT: 'Optimism',
  CEL: 'Celo',
  SNC: 'Sonic',
  SUI: 'Sui',
  UNI: 'Unichain',
  ALG: 'Algorand',
  STX: 'Stacks',
  LIN: 'Linea',
}

export function chainDisplayName(symbol: string | null | undefined): string {
  if (!symbol) return 'Unknown'
  return CHAIN_NAMES[symbol] ?? symbol
}
