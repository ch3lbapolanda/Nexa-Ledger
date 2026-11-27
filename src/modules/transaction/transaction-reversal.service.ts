
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service.js';
import {
  JournalEntryStatus,
  JournalLineSide,
  Prisma,
  TransactionStatus,
} from '../../generated/prisma/client.js';

import { LedgerService } from '../ledger/ledger.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
} from '../audit/audit.constants.js';

export interface ReverseTransactionInput {
  transactionId: string;
  actorId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class TransactionReversalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly auditService: AuditService,
  ) {}

  async reverse(input: ReverseTransactionInput) {
    this.validateInput(input);

    try {
      return await this.prisma.$transaction(async (tx) => {
        return this.executeReversal(tx, input);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Transaction has already been reversed',
        );
      }

      throw error;
    }
  }

  private async executeReversal(
    tx: Prisma.TransactionClient,
    input: ReverseTransactionInput,
  ) {
    // Lock the original transaction to prevent concurrent reversals.
    const lockedTransactions = await tx.$queryRaw<
      Array<{ id: string }>
    >`
      SELECT id
      FROM financial_transactions
      WHERE id = ${input.transactionId}::uuid
      FOR UPDATE
    `;

    if (lockedTransactions.length === 0) {
      throw new NotFoundException('Transaction not found');
    }

    const original = await tx.transaction.findUnique({
      where: {
        id: input.transactionId,
      },
      include: {
        journalEntry: {
          include: {
            lines: {
              orderBy: {
                id: 'asc',
              },
            },
          },
        },
      },
    });

    if (!original) {
      throw new NotFoundException('Transaction not found');
    }

    if (original.reversalOfId !== null) {
      throw new BadRequestException(
        'A reversal transaction cannot be reversed',
      );
    }

    if (original.status === TransactionStatus.REVERSED) {
      throw new ConflictException(
        'Transaction has already been reversed',
      );
    }

    if (original.status !== TransactionStatus.COMPLETED) {
      throw new BadRequestException(
        'Only completed transactions can be reversed',
      );
    }

    if (
      original.journalEntry.status !== JournalEntryStatus.POSTED
    ) {
      throw new BadRequestException(
        'Original journal entry must be posted',
      );
    }

    if (original.journalEntry.lines.length < 2) {
      throw new BadRequestException(
        'Original journal entry is invalid',
      );
    }

    const reversalId = randomUUID();
    const reversalReference = `REV-${reversalId}`;
    const journalReference = `REV-JRN-${reversalId}`;

    const reversalDescription =
      `Reversal of ${original.reference}`.slice(0, 255);

    // Reverse every journal line without modifying the original.
    const reversalLines = original.journalEntry.lines.map(
      (line) => ({
        accountId: line.accountId,
        side:
          line.side === JournalLineSide.DEBIT
            ? JournalLineSide.CREDIT
            : JournalLineSide.DEBIT,
        amount: line.amount,
      }),
    );

    // Create the reversal journal.
    const reversalJournal = await this.ledgerService.createDraft(
      tx,
      {
        reference: journalReference,
        description: reversalDescription,
        lines: reversalLines,
      },
    );

    // Post the reversal journal through the ledger.
    const postedJournal = await this.ledgerService.postJournal(
      tx,
      reversalJournal.id,
    );

    // Create a separate reversal transaction.
    const reversalTransaction = await tx.transaction.create({
      data: {
        id: reversalId,
        reference: reversalReference,
        type: original.type,
        status: TransactionStatus.COMPLETED,
        amount: original.amount,
        currency: original.currency,
        description: reversalDescription,
        journalEntryId: postedJournal.id,
        reversalOfId: original.id,
      },
    });

    // Mark the original transaction as reversed.
    await tx.transaction.update({
      where: {
        id: original.id,
      },
      data: {
        status: TransactionStatus.REVERSED,
      },
    });

    // Write audit log in the same database transaction.
    await this.auditService.create(tx, {
      actorId: input.actorId,
      action: AUDIT_ACTIONS.TRANSACTION_REVERSED,
      entityType: AUDIT_ENTITY_TYPES.TRANSACTION,
      entityId: original.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: {
        originalTransactionId: original.id,
        originalReference: original.reference,
        reversalTransactionId: reversalTransaction.id,
        reversalReference: reversalTransaction.reference,
        originalJournalEntryId: original.journalEntryId,
        reversalJournalEntryId: postedJournal.id,
        amount: original.amount.toString(),
        currency: original.currency,
      },
    });

    return {
      originalTransactionId: original.id,
      originalReference: original.reference,
      originalStatus: TransactionStatus.REVERSED,
      reversalTransaction: {
        ...reversalTransaction,
        amount: reversalTransaction.amount.toString(),
      },
      reversalJournal: {
        ...postedJournal,
        lines: postedJournal.lines.map((line) => ({
          ...line,
          amount: line.amount.toString(),
        })),
      },
    };
  }

  private validateInput(input: ReverseTransactionInput): void {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (
      !input.transactionId ||
      !uuidRegex.test(input.transactionId)
    ) {
      throw new BadRequestException(
        'Valid transaction ID is required',
      );
    }

    if (
      !input.actorId ||
      !uuidRegex.test(input.actorId)
    ) {
      throw new BadRequestException(
        'Valid actor ID is required',
      );
    }

    if (
      input.ipAddress &&
      input.ipAddress.length > 45
    ) {
      throw new BadRequestException(
        'IP address must not exceed 45 characters',
      );
    }

    if (
      input.userAgent &&
      input.userAgent.length > 500
    ) {
      throw new BadRequestException(
        'User agent must not exceed 500 characters',
      );
    }
  }
}
