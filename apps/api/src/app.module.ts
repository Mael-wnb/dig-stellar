// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DbModule } from './db/db.module';
import { NetworkModule } from './modules/network/network.module';
import { StellarModule } from './modules/stellar/stellar.module';
import { WalletsModule } from './modules/wallets/wallets.module';

@Module({
  imports: [DbModule, StellarModule, WalletsModule, NetworkModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}