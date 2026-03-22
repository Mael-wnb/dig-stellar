// apps/api/src/modules/wallets/wallets.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { WalletsService } from './wallets.service';

type CreateWalletBody = {
  userId?: string;
  chain?: string;
  address?: string;
  label?: string | null;
};

type SetPrimaryBody = {
  userId?: string;
};

type SetActiveBody = {
  userId?: string;
  isActive?: boolean;
};

@Controller('v1/wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post()
  createWallet(
    @Query('userId') queryUserId?: string,
    @Body() body?: CreateWalletBody
  ) {
    return this.walletsService.createWallet({
      userId: queryUserId ?? body?.userId,
      chain: body?.chain,
      address: body?.address,
      label: body?.label ?? null,
    });
  }

  @Get()
  getWallets(@Query('userId') userId?: string) {
    return this.walletsService.getWallets(userId);
  }

  @Get('overview')
  getWalletsOverview(@Query('userId') userId?: string) {
    return this.walletsService.getWalletsOverview(userId);
  }

  @Patch(':walletId/primary')
  setPrimaryWallet(
    @Param('walletId') walletId: string,
    @Query('userId') queryUserId?: string,
    @Body() body?: SetPrimaryBody
  ) {
    return this.walletsService.setPrimaryWallet({
      walletId,
      userId: queryUserId ?? body?.userId,
    });
  }

  @Patch(':walletId/active')
  setWalletActive(
    @Param('walletId') walletId: string,
    @Query('userId') queryUserId?: string,
    @Body() body?: SetActiveBody
  ) {
    return this.walletsService.setWalletActive({
      walletId,
      userId: queryUserId ?? body?.userId,
      isActive: body?.isActive,
    });
  }
}