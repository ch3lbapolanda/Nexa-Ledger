import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../authentication/authentication.module.js';

import { WalletController } from './wallet.controller.js';
import { WalletService } from './wallet.service.js';

@Module({
  imports: [AuthenticationModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}