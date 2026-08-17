import {
  Controller,
  Post,
  Body,
  BadRequestException,
  ForbiddenException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ActionsService, type AssetRef } from './actions.service';
import { OpsService } from '../ops/ops.service';
import {
  type ActionNetwork,
  isMainnetEnabled,
  isMainnetBlendEnabled,
  mainnetMaxSendXlm,
  isWhitelistedMainnetAsset,
  resolveBlendPool,
  MAINNET_ASSET_WHITELIST,
} from './network-registry';

/** Codes a user can be told are allowed on Mainnet (native XLM + every whitelist code). */
const MAINNET_ALLOWED_CODES = [
  'XLM',
  ...MAINNET_ASSET_WHITELIST.map((a) => a.code),
].join(', ');

interface BlendDepositBody {
  address: string;
  asset: 'USDC' | 'XLM';
  amount: string;
  network?: string;
  /**
   * Registry slug of the Blend pool to act on (Lot A5). ABSENT = the network's
   * default pool, so every pre-A5 client keeps working unchanged. An unknown slug
   * is a 400 from resolveBlendPool — never a silent fallback to another pool.
   */
  pool?: string;
}

/** Same shape as the deposit body — the withdraw is its mirror (Lot A3). */
type BlendWithdrawBody = BlendDepositBody;

interface BlendPositionBody {
  address: string;
  network?: string;
  /** Registry slug of the pool to read (A5). Absent = the network default. */
  pool?: string;
}

/**
 * An SDEX asset as the client sends it. Two accepted shapes:
 *   - legacy string: 'XLM' | 'USDC' (USDC resolves to the vetted Circle testnet issuer)
 *   - explicit ref:  { code, issuer? } (issuer required for anything but XLM)
 * The explicit form is what the multi-pair Testnet Actions widget sends.
 */
type AssetField = string | { code?: string; issuer?: string };

interface SdexSwapBody {
  address: string;
  fromAsset: AssetField;
  toAsset: AssetField;
  amount: string;
  minReceive: string;
  network?: string;
}

interface SdexQuoteBody {
  fromAsset: AssetField;
  toAsset: AssetField;
  amount: string;
  network?: string;
}

const STELLAR_PUBKEY_RE = /^G[A-Z2-7]{55}$/;
const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;

/**
 * Normalizes a client-supplied asset field to a canonical AssetRef and validates
 * its shape. XLM/native carries no issuer; any other asset requires a well-formed
 * Stellar issuer. The legacy 'USDC' string is passed through issuer-less so the
 * service maps it to the vetted testnet issuer (backward compatibility).
 */
function normalizeAssetField(field: AssetField, label: string): AssetRef {
  if (typeof field === 'string') {
    if (field === 'XLM') return { code: 'XLM' };
    if (field === 'USDC') return { code: 'USDC' }; // service supplies the vetted issuer
    throw new BadRequestException(`${label}: unknown asset "${field}"`);
  }
  if (!field || typeof field !== 'object' || typeof field.code !== 'string') {
    throw new BadRequestException(`${label} must be "XLM"/"USDC" or { code, issuer }`);
  }
  const code = field.code;
  if (code === 'XLM' || code === 'native') return { code: 'XLM' };
  if (!ASSET_CODE_RE.test(code)) {
    throw new BadRequestException(`${label}: invalid asset code "${code}"`);
  }
  if (typeof field.issuer !== 'string' || !STELLAR_PUBKEY_RE.test(field.issuer)) {
    throw new BadRequestException(
      `${label}: a valid Stellar issuer is required for ${code}`,
    );
  }
  return { code, issuer: field.issuer };
}

/**
 * Compact 'CODE:ISSUER' / 'XLM' form for action_events metadata (R1, Lot R) —
 * matches the op-summary asset notation used elsewhere.
 */
function assetKey(ref: AssetRef): string {
  return ref.issuer ? `${ref.code}:${ref.issuer}` : ref.code;
}

/** Same-asset check on the canonical refs (native XLM has no issuer to compare). */
function sameAsset(a: AssetRef, b: AssetRef): boolean {
  const na = a.code === 'XLM' || a.code === 'native';
  const nb = b.code === 'XLM' || b.code === 'native';
  if (na || nb) return na && nb;
  return a.code === b.code && a.issuer === b.issuer;
}

/**
 * Resolves the swap network from the request body (Lot A1 gating regime, INV-4.1):
 *   - absent / 'testnet' → testnet (today's behavior, byte-for-byte)
 *   - 'mainnet'          → 403 unless ACTIONS_MAINNET_ENABLED === 'true'
 *   - anything else      → 400
 * The kill-switch is enforced HERE, server-side; the VITE flag is UX only.
 */
function resolveSwapNetwork(network: unknown): ActionNetwork {
  if (network == null || network === 'testnet') return 'testnet';
  if (network === 'mainnet') {
    if (!isMainnetEnabled()) {
      throw new ForbiddenException('Mainnet actions are not enabled.');
    }
    return 'mainnet';
  }
  throw new BadRequestException(`unknown network "${String(network)}"`);
}

/**
 * Resolves the Blend deposit network (Lot A2). Same shape as resolveSwapNetwork but
 * gated by the deposit's OWN kill-switch (ACTIONS_MAINNET_BLEND_ENABLED), so the
 * deposit's mainnet rollout is independent of the swap:
 *   - absent / 'testnet' → testnet (today's behavior, byte-for-byte)
 *   - 'mainnet'          → 403 unless ACTIONS_MAINNET_BLEND_ENABLED === 'true'
 *   - anything else      → 400
 */
function resolveBlendNetwork(network: unknown): ActionNetwork {
  if (network == null || network === 'testnet') return 'testnet';
  if (network === 'mainnet') {
    if (!isMainnetBlendEnabled()) {
      throw new ForbiddenException('Mainnet Blend deposits are not enabled.');
    }
    return 'mainnet';
  }
  throw new BadRequestException(`unknown network "${String(network)}"`);
}

/**
 * Mainnet asset whitelist enforcement (INV-4.3). On testnet this is a no-op — assets
 * are vetted client-side. On mainnet the server rejects anything off its own list.
 */
function assertMainnetAsset(
  network: ActionNetwork,
  ref: AssetRef,
  label: string,
): void {
  if (network !== 'mainnet') return;
  if (!isWhitelistedMainnetAsset(ref)) {
    const name = ref.issuer ? `${ref.code}:${ref.issuer}` : ref.code;
    throw new BadRequestException(
      `${label}: asset ${name} is not on the mainnet whitelist (${MAINNET_ALLOWED_CODES})`,
    );
  }
}

@Controller('v1/actions')
export class ActionsController {
  constructor(
    private readonly actionsService: ActionsService,
    private readonly opsService: OpsService,
  ) {}

  @Post('blend/deposit')
  @HttpCode(HttpStatus.OK)
  async blendDeposit(@Body() body: BlendDepositBody) {
    const { address, asset, amount, network, pool } = body;

    // Lot A2 gating regime: mainnet requires the deposit's own kill-switch (403
    // otherwise); absent/'testnet' keeps today's behavior byte-for-byte.
    const resolvedNetwork = resolveBlendNetwork(network);
    if (!address || typeof address !== 'string') {
      throw new BadRequestException('address is required');
    }
    // Mainnet asset whitelist for the deposit = XLM | USDC only. The USDC/XLM guard
    // below already rejects anything else (e.g. EURC) with a 400 on both networks.
    if (!asset || !['USDC', 'XLM'].includes(asset)) {
      throw new BadRequestException('asset must be USDC or XLM');
    }
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      throw new BadRequestException('amount must be a positive numeric string');
    }
    // Mainnet per-transaction cap (reuses ACTIONS_MAINNET_MAX_SEND_XLM, default 100),
    // applied to the deposit amount whatever the asset. Testnet is uncapped.
    if (resolvedNetwork === 'mainnet') {
      const cap = mainnetMaxSendXlm();
      if (parsedAmount > cap) {
        throw new BadRequestException(
          `amount exceeds the mainnet per-transaction cap of ${cap} ${asset}`,
        );
      }
    }

    const result = await this.actionsService.buildBlendDeposit({
      address,
      asset,
      amount,
      network: resolvedNetwork,
      poolSlug: pool,
    });

    // E3 adoption counter — fire-and-forget (recordActionEvent never throws).
    // Three outcomes: trustline-only build (2-step gate), successful deposit
    // build, or failed simulation (empty xdr — nothing was built, no event).
    // R1 metadata: what was built (the service already resolved this slug, so
    // resolveBlendPool cannot throw here).
    const depositMeta = {
      venue: 'blend',
      pool: resolveBlendPool(resolvedNetwork, pool).poolSlug,
      asset,
      amount,
    };
    if (result.trustlineRequired) {
      void this.opsService.recordActionEvent('trustline-build', resolvedNetwork, address, {
        ...depositMeta,
        step: 'trustline',
      });
    } else if (result.xdr) {
      void this.opsService.recordActionEvent(
        'blend-deposit-build',
        resolvedNetwork,
        address,
        depositMeta,
      );
    }

    return result;
  }

  /**
   * Blend WITHDRAW of supplied collateral (Lot A3) — the mirror of blend/deposit.
   *
   * Rides the SAME kill-switch as the deposit (`ACTIONS_MAINNET_BLEND_ENABLED` via
   * resolveBlendNetwork): no new flag, and with the flags unset a mainnet withdraw
   * is a 403 exactly like a mainnet deposit.
   *
   * NO amount cap — deliberate, and the one place this endpoint differs from the
   * deposit. The mainnet cap exists to limit how much a user can commit INTO a
   * protocol during the launch period; a withdraw moves the user's own funds back
   * OUT to their own wallet, so capping it could strand a position larger than the
   * cap and would push the user off-app to unwind it. The amount is still bounded by
   * reality: Blend can only return what the position holds, and simulation failure
   * means no XDR is produced at all.
   */
  @Post('blend/withdraw')
  @HttpCode(HttpStatus.OK)
  async blendWithdraw(@Body() body: BlendWithdrawBody) {
    const { address, asset, amount, network, pool } = body;

    const resolvedNetwork = resolveBlendNetwork(network);
    if (!address || typeof address !== 'string') {
      throw new BadRequestException('address is required');
    }
    // Same asset whitelist as the deposit: you can only withdraw what this app can
    // supply. EURC and anything else is a 400 on both networks.
    if (!asset || !['USDC', 'XLM'].includes(asset)) {
      throw new BadRequestException('asset must be USDC or XLM');
    }
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      throw new BadRequestException('amount must be a positive numeric string');
    }

    const result = await this.actionsService.buildBlendWithdraw({
      address,
      asset,
      amount,
      network: resolvedNetwork,
      poolSlug: pool,
    });

    // E3 adoption counter — only when a signable XDR was actually produced
    // (a failed simulation returns an empty xdr and records nothing).
    if (result.xdr) {
      void this.opsService.recordActionEvent(
        'blend-withdraw-build',
        resolvedNetwork,
        address,
        {
          venue: 'blend',
          pool: resolveBlendPool(resolvedNetwork, pool).poolSlug,
          asset,
          amount,
        },
      );
    }

    return result;
  }

  /**
   * The acting wallet's CURRENT Blend position, read live from chain. Feeds the
   * withdraw pane's "you have X supplied" + Max. Same kill-switch as the deposit /
   * withdraw, so it contacts no mainnet endpoint while the flag is off.
   *
   * Read-only and non-authoritative: the signing gate compares the returned XDR
   * against the amount the USER typed and the client-side pool registry — never
   * against this response.
   */
  @Post('blend/position')
  @HttpCode(HttpStatus.OK)
  async blendPosition(@Body() body: BlendPositionBody) {
    const { address, network, pool } = body;

    const resolvedNetwork = resolveBlendNetwork(network);
    if (!address || typeof address !== 'string') {
      throw new BadRequestException('address is required');
    }

    return this.actionsService.getBlendPosition({
      address,
      network: resolvedNetwork,
      poolSlug: pool,
    });
  }

  @Post('sdex/quote')
  @HttpCode(HttpStatus.OK)
  async sdexQuote(@Body() body: SdexQuoteBody) {
    const { fromAsset, toAsset, amount, network } = body;

    const resolvedNetwork = resolveSwapNetwork(network);
    const from = normalizeAssetField(fromAsset, 'fromAsset');
    const to = normalizeAssetField(toAsset, 'toAsset');
    assertMainnetAsset(resolvedNetwork, from, 'fromAsset');
    assertMainnetAsset(resolvedNetwork, to, 'toAsset');
    if (sameAsset(from, to)) {
      throw new BadRequestException('fromAsset and toAsset must differ');
    }
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      throw new BadRequestException('amount must be a positive numeric string');
    }

    const result = await this.actionsService.quoteSdexSwap({
      fromAsset: from,
      toAsset: to,
      amount,
      network: resolvedNetwork,
    });

    // E3 adoption counter — quotes carry no acting address (null by design).
    void this.opsService.recordActionEvent('sdex-quote', resolvedNetwork, null, {
      venue: 'sdex',
      from: assetKey(from),
      to: assetKey(to),
      amount,
    });

    return result;
  }

  @Post('sdex/swap')
  @HttpCode(HttpStatus.OK)
  async sdexSwap(@Body() body: SdexSwapBody) {
    const { address, fromAsset, toAsset, amount, minReceive, network } = body;

    const resolvedNetwork = resolveSwapNetwork(network);
    if (!address || typeof address !== 'string') {
      throw new BadRequestException('address is required');
    }
    const from = normalizeAssetField(fromAsset, 'fromAsset');
    const to = normalizeAssetField(toAsset, 'toAsset');
    assertMainnetAsset(resolvedNetwork, from, 'fromAsset');
    assertMainnetAsset(resolvedNetwork, to, 'toAsset');
    if (sameAsset(from, to)) {
      throw new BadRequestException('fromAsset and toAsset must differ');
    }
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      throw new BadRequestException('amount must be a positive numeric string');
    }
    // Mainnet per-transaction send-amount cap (INV-4.2), enforced server-side.
    if (resolvedNetwork === 'mainnet') {
      const cap = mainnetMaxSendXlm();
      if (parsedAmount > cap) {
        throw new BadRequestException(
          `amount exceeds the mainnet per-transaction cap of ${cap} ${from.code}`,
        );
      }
    }
    const parsedMin = parseFloat(minReceive);
    if (!minReceive || isNaN(parsedMin) || parsedMin <= 0) {
      throw new BadRequestException('minReceive must be a positive numeric string');
    }

    const result = await this.actionsService.buildSdexSwap({
      address,
      fromAsset: from,
      toAsset: to,
      amount,
      minReceive,
      network: resolvedNetwork,
    });

    // E3 adoption counter — buildSdexSwap throws on failure, so reaching here
    // means a signable XDR was produced.
    void this.opsService.recordActionEvent('sdex-swap-build', resolvedNetwork, address, {
      venue: 'sdex',
      from: assetKey(from),
      to: assetKey(to),
      amount,
      minReceive,
    });

    return result;
  }
}
