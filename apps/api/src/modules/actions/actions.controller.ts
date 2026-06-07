import {
  Controller,
  Post,
  Body,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ActionsService } from './actions.service';

interface BlendDepositBody {
  address: string;
  asset: 'USDC' | 'XLM';
  amount: string;
  network?: string;
}

interface SdexSwapBody {
  address: string;
  fromAsset: 'XLM' | 'USDC';
  toAsset: 'XLM' | 'USDC';
  amount: string;
  minReceive: string;
  network?: string;
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
    if (!fromAsset || !['XLM', 'USDC'].includes(fromAsset)) {
      throw new BadRequestException('fromAsset must be XLM or USDC');
    }
    if (!toAsset || !['XLM', 'USDC'].includes(toAsset)) {
      throw new BadRequestException('toAsset must be XLM or USDC');
    }
    if (fromAsset === toAsset) {
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
      fromAsset,
      toAsset,
      amount,
      minReceive,
    });
  }
}
