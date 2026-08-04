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
import {
  type ActionNetwork,
  isMainnetEnabled,
  isMainnetBlendEnabled,
  mainnetMaxSendXlm,
  isWhitelistedMainnetAsset,
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
  constructor(private readonly actionsService: ActionsService) {}

  @Post('blend/deposit')
  @HttpCode(HttpStatus.OK)
  async blendDeposit(@Body() body: BlendDepositBody) {
    const { address, asset, amount, network } = body;

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

    return this.actionsService.buildBlendDeposit({
      address,
      asset,
      amount,
      network: resolvedNetwork,
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

    return this.actionsService.quoteSdexSwap({
      fromAsset: from,
      toAsset: to,
      amount,
      network: resolvedNetwork,
    });
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

    return this.actionsService.buildSdexSwap({
      address,
      fromAsset: from,
      toAsset: to,
      amount,
      minReceive,
      network: resolvedNetwork,
    });
  }
}
