import { Asset } from '@stellar/stellar-sdk';

export const TESTNET_RPC_URL = 'https://soroban-testnet.stellar.org';
// Horizon (classic) testnet — used to quote SDEX paths (/paths/strict-send).
// The Soroban RPC above cannot price classic DEX routes; Horizon is the source for that.
export const TESTNET_HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const TESTNET_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

export const TESTNET_BLEND_POOL =
  'CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF';
export const TESTNET_BACKSTOP_V2 =
  'CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA';
export const TESTNET_USDC_SAC =
  'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU';
export const TESTNET_XLM_SAC =
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

// Classic USDC asset wrapping TESTNET_USDC_SAC.
// Issuer confirmed on-chain: read from the SAC instance storage (AssetInfo/Admin) and proven by
// deterministic contractId derivation against TESTNET_USDC_SAC.
export const TESTNET_USDC_CLASSIC = new Asset(
  'USDC',
  'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56',
);

// USDC used by the SDEX swap action ONLY (not Blend). Circle's canonical testnet USDC.
// Rationale: the GATALTGT issuer above has no direct XLM venue on testnet (no order book,
// no {XLM, USDC-GATALTGT} liquidity pool), so a PathPaymentStrictSend with an empty path
// fails with pathPaymentStrictSendTooFewOffers. Circle's USDC has a deep XLM/USDC AMM pool
// + order book, making the direct (single-hop) swap reliably fillable. Keep this separate
// from TESTNET_USDC_CLASSIC so the Blend deposit keeps using its own SAC-backed USDC.
export const TESTNET_USDC_SDEX = new Asset(
  'USDC',
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
);

export const ASSET_DECIMALS: Record<'USDC' | 'XLM', number> = {
  USDC: 7,
  XLM: 7,
};

export const ASSET_SAC: Record<'USDC' | 'XLM', string> = {
  USDC: TESTNET_USDC_SAC,
  XLM: TESTNET_XLM_SAC,
};
