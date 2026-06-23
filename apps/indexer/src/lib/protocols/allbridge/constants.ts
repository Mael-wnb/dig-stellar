// apps/indexer/src/lib/protocols/allbridge/constants.ts
//
// Locked Allbridge Core facts (T2-D3). Pinned as constants so ingestion never
// depends on the Allbridge API being up. If Allbridge ever redeploys, this is a
// one-line change. Source: Allbridge Core API GET /token-info?filter=all (.SRB).

// Soroban bridge contract (mainnet). Single entry point — `swapAddress` is identical.
export const ALLBRIDGE_BRIDGE_CONTRACT_ID =
  'CBQ6GW7QCFFE252QEVENUNG45KYHHBRO4IZIWFJOXEFANHPQUXX5NFWV';

// The only token Allbridge Core bridges on Stellar today: USDC (Soroban SAC).
export const ALLBRIDGE_USDC_CONTRACT_ID =
  'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
export const ALLBRIDGE_USDC_SYMBOL = 'USDC';
export const ALLBRIDGE_USDC_DECIMALS = 7;

// Classic Circle USDC issuer the Soroban SAC wraps (provenance / metadata only).
export const ALLBRIDGE_USDC_CLASSIC_ISSUER =
  'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

// Venue identity for the `venues` row backing bridge_flows.venue_id.
export const ALLBRIDGE_VENUE_SLUG = 'allbridge';
export const ALLBRIDGE_VENUE_NAME = 'Allbridge';
export const ALLBRIDGE_CHAIN = 'stellar-mainnet';

// Allbridge's internal id for Stellar/Soroban itself. Should never appear as a
// counterparty on an inflow or outflow.
export const ALLBRIDGE_SELF_CHAIN_ID = 7;

// Soroban event topic symbols on the bridge contract.
export const ALLBRIDGE_EVENT_TOKENS_SENT = 'TokensSent'; // Stellar -> other chain (outflow)
export const ALLBRIDGE_EVENT_TOKENS_RECEIVED = 'TokensReceived'; // other chain -> Stellar (inflow)

// Host function whose args carry the inflow source chain (TokensReceived has no
// source chain in the event itself — see fetch-bridge-events.ts).
export const ALLBRIDGE_RECEIVE_TOKENS_FN = 'receive_tokens';

// receive_tokens(...) arg order, confirmed against the contract source
// (allbridge-core-soroban-contracts/contracts/bridge/src/contract.rs); the
// implicit `env` is not an invocation arg:
//   0 sender: Address
//   1 amount: u128
//   2 recipient: Address
//   3 source_chain_id: u32   <-- the inflow counterparty chain
//   4 receive_token: BytesN<32>
//   5 nonce: U256
//   6 receive_amount_min: u128
//   7 extra_gas: Option<u128>
// u32 decodes to a JS number via scValToNative, so we read this index with a
// numeric type guard. The raw value is passed straight to resolveChain so a
// chain Allbridge adds later still renders (Unknown (N)) rather than being lost.
export const ALLBRIDGE_RECEIVE_TOKENS_SOURCE_CHAIN_ARG_INDEX = 3;
