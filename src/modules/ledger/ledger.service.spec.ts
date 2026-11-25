
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountNormalBalance,
  AccountStatus,
  JournalEntryStatus,
  JournalLineSide,
  Prisma,
} from '../../generated/prisma/client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LedgerService } from './ledger.service.js';

const JOURNAL_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_A = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_B = '33333333-3333-4333-8333-333333333333';

function createTransactionMock() {
  const mocks = {
    account: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    journalEntry: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };

  return {
    mocks,
    tx: mocks as unknown as Parameters<LedgerService['postJournal']>[0],
  };
}

function makeJournal(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: JOURNAL_ID,
    description: 'Test journal',
    reference: null,
    status: JournalEntryStatus.DRAFT,
    postedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lines: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        journalEntryId: JOURNAL_ID,
        accountId: ACCOUNT_A,
        side: JournalLineSide.DEBIT,
        amount: 100n,
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        journalEntryId: JOURNAL_ID,
        accountId: ACCOUNT_B,
        side: JournalLineSide.CREDIT,
        amount: 100n,
      },
    ],
    ...overrides,
  };
}

function makeAccount(
  id: string,
  normalBalance: AccountNormalBalance,
  balance = 0n,
) {
  return {
    id,
    normalBalance,
    balance,
    status: AccountStatus.ACTIVE,
  };
}

describe('LedgerService', () => {
  let service: LedgerService;

  beforeEach(() => {
    service = new LedgerService();
  });

  describe('createDraft', () => {
    it('creates a draft journal with active accounts', async () => {
      const { mocks, tx } = createTransactionMock();

      mocks.account.findMany.mockResolvedValue([
        { id: ACCOUNT_A },
        { id: ACCOUNT_B },
      ]);

      const createdJournal = makeJournal();
      mocks.journalEntry.create.mockResolvedValue(createdJournal);

      const result = await service.createDraft(tx, {
        description: 'Test journal',
        lines: [
          {
            accountId: ACCOUNT_A,
            side: JournalLineSide.DEBIT,
            amount: 100n,
          },
          {
            accountId: ACCOUNT_B,
            side: JournalLineSide.CREDIT,
            amount: 100n,
          },
        ],
      });

      expect(result).toEqual(createdJournal);
      expect(mocks.account.findMany).toHaveBeenCalledOnce();
      expect(mocks.journalEntry.create).toHaveBeenCalledOnce();
    });

    it('rejects an empty description', async () => {
      const { tx } = createTransactionMock();

      await expect(
        service.createDraft(tx, {
          description: '   ',
          lines: [
            {
              accountId: ACCOUNT_A,
              side: JournalLineSide.DEBIT,
              amount: 100n,
            },
            {
              accountId: ACCOUNT_B,
              side: JournalLineSide.CREDIT,
              amount: 100n,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a journal with fewer than two lines', async () => {
      const { tx } = createTransactionMock();

      await expect(
        service.createDraft(tx, {
          description: 'Invalid journal',
          lines: [
            {
              accountId: ACCOUNT_A,
              side: JournalLineSide.DEBIT,
              amount: 100n,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a non-positive amount', async () => {
      const { tx } = createTransactionMock();

      await expect(
        service.createDraft(tx, {
          description: 'Invalid amount',
          lines: [
            {
              accountId: ACCOUNT_A,
              side: JournalLineSide.DEBIT,
              amount: 0n,
            },
            {
              accountId: ACCOUNT_B,
              side: JournalLineSide.CREDIT,
              amount: 100n,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects accounts that are missing or inactive', async () => {
      const { mocks, tx } = createTransactionMock();

      mocks.account.findMany.mockResolvedValue([
        { id: ACCOUNT_A },
      ]);

      await expect(
        service.createDraft(tx, {
          description: 'Missing account',
          lines: [
            {
              accountId: ACCOUNT_A,
              side: JournalLineSide.DEBIT,
              amount: 100n,
            },
            {
              accountId: ACCOUNT_B,
              side: JournalLineSide.CREDIT,
              amount: 100n,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.journalEntry.create).not.toHaveBeenCalled();
    });

    it('converts duplicate reference errors into ConflictException', async () => {
      const { mocks, tx } = createTransactionMock();

      mocks.account.findMany.mockResolvedValue([
        { id: ACCOUNT_A },
        { id: ACCOUNT_B },
      ]);

      mocks.journalEntry.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          {
            code: 'P2002',
            clientVersion: '7.10.1',
          },
        ),
      );

      await expect(
        service.createDraft(tx, {
          reference: 'REF-001',
          description: 'Duplicate reference',
          lines: [
            {
              accountId: ACCOUNT_A,
              side: JournalLineSide.DEBIT,
              amount: 100n,
            },
            {
              accountId: ACCOUNT_B,
              side: JournalLineSide.CREDIT,
              amount: 100n,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('postJournal', () => {
    it('rejects a journal that does not exist', async () => {
      const { mocks, tx } = createTransactionMock();

      mocks.$queryRaw.mockResolvedValue([]);

      await expect(
        service.postJournal(tx, JOURNAL_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mocks.journalEntry.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an already posted journal', async () => {
      const { mocks, tx } = createTransactionMock();

      mocks.$queryRaw.mockResolvedValueOnce([{ id: JOURNAL_ID }]);

      mocks.journalEntry.findUnique.mockResolvedValue(
        makeJournal({
          status: JournalEntryStatus.POSTED,
        }),
      );

      await expect(
        service.postJournal(tx, JOURNAL_ID),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mocks.account.update).not.toHaveBeenCalled();
      expect(mocks.journalEntry.update).not.toHaveBeenCalled();
    });

    it('rejects an unbalanced journal', async () => {
      const { mocks, tx } = createTransactionMock();

      mocks.$queryRaw.mockResolvedValueOnce([{ id: JOURNAL_ID }]);

      mocks.journalEntry.findUnique.mockResolvedValue(
        makeJournal({
          lines: [
            {
              accountId: ACCOUNT_A,
              side: JournalLineSide.DEBIT,
              amount: 100n,
            },
            {
              accountId: ACCOUNT_B,
              side: JournalLineSide.CREDIT,
              amount: 80n,
            },
          ],
        }),
      );

      await expect(
        service.postJournal(tx, JOURNAL_ID),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.account.update).not.toHaveBeenCalled();
    });

    it('posts a balanced journal and updates account balances', async () => {
      const { mocks, tx } = createTransactionMock();

      mocks.$queryRaw
        .mockResolvedValueOnce([{ id: JOURNAL_ID }])
        .mockResolvedValueOnce([]);

      mocks.journalEntry.findUnique.mockResolvedValue(makeJournal());

      mocks.account.findMany.mockResolvedValue([
        makeAccount(ACCOUNT_A, AccountNormalBalance.DEBIT),
        makeAccount(ACCOUNT_B, AccountNormalBalance.CREDIT),
      ]);

      const postedJournal = makeJournal({
        status: JournalEntryStatus.POSTED,
        postedAt: new Date(),
      });

      mocks.journalEntry.update.mockResolvedValue(postedJournal);

      const result = await service.postJournal(tx, JOURNAL_ID);

      expect(mocks.account.update).toHaveBeenCalledTimes(2);

      expect(mocks.account.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: ACCOUNT_A },
          data: { balance: { increment: 100n } },
        }),
      );

      expect(mocks.account.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: ACCOUNT_B },
          data: { balance: { increment: 100n } },
        }),
      );

      expect(mocks.journalEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: JOURNAL_ID },
          data: expect.objectContaining({
            status: JournalEntryStatus.POSTED,
            postedAt: expect.any(Date),
          }),
        }),
      );

      expect(result).toEqual(postedJournal);
    });

    it('aggregates multiple lines for the same account before updating balance', async () => {
      const { mocks, tx } = createTransactionMock();

      mocks.$queryRaw
        .mockResolvedValueOnce([{ id: JOURNAL_ID }])
        .mockResolvedValueOnce([]);

      mocks.journalEntry.findUnique.mockResolvedValue(
        makeJournal({
          lines: [
            {
              accountId: ACCOUNT_A,
              side: JournalLineSide.DEBIT,
              amount: 100n,
            },
            {
              accountId: ACCOUNT_A,
              side: JournalLineSide.CREDIT,
              amount: 70n,
            },
            {
              accountId: ACCOUNT_B,
              side: JournalLineSide.CREDIT,
              amount: 100n,
            },
            {
              accountId: ACCOUNT_B,
              side: JournalLineSide.DEBIT,
              amount: 70n,
            },
          ],
        }),
      );

      mocks.account.findMany.mockResolvedValue([
        makeAccount(ACCOUNT_A, AccountNormalBalance.DEBIT, 50n),
        makeAccount(ACCOUNT_B, AccountNormalBalance.CREDIT, 0n),
      ]);

      mocks.journalEntry.update.mockResolvedValue(
        makeJournal({ status: JournalEntryStatus.POSTED }),
      );

      await service.postJournal(tx, JOURNAL_ID);

      expect(mocks.account.update).toHaveBeenCalledTimes(2);

      expect(mocks.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ACCOUNT_A },
          data: { balance: { increment: 30n } },
        }),
      );

      expect(mocks.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ACCOUNT_B },
          data: { balance: { increment: 30n } },
        }),
      );
    });

    it('rejects a posting that would make an account balance negative', async () => {
      const { mocks, tx } = createTransactionMock();

      mocks.$queryRaw
        .mockResolvedValueOnce([{ id: JOURNAL_ID }])
        .mockResolvedValueOnce([]);

      mocks.journalEntry.findUnique.mockResolvedValue(
        makeJournal({
          lines: [
            {
              accountId: ACCOUNT_A,
              side: JournalLineSide.CREDIT,
              amount: 100n,
            },
            {
              accountId: ACCOUNT_B,
              side: JournalLineSide.DEBIT,
              amount: 100n,
            },
          ],
        }),
      );

      mocks.account.findMany.mockResolvedValue([
        makeAccount(ACCOUNT_A, AccountNormalBalance.DEBIT, 50n),
        makeAccount(ACCOUNT_B, AccountNormalBalance.CREDIT, 100n),
      ]);

      await expect(
        service.postJournal(tx, JOURNAL_ID),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.account.update).not.toHaveBeenCalled();
      expect(mocks.journalEntry.update).not.toHaveBeenCalled();
    });

    it('rejects posting when an account is inactive or missing', async () => {
      const { mocks, tx } = createTransactionMock();

      mocks.$queryRaw
        .mockResolvedValueOnce([{ id: JOURNAL_ID }])
        .mockResolvedValueOnce([]);

      mocks.journalEntry.findUnique.mockResolvedValue(makeJournal());

      mocks.account.findMany.mockResolvedValue([
        makeAccount(ACCOUNT_A, AccountNormalBalance.DEBIT),
        {
          ...makeAccount(ACCOUNT_B, AccountNormalBalance.CREDIT),
          status: AccountStatus.INACTIVE,
        },
      ]);

      await expect(
        service.postJournal(tx, JOURNAL_ID),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.account.update).not.toHaveBeenCalled();
    });
  });
});
