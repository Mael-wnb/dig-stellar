// apps/api/src/modules/actions/witness.service.ts
//
// R1 (Lot R — T3-D2): the execution witness. Verifies — ALL server-side, all
// against Horizon, never trusting the client — that a submitted tx hash is a
// real, successful, qualifying action (SDEX swap or Blend deposit) executed by
// a wallet known to us, within a sane window of a recorded Dig build event.
// Verified witnesses land in `action_witnesses` (tx_hash PK — idempotent);
// failed verifications are returned as an honest reason and never stored.
//
// This module BUILDS nothing, SIGNS nothing and holds no keys — it is the
// read-only eligibility primitive the R2 faucet consumes via the DB only.

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Horizon } from '@stellar/stellar-sdk';
import { PrismaService } from '../../db/prisma.service';
import {
  type ActionNetwork,
  getNetworkConfig,
  blendPoolsFor,
} from './network-registry';
import {
  findQualifyingOp,
  computeNotionalXlm,
  contractIdFor,
  type HorizonOpRecordLike,
  type WitnessKind,
} from './witness-verify';

/**
 * Build-link window: the qualifying tx must close within [-60 min, +5 min] of a
 * recorded matching build for that wallet. 60 min covers a slow wallet-approval
 * flow (incl. the USDC two-step trustline gate); +5 min absorbs clock skew.
 */
const BUILD_WINDOW_BEFORE_MIN = 60;
const BUILD_WINDOW_AFTER_MIN = 5;

/** Verification-time prices only: a price older than this is treated as absent. */
const PRICE_MAX_AGE = '24 hours';

/**
 * Min XLM-equivalent notional for faucet eligibility (raises farming cost).
 * Env-overridable (FAUCET_MIN_NOTIONAL_XLM, default 1); the threshold in force
 * is stored ON the witness row so the rule stays auditable if it changes.
 */
export function faucetMinNotionalXlm(): number {
  const raw = process.env.FAUCET_MIN_NOTIONAL_XLM;
  const parsed = raw != null ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export type WitnessFailureReason =
  | 'tx-not-found'
  | 'tx-not-successful'
  | 'unknown-wallet'
  | 'no-qualifying-op'
  | 'no-matching-build';

export interface WitnessResponse {
  witnessed: boolean;
  txHash: string;
  network: ActionNetwork;
  /** Present on witnessed=false — the exact check that failed (honest UX). */
  reason?: WitnessFailureReason;
  /** True when the tx was already witnessed (re-witnessing is a no-op). */
  alreadyWitnessed?: boolean;
  kind?: WitnessKind;
  walletAddress?: string;
  notionalXlm?: number | null;
  minNotionalXlm?: number;
  meetsMinNotional?: boolean;
}

type WalletRow = { user_id: string; address: string };
type WitnessRow = {
  tx_hash: string;
  kind: string;
  wallet_address: string;
  notional_xlm: unknown;
  min_notional_xlm: unknown;
  meets_min_notional: boolean;
};
type BuildRow = { id: unknown };
type PriceRow = { contract_address: string; price_usd: unknown };

/** The one build kind whose recorded event can back each witness kind. */
const BUILD_KIND_FOR: Record<WitnessKind, string> = {
  'sdex-swap': 'sdex-swap-build',
  'blend-deposit': 'blend-deposit-build',
  'blend-withdraw': 'blend-withdraw-build',
};

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : null;
}

@Injectable()
export class WitnessService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly horizonServers = new Map<ActionNetwork, Horizon.Server>();

  private horizonFor(network: ActionNetwork): Horizon.Server {
    const cached = this.horizonServers.get(network);
    if (cached) return cached;
    const server = new Horizon.Server(getNetworkConfig(network).horizonUrl);
    this.horizonServers.set(network, server);
    return server;
  }

  async witness(params: {
    txHash: string;
    network: ActionNetwork;
    userId: string | null;
  }): Promise<WitnessResponse> {
    const network = params.network;
    const txHash = params.txHash.toLowerCase();
    const fail = (reason: WitnessFailureReason): WitnessResponse => ({
      witnessed: false,
      txHash,
      network,
      reason,
    });

    // 0. Idempotency first: an already-witnessed tx is a no-op — no Horizon
    // round-trips, the stored row answers.
    const existing = await this.findExisting(txHash);
    if (existing) return existing;

    // 1. The tx must exist on the network's Horizon and be successful.
    const horizon = this.horizonFor(network);
    let tx: Horizon.ServerApi.TransactionRecord;
    try {
      tx = await horizon.transactions().transaction(txHash).call();
    } catch (err) {
      if (isHorizonNotFound(err)) return fail('tx-not-found');
      throw new ServiceUnavailableException('Horizon is unavailable. Retry later.');
    }
    if (!tx.successful) return fail('tx-not-successful');

    // 2. The tx source must be a wallet known to us. When the client names a
    // userId, that user's row is preferred; otherwise the active signer wins.
    const sourceAddress = tx.source_account;
    const wallet = await this.findKnownWallet(sourceAddress, params.userId);
    if (!wallet) return fail('unknown-wallet');

    // 3. The tx must contain a qualifying op whose source is that wallet.
    let opRecords: HorizonOpRecordLike[];
    try {
      const ops = await horizon.operations().forTransaction(txHash).limit(200).call();
      opRecords = ops.records as unknown as HorizonOpRecordLike[];
    } catch {
      throw new ServiceUnavailableException('Horizon is unavailable. Retry later.');
    }
    const poolIds = blendPoolsFor(network).map((p) => p.poolId);
    const qualifying = findQualifyingOp(opRecords, sourceAddress, poolIds);
    if (!qualifying) return fail('no-qualifying-op');

    // 4. Build link: a recorded matching Dig build for that wallet, within the
    // window around the tx close time. Builds alone prove nothing; an executed
    // tx with NO recorded build did not come through Dig.
    const closedAt = tx.created_at;
    const buildEventId = await this.findMatchingBuild(
      BUILD_KIND_FOR[qualifying.kind],
      sourceAddress,
      network,
      closedAt,
    );
    if (buildEventId == null) return fail('no-matching-build');

    // 5. Min-notional (faucet eligibility, stored — never a rejection: the
    // witness itself is valid evidence either way).
    const passphrase = getNetworkConfig(network).networkPassphrase;
    const prices = await this.loadPrices(qualifying.legs, passphrase);
    const { notionalXlm, pricing } = computeNotionalXlm(qualifying.legs, prices, passphrase);
    const minNotional = faucetMinNotionalXlm();
    const meetsMin = notionalXlm != null && notionalXlm >= minNotional;

    // 6. Persist (idempotent — a concurrent duplicate loses silently and we
    // return the stored row).
    const opSummary = { ...qualifying.summary, pricing };
    const inserted = await this.prisma.$executeRawUnsafe(
      `insert into action_witnesses
         (tx_hash, network, wallet_address, user_id, kind, op_summary,
          notional_xlm, min_notional_xlm, meets_min_notional,
          action_event_id, ledger_closed_at)
       values ($1, $2, $3, $4::uuid, $5, $6::jsonb, $7, $8, $9, $10, $11::timestamptz)
       on conflict (tx_hash) do nothing`,
      txHash,
      network,
      sourceAddress,
      wallet.user_id,
      qualifying.kind,
      JSON.stringify(opSummary),
      notionalXlm,
      minNotional,
      meetsMin,
      buildEventId,
      closedAt,
    );
    if (inserted === 0) {
      const raced = await this.findExisting(txHash);
      if (raced) return raced;
    }

    return {
      witnessed: true,
      txHash,
      network,
      kind: qualifying.kind,
      walletAddress: sourceAddress,
      notionalXlm,
      minNotionalXlm: minNotional,
      meetsMinNotional: meetsMin,
    };
  }

  private async findExisting(txHash: string): Promise<WitnessResponse | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `select tx_hash, network, kind, wallet_address,
              notional_xlm, min_notional_xlm, meets_min_notional
       from action_witnesses where tx_hash = $1`,
      txHash,
    )) as Array<WitnessRow & { network: string }>;
    const row = rows[0];
    if (!row) return null;
    return {
      witnessed: true,
      alreadyWitnessed: true,
      txHash: row.tx_hash,
      network: row.network as ActionNetwork,
      kind: row.kind as WitnessKind,
      walletAddress: row.wallet_address,
      notionalXlm: toNum(row.notional_xlm),
      minNotionalXlm: toNum(row.min_notional_xlm) ?? undefined,
      meetsMinNotional: row.meets_min_notional,
    };
  }

  private async findKnownWallet(
    address: string,
    userId: string | null,
  ): Promise<WalletRow | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `select user_id::text as user_id, address
       from user_wallets
       where lower(chain) = 'stellar' and lower(address) = lower($1)
       order by (case when $2::uuid is not null and user_id = $2::uuid then 0 else 1 end),
                is_active_signer desc, updated_at desc, id asc
       limit 1`,
      address,
      userId,
    )) as WalletRow[];
    return rows[0] ?? null;
  }

  private async findMatchingBuild(
    buildKind: string,
    address: string,
    network: ActionNetwork,
    txClosedAt: string,
  ): Promise<number | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `select id from action_events
       where kind = $1
         and lower(address) = lower($2)
         and network = $3
         and created_at between $4::timestamptz - interval '${BUILD_WINDOW_BEFORE_MIN} minutes'
                            and $4::timestamptz + interval '${BUILD_WINDOW_AFTER_MIN} minutes'
       order by created_at desc
       limit 1`,
      buildKind,
      address,
      network,
      txClosedAt,
    )) as BuildRow[];
    const id = rows[0]?.id;
    return id == null ? null : Number(String(id));
  }

  /**
   * Latest fresh (≤ 24h) USD prices for the legs' SAC contract ids + native
   * XLM, from the indexer-maintained asset_prices. Missing/stale prices simply
   * do not appear in the map — computeNotionalXlm degrades to NULL honestly.
   */
  private async loadPrices(
    legs: Array<{ asset: { native: boolean; code?: string; issuer?: string } }>,
    networkPassphrase: string,
  ): Promise<Map<string, number>> {
    const wanted = new Set<string>();
    const nativeId = contractIdFor({ native: true }, networkPassphrase);
    if (nativeId) wanted.add(nativeId);
    for (const leg of legs) {
      const id = contractIdFor(leg.asset, networkPassphrase);
      if (id) wanted.add(id);
    }
    const ids = Array.from(wanted);
    if (ids.length === 0) return new Map();

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const rows = (await this.prisma.$queryRawUnsafe(
      `select a.contract_address, p.price_usd
       from assets a
       join lateral (
         select ap.price_usd
         from asset_prices ap
         where ap.asset_id = a.id
           and ap.observed_at > now() - interval '${PRICE_MAX_AGE}'
         order by ap.observed_at desc
         limit 1
       ) p on true
       where a.contract_address in (${placeholders})`,
      ...ids,
    )) as PriceRow[];

    const map = new Map<string, number>();
    for (const row of rows) {
      const price = toNum(row.price_usd);
      if (price != null && price > 0) map.set(row.contract_address, price);
    }
    return map;
  }
}

function isHorizonNotFound(err: unknown): boolean {
  const e = err as { name?: string; response?: { status?: number } } | null;
  return e?.name === 'NotFoundError' || e?.response?.status === 404;
}
