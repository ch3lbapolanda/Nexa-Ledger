
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  JournalEntryStatus,
  Prisma,
  TransactionType,
} from '../../generated/prisma/client.js';

type TransactionClient = Prisma.TransactionClient;

export interface CreateTransactionInput {
  reference: string;
  type: TransactionType;
  amount: bigint;
  currency?: string;
  description: string;
  journalEntryId: string;
}

@Injectable()
export class TransactionService {
  async create(
    tx: TransactionClient,
    input: CreateTransactionInput,
  ) {
    this.validateInput(input);

    const journal = await tx.journalEntry.findUnique({
      where: { id: input.journalEntryId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!journal) {
      throw new NotFoundException('Journal entry not found');
    }

    if (journal.status !== JournalEntryStatus.POSTED) {
      throw new BadRequestException(
        'Transaction requires a posted journal entry',
      );
    }

    try {
      return await tx.transaction.create({
        data: {
          reference: input.reference.trim(),
          type: input.type,
          amount: input.amount,
          currency: input.currency ?? 'IDR',
          description: input.description.trim(),
          journalEntryId: input.journalEntryId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Transaction reference or journal entry already exists',
        );
      }

      throw error;
    }
  }

  async findById(id: string) {
    const transaction = await this.prismaTransactionFindById(id);

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return this.serialize(transaction);
  }

  async findByReference(reference: string) {
    const transaction = await this.prismaTransactionFindByReference(
      reference.trim(),
    );

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return this.serialize(transaction);
  }

  private async prismaTransactionFindById(id: string) {
    return this.prisma.transaction.findUnique({
      where: { id },
      include: {
        journalEntry: {
          include: {
            lines: true,
          },
        },
      },
    });
  }

  private async prismaTransactionFindByReference(
    reference: string,
  ) {
    return this.prisma.transaction.findUnique({
      where: { reference },
      include: {
        journalEntry: {
          include: {
            lines: true,
          },
        },
      },
    });
  }

  private serialize<T extends { amount: bigint }>(transaction: T) {
    return {
      ...transaction,
      amount: transaction.amount.toString(),
    };
  }

  private validateInput(input: CreateTransactionInput): void {
    if (!input.reference?.trim()) {
      throw new BadRequestException(
        'Transaction reference is required',
      );
    }

    if (input.reference.trim().length > 100) {
      throw new BadRequestException(
        'Transaction reference must not exceed 100 characters',
      );
    }

    if (!Object.values(TransactionType).includes(input.type)) {
      throw new BadRequestException('Invalid transaction type');
    }

    if (input.amount <= 0n) {
      throw new BadRequestException(
        'Transaction amount must be positive',
      );
    }

    if (
      input.currency !== undefined &&
      input.currency !== 'IDR'
    ) {
      throw new BadRequestException(
        'Only IDR currency is supported',
      );
    }

    if (!input.description?.trim()) {
      throw new BadRequestException(
        'Transaction description is required',
      );
    }

    if (input.description.trim().length > 255) {
      throw new BadRequestException(
        'Transaction description must not exceed 255 characters',
      );
    }

    if (!input.journalEntryId) {
      throw new BadRequestException(
        'Journal entry ID is required',
      );
    }
  }

  constructor(
    private readonly prisma: PrismaService,
  ) {}
}
