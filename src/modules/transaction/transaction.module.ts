
import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../authentication/authentication.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';

import { TransactionController } from './transaction.controller.js';
import { TransactionService } from './transaction.service.js';
import { TransactionReversalService } from './transaction-reversal.service.js';

@Module({
  imports: [
    AuthenticationModule,
    LedgerModule,
    AuditModule,
  ],
  controllers: [
    TransactionController,
  ],
  providers: [
    TransactionService,
    TransactionReversalService,
  ],
  exports: [
    TransactionService,
    TransactionReversalService,
  ],
})
export class TransactionModule {}
