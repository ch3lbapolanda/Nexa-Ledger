
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { TransactionModule } from '../transaction/transaction.module.js';

import { TransferService } from './transfer.service.js';

@Module({
  imports: [
    AuditModule,
    LedgerModule,
    TransactionModule,
  ],
  providers: [TransferService],
  exports: [TransferService],
})
export class TransferModule {}
