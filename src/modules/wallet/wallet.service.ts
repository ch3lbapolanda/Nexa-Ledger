import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service.js';
import { CreateWalletDto } from './dto/create-wallet.dto.js';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateWalletDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingWallet = await tx.wallet.findUnique({
          where: { userId },
        });

        if (existingWallet) {
          throw new ConflictException(
            'User already has a wallet',
          );
        }

        const wallet = await tx.wallet.create({
          data: {
            userId,
            currency: dto.currency ?? 'IDR',
          },
        });

        const account = await tx.account.create({
          data: {
            walletId: wallet.id,
            code: `WALLET-${randomUUID()}`,
            name: `Customer Wallet ${wallet.id}`,
            type: 'LIABILITY',
            normalBalance: 'CREDIT',
            balance: 0n,
          },
        });

        return {
          id: wallet.id,
          currency: wallet.currency,
          status: wallet.status,
          account: {
            id: account.id,
            code: account.code,
            type: account.type,
            normalBalance: account.normalBalance,
            balance: account.balance.toString(),
          },
          createdAt: wallet.createdAt,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'User already has a wallet',
        );
      }

      throw error;
    }
  }

  async findMyWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      include: {
        account: {
          select: {
            id: true,
            code: true,
            type: true,
            normalBalance: true,
            balance: true,
            status: true,
          },
        },
      },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return {
      id: wallet.id,
      currency: wallet.currency,
      status: wallet.status,
      account: wallet.account
        ? {
            ...wallet.account,
            balance: wallet.account.balance.toString(),
          }
        : null,
      createdAt: wallet.createdAt,
    };
  }

  async getMyBalance(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: {
        currency: true,
        status: true,
        account: {
          select: {
            balance: true,
            status: true,
          },
        },
      },
    });

    if (!wallet || !wallet.account) {
      throw new NotFoundException('Wallet not found');
    }

    return {
      balance: wallet.account.balance.toString(),
      currency: wallet.currency,
      walletStatus: wallet.status,
      accountStatus: wallet.account.status,
    };
  }
}