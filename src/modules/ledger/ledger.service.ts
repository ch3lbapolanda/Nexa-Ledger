
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  JournalEntryStatus,
  JournalLineSide,
  Prisma,
} from '../../generated/prisma/client.js';

type LedgerTransaction = Prisma.TransactionClient;

export interface CreateJournalLineInput {
  accountId: string;
  side: JournalLineSide;
  amount: bigint;
}

export interface CreateJournalInput {
  reference?: string;
  description: string;
  lines: CreateJournalLineInput[];
}

@Injectable()
export class LedgerService {
  async createDraft(
    tx: LedgerTransaction,
    input: CreateJournalInput,
  ) {
    this.validateInput(input);

    const accountIds: string[] = [
      ...new Set(input.lines.map((line) => line.accountId)),
    ];

    const accounts = await tx.account.findMany({
      where: {
        id: { in: accountIds },
        status: AccountStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (accounts.length !== accountIds.length) {
      throw new BadRequestException(
        'One or more accounts are invalid or inactive',
      );
    }

    try {
      return await tx.journalEntry.create({
        data: {
          reference: input.reference,
          description: input.description.trim(),
          lines: {
            create: input.lines.map((line) => ({
              accountId: line.accountId,
              side: line.side,
              amount: line.amount,
            })),
          },
        },
        include: { lines: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Journal reference already exists',
        );
      }

      throw error;
    }
  }

  async postJournal(
    tx: LedgerTransaction,
    journalEntryId: string,
  ) {
    // Lock journal first to prevent concurrent posting.
    const lockedJournal = await tx.$queryRaw<
      Array<{ id: string }>
    >`
      SELECT id
      FROM journal_entries
      WHERE id = ${journalEntryId}::uuid
      FOR UPDATE
    `;

    if (lockedJournal.length === 0) {
      throw new NotFoundException('Journal entry not found');
    }

    const journal = await tx.journalEntry.findUnique({
      where: { id: journalEntryId },
      include: {
        lines: {
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!journal) {
      throw new NotFoundException('Journal entry not found');
    }

    if (journal.status !== JournalEntryStatus.DRAFT) {
      throw new ConflictException(
        'Only draft journals can be posted',
      );
    }

    this.validateBalance(journal.lines);

    const accountIds: string[] = [
      ...new Set(journal.lines.map((line) => line.accountId)),
    ].sort();

    // Lock accounts in deterministic order.
    await tx.$queryRaw`
      SELECT id
      FROM accounts
      WHERE id IN (${Prisma.join(accountIds)})
      ORDER BY id
      FOR UPDATE
    `;

    const accounts = await tx.account.findMany({
      where: {
        id: { in: accountIds },
      },
      select: {
        id: true,
        normalBalance: true,
        balance: true,
        status: true,
      },
    });

    if (accounts.length !== accountIds.length) {
      throw new BadRequestException(
        'One or more journal accounts no longer exist',
      );
    }

    const accountMap = new Map(
      accounts.map((account) => [account.id, account]),
    );

    // Aggregate net balance changes per account.
    const balanceDeltas = new Map<string, bigint>();

    for (const line of journal.lines) {
      const account = accountMap.get(line.accountId);

      if (!account || account.status !== AccountStatus.ACTIVE) {
        throw new BadRequestException(
          'Journal contains an inactive account',
        );
      }

      const delta =
        line.side === account.normalBalance
          ? line.amount
          : -line.amount;

      balanceDeltas.set(
        account.id,
        (balanceDeltas.get(account.id) ?? 0n) + delta,
      );
    }

    // Validate final balance before writing anything.
    for (const [accountId, delta] of balanceDeltas) {
      const account = accountMap.get(accountId);

      if (!account) {
        throw new BadRequestException('Account not found');
      }

      if (account.balance + delta < 0n) {
        throw new BadRequestException(
          `Insufficient account balance: ${account.id}`,
        );
      }
    }

    // Update each account once.
    for (const [accountId, delta] of balanceDeltas) {
      if (delta === 0n) {
        continue;
      }

      await tx.account.update({
        where: { id: accountId },
        data: {
          balance: { increment: delta },
        },
      });
    }

    return tx.journalEntry.update({
      where: { id: journal.id },
      data: {
        status: JournalEntryStatus.POSTED,
        postedAt: new Date(),
      },
      include: { lines: true },
    });
  }

  private validateInput(input: CreateJournalInput): void {
    if (!input.description?.trim()) {
      throw new BadRequestException(
        'Journal description is required',
      );
    }

    if (input.description.trim().length > 255) {
      throw new BadRequestException(
        'Journal description must not exceed 255 characters',
      );
    }

    if (
      input.reference !== undefined &&
      (input.reference.trim().length === 0 ||
        input.reference.length > 100)
    ) {
      throw new BadRequestException(
        'Journal reference must contain 1-100 characters',
      );
    }

    if (!Array.isArray(input.lines) || input.lines.length < 2) {
      throw new BadRequestException(
        'Journal must contain at least two lines',
      );
    }

    for (const line of input.lines) {
      if (
        !line.accountId ||
        !Object.values(JournalLineSide).includes(line.side)
      ) {
        throw new BadRequestException(
          'Invalid journal line',
        );
      }

      if (line.amount <= 0n) {
        throw new BadRequestException(
          'Journal line amount must be positive',
        );
      }
    }
  }

  private validateBalance(
    lines: Array<{
      side: JournalLineSide;
      amount: bigint;
    }>,
  ): void {
    const debit = lines
      .filter((line) => line.side === JournalLineSide.DEBIT)
      .reduce((sum, line) => sum + line.amount, 0n);

    const credit = lines
      .filter((line) => line.side === JournalLineSide.CREDIT)
      .reduce((sum, line) => sum + line.amount, 0n);

    if (debit !== credit) {
      throw new BadRequestException(
        'Journal is not balanced',
      );
    }
  }
}

