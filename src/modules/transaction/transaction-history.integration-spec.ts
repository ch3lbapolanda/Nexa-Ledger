
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
import {
  AccountNormalBalance,
  AccountStatus,
  AccountType,
  TransactionStatus,
  TransactionType,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';

import { AuditService } from '../audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { TransactionHistoryQueryDto } from './transaction-history-query.dto.js';
import { TransactionReversalService } from './transaction-reversal.service.js';
import { TransactionService } from './transaction.service.js';
import { TransferService } from '../transfer/transfer.service.js';

describe('Transaction history integration', () => {
  let prisma: PrismaService;
  let transactionService: TransactionService;
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
    const auditService = new AuditService();

    transactionService = new TransactionService(prisma);

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

  async function createWallet(label: string) {
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
        balance: 500_000n,
        status: AccountStatus.ACTIVE,
      },
    });

    accountIds.push(account.id);

    return { user, wallet, account };
  }

  async function createTransfer(
    sender: Awaited<ReturnType<typeof createWallet>>,
    receiver: Awaited<ReturnType<typeof createWallet>>,
    amount = 10_000n,
  ) {
    return transferService.create(sender.user.id, {
      receiverWalletId: receiver.wallet.id,
      amount,
      idempotencyKey: randomUUID(),
      description: 'Transaction history integration test',
    });
  }

  async function cleanupFixtures() {
    if (walletIds.length === 0) {
      return;
    }

    await prisma.transfer.deleteMany({
      where: {
        OR: [
          { senderWalletId: { in: walletIds } },
          { receiverWalletId: { in: walletIds } },
        ],
      },
    });

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

      // Delete reversal transactions before their original transactions.
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

  it('should allow admin to view all transactions', async () => {
    const alice = await createWallet('admin-alice');
    const bob = await createWallet('admin-bob');
    const charlie = await createWallet('admin-charlie');

    await createTransfer(alice, bob);
    await createTransfer(bob, charlie);
    await createTransfer(charlie, alice);

    const result = await transactionService.list(
      alice.user.id,
      UserRole.ADMIN,
      new TransactionHistoryQueryDto(),
    );

    expect(result.data).toHaveLength(3);
    expect(result.meta).toMatchObject({
      page: 1,
      limit: 10,
      total: 3,
      totalPages: 1,
    });
  });

  it('should include both incoming and outgoing transactions for a customer', async () => {
    const alice = await createWallet('scope-alice');
    const bob = await createWallet('scope-bob');
    const charlie = await createWallet('scope-charlie');

    const outgoing = await createTransfer(alice, bob);
    const incoming = await createTransfer(charlie, alice);
    await createTransfer(bob, charlie);

    const result = await transactionService.list(
      alice.user.id,
      UserRole.CUSTOMER,
      new TransactionHistoryQueryDto(),
    );

    expect(result.data).toHaveLength(2);

    const transactionIds = result.data.map(
      (transaction) => transaction.id,
    );

    expect(transactionIds).toContain(outgoing.transactionId);
    expect(transactionIds).toContain(incoming.transactionId);

    expect(result.meta.total).toBe(2);
  });

  it('should not expose transactions belonging to unrelated wallets', async () => {
    const alice = await createWallet('private-alice');
    const bob = await createWallet('private-bob');
    const charlie = await createWallet('private-charlie');
    const david = await createWallet('private-david');

    const visible = await createTransfer(alice, bob);
    const unrelated = await createTransfer(charlie, david);

    const result = await transactionService.list(
      alice.user.id,
      UserRole.CUSTOMER,
      new TransactionHistoryQueryDto(),
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(visible.transactionId);

    expect(
      result.data.some(
        (transaction) => transaction.id === unrelated.transactionId,
      ),
    ).toBe(false);
  });

  it('should apply transaction type and status filters', async () => {
    const alice = await createWallet('filter-alice');
    const bob = await createWallet('filter-bob');

    await createTransfer(alice, bob);

    const completedResult = await transactionService.list(
      alice.user.id,
      UserRole.CUSTOMER,
      {
        ...new TransactionHistoryQueryDto(),
        type: TransactionType.TRANSFER,
        status: TransactionStatus.COMPLETED,
      },
    );

    expect(completedResult.data).toHaveLength(1);
    expect(completedResult.data[0].type).toBe(
      TransactionType.TRANSFER,
    );
    expect(completedResult.data[0].status).toBe(
      TransactionStatus.COMPLETED,
    );

    const depositResult = await transactionService.list(
      alice.user.id,
      UserRole.CUSTOMER,
      {
        ...new TransactionHistoryQueryDto(),
        type: TransactionType.DEPOSIT,
      },
    );

    expect(depositResult.data).toHaveLength(0);
    expect(depositResult.meta.total).toBe(0);
  });

  it('should paginate transaction history correctly', async () => {
    const alice = await createWallet('pagination-alice');
    const bob = await createWallet('pagination-bob');

    await createTransfer(alice, bob);
    await createTransfer(alice, bob);
    await createTransfer(alice, bob);

    const firstPage = await transactionService.list(
      alice.user.id,
      UserRole.ADMIN,
      {
        ...new TransactionHistoryQueryDto(),
        page: 1,
        limit: 2,
      },
    );

    const secondPage = await transactionService.list(
      alice.user.id,
      UserRole.ADMIN,
      {
        ...new TransactionHistoryQueryDto(),
        page: 2,
        limit: 2,
      },
    );

    expect(firstPage.data).toHaveLength(2);
    expect(secondPage.data).toHaveLength(1);

    expect(firstPage.meta).toMatchObject({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });

    expect(secondPage.meta).toMatchObject({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
    });

    const firstIds = firstPage.data.map(
      (transaction) => transaction.id,
    );

    const secondIds = secondPage.data.map(
      (transaction) => transaction.id,
    );

    expect(
      firstIds.some((id) => secondIds.includes(id)),
    ).toBe(false);
  });

  it('should return empty history when customer has no wallet', async () => {
    const user = await prisma.user.create({
      data: {
        email: `no-wallet-${randomUUID()}@integration.test`,
        fullName: 'Customer Without Wallet',
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
      },
    });

    userIds.push(user.id);

    const result = await transactionService.list(
      user.id,
      UserRole.CUSTOMER,
      new TransactionHistoryQueryDto(),
    );

    expect(result.data).toHaveLength(0);
    expect(result.meta).toMatchObject({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  });

  it('should include original and reversal transactions in both customers history', async () => {
    const alice = await createWallet('reversal-history-alice');
    const bob = await createWallet('reversal-history-bob');

    const transfer = await createTransfer(alice, bob);

    const reversal = await reversalService.reverse({
      transactionId: transfer.transactionId,
      actorId: alice.user.id,
    });

    const aliceHistory = await transactionService.list(
      alice.user.id,
      UserRole.CUSTOMER,
      new TransactionHistoryQueryDto(),
    );

    const bobHistory = await transactionService.list(
      bob.user.id,
      UserRole.CUSTOMER,
      new TransactionHistoryQueryDto(),
    );

    for (const history of [aliceHistory, bobHistory]) {
      expect(history.data).toHaveLength(2);
      expect(history.meta.total).toBe(2);

      const originalTransaction = history.data.find(
        (transaction) => transaction.id === transfer.transactionId,
      );

      const reversalTransaction = history.data.find(
        (transaction) =>
          transaction.id === reversal.reversalTransaction.id,
      );

      expect(originalTransaction).toBeDefined();
      expect(originalTransaction?.status).toBe(
        TransactionStatus.REVERSED,
      );

      expect(reversalTransaction).toBeDefined();
      expect(reversalTransaction?.status).toBe(
        TransactionStatus.COMPLETED,
      );

      expect(reversalTransaction?.reversalOfId).toBe(
        transfer.transactionId,
      );
    }
  });
});

