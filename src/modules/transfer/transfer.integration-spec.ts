
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../../database/prisma.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { TransactionService } from '../transaction/transaction.service.js';
import { TransferService } from './transfer.service.js';

import {
  AccountNormalBalance,
  AccountStatus,
  AccountType,
  JournalEntryStatus,
  Prisma,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';

describe('TransferService integration', () => {
  let prisma: PrismaService;
  let transferService: TransferService;

  const userIds: string[] = [];
  const walletIds: string[] = [];
  const accountIds: string[] = [];

  const TEST_DATABASE_NAME = 'nexa_ledger_test';

  beforeAll(async () => {
    const databaseUrl = process.env['TEST_DATABASE_URL'];

    if (!databaseUrl) {
      throw new Error('TEST_DATABASE_URL is required');
    }

    const parsedUrl = new URL(databaseUrl);

    if (parsedUrl.pathname.replace(/^\//, '') !== TEST_DATABASE_NAME) {
      throw new Error(
        `Integration tests must use ${TEST_DATABASE_NAME}`,
      );
    }

    const connectionString = databaseUrl.split('?')[0];

    const config = {
      getOrThrow: () => connectionString,
    } as unknown as ConfigService;

    prisma = new PrismaService(config);
    await prisma.$connect();

    const ledgerService = new LedgerService();
    const transactionService = new TransactionService(prisma);

    transferService = new TransferService(
      prisma,
      ledgerService,
      transactionService,
    );
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  async function createWallet(
    label: string,
    balance: bigint,
  ) {
    const user = await prisma.user.create({
      data: {
        email: `${label}-${randomUUID()}@integration.test`,
        fullName: `Integration ${label}`,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
      },
    });

    userIds.push(user.id);

    const wallet = await prisma.wallet.create({
      data: {
        userId: user.id,
        currency: 'IDR',
      },
    });

    walletIds.push(wallet.id);

    const account = await prisma.account.create({
      data: {
        walletId: wallet.id,
        code: `TEST-${randomUUID()}`,
        name: `Integration ${label}`,
        type: AccountType.LIABILITY,
        normalBalance: AccountNormalBalance.CREDIT,
        balance,
        status: AccountStatus.ACTIVE,
      },
    });

    accountIds.push(account.id);

    return {
      user,
      wallet,
      account,
    };
  }

  async function cleanupFixtures() {
    if (walletIds.length === 0) {
      return;
    }

    const journalLines = await prisma.journalLine.findMany({
      where: {
        accountId: { in: accountIds },
      },
      select: {
        journalEntryId: true,
      },
    });

    const journalIds = [
      ...new Set(journalLines.map((line) => line.journalEntryId)),
    ];

    await prisma.transfer.deleteMany({
      where: {
        senderWalletId: { in: walletIds },
      },
    });

    if (journalIds.length > 0) {
      await prisma.transaction.deleteMany({
        where: {
          journalEntryId: { in: journalIds },
        },
      });

      await prisma.journalLine.deleteMany({
        where: {
          journalEntryId: { in: journalIds },
        },
      });

      await prisma.journalEntry.deleteMany({
        where: {
          id: { in: journalIds },
        },
      });
    }

    await prisma.account.deleteMany({
      where: { id: { in: accountIds } },
    });

    await prisma.wallet.deleteMany({
      where: { id: { in: walletIds } },
    });

    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });

    walletIds.length = 0;
    accountIds.length = 0;
    userIds.length = 0;
  }

  afterEach(async () => {
    await cleanupFixtures();
  });

  it('should transfer funds and post a balanced journal', async () => {
    const sender = await createWallet('sender', 500_000n);
    const receiver = await createWallet('receiver', 100_000n);

    const result = await transferService.create(sender.user.id, {
      receiverWalletId: receiver.wallet.id,
      amount: 75_000n,
      idempotencyKey: randomUUID(),
      description: 'Integration test transfer',
    });

    expect(result.transaction.amount).toBe('75000');

    const senderAccount = await prisma.account.findUniqueOrThrow({
      where: { id: sender.account.id },
    });

    const receiverAccount = await prisma.account.findUniqueOrThrow({
      where: { id: receiver.account.id },
    });

    expect(senderAccount.balance).toBe(425_000n);
    expect(receiverAccount.balance).toBe(175_000n);

    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { id: result.transactionId },
      include: {
        journalEntry: {
          include: { lines: true },
        },
      },
    });

    expect(transaction.journalEntry.status).toBe(
      JournalEntryStatus.POSTED,
    );

    expect(transaction.journalEntry.lines).toHaveLength(2);

    const debit = transaction.journalEntry.lines.find(
      (line) => line.side === 'DEBIT',
    );

    const credit = transaction.journalEntry.lines.find(
      (line) => line.side === 'CREDIT',
    );

    expect(debit?.amount).toBe(75_000n);
    expect(credit?.amount).toBe(75_000n);

    expect(
      await prisma.transfer.count({
        where: { transactionId: transaction.id },
      }),
    ).toBe(1);
  });

  it('should reject insufficient balance without persisting a journal', async () => {
    const sender = await createWallet('poor-sender', 20_000n);
    const receiver = await createWallet('receiver', 100_000n);

    await expect(
      transferService.create(sender.user.id, {
        receiverWalletId: receiver.wallet.id,
        amount: 50_000n,
        idempotencyKey: randomUUID(),
        description: 'Insufficient balance test',
      }),
    ).rejects.toThrow();

    const senderAccount = await prisma.account.findUniqueOrThrow({
      where: { id: sender.account.id },
    });

    expect(senderAccount.balance).toBe(20_000n);

    expect(
      await prisma.journalLine.count({
        where: {
          accountId: {
            in: [sender.account.id, receiver.account.id],
          },
        },
      }),
    ).toBe(0);

    expect(
      await prisma.transfer.count({
        where: { senderWalletId: sender.wallet.id },
      }),
    ).toBe(0);
  });

  it('should return the existing transfer for an identical idempotent request', async () => {
    const sender = await createWallet('idempotent-sender', 500_000n);
    const receiver = await createWallet('idempotent-receiver', 100_000n);

    const input = {
      receiverWalletId: receiver.wallet.id,
      amount: 50_000n,
      idempotencyKey: randomUUID(),
      description: 'Idempotency test',
    };

    const first = await transferService.create(sender.user.id, input);
    const second = await transferService.create(sender.user.id, input);

    expect(second.id).toBe(first.id);

    const senderAccount = await prisma.account.findUniqueOrThrow({
      where: { id: sender.account.id },
    });

    expect(senderAccount.balance).toBe(450_000n);

    expect(
      await prisma.transfer.count({
        where: { senderWalletId: sender.wallet.id },
      }),
    ).toBe(1);
  });

  it('should rollback all changes when transfer insertion fails', async () => {
    const sender = await createWallet('rollback-sender', 500_000n);
    const receiver = await createWallet('rollback-receiver', 100_000n);

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_reject_transfer_insert()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Forced integration test failure';
      END;
      $$ LANGUAGE plpgsql
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_reject_transfer_insert_trigger
      BEFORE INSERT ON transfers
      FOR EACH ROW
      EXECUTE FUNCTION test_reject_transfer_insert()
    `);

    try {
      await expect(
        transferService.create(sender.user.id, {
          receiverWalletId: receiver.wallet.id,
          amount: 75_000n,
          idempotencyKey: randomUUID(),
          description: 'Rollback test',
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS test_reject_transfer_insert_trigger
        ON transfers
      `);

      await prisma.$executeRawUnsafe(`
        DROP FUNCTION IF EXISTS test_reject_transfer_insert()
      `);
    }

    const senderAccount = await prisma.account.findUniqueOrThrow({
      where: { id: sender.account.id },
    });

    const receiverAccount = await prisma.account.findUniqueOrThrow({
      where: { id: receiver.account.id },
    });

    expect(senderAccount.balance).toBe(500_000n);
    expect(receiverAccount.balance).toBe(100_000n);

    expect(
      await prisma.journalLine.count({
        where: {
          accountId: {
            in: [sender.account.id, receiver.account.id],
          },
        },
      }),
    ).toBe(0);

    expect(
      await prisma.transfer.count({
        where: { senderWalletId: sender.wallet.id },
      }),
    ).toBe(0);
  });
});
