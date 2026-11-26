import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module.js';
import { TransactionService } from './transaction.service.js';

@Module({
  imports: [LedgerModule],
  providers: [TransactionService],
  exports: [TransactionService],
})
export class TransactionModule {}