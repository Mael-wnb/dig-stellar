import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { WalletsService } from './wallets.service';

type CreateWalletBody = {
  userId?: string;
  chain?: string;
  address?: string;
  label?: string | null;
};

type ConnectWalletBody = {
  // Session account id, sent by the client when one exists (W1). Present →
  // attach/promote inside THAT account only. Absent → signer-preferring
  // account recovery, else a fresh account.
  userId?: string;
  chain?: string;
  address?: string;
  label?: string | null;
};

type SetPrimaryBody = {
  userId?: string;
};

type SetSignerBody = {
  userId?: string;
};

type SetActiveBody = {
  userId?: string;
  isActive?: boolean;
};

type RefreshWalletBody = {
  userId?: string;
};

type UpdateWalletBody = {
  userId?: string;
  label?: string | null;
};

@Controller('v1/wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post('connect')
  connectWallet(@Body() body?: ConnectWalletBody) {
    return this.walletsService.connectWallet({
      userId: body?.userId,
      chain: body?.chain,
      address: body?.address,
      label: body?.label ?? null,
    });
  }

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

  @Get(':walletId/balances')
  getWalletBalances(
    @Param('walletId') walletId: string,
    @Query('userId') userId?: string
  ) {
    return this.walletsService.getWalletBalances({
      walletId,
      userId,
    });
  }

  @Get(':walletId/positions')
  getWalletPositions(
    @Param('walletId') walletId: string,
    @Query('userId') userId?: string
  ) {
    return this.walletsService.getWalletPositions({
      walletId,
      userId,
    });
  }

  @Post(':walletId/refresh')
  refreshWallet(
    @Param('walletId') walletId: string,
    @Query('userId') queryUserId?: string,
    @Body() body?: RefreshWalletBody
  ) {
    return this.walletsService.refreshWallet({
      walletId,
      userId: queryUserId ?? body?.userId,
    });
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

  @Patch(':walletId/signer')
  setActiveSigner(
    @Param('walletId') walletId: string,
    @Query('userId') queryUserId?: string,
    @Body() body?: SetSignerBody
  ) {
    return this.walletsService.setActiveSigner({
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

  // W2 — label-only update (rename). Same auth pattern as the other wallet
  // ops: userId scoping, ownership enforced in the service WHERE clause.
  @Patch(':walletId')
  updateWallet(
    @Param('walletId') walletId: string,
    @Query('userId') queryUserId?: string,
    @Body() body?: UpdateWalletBody
  ) {
    return this.walletsService.updateWalletLabel({
      walletId,
      userId: queryUserId ?? body?.userId,
      label: body?.label ?? null,
    });
  }

  @Delete(':walletId')
  deleteWallet(
    @Param('walletId') walletId: string,
    @Query('userId') queryUserId?: string,
    @Body() body?: { userId?: string }
  ) {
    return this.walletsService.deleteWallet({
      walletId,
      userId: queryUserId ?? body?.userId,
    });
  }
}