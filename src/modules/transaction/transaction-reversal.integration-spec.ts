
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { PrismaService } from '../../database/prisma.service.js';

import { AuditService } from '../audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { TransactionService } from './transaction.service.js';
import { TransactionReversalService } from './transaction-reversal.service.js';
import { TransferService } from '../transfer/transfer.service.js';

import {
  AccountNormalBalance,
  AccountStatus,
  AccountType,
  JournalEntryStatus,
  JournalLineSide,
  TransactionStatus,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';

describe('TransactionReversalService integration', () => {
  let prisma: PrismaService;
  let transferService: TransferService;
  let reversalService: TransactionReversalService;

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

    if (
      parsedUrl.pathname.replace(/^\//, '') !==
      TEST_DATABASE_NAME
    ) {
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
    const auditService = new AuditService();

    transferService = new TransferService(
      prisma,
      ledgerService,
      transactionService,
      auditService,
    );

    reversalService = new TransactionReversalService(
      prisma,
      ledgerService,
      auditService,
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

  async function createTransfer(
    amount: bigint = 75_000n,
  ) {
    const sender = await createWallet(
      'reversal-sender',
      500_000n,
    );

    const receiver = await createWallet(
      'reversal-receiver',
      100_000n,
    );

    const transfer = await transferService.create(
      sender.user.id,
      {
        receiverWalletId: receiver.wallet.id,
        amount,
        idempotencyKey: randomUUID(),
        description: 'Integration reversal test',
      },
    );

    return {
      sender,
      receiver,
      transfer,
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
      ...new Set(
        journalLines.map((line) => line.journalEntryId),
      ),
    ];

    // Remove transfer records before their transactions.
    await prisma.transfer.deleteMany({
      where: {
        OR: [
          { senderWalletId: { in: walletIds } },
          { receiverWalletId: { in: walletIds } },
        ],
      },
    });

    if (journalIds.length > 0) {
      const transactions = await prisma.transaction.findMany({
        where: {
          journalEntryId: { in: journalIds },
        },
        select: {
          id: true,
          reversalOfId: true,
        },
      });

      const transactionIds = transactions.map(
        (transaction) => transaction.id,
      );

      // Delete reversal transactions first because of the
      // self-referencing reversalOfId foreign key.
      await prisma.transaction.deleteMany({
        where: {
          id: { in: transactionIds },
          reversalOfId: { not: null },
        },
      });

      await prisma.transaction.deleteMany({
        where: {
          id: { in: transactionIds },
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

    await prisma.auditLog.deleteMany({
      where: {
        actorId: { in: userIds },
      },
    });

    await prisma.account.deleteMany({
      where: {
        id: { in: accountIds },
      },
    });

    await prisma.wallet.deleteMany({
      where: {
        id: { in: walletIds },
      },
    });

    await prisma.user.deleteMany({
      where: {
        id: { in: userIds },
      },
    });

    walletIds.length = 0;
    accountIds.length = 0;
    userIds.length = 0;
  }

  afterEach(async () => {
    await cleanupFixtures();
  });

  it('should reverse a transfer and restore both wallet balances', async () => {
    const { sender, receiver, transfer } =
      await createTransfer();

    const result = await reversalService.reverse({
      transactionId: transfer.transactionId,
      actorId: sender.user.id,
    });

    expect(result.originalStatus).toBe(
      TransactionStatus.REVERSED,
    );

    expect(result.reversalTransaction.amount).toBe('75000');

    const senderAccount = await prisma.account.findUniqueOrThrow({
      where: { id: sender.account.id },
    });

    const receiverAccount = await prisma.account.findUniqueOrThrow({
      where: { id: receiver.account.id },
    });

    expect(senderAccount.balance).toBe(500_000n);
    expect(receiverAccount.balance).toBe(100_000n);

    const original = await prisma.transaction.findUniqueOrThrow({
      where: {
        id: transfer.transactionId,
      },
    });

    expect(original.status).toBe(
      TransactionStatus.REVERSED,
    );

    const reversal = await prisma.transaction.findUniqueOrThrow({
      where: {
        id: result.reversalTransaction.id,
      },
      include: {
        journalEntry: {
          include: {
            lines: true,
          },
        },
      },
    });

    expect(reversal.reversalOfId).toBe(original.id);

    expect(reversal.status).toBe(
      TransactionStatus.COMPLETED,
    );

    expect(reversal.journalEntry.status).toBe(
      JournalEntryStatus.POSTED,
    );

    expect(reversal.journalEntry.lines).toHaveLength(2);

    const reversalDebit = reversal.journalEntry.lines.find(
      (line) => line.side === JournalLineSide.DEBIT,
    );

    const reversalCredit = reversal.journalEntry.lines.find(
      (line) => line.side === JournalLineSide.CREDIT,
    );

    expect(reversalDebit?.accountId).toBe(receiver.account.id);
    expect(reversalCredit?.accountId).toBe(sender.account.id);

    expect(reversalDebit?.amount).toBe(75_000n);
    expect(reversalCredit?.amount).toBe(75_000n);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        actorId: sender.user.id,
        action: 'TRANSACTION_REVERSED',
        entityType: 'TRANSACTION',
        entityId: original.id,
      },
    });

    expect(auditLog).not.toBeNull();

    expect(auditLog?.metadata).toMatchObject({
      originalTransactionId: original.id,
      reversalTransactionId: reversal.id,
      amount: '75000',
      currency: 'IDR',
    });
  });

  it('should reject reversing an already reversed transaction', async () => {
    const { sender, transfer } = await createTransfer();

    await reversalService.reverse({
      transactionId: transfer.transactionId,
      actorId: sender.user.id,
    });

    await expect(
      reversalService.reverse({
        transactionId: transfer.transactionId,
        actorId: sender.user.id,
      }),
    ).rejects.toThrow();

    expect(
      await prisma.transaction.count({
        where: {
          reversalOfId: transfer.transactionId,
        },
      }),
    ).toBe(1);
  });

  it('should reject reversing a reversal transaction', async () => {
    const { sender, transfer } = await createTransfer();

    const result = await reversalService.reverse({
      transactionId: transfer.transactionId,
      actorId: sender.user.id,
    });

    await expect(
      reversalService.reverse({
        transactionId: result.reversalTransaction.id,
        actorId: sender.user.id,
      }),
    ).rejects.toThrow(
      'A reversal transaction cannot be reversed',
    );

    expect(
      await prisma.transaction.count({
        where: {
          reversalOfId: transfer.transactionId,
        },
      }),
    ).toBe(1);
  });

  it('should process concurrent reversal requests only once', async () => {
    const { sender, transfer } = await createTransfer();

    const results = await Promise.allSettled([
      reversalService.reverse({
        transactionId: transfer.transactionId,
        actorId: sender.user.id,
      }),
      reversalService.reverse({
        transactionId: transfer.transactionId,
        actorId: sender.user.id,
      }),
    ]);

    const successful = results.filter(
      (result) => result.status === 'fulfilled',
    );

    const failed = results.filter(
      (result) => result.status === 'rejected',
    );

    expect(successful).toHaveLength(1);
    expect(failed).toHaveLength(1);

    expect(
      await prisma.transaction.count({
        where: {
          reversalOfId: transfer.transactionId,
        },
      }),
    ).toBe(1);

    const senderAccount = await prisma.account.findUniqueOrThrow({
      where: { id: sender.account.id },
    });

    expect(senderAccount.balance).toBe(500_000n);
  });

  it('should rollback the entire reversal when audit insertion fails', async () => {
    const { sender, receiver, transfer } =
      await createTransfer();

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_reject_reversal_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'TRANSACTION_REVERSED' THEN
          RAISE EXCEPTION 'Forced reversal audit failure';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_reject_reversal_audit_trigger
      BEFORE INSERT ON audit_logs
      FOR EACH ROW
      EXECUTE FUNCTION test_reject_reversal_audit()
    `);

    try {
      await expect(
        reversalService.reverse({
          transactionId: transfer.transactionId,
          actorId: sender.user.id,
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS test_reject_reversal_audit_trigger
        ON audit_logs
      `);

      await prisma.$executeRawUnsafe(`
        DROP FUNCTION IF EXISTS test_reject_reversal_audit()
      `);
    }

    const senderAccount = await prisma.account.findUniqueOrThrow({
      where: { id: sender.account.id },
    });

    const receiverAccount = await prisma.account.findUniqueOrThrow({
      where: { id: receiver.account.id },
    });

    expect(senderAccount.balance).toBe(425_000n);
    expect(receiverAccount.balance).toBe(175_000n);

    const original = await prisma.transaction.findUniqueOrThrow({
      where: {
        id: transfer.transactionId,
      },
    });

    expect(original.status).toBe(
      TransactionStatus.COMPLETED,
    );

    expect(
      await prisma.transaction.count({
        where: {
          reversalOfId: transfer.transactionId,
        },
      }),
    ).toBe(0);

    expect(
      await prisma.auditLog.count({
        where: {
          actorId: sender.user.id,
          action: 'TRANSACTION_REVERSED',
        },
      }),
    ).toBe(0);
  });

  it('should rollback reversal when receiver has insufficient balance', async () => {
    const { sender, receiver, transfer } =
      await createTransfer();

    // Spend part of the receiver balance.
    const thirdParty = await createWallet(
      'reversal-third-party',
      0n,
    );

    await transferService.create(receiver.user.id, {
      receiverWalletId: thirdParty.wallet.id,
      amount: 150_000n,
      idempotencyKey: randomUUID(),
      description: 'Spend receiver funds',
    });

    // Receiver now has 25,000 IDR, less than the 75,000 IDR
    // needed to reverse the original transfer.
    await expect(
      reversalService.reverse({
        transactionId: transfer.transactionId,
        actorId: sender.user.id,
      }),
    ).rejects.toThrow();

    const senderAccount = await prisma.account.findUniqueOrThrow({
      where: { id: sender.account.id },
    });

    const receiverAccount = await prisma.account.findUniqueOrThrow({
      where: { id: receiver.account.id },
    });

    expect(senderAccount.balance).toBe(425_000n);
    expect(receiverAccount.balance).toBe(25_000n);

    const original = await prisma.transaction.findUniqueOrThrow({
      where: {
        id: transfer.transactionId,
      },
    });

    expect(original.status).toBe(
      TransactionStatus.COMPLETED,
    );

    expect(
      await prisma.transaction.count({
        where: {
          reversalOfId: transfer.transactionId,
        },
      }),
    ).toBe(0);
  });

  it('should reject a transaction that does not exist', async () => {
    const actor = await createWallet(
      'missing-transaction-actor',
      0n,
    );

    await expect(
      reversalService.reverse({
        transactionId: randomUUID(),
        actorId: actor.user.id,
      }),
    ).rejects.toThrow('Transaction not found');
  });
});
