
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountNormalBalance,
  AccountStatus,
  AccountType,
  Prisma,
} from '../../generated/prisma/client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../../database/prisma.service.js';
import { AccountService } from './account.service.js';

describe('AccountService', () => {
  let service: AccountService;

  const prismaMock = {
    account: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const txMock = {
    $queryRaw: vi.fn(),
    account: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  const accountId = '11111111-1111-4111-8111-111111111111';

  const accountFixture = {
    id: accountId,
    walletId: null,
    code: '1001',
    name: 'Cash',
    type: AccountType.ASSET,
    normalBalance: AccountNormalBalance.DEBIT,
    balance: 100000n,
    status: AccountStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof txMock) => Promise<unknown>) =>
        callback(txMock),
    );

    service = new AccountService(
      prismaMock as unknown as PrismaService,
    );
  });

  describe('createSystemAccount', () => {
    const input = {
      code: '1001',
      name: 'Cash',
      type: AccountType.ASSET,
      normalBalance: AccountNormalBalance.DEBIT,
    };

    it('should create a system account with zero balance', async () => {
      prismaMock.account.create.mockResolvedValue({
        ...accountFixture,
        balance: 0n,
      });

      const result = await service.createSystemAccount(input);

      expect(prismaMock.account.create).toHaveBeenCalledWith({
        data: {
          ...input,
          balance: 0n,
        },
      });

      expect(result.balance).toBe('0');
      expect(typeof result.balance).toBe('string');
    });

    it('should normalize code and name', async () => {
      prismaMock.account.create.mockResolvedValue({
        ...accountFixture,
        code: '1001',
        name: 'Cash',
      });

      await service.createSystemAccount({
        ...input,
        code: ' 1001 ',
        name: ' Cash ',
      });

      expect(prismaMock.account.create).toHaveBeenCalledWith({
        data: {
          ...input,
          code: '1001',
          name: 'Cash',
          balance: 0n,
        },
      });
    });

    it('should reject empty code', async () => {
      await expect(
        service.createSystemAccount({
          ...input,
          code: ' ',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject empty name', async () => {
      await expect(
        service.createSystemAccount({
          ...input,
          name: ' ',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid account type', async () => {
      await expect(
        service.createSystemAccount({
          ...input,
          type: 'INVALID' as AccountType,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid normal balance', async () => {
      await expect(
        service.createSystemAccount({
          ...input,
          normalBalance: 'INVALID' as AccountNormalBalance,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should map duplicate code to conflict', async () => {
      prismaMock.account.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          {
            code: 'P2002',
            clientVersion: 'test',
          },
        ),
      );

      await expect(
        service.createSystemAccount(input),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return accounts with serialized balances', async () => {
      prismaMock.account.findMany.mockResolvedValue([
        accountFixture,
      ]);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].balance).toBe('100000');
    });

    it('should filter by type and status', async () => {
      prismaMock.account.findMany.mockResolvedValue([]);

      await service.findAll({
        type: AccountType.ASSET,
        status: AccountStatus.ACTIVE,
      });

      expect(prismaMock.account.findMany).toHaveBeenCalledWith({
        where: {
          type: AccountType.ASSET,
          status: AccountStatus.ACTIVE,
        },
        orderBy: { code: 'asc' },
      });
    });
  });

  describe('findById', () => {
    it('should return account with string balance', async () => {
      prismaMock.account.findUnique.mockResolvedValue(
        accountFixture,
      );

      const result = await service.findById(accountId);

      expect(result.balance).toBe('100000');
    });

    it('should reject empty ID', async () => {
      await expect(service.findById(' ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw when account does not exist', async () => {
      prismaMock.account.findUnique.mockResolvedValue(null);

      await expect(
        service.findById(accountId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMetadata', () => {
    it('should update account name only', async () => {
      prismaMock.account.update.mockResolvedValue({
        ...accountFixture,
        name: 'Operating Cash',
      });

      const result = await service.updateMetadata(accountId, {
        name: ' Operating Cash ',
      });

      expect(prismaMock.account.update).toHaveBeenCalledWith({
        where: { id: accountId },
        data: { name: 'Operating Cash' },
      });

      expect(result.name).toBe('Operating Cash');
    });

    it('should reject empty name', async () => {
      await expect(
        service.updateMetadata(accountId, { name: ' ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should map missing account to not found', async () => {
      prismaMock.account.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Record not found',
          {
            code: 'P2025',
            clientVersion: 'test',
          },
        ),
      );

      await expect(
        service.updateMetadata(accountId, {
          name: 'Cash',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('should freeze an active account', async () => {
      txMock.$queryRaw.mockResolvedValue([{ id: accountId }]);
      txMock.account.findUnique.mockResolvedValue(accountFixture);
      txMock.account.update.mockResolvedValue({
        ...accountFixture,
        status: AccountStatus.FROZEN,
      });

      const result = await service.updateStatus(
        accountId,
        AccountStatus.FROZEN,
      );

      expect(prismaMock.$transaction).toHaveBeenCalledOnce();
      expect(result.status).toBe(AccountStatus.FROZEN);
    });

    it('should throw when account does not exist', async () => {
      txMock.$queryRaw.mockResolvedValue([]);

      await expect(
        service.updateStatus(accountId, AccountStatus.FROZEN),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not close an account with non-zero balance', async () => {
      txMock.$queryRaw.mockResolvedValue([{ id: accountId }]);
      txMock.account.findUnique.mockResolvedValue(accountFixture);

      await expect(
        service.updateStatus(accountId, AccountStatus.CLOSED),
      ).rejects.toThrow(ConflictException);

      expect(txMock.account.update).not.toHaveBeenCalled();
    });

    it('should close an account with zero balance', async () => {
      txMock.$queryRaw.mockResolvedValue([{ id: accountId }]);
      txMock.account.findUnique.mockResolvedValue({
        ...accountFixture,
        balance: 0n,
      });
      txMock.account.update.mockResolvedValue({
        ...accountFixture,
        balance: 0n,
        status: AccountStatus.CLOSED,
      });

      const result = await service.updateStatus(
        accountId,
        AccountStatus.CLOSED,
      );

      expect(result.status).toBe(AccountStatus.CLOSED);
    });

    it('should not reactivate a closed account', async () => {
      txMock.$queryRaw.mockResolvedValue([{ id: accountId }]);
      txMock.account.findUnique.mockResolvedValue({
        ...accountFixture,
        status: AccountStatus.CLOSED,
        balance: 0n,
      });

      await expect(
        service.updateStatus(accountId, AccountStatus.ACTIVE),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject invalid status', async () => {
      await expect(
        service.updateStatus(
          accountId,
          'INVALID' as AccountStatus,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
