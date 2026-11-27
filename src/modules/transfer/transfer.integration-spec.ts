
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
import { TransactionService } from '../transaction/transaction.service.js';
import { TransferService } from './transfer.service.js';

import {
  AccountNormalBalance,
  AccountStatus,
  AccountType,
  JournalEntryStatus,
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
      ...new Set(
        journalLines.map((line) => line.journalEntryId),
      ),
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

  it('should transfer funds, post a balanced journal and create audit log', async () => {
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
          include: {
            lines: true,
          },
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
        where: {
          transactionId: transaction.id,
        },
      }),
    ).toBe(1);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        actorId: sender.user.id,
        action: 'TRANSFER_COMPLETED',
        entityType: 'TRANSFER',
        entityId: result.id,
      },
    });

    expect(auditLog).not.toBeNull();

    expect(auditLog?.metadata).toMatchObject({
      transactionId: transaction.id,
      senderWalletId: sender.wallet.id,
      receiverWalletId: receiver.wallet.id,
      amount: '75000',
      currency: 'IDR',
    });
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
            in: [
              sender.account.id,
              receiver.account.id,
            ],
          },
        },
      }),
    ).toBe(0);

    expect(
      await prisma.transfer.count({
        where: {
          senderWalletId: sender.wallet.id,
        },
      }),
    ).toBe(0);

    expect(
      await prisma.auditLog.count({
        where: {
          actorId: sender.user.id,
          action: 'TRANSFER_COMPLETED',
        },
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
        where: {
          senderWalletId: sender.wallet.id,
        },
      }),
    ).toBe(1);

    expect(
      await prisma.auditLog.count({
        where: {
          actorId: sender.user.id,
          action: 'TRANSFER_COMPLETED',
          entityId: first.id,
        },
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
            in: [
              sender.account.id,
              receiver.account.id,
            ],
          },
        },
      }),
    ).toBe(0);

    expect(
      await prisma.transfer.count({
        where: {
          senderWalletId: sender.wallet.id,
        },
      }),
    ).toBe(0);
  });

  it('should rollback the entire transfer when audit insertion fails', async () => {
    const sender = await createWallet('audit-rollback-sender', 500_000n);
    const receiver = await createWallet('audit-rollback-receiver', 100_000n);

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_reject_audit_insert()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Forced audit insertion failure';
      END;
      $$ LANGUAGE plpgsql
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_reject_audit_insert_trigger
      BEFORE INSERT ON audit_logs
      FOR EACH ROW
      EXECUTE FUNCTION test_reject_audit_insert()
    `);

    try {
      await expect(
        transferService.create(sender.user.id, {
          receiverWalletId: receiver.wallet.id,
          amount: 75_000n,
          idempotencyKey: randomUUID(),
          description: 'Audit rollback test',
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS test_reject_audit_insert_trigger
        ON audit_logs
      `);

      await prisma.$executeRawUnsafe(`
        DROP FUNCTION IF EXISTS test_reject_audit_insert()
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
            in: [
              sender.account.id,
              receiver.account.id,
            ],
          },
        },
      }),
    ).toBe(0);

    expect(
      await prisma.transfer.count({
        where: {
          senderWalletId: sender.wallet.id,
        },
      }),
    ).toBe(0);

    expect(
      await prisma.auditLog.count({
        where: {
          actorId: sender.user.id,
          action: 'TRANSFER_COMPLETED',
        },
      }),
    ).toBe(0);
  });

  it('should prevent double spending during concurrent transfers', async () => {
    const sender = await createWallet('concurrent-sender', 100_000n);
    const receiverA = await createWallet('concurrent-receiver-a', 0n);
    const receiverB = await createWallet('concurrent-receiver-b', 0n);

    const results = await Promise.allSettled([
      transferService.create(sender.user.id, {
        receiverWalletId: receiverA.wallet.id,
        amount: 80_000n,
        idempotencyKey: randomUUID(),
        description: 'Concurrent transfer A',
      }),
      transferService.create(sender.user.id, {
        receiverWalletId: receiverB.wallet.id,
        amount: 80_000n,
        idempotencyKey: randomUUID(),
        description: 'Concurrent transfer B',
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

    const senderAccount = await prisma.account.findUniqueOrThrow({
      where: { id: sender.account.id },
    });

    const receiverAAccount = await prisma.account.findUniqueOrThrow({
      where: { id: receiverA.account.id },
    });

    const receiverBAccount = await prisma.account.findUniqueOrThrow({
      where: { id: receiverB.account.id },
    });

    expect(senderAccount.balance).toBe(20_000n);

    expect(
      receiverAAccount.balance + receiverBAccount.balance,
    ).toBe(80_000n);

    expect(
      await prisma.transfer.count({
        where: {
          senderWalletId: sender.wallet.id,
        },
      }),
    ).toBe(1);
  });

  it('should process concurrent identical idempotent requests only once', async () => {
    const sender = await createWallet('concurrent-idem-sender', 500_000n);
    const receiver = await createWallet('concurrent-idem-receiver', 0n);

    const input = {
      receiverWalletId: receiver.wallet.id,
      amount: 75_000n,
      idempotencyKey: randomUUID(),
      description: 'Concurrent idempotency test',
    };

    const results = await Promise.all([
      transferService.create(sender.user.id, input),
      transferService.create(sender.user.id, input),
    ]);

    expect(results[0].id).toBe(results[1].id);

    const senderAccount = await prisma.account.findUniqueOrThrow({
      where: { id: sender.account.id },
    });

    const receiverAccount = await prisma.account.findUniqueOrThrow({
      where: { id: receiver.account.id },
    });

    expect(senderAccount.balance).toBe(425_000n);
    expect(receiverAccount.balance).toBe(75_000n);

    expect(
      await prisma.transfer.count({
        where: {
          senderWalletId: sender.wallet.id,
        },
      }),
    ).toBe(1);

    expect(
      await prisma.auditLog.count({
        where: {
          actorId: sender.user.id,
          action: 'TRANSFER_COMPLETED',
        },
      }),
    ).toBe(1);
  });

  it('should normalize idempotency key before storing it', async () => {
    const sender = await createWallet(
      'normalize-sender',
      500_000n,
    );

    const receiver = await createWallet(
      'normalize-receiver',
      100_000n,
    );

    const input = {
      receiverWalletId: receiver.wallet.id,
      amount: 10_000n,
      idempotencyKey: '  transfer-normalize-001  ',
      description: '  Test normalization  ',
    };

    const first = await transferService.create(
      sender.user.id,
      input,
    );

    const second = await transferService.create(
      sender.user.id,
      {
        ...input,
        idempotencyKey: 'transfer-normalize-001',
        description: 'Test normalization',
      },
    );

    expect(first.id).toBe(second.id);

    const stored = await prisma.transfer.findUnique({
      where: {
        senderWalletId_idempotencyKey: {
          senderWalletId: sender.wallet.id,
          idempotencyKey: 'transfer-normalize-001',
        },
      },
    });

    expect(stored).not.toBeNull();
    expect(stored?.idempotencyKey).toBe(
      'transfer-normalize-001',
    );

    const senderAccount = await prisma.account.findUniqueOrThrow({
      where: { id: sender.account.id },
    });

    expect(senderAccount.balance).toBe(490_000n);
  });
});

