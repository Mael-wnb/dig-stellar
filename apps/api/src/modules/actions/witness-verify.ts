// apps/api/src/modules/actions/witness-verify.ts
//
// R1 (Lot R — T3-D2): PURE qualification rules for the execution witness.
// No I/O, no Nest, no DB — deliberately side-effect free so the money-path
// review gate (R2) can reason about, and unit-test, exactly what counts as a
// qualifying action and how the min-notional rule is computed.
//
// A tx qualifies when it contains an operation whose SOURCE is the witnessed
// wallet and whose shape is one of (per the Lot R brief):
//   - a path payment (strict send / strict receive)      → kind 'sdex-swap'
//   - a manage_buy_offer                                  → kind 'sdex-swap'
//     (accepted per the brief; note an offer op proves placement, not a fill.
//     Dig never BUILDS offer ops, so the build-link check makes this path
//     unreachable in practice today — kept for shape-completeness.)
//   - an invoke_host_function moving funds FROM the wallet INTO a registry
//     Blend pool (a SAC transfer in asset_balance_changes) → kind 'blend-deposit'
// Generic "Soroban swap invokes" are NOT recognized: without a vetted router
// registry there is no honest way to tell a swap from any other invoke, and no
// Dig build path produces one — the mandatory build-link would reject it anyway.

import { Asset } from '@stellar/stellar-sdk';

export type WitnessKind = 'sdex-swap' | 'blend-deposit';

/** An asset as it appears on a Horizon op record. */
export interface WitnessAsset {
  native: boolean;
  code?: string;
  issuer?: string;
}

/** One measurable leg of the qualifying op (what the min-notional rule prices). */
export interface WitnessLeg {
  label: string; // e.g. 'source', 'dest', 'deposit'
  asset: WitnessAsset;
  amount: number;
}

export interface QualifyingOp {
  kind: WitnessKind;
  opIndex: number;
  /**
   * Legs in priority order: the FIRST leg that can be honestly priced decides
   * the notional (a swap's source leg first, dest leg as fallback).
   */
  legs: WitnessLeg[];
  /** Audit payload persisted as action_witnesses.op_summary. */
  summary: Record<string, unknown>;
}

/** Minimal structural view of a Horizon operation record (fields we read). */
export interface HorizonOpRecordLike {
  type: string;
  source_account?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  source_amount?: string;
  source_asset_type?: string;
  source_asset_code?: string;
  source_asset_issuer?: string;
  buying_asset_type?: string;
  buying_asset_code?: string;
  buying_asset_issuer?: string;
  asset_balance_changes?: Array<{
    type?: string;
    asset_type?: string;
    asset_code?: string;
    asset_issuer?: string;
    from?: string;
    to?: string;
    amount?: string;
  }>;
}

function assetFrom(
  assetType: string | undefined,
  code: string | undefined,
  issuer: string | undefined,
): WitnessAsset {
  if (assetType === 'native' || (!code && !issuer)) return { native: true };
  return { native: false, code, issuer };
}

/** Compact 'CODE:ISSUER' / 'XLM' form for audit summaries. */
export function assetLabel(a: WitnessAsset): string {
  return a.native ? 'XLM' : `${a.code ?? '?'}:${a.issuer ?? '?'}`;
}

const SWAP_OP_TYPES = new Set([
  'path_payment_strict_send',
  'path_payment_strict_receive',
  'manage_buy_offer',
]);

/**
 * Finds the first qualifying operation whose source is `walletAddress`.
 * `blendPoolIds` is the vetted pool registry for the tx's network — an invoke
 * only qualifies as a Blend deposit when funds demonstrably moved from the
 * wallet into one of those exact contracts.
 */
export function findQualifyingOp(
  records: HorizonOpRecordLike[],
  walletAddress: string,
  blendPoolIds: readonly string[],
): QualifyingOp | null {
  const wallet = walletAddress.toUpperCase();
  const poolSet = new Set(blendPoolIds);

  for (let i = 0; i < records.length; i++) {
    const op = records[i];
    // Horizon fills source_account with the tx source when the op has none.
    if ((op.source_account ?? '').toUpperCase() !== wallet) continue;

    if (SWAP_OP_TYPES.has(op.type)) {
      if (op.type === 'manage_buy_offer') {
        const buying = assetFrom(
          op.buying_asset_type,
          op.buying_asset_code,
          op.buying_asset_issuer,
        );
        const amount = Number(op.amount ?? '0');
        if (!(amount > 0)) continue;
        return {
          kind: 'sdex-swap',
          opIndex: i,
          legs: [{ label: 'buying', asset: buying, amount }],
          summary: {
            opType: op.type,
            opIndex: i,
            buyingAsset: assetLabel(buying),
            buyingAmount: op.amount,
          },
        };
      }

      // Path payments: the source leg (what the user spent) is the primary
      // measure of the swap's size; the dest leg is the pricing fallback.
      const sourceAsset = assetFrom(
        op.source_asset_type,
        op.source_asset_code,
        op.source_asset_issuer,
      );
      const destAsset = assetFrom(op.asset_type, op.asset_code, op.asset_issuer);
      const sourceAmount = Number(op.source_amount ?? '0');
      const destAmount = Number(op.amount ?? '0');
      const legs: WitnessLeg[] = [];
      if (sourceAmount > 0) legs.push({ label: 'source', asset: sourceAsset, amount: sourceAmount });
      if (destAmount > 0) legs.push({ label: 'dest', asset: destAsset, amount: destAmount });
      if (legs.length === 0) continue;
      return {
        kind: 'sdex-swap',
        opIndex: i,
        legs,
        summary: {
          opType: op.type,
          opIndex: i,
          sourceAsset: assetLabel(sourceAsset),
          sourceAmount: op.source_amount,
          destAsset: assetLabel(destAsset),
          destAmount: op.amount,
        },
      };
    }

    if (op.type === 'invoke_host_function') {
      // Deposit-shaped iff a SAC transfer moved funds wallet → registry pool.
      // (A withdraw transfers pool → wallet and therefore never matches.)
      const transfer = (op.asset_balance_changes ?? []).find(
        (c) =>
          c.type === 'transfer' &&
          (c.from ?? '').toUpperCase() === wallet &&
          poolSet.has(c.to ?? ''),
      );
      if (!transfer) continue;
      const asset = assetFrom(transfer.asset_type, transfer.asset_code, transfer.asset_issuer);
      const amount = Number(transfer.amount ?? '0');
      if (!(amount > 0)) continue;
      return {
        kind: 'blend-deposit',
        opIndex: i,
        legs: [{ label: 'deposit', asset, amount }],
        summary: {
          opType: op.type,
          opIndex: i,
          pool: transfer.to,
          depositAsset: assetLabel(asset),
          depositAmount: transfer.amount,
        },
      };
    }
  }
  return null;
}

/**
 * Deterministic SAC contract id for an asset on a network — the key into
 * `assets.contract_address` (and thus `asset_prices`).
 */
export function contractIdFor(a: WitnessAsset, networkPassphrase: string): string | null {
  try {
    if (a.native) return Asset.native().contractId(networkPassphrase);
    if (!a.code || !a.issuer) return null;
    return new Asset(a.code, a.issuer).contractId(networkPassphrase);
  } catch {
    return null; // malformed code/issuer — unpriceable, never a throw path
  }
}

export interface NotionalResult {
  /** XLM-equivalent of the first priceable leg; null = could not price honestly. */
  notionalXlm: number | null;
  /** Audit detail merged into op_summary. */
  pricing: Record<string, unknown>;
}

/**
 * XLM-equivalent notional of the qualifying op at verification-time prices.
 * A native-XLM leg needs no price at all. A non-native leg converts through
 * USD: amount * priceUsd(asset) / priceUsd(XLM). Legs are tried in priority
 * order; if none can be priced the notional is NULL (stored honestly — the
 * witness exists but does not meet the faucet's min-notional rule).
 */
export function computeNotionalXlm(
  legs: WitnessLeg[],
  priceUsdByContract: ReadonlyMap<string, number>,
  networkPassphrase: string,
): NotionalResult {
  const xlmContract = Asset.native().contractId(networkPassphrase);
  const xlmUsd = priceUsdByContract.get(xlmContract);

  for (const leg of legs) {
    if (leg.asset.native) {
      return {
        notionalXlm: leg.amount,
        pricing: { pricedLeg: leg.label, method: 'native-direct' },
      };
    }
    const contract = contractIdFor(leg.asset, networkPassphrase);
    const priceUsd = contract ? priceUsdByContract.get(contract) : undefined;
    if (contract && priceUsd != null && priceUsd > 0 && xlmUsd != null && xlmUsd > 0) {
      return {
        notionalXlm: (leg.amount * priceUsd) / xlmUsd,
        pricing: {
          pricedLeg: leg.label,
          method: 'usd-cross',
          assetPriceUsd: priceUsd,
          xlmPriceUsd: xlmUsd,
        },
      };
    }
  }
  return { notionalXlm: null, pricing: { pricedLeg: null, method: 'unpriceable' } };
}
