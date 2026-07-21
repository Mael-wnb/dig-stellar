import {
  Controller,
  Post,
  Body,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ActionsService, type AssetRef } from './actions.service';

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

@Controller('v1/actions')
export class ActionsController {
  constructor(private readonly actionsService: ActionsService) {}

  @Post('blend/deposit')
  @HttpCode(HttpStatus.OK)
  async blendDeposit(@Body() body: BlendDepositBody) {
    const { address, asset, amount, network } = body;

    if (network && network !== 'testnet') {
      throw new BadRequestException(
        'Only testnet is supported at this time. Pass network="testnet" or omit it.',
      );
    }
    if (!address || typeof address !== 'string') {
      throw new BadRequestException('address is required');
    }
    if (!asset || !['USDC', 'XLM'].includes(asset)) {
      throw new BadRequestException('asset must be USDC or XLM');
    }
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      throw new BadRequestException('amount must be a positive numeric string');
    }

    return this.actionsService.buildBlendDeposit({ address, asset, amount });
  }

  @Post('sdex/quote')
  @HttpCode(HttpStatus.OK)
  async sdexQuote(@Body() body: SdexQuoteBody) {
    const { fromAsset, toAsset, amount, network } = body;

    if (network && network !== 'testnet') {
      throw new BadRequestException(
        'Only testnet is supported at this time. Pass network="testnet" or omit it.',
      );
    }
    const from = normalizeAssetField(fromAsset, 'fromAsset');
    const to = normalizeAssetField(toAsset, 'toAsset');
    if (sameAsset(from, to)) {
      throw new BadRequestException('fromAsset and toAsset must differ');
    }
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      throw new BadRequestException('amount must be a positive numeric string');
    }

    return this.actionsService.quoteSdexSwap({ fromAsset: from, toAsset: to, amount });
  }

  @Post('sdex/swap')
  @HttpCode(HttpStatus.OK)
  async sdexSwap(@Body() body: SdexSwapBody) {
    const { address, fromAsset, toAsset, amount, minReceive, network } = body;

    if (network && network !== 'testnet') {
      throw new BadRequestException(
        'Only testnet is supported at this time. Pass network="testnet" or omit it.',
      );
    }
    if (!address || typeof address !== 'string') {
      throw new BadRequestException('address is required');
    }
    const from = normalizeAssetField(fromAsset, 'fromAsset');
    const to = normalizeAssetField(toAsset, 'toAsset');
    if (sameAsset(from, to)) {
      throw new BadRequestException('fromAsset and toAsset must differ');
    }
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      throw new BadRequestException('amount must be a positive numeric string');
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
    });
  }
}
