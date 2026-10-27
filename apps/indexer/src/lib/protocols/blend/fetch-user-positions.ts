// apps/indexer/src/lib/protocols/blend/fetch-user-positions.ts
//
// Resolve users' Blend positions in a pool, using the SAME pool / RPC / oracle
// setup as fetch-pool-state.ts. Reads are SDK-native:
//   - PoolV2.load    → reserves
//   - pool.loadOracle → the pool's Reflector oracle (USD prices, on-chain parity)
//   - pool.loadUser   → the user's collateral / supply / liability positions
//
// Two entry points share one builder so their results are identical:
//   - fetchBlendUserPositions      — ONE user: loads pool + oracle + user (the
//                                    original path; still used by the API's
//                                    per-wallet refresh through script 81 in
//                                    single-wallet mode).
//   - loadBlendPoolContext +
//     fetchBlendUsersPositionsBatch — Lot RP (RP1): load pool + oracle ONCE per
//                                    run, then read MANY users' `Positions`
//                                    ledger entries per getLedgerEntries request
//                                    (the RPC accepts up to 200 keys; we send
//                                    POSITIONS_BATCH_SIZE). The 81 sweep went
//                                    from 12 RPC calls per wallet × pool to one
//                                    pool/oracle load per pool plus one call per
//                                    batch of wallets.
//
// We return the per-asset breakdown PLUS the raw SDK objects (pool, oracle, user)
// so resolve-user-health.ts can hand them straight to PositionsEstimate.build —
// the health factor must come from the SDK's estimate, never a hand-rolled
// collateral/liability-factor formula.
//
// Emissions: PoolUser.load also fetches the user's emission entries (2 keys per
// reserve). Neither the per-asset breakdown nor PositionsEstimate.build reads
// them (the Float getters and the estimate only use `positions`), so the batch
// path builds the PoolUser with an EMPTY emissions map. Do not use the batch
// path for anything that needs claimable emissions.

import 'dotenv/config';

import { Networks, StrKey, rpc } from '@stellar/stellar-sdk';
import { PoolOracle, PoolUser, PoolV2, Positions } from '@blend-capital/blend-sdk';
import { resolveRpcUrl } from '../../rpc-config';

/** Keys per getLedgerEntries request. The RPC caps at 200; stay well under. */
export const POSITIONS_BATCH_SIZE = 100;

export type BlendUserReservePosition = {
  assetId: string; // reserve asset contract address
  decimals: number;
  priceUsd: number | null; // oracle (Reflector) price, USD float
  // amounts in asset units (the SDK Float helpers are already decimal-scaled)
  collateral: number; // collateralized supply
  supply: number; // non-collateral supply
  liabilities: number; // borrow
  collateralUsd: number | null;
  supplyUsd: number | null;
  liabilitiesUsd: number | null;
};

export type BlendUserPositions = {
  poolId: string;
  userAddress: string;
  hasPosition: boolean;
  reserves: BlendUserReservePosition[];
  // Raw SDK objects retained for the health estimate (resolve-user-health).
  pool: PoolV2;
  oracle: PoolOracle;
  user: PoolUser;
};

/** Pool + oracle loaded once; shared by every user read of the same pool. */
export type BlendPoolContext = {
  poolId: string;
  rpcUrl: string;
  pool: PoolV2;
  oracle: PoolOracle;
};

function networkFor(rpcUrl: string) {
  return {
    passphrase: Networks.PUBLIC,
    rpc: rpcUrl,
  };
}

/**
 * The per-asset breakdown from already-loaded SDK objects. This is the ONLY
 * place the breakdown is computed, so the single-user and batch paths cannot
 * drift apart.
 */
export function buildBlendUserPositions(params: {
  poolId: string;
  userAddress: string;
  pool: PoolV2;
  oracle: PoolOracle;
  user: PoolUser;
}): BlendUserPositions {
  const { poolId, userAddress, pool, oracle, user } = params;
  const reserves: BlendUserReservePosition[] = [];
  let hasPosition = false;

  for (const [assetId, reserve] of pool.reserves.entries()) {
    // Float helpers return human-scaled asset units (SDK applies decimals/bRate/
    // dRate internally) — no manual scaling, which is what bit us on the bridge.
    const collateral = user.getCollateralFloat(reserve);
    const supply = user.getSupplyFloat(reserve);
    const liabilities = user.getLiabilitiesFloat(reserve);

    if (collateral === 0 && supply === 0 && liabilities === 0) {
      continue;
    }

    hasPosition = true;

    const priceUsd = oracle.getPriceFloat(assetId) ?? null;

    reserves.push({
      assetId,
      decimals: reserve.config.decimals,
      priceUsd,
      collateral,
      supply,
      liabilities,
      collateralUsd: priceUsd !== null ? collateral * priceUsd : null,
      supplyUsd: priceUsd !== null ? supply * priceUsd : null,
      liabilitiesUsd: priceUsd !== null ? liabilities * priceUsd : null,
    });
  }

  return {
    poolId,
    userAddress,
    hasPosition,
    reserves,
    pool,
    oracle,
    user,
  };
}

/**
 * Load a pool and its oracle once. RPC cost: PoolV2.load (2 getLedgerEntries)
 * + loadOracle (1 simulateTransaction for decimals + 1 `lastprice` simulation
 * per reserve asset).
 */
export async function loadBlendPoolContext(params: {
  poolId: string;
  rpcUrl?: string;
}): Promise<BlendPoolContext> {
  const rpcUrl = resolveRpcUrl(params.rpcUrl);
  const pool = await PoolV2.load(networkFor(rpcUrl), params.poolId);
  const oracle = await pool.loadOracle();
  return { poolId: params.poolId, rpcUrl, pool, oracle };
}

/**
 * RP1.1: a Blend user is a Stellar account (G…) or a contract (C…). Anything
 * else (user_wallets has carried scanner junk such as SQL-injection strings)
 * cannot become a ledger key — `Address.fromString` throws — and must be kept
 * out of a batch so one bad row never takes down a whole pool's read.
 */
export function isValidBlendUserAddress(address: string): boolean {
  return (
    typeof address === 'string' &&
    (StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address))
  );
}

export type BlendUsersPositionsBatchResult = {
  positions: Map<string, BlendUserPositions>;
  /** Addresses for which no ledger key could be built (skipped, never thrown). */
  invalidAddresses: string[];
};

/** The one RPC call the batch path makes; injectable so the batching logic is unit-testable. */
export type LedgerEntriesReader = (
  keys: ReturnType<typeof Positions.ledgerKey>[]
) => Promise<{ entries: Array<{ key: { toXDR(format: 'base64'): string }; val: Parameters<typeof Positions.fromLedgerEntryData>[0] }> }>;

/**
 * Read MANY users' positions in one pool with batched getLedgerEntries calls
 * (one `Positions` key per user). Users without a `Positions` entry get an
 * empty position (hasPosition=false) — the same outcome PoolUser.load produces
 * for an unknown user. An address whose key cannot be built is skipped and
 * reported in `invalidAddresses` (RP1.1 — defense in depth; 81 validates
 * upstream). Throws only on an RPC failure for a batch; the caller decides
 * whether to skip the pool for this run.
 */
export async function fetchBlendUsersPositionsBatch(params: {
  context: BlendPoolContext;
  userAddresses: string[];
  batchSize?: number;
  /** Test seam; defaults to rpc.Server(context.rpcUrl).getLedgerEntries. */
  readLedgerEntries?: LedgerEntriesReader;
}): Promise<BlendUsersPositionsBatchResult> {
  const { context } = params;
  const batchSize = Math.max(1, Math.min(200, params.batchSize ?? POSITIONS_BATCH_SIZE));
  const readLedgerEntries: LedgerEntriesReader =
    params.readLedgerEntries ??
    (() => {
      const server = new rpc.Server(context.rpcUrl, { allowHttp: false });
      return (keys) => server.getLedgerEntries(...keys);
    })();
  const results = new Map<string, BlendUserPositions>();
  const invalidAddresses: string[] = [];

  // De-duplicate so one address tracked by several users costs one key.
  const addresses = Array.from(new Set(params.userAddresses));

  for (let start = 0; start < addresses.length; start += batchSize) {
    const batch: string[] = [];

    // key XDR (base64) -> address, to map returned entries back to their user.
    // Built per address inside try/catch: a malformed address is reported and
    // skipped, it never aborts the batch (RP1.1).
    const keyToAddress = new Map<string, string>();
    const keys: ReturnType<typeof Positions.ledgerKey>[] = [];
    for (const address of addresses.slice(start, start + batchSize)) {
      try {
        const key = Positions.ledgerKey(context.poolId, address);
        keyToAddress.set(key.toXDR('base64'), address);
        keys.push(key);
        batch.push(address);
      } catch {
        invalidAddresses.push(address);
      }
    }
    if (keys.length === 0) continue;

    const response = await readLedgerEntries(keys);

    const positionsByAddress = new Map<string, Positions>();
    for (const entry of response.entries) {
      const address = keyToAddress.get(entry.key.toXDR('base64'));
      if (!address) continue; // not one of ours — ignore rather than guess
      positionsByAddress.set(address, Positions.fromLedgerEntryData(entry.val));
    }

    for (const address of batch) {
      const positions =
        positionsByAddress.get(address) ?? new Positions(new Map(), new Map(), new Map());
      const user = new PoolUser(address, positions, new Map());
      results.set(
        address,
        buildBlendUserPositions({
          poolId: context.poolId,
          userAddress: address,
          pool: context.pool,
          oracle: context.oracle,
          user,
        })
      );
    }
  }

  return { positions: results, invalidAddresses };
}

/** One user, one pool — loads pool + oracle + user (12 RPC calls on a pool with 8 reserves). */
export async function fetchBlendUserPositions(params: {
  poolId: string;
  userAddress: string;
  rpcUrl?: string;
}): Promise<BlendUserPositions> {
  const rpcUrl = resolveRpcUrl(params.rpcUrl);
  const network = networkFor(rpcUrl);

  const pool = await PoolV2.load(network, params.poolId);
  const oracle = await pool.loadOracle();
  const user = await pool.loadUser(params.userAddress);

  return buildBlendUserPositions({
    poolId: params.poolId,
    userAddress: params.userAddress,
    pool,
    oracle,
    user,
  });
}
