
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { PrismaService } from '../../database/prisma.service.js';

import {
  JournalEntryStatus,
  Prisma,
  TransactionStatus,
  TransactionType,
  UserRole,
} from '../../generated/prisma/client.js';

import { TransactionHistoryQueryDto } from './transaction-history-query.dto.js';
import { TransactionService } from './transaction.service.js';

describe('TransactionService', () => {
  let service: TransactionService;

  const txMock = {
    journalEntry: {
      findUnique: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
  };

  const prismaMock = {
    wallet: {
      findUnique: vi.fn(),
    },
    transaction: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };

  const tx = txMock as unknown as Prisma.TransactionClient;

  const journalEntryId =
    '11111111-1111-4111-8111-111111111111';

  const transactionId =
    '22222222-2222-4222-8222-222222222222';

  const walletId =
    '33333333-3333-4333-8333-333333333333';

  const userId =
    '44444444-4444-4444-8444-444444444444';

  const input = {
    reference: 'TXN-TEST-001',
    type: TransactionType.DEPOSIT,
    amount: 1500000n,
    currency: 'IDR',
    description: 'Test deposit',
    journalEntryId,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    service = new TransactionService(
      prismaMock as unknown as PrismaService,
    );
  });

  describe('create', () => {
    it('should create transaction with a posted journal entry', async () => {
      const createdTransaction = {
        id: transactionId,
        ...input,
        status: 'COMPLETED',
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      txMock.journalEntry.findUnique.mockResolvedValue({
        id: journalEntryId,
        status: JournalEntryStatus.POSTED,
      });

      txMock.transaction.create.mockResolvedValue(
        createdTransaction,
      );

      const result = await service.create(tx, input);

      expect(
        txMock.journalEntry.findUnique,
      ).toHaveBeenCalledWith({
        where: { id: journalEntryId },
        select: {
          id: true,
          status: true,
        },
      });

      expect(
        txMock.transaction.create,
      ).toHaveBeenCalledWith({
        data: {
          reference: input.reference,
          type: input.type,
          amount: input.amount,
          currency: 'IDR',
          description: input.description,
          journalEntryId,
        },
      });

      expect(result).toEqual(createdTransaction);
    });

    it('should throw when journal entry does not exist', async () => {
      txMock.journalEntry.findUnique.mockResolvedValue(null);

      await expect(
        service.create(tx, input),
      ).rejects.toThrow(NotFoundException);

      expect(
        txMock.transaction.create,
      ).not.toHaveBeenCalled();
    });

    it('should reject journal entry that is not posted', async () => {
      txMock.journalEntry.findUnique.mockResolvedValue({
        id: journalEntryId,
        status: JournalEntryStatus.DRAFT,
      });

      await expect(
        service.create(tx, input),
      ).rejects.toThrow(BadRequestException);

      expect(
        txMock.transaction.create,
      ).not.toHaveBeenCalled();
    });

    it('should reject empty reference', async () => {
      await expect(
        service.create(tx, {
          ...input,
          reference: '   ',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(
        txMock.journalEntry.findUnique,
      ).not.toHaveBeenCalled();
    });

    it('should reject reference longer than 100 characters', async () => {
      await expect(
        service.create(tx, {
          ...input,
          reference: 'A'.repeat(101),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid transaction type', async () => {
      await expect(
        service.create(tx, {
          ...input,
          type: 'INVALID' as TransactionType,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject zero or negative amount', async () => {
      await expect(
        service.create(tx, {
          ...input,
          amount: 0n,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.create(tx, {
          ...input,
          amount: -100n,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject unsupported currency', async () => {
      await expect(
        service.create(tx, {
          ...input,
          currency: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject empty description', async () => {
      await expect(
        service.create(tx, {
          ...input,
          description: '   ',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject description longer than 255 characters', async () => {
      await expect(
        service.create(tx, {
          ...input,
          description: 'A'.repeat(256),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should convert duplicate reference or journal into conflict', async () => {
      txMock.journalEntry.findUnique.mockResolvedValue({
        id: journalEntryId,
        status: JournalEntryStatus.POSTED,
      });

      txMock.transaction.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          {
            code: 'P2002',
            clientVersion: '7.10.1',
            meta: {
              target: ['reference'],
            },
          },
        ),
      );

      await expect(
        service.create(tx, input),
      ).rejects.toThrow(ConflictException);
    });

    it('should propagate unexpected database errors', async () => {
      const error = new Error('Database unavailable');

      txMock.journalEntry.findUnique.mockResolvedValue({
        id: journalEntryId,
        status: JournalEntryStatus.POSTED,
      });

      txMock.transaction.create.mockRejectedValue(error);

      await expect(
        service.create(tx, input),
      ).rejects.toThrow('Database unavailable');
    });
  });

  describe('list', () => {
    const transactionRecord = {
      id: transactionId,
      reference: 'TXN-TEST-001',
      type: TransactionType.DEPOSIT,
      status: TransactionStatus.COMPLETED,
      amount: 9007199254740993n,
      currency: 'IDR',
      description: 'Test transaction',
      createdAt: new Date(),
    };

    it('should return all transactions for ADMIN with pagination', async () => {
      prismaMock.transaction.findMany.mockResolvedValue([
        transactionRecord,
      ]);

      prismaMock.transaction.count.mockResolvedValue(25);

      const query = {
        page: 2,
        limit: 10,
      } as TransactionHistoryQueryDto;

      const result = await service.list(
        userId,
        UserRole.ADMIN,
        query,
      );

      expect(
        prismaMock.wallet.findUnique,
      ).not.toHaveBeenCalled();

      expect(
        prismaMock.transaction.findMany,
      ).toHaveBeenCalledWith({
        where: {},
        include: {
          transfer: {
            select: {
              senderWalletId: true,
              receiverWalletId: true,
            },
          },
          reversalOf: {
            select: {
              id: true,
              reference: true,
            },
          },
          reversedBy: {
            select: {
              id: true,
              reference: true,
            },
          },
        },
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        skip: 10,
        take: 10,
      });

      expect(
        prismaMock.transaction.count,
      ).toHaveBeenCalledWith({
        where: {},
      });

      expect(result.meta).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].amount).toBe('9007199254740993');
    });

    it('should filter transactions by type and status', async () => {
      prismaMock.transaction.findMany.mockResolvedValue([]);
      prismaMock.transaction.count.mockResolvedValue(0);

      const query = {
        page: 1,
        limit: 10,
        type: TransactionType.TRANSFER,
        status: TransactionStatus.REVERSED,
      } as TransactionHistoryQueryDto;

      await service.list(
        userId,
        UserRole.ADMIN,
        query,
      );

      const expectedWhere = {
        type: TransactionType.TRANSFER,
        status: TransactionStatus.REVERSED,
      };

      expect(
        prismaMock.transaction.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expectedWhere,
        }),
      );

      expect(
        prismaMock.transaction.count,
      ).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });

    it('should scope CUSTOMER transactions to owned wallet', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue({
        id: walletId,
      });

      prismaMock.transaction.findMany.mockResolvedValue([
        transactionRecord,
      ]);

      prismaMock.transaction.count.mockResolvedValue(1);

      const result = await service.list(
        userId,
        UserRole.CUSTOMER,
        {
          page: 1,
          limit: 10,
        } as TransactionHistoryQueryDto,
      );

      expect(
        prismaMock.wallet.findUnique,
      ).toHaveBeenCalledWith({
        where: { userId },
        select: { id: true },
      });

      const expectedWhere = {
        OR: [
          {
            transfer: {
              is: {
                senderWalletId: walletId,
              },
            },
          },
          {
            transfer: {
              is: {
                receiverWalletId: walletId,
              },
            },
          },
          {
            journalEntry: {
              is: {
                lines: {
                  some: {
                    account: {
                      is: {
                        walletId,
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      };

      expect(
        prismaMock.transaction.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expectedWhere,
        }),
      );

      expect(
        prismaMock.transaction.count,
      ).toHaveBeenCalledWith({
        where: expectedWhere,
      });

      expect(result.data).toHaveLength(1);
    });

    it('should include both outgoing and incoming transfers in customer scope', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue({
        id: walletId,
      });

      prismaMock.transaction.findMany.mockResolvedValue([]);
      prismaMock.transaction.count.mockResolvedValue(0);

      await service.list(
        userId,
        UserRole.CUSTOMER,
        {} as TransactionHistoryQueryDto,
      );

      const call =
        prismaMock.transaction.findMany.mock.calls[0][0];

      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          {
            transfer: {
              is: {
                senderWalletId: walletId,
              },
            },
          },
          {
            transfer: {
              is: {
                receiverWalletId: walletId,
              },
            },
          },
        ]),
      );
    });

    it('should return empty history when customer has no wallet', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(null);

      const result = await service.list(
        userId,
        UserRole.CUSTOMER,
        {} as TransactionHistoryQueryDto,
      );

      expect(result).toEqual({
        data: [],
        meta: {
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 0,
        },
      });

      expect(
        prismaMock.transaction.findMany,
      ).not.toHaveBeenCalled();

      expect(
        prismaMock.transaction.count,
      ).not.toHaveBeenCalled();
    });

    it('should reject unsupported user role', async () => {
      await expect(
        service.list(
          userId,
          'UNKNOWN' as UserRole,
          {} as TransactionHistoryQueryDto,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(
        prismaMock.transaction.findMany,
      ).not.toHaveBeenCalled();
    });

    it('should return empty data when no transactions exist', async () => {
      prismaMock.transaction.findMany.mockResolvedValue([]);
      prismaMock.transaction.count.mockResolvedValue(0);

      const result = await service.list(
        userId,
        UserRole.ADMIN,
        {} as TransactionHistoryQueryDto,
      );

      expect(result).toEqual({
        data: [],
        meta: {
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 0,
        },
      });
    });
  });

  describe('findById', () => {
    it('should return transaction with BigInt amount serialized as string', async () => {
      prismaMock.transaction.findUnique.mockResolvedValue({
        id: transactionId,
        reference: 'TXN-TEST-001',
        amount: 9007199254740993n,
        journalEntry: {
          id: journalEntryId,
          lines: [],
        },
      });

      const result = await service.findById(transactionId);

      expect(
        prismaMock.transaction.findUnique,
      ).toHaveBeenCalledWith({
        where: { id: transactionId },
        include: {
          journalEntry: {
            include: {
              lines: true,
            },
          },
        },
      });

      expect(result.amount).toBe('9007199254740993');
      expect(typeof result.amount).toBe('string');
    });

    it('should throw when transaction does not exist', async () => {
      prismaMock.transaction.findUnique.mockResolvedValue(null);

      await expect(
        service.findById(transactionId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByReference', () => {
    it('should return transaction by reference', async () => {
      prismaMock.transaction.findUnique.mockResolvedValue({
        id: transactionId,
        reference: 'TXN-TEST-001',
        amount: 1500000n,
        journalEntry: {
          id: journalEntryId,
          lines: [],
        },
      });

      const result = await service.findByReference(
        'TXN-TEST-001',
      );

      expect(
        prismaMock.transaction.findUnique,
      ).toHaveBeenCalledWith({
        where: { reference: 'TXN-TEST-001' },
        include: {
          journalEntry: {
            include: {
              lines: true,
            },
          },
        },
      });

      expect(result.amount).toBe('1500000');
    });

    it('should throw when reference does not exist', async () => {
      prismaMock.transaction.findUnique.mockResolvedValue(null);

      await expect(
        service.findByReference('TXN-NOT-FOUND'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

