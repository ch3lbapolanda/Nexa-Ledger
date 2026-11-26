
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../../database/prisma.service.js';
import {
  JournalEntryStatus,
  Prisma,
  TransactionType,
} from '../../generated/prisma/client.js';
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
    transaction: {
      findUnique: vi.fn(),
    },
  };

  const tx = txMock as unknown as Prisma.TransactionClient;

  const journalEntryId =
    '11111111-1111-4111-8111-111111111111';

  const transactionId =
    '22222222-2222-4222-8222-222222222222';

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
