
import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../../database/prisma.service.js';
import { WalletService } from './wallet.service.js';

describe('WalletService', () => {
  let service: WalletService;

  const txMock = {
    wallet: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    account: {
      create: vi.fn(),
    },
  };

  const prismaMock = {
    $transaction: vi.fn(),
    wallet: {
      findUnique: vi.fn(),
    },
  };

  const userId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof txMock) => Promise<unknown>) =>
        callback(txMock),
    );

    service = new WalletService(
      prismaMock as unknown as PrismaService,
    );
  });

  describe('create', () => {
    it('should create wallet and liability account in one transaction', async () => {
      const wallet = {
        id: '22222222-2222-4222-8222-222222222222',
        currency: 'IDR',
        status: 'ACTIVE',
        createdAt: new Date(),
      };

      const account = {
        id: '33333333-3333-4333-8333-333333333333',
        code: 'WALLET-TEST',
        type: 'LIABILITY',
        normalBalance: 'CREDIT',
        balance: 0n,
      };

      txMock.wallet.findUnique.mockResolvedValue(null);
      txMock.wallet.create.mockResolvedValue(wallet);
      txMock.account.create.mockResolvedValue(account);

      const result = await service.create(userId, {});

      expect(prismaMock.$transaction).toHaveBeenCalledOnce();

      expect(txMock.wallet.create).toHaveBeenCalledWith({
        data: {
          userId,
          currency: 'IDR',
        },
      });

      expect(txMock.account.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          walletId: wallet.id,
          type: 'LIABILITY',
          normalBalance: 'CREDIT',
          balance: 0n,
        }),
      });

      expect(result).toEqual({
        id: wallet.id,
        currency: 'IDR',
        status: 'ACTIVE',
        account: {
          id: account.id,
          code: 'WALLET-TEST',
          type: 'LIABILITY',
          normalBalance: 'CREDIT',
          balance: '0',
        },
        createdAt: wallet.createdAt,
      });
    });

    it('should reject when user already has a wallet', async () => {
      txMock.wallet.findUnique.mockResolvedValue({
        id: 'existing-wallet',
      });

      await expect(
        service.create(userId, {}),
      ).rejects.toThrow(ConflictException);

      expect(txMock.wallet.create).not.toHaveBeenCalled();
      expect(txMock.account.create).not.toHaveBeenCalled();
    });

    it('should propagate account creation failure', async () => {
      txMock.wallet.findUnique.mockResolvedValue(null);
      txMock.wallet.create.mockResolvedValue({
        id: '22222222-2222-4222-8222-222222222222',
        currency: 'IDR',
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      txMock.account.create.mockRejectedValue(
        new Error('Account creation failed'),
      );

      await expect(
        service.create(userId, {}),
      ).rejects.toThrow('Account creation failed');
    });
  });

  describe('findMyWallet', () => {
    it('should return wallet with BigInt balance serialized as string', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue({
        id: 'wallet-id',
        currency: 'IDR',
        status: 'ACTIVE',
        createdAt: new Date(),
        account: {
          id: 'account-id',
          code: 'WALLET-001',
          type: 'LIABILITY',
          normalBalance: 'CREDIT',
          balance: 9007199254740993n,
          status: 'ACTIVE',
        },
      });

      const result = await service.findMyWallet(userId);

      expect(result.account?.balance).toBe('9007199254740993');
      expect(typeof result.account?.balance).toBe('string');
    });

    it('should throw when wallet does not exist', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(null);

      await expect(
        service.findMyWallet(userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getMyBalance', () => {
    it('should return balance as string', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue({
        currency: 'IDR',
        status: 'ACTIVE',
        account: {
          balance: 1500000n,
          status: 'ACTIVE',
        },
      });

      const result = await service.getMyBalance(userId);

      expect(result).toEqual({
        balance: '1500000',
        currency: 'IDR',
        walletStatus: 'ACTIVE',
        accountStatus: 'ACTIVE',
      });
    });

    it('should throw when wallet or account does not exist', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue({
        currency: 'IDR',
        status: 'ACTIVE',
        account: null,
      });

      await expect(
        service.getMyBalance(userId),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
