// apps/api/src/modules/actions/witness.controller.ts
//
// R1 (Lot R — T3-D2): POST /v1/actions/witness — the web submits a tx hash
// after a successful swap / Blend deposit submit; verification is entirely
// server-side (see WitnessService). Deliberately NOT gated by the mainnet
// action kill-switches: witnessing builds no XDR and moves no funds — it only
// verifies what already happened on-chain. Failed verification is a 200 with
// an honest `reason`, never a 4xx: the client fires-and-forgets, and the R2
// faucet reads eligibility from the DB, not from this response.
//
// Ops note: this endpoint belongs in Lot S's strict nginx rate-limit zone
// alongside the future faucet endpoints (VPS config — see the R1 evidence).

import {
  Controller,
  Post,
  Body,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WitnessService } from './witness.service';
import { type ActionNetwork } from './network-registry';

interface WitnessBody {
  txHash: string;
  network?: string;
  /** Optional app user id (localStorage uuid) to pin the owning wallet row. */
  userId?: string;
}

const TX_HASH_RE = /^[0-9a-f]{64}$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Same accepted values as the action builders (absent → testnet), but WITHOUT
 * the mainnet kill-switch: a mainnet witness must verify even if mainnet
 * BUILDING were ever re-gated, or already-executed actions would become
 * unwitnessable.
 */
function resolveWitnessNetwork(network: unknown): ActionNetwork {
  if (network == null || network === 'testnet') return 'testnet';
  if (network === 'mainnet') return 'mainnet';
  throw new BadRequestException(`unknown network "${String(network)}"`);
}

@Controller('v1/actions')
export class WitnessController {
  constructor(private readonly witnessService: WitnessService) {}

  @Post('witness')
  @HttpCode(HttpStatus.OK)
  async witness(@Body() body: WitnessBody) {
    const { txHash, network, userId } = body;

    if (!txHash || typeof txHash !== 'string' || !TX_HASH_RE.test(txHash)) {
      throw new BadRequestException('txHash must be a 64-char hex transaction hash');
    }
    const resolvedNetwork = resolveWitnessNetwork(network);
    if (userId != null && (typeof userId !== 'string' || !UUID_RE.test(userId))) {
      throw new BadRequestException('userId must be a uuid when provided');
    }

    return this.witnessService.witness({
      txHash,
      network: resolvedNetwork,
      userId: userId ?? null,
    });
  }
}
