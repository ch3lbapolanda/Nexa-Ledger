
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
import { AccountService } from './account.service.js';

import {
  AccountNormalBalance,
  AccountStatus,
  AccountType,
  JournalEntryStatus,
  JournalLineSide,
} from '../../generated/prisma/client.js';

import { LedgerService } from '../ledger/ledger.service.js';

describe('AccountService integration', () => {
  let ledgerService: LedgerService;
  const journalEntryIds: string[] = [];
  let prisma: PrismaService;
  let accountService: AccountService;
  function createBarrier() {
  let release!: () => void;
  let signal!: () => void;

  function createBarrier() {
  let release!: () => void;
  let signal!: () => void;

  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });

  const reached = new Promise<void>((resolve) => {
    signal = resolve;
  });

  return { waiting, reached, release, signal };
    }

  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });

  const reached = new Promise<void>((resolve) => {
    signal = resolve;
  });

  return { waiting, reached, release, signal };
  }

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

    accountService = new AccountService(prisma);
    ledgerService = new LedgerService();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  async function createAccount(balance = 0n) {
    const account = await prisma.account.create({
      data: {
        code: `TEST-${randomUUID()}`,
        name: 'Integration Test Account',
        type: AccountType.ASSET,
        normalBalance: AccountNormalBalance.DEBIT,
        balance,
        status: AccountStatus.ACTIVE,
      },
    });

    accountIds.push(account.id);

    return account;
  }

  async function createDraftJournal(
  debitAccountId: string,
  creditAccountId: string,
) {
  const journal = await prisma.$transaction((tx) =>
    ledgerService.createDraft(tx, {
      reference: `CONCURRENCY-${randomUUID()}`,
      description: 'Account ledger concurrency test',
      lines: [
        {
          accountId: debitAccountId,
          side: JournalLineSide.DEBIT,
          amount: 100n,
        },
        {
          accountId: creditAccountId,
          side: JournalLineSide.CREDIT,
          amount: 100n,
        },
      ],
    }),
  );

  journalEntryIds.push(journal.id);

  return journal;
  }

  async function cleanupFixtures() {
  if (journalEntryIds.length > 0) {
    await prisma.journalLine.deleteMany({
      where: {
        journalEntryId: { in: journalEntryIds },
      },
    });

    await prisma.journalEntry.deleteMany({
      where: {
        id: { in: journalEntryIds },
      },
    });

    journalEntryIds.length = 0;
  }

  if (accountIds.length > 0) {
    await prisma.account.deleteMany({
      where: {
        id: { in: accountIds },
      },
    });

    accountIds.length = 0;
  }
  }

  afterEach(async () => {
    await cleanupFixtures();
  });

  describe('createSystemAccount', () => {
    it('should create a system account in PostgreSQL', async () => {
      const result = await accountService.createSystemAccount({
        code: `SYSTEM-${randomUUID()}`,
        name: 'Cash Account',
        type: AccountType.ASSET,
        normalBalance: AccountNormalBalance.DEBIT,
      });

      accountIds.push(result.id);

      const persisted = await prisma.account.findUniqueOrThrow({
        where: { id: result.id },
      });

      expect(persisted.code).toBe(result.code);
      expect(persisted.name).toBe('Cash Account');
      expect(persisted.type).toBe(AccountType.ASSET);
      expect(persisted.normalBalance).toBe(
        AccountNormalBalance.DEBIT,
      );
      expect(persisted.balance).toBe(0n);
      expect(persisted.walletId).toBeNull();
    });

    it('should reject duplicate account code', async () => {
      const code = `DUPLICATE-${randomUUID()}`;

      const input = {
        code,
        name: 'First Account',
        type: AccountType.ASSET,
        normalBalance: AccountNormalBalance.DEBIT,
      };

      const first = await accountService.createSystemAccount(input);
      accountIds.push(first.id);

      await expect(
        accountService.createSystemAccount({
          ...input,
          name: 'Second Account',
        }),
      ).rejects.toThrow('Account code already exists');

      expect(
        await prisma.account.count({
          where: { code },
        }),
      ).toBe(1);
    });
  });

  describe('findAll', () => {
    it('should return persisted accounts with serialized balances', async () => {
      const account = await createAccount(9007199254740993n);

      const result = await accountService.findAll({
        type: AccountType.ASSET,
      });

      const found = result.find(
        (item) => item.id === account.id,
      );

      expect(found).toBeDefined();
      expect(found?.balance).toBe('9007199254740993');
      expect(typeof found?.balance).toBe('string');
    });

    it('should filter accounts by status', async () => {
      const active = await createAccount();

      const frozen = await prisma.account.create({
        data: {
          code: `TEST-${randomUUID()}`,
          name: 'Frozen Account',
          type: AccountType.ASSET,
          normalBalance: AccountNormalBalance.DEBIT,
          status: AccountStatus.FROZEN,
        },
      });

      accountIds.push(frozen.id);

      const result = await accountService.findAll({
        status: AccountStatus.FROZEN,
      });

      expect(
        result.some((item) => item.id === frozen.id),
      ).toBe(true);

      expect(
        result.some((item) => item.id === active.id),
      ).toBe(false);
    });
  });

  it('should reject journal posting when account is frozen first', async () => {
  const debitAccount = await createAccount(1_000n);
  const creditAccount = await createAccount(1_000n);

  const journal = await createDraftJournal(
    debitAccount.id,
    creditAccount.id,
  );

  const barrier = createBarrier();

  const freezeTransaction = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM accounts
      WHERE id = ${debitAccount.id}::uuid
      FOR UPDATE
    `;

    await tx.account.update({
      where: { id: debitAccount.id },
      data: { status: AccountStatus.FROZEN },
    });

    barrier.signal();
    await barrier.waiting;
  });

  await barrier.reached;

  const postingTransaction = prisma.$transaction((tx) =>
    ledgerService.postJournal(tx, journal.id),
  );

  barrier.release();

  await freezeTransaction;

  await expect(postingTransaction).rejects.toThrow(
    'Journal contains an inactive account',
  );

  const persistedAccount = await prisma.account.findUniqueOrThrow({
    where: { id: debitAccount.id },
  });

  const persistedJournal = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: journal.id },
  });

  expect(persistedAccount.status).toBe(AccountStatus.FROZEN);
  expect(persistedAccount.balance).toBe(1_000n);
  expect(persistedJournal.status).toBe(JournalEntryStatus.DRAFT);
});

  it('should preserve posted balance when posting completes before freeze', async () => {
  const debitAccount = await createAccount(1_000n);
  const creditAccount = await createAccount(1_000n);

  const journal = await createDraftJournal(
    debitAccount.id,
    creditAccount.id,
  );

  const barrier = createBarrier();

  const postingTransaction = prisma.$transaction(async (tx) => {
    const result = await ledgerService.postJournal(tx, journal.id);

    barrier.signal();
    await barrier.waiting;

    return result;
  });

  await barrier.reached;

  const freezeTransaction = accountService.updateStatus(
    debitAccount.id,
    AccountStatus.FROZEN,
  );

  barrier.release();

  await postingTransaction;
  await freezeTransaction;

  const persistedAccount = await prisma.account.findUniqueOrThrow({
    where: { id: debitAccount.id },
  });

  const persistedJournal = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: journal.id },
  });

  expect(persistedAccount.status).toBe(AccountStatus.FROZEN);
  expect(persistedAccount.balance).toBe(1_100n);
  expect(persistedJournal.status).toBe(JournalEntryStatus.POSTED);
});

  describe('findById', () => {
    it('should retrieve an existing account', async () => {
      const account = await createAccount(250000n);

      const result = await accountService.findById(account.id);

      expect(result.id).toBe(account.id);
      expect(result.balance).toBe('250000');
    });

    it('should reject an unknown account ID', async () => {
      await expect(
        accountService.findById(randomUUID()),
      ).rejects.toThrow('Account not found');
    });
  });

  describe('updateMetadata', () => {
    it('should update account name without changing financial data', async () => {
      const account = await createAccount(500000n);

      const result = await accountService.updateMetadata(
        account.id,
        {
          name: 'Updated Cash Account',
        },
      );

      const persisted = await prisma.account.findUniqueOrThrow({
        where: { id: account.id },
      });

      expect(result.name).toBe('Updated Cash Account');
      expect(persisted.balance).toBe(500000n);
      expect(persisted.code).toBe(account.code);
      expect(persisted.type).toBe(account.type);
      expect(persisted.normalBalance).toBe(
        account.normalBalance,
      );
    });

    it('should reject an unknown account ID', async () => {
      await expect(
        accountService.updateMetadata(randomUUID(), {
          name: 'Unknown Account',
        }),
      ).rejects.toThrow('Account not found');
    });
  });

  describe('updateStatus', () => {
    it('should freeze an active account', async () => {
      const account = await createAccount();

      const result = await accountService.updateStatus(
        account.id,
        AccountStatus.FROZEN,
      );

      const persisted = await prisma.account.findUniqueOrThrow({
        where: { id: account.id },
      });

      expect(result.status).toBe(AccountStatus.FROZEN);
      expect(persisted.status).toBe(AccountStatus.FROZEN);
    });

    it('should close an account with zero balance', async () => {
      const account = await createAccount();

      const result = await accountService.updateStatus(
        account.id,
        AccountStatus.CLOSED,
      );

      expect(result.status).toBe(AccountStatus.CLOSED);

      const persisted = await prisma.account.findUniqueOrThrow({
        where: { id: account.id },
      });

      expect(persisted.status).toBe(AccountStatus.CLOSED);
    });

    it('should reject closing an account with non-zero balance', async () => {
      const account = await createAccount(100000n);

      await expect(
        accountService.updateStatus(
          account.id,
          AccountStatus.CLOSED,
        ),
      ).rejects.toThrow(
        'Account must have zero balance before closing',
      );

      const persisted = await prisma.account.findUniqueOrThrow({
        where: { id: account.id },
      });

      expect(persisted.status).toBe(AccountStatus.ACTIVE);
      expect(persisted.balance).toBe(100000n);
    });

    it('should not reactivate a closed account', async () => {
      const account = await createAccount();

      await accountService.updateStatus(
        account.id,
        AccountStatus.CLOSED,
      );

      await expect(
        accountService.updateStatus(
          account.id,
          AccountStatus.ACTIVE,
        ),
      ).rejects.toThrow(
        'Closed accounts cannot be reactivated or changed',
      );

      const persisted = await prisma.account.findUniqueOrThrow({
        where: { id: account.id },
      });

      expect(persisted.status).toBe(AccountStatus.CLOSED);
    });

    it('should reject concurrent attempts to apply the same status', async () => {
      const account = await createAccount();

      const results = await Promise.allSettled([
        accountService.updateStatus(
          account.id,
          AccountStatus.FROZEN,
        ),
        accountService.updateStatus(
          account.id,
          AccountStatus.FROZEN,
        ),
      ]);

      const successful = results.filter(
        (result) => result.status === 'fulfilled',
      );

      const failed = results.filter(
        (result) => result.status === 'rejected',
      );

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(1);

      const persisted = await prisma.account.findUniqueOrThrow({
        where: { id: account.id },
      });

      expect(persisted.status).toBe(AccountStatus.FROZEN);
    });
  });
});
