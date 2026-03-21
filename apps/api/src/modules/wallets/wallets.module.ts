// apps/api/src/modules/wallets/wallets.module.ts
import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [DbModule],
  controllers: [WalletsController],
  providers: [WalletsService],
})
export class WalletsModule {}