
import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module.js';
import { TransactionModule } from '../transaction/transaction.module.js';

import { TransferService } from './transfer.service.js';

@Module({
  imports: [
    LedgerModule,
    TransactionModule,
  ],
  providers: [TransferService],
  exports: [TransferService],
})
export class TransferModule {}
