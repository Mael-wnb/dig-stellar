// explorer.ts — stellar.expert deep links (G1, Lot G / T3-D3).
//
// Single source for the explorer URL shape already used inline by the action
// widgets (SdexSwapWidget / BlendDepositCard, `public` on mainnet, `testnet`
// otherwise — INV-6.1). Read-only feeds that surface a real on-chain hash
// (bridge flows) are Stellar mainnet data, so they default to `public`.
export type ExplorerNetwork = 'public' | 'testnet'

export function stellarExpertTxUrl(
  hash: string,
  network: ExplorerNetwork = 'public',
): string {
  return `https://stellar.expert/explorer/${network}/tx/${hash}`
}
