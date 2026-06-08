// apps/api/src/modules/network/network.module.ts
import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { NetworkController } from './network.controller';
import { NetworkService } from './network.service';

@Module({
  imports: [DbModule],
  controllers: [NetworkController],
  providers: [NetworkService],
})
export class NetworkModule {}