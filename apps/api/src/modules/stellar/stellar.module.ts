import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { StellarController } from './stellar.controller';
import { StellarService } from './stellar.service';

@Module({
  imports: [DbModule],
  controllers: [StellarController],
  providers: [StellarService],
})
export class StellarModule {}