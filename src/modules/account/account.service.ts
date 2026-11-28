
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountNormalBalance,
  AccountStatus,
  AccountType,
  Prisma,
} from '../../generated/prisma/client.js';

import { PrismaService } from '../../database/prisma.service.js';

export interface CreateAccountInput {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: AccountNormalBalance;
}

export interface FindAccountsInput {
  type?: AccountType;
  status?: AccountStatus;
}

export interface UpdateAccountInput {
  name: string;
}

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async createSystemAccount(input: CreateAccountInput) {
    const data = this.validateCreateInput(input);

    try {
      const account = await this.prisma.account.create({
        data: {
          ...data,
          balance: 0n,
        },
      });

      return this.serializeAccount(account);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Account code already exists',
        );
      }

      throw error;
    }
  }

  async findAll(input: FindAccountsInput = {}) {
    const accounts = await this.prisma.account.findMany({
      where: {
        ...(input.type ? { type: input.type } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      orderBy: {
        code: 'asc',
      },
    });

    return accounts.map((account) =>
      this.serializeAccount(account),
    );
  }

  async findById(id: string) {
    if (!id?.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const account = await this.prisma.account.findUnique({
      where: { id },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return this.serializeAccount(account);
  }

  async updateMetadata(
    id: string,
    input: UpdateAccountInput,
  ) {
    if (!id?.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const name = input.name?.trim();

    if (!name) {
      throw new BadRequestException(
        'Account name is required',
      );
    }

    if (name.length > 120) {
      throw new BadRequestException(
        'Account name must not exceed 120 characters',
      );
    }

    try {
      const account = await this.prisma.account.update({
        where: { id },
        data: { name },
      });

      return this.serializeAccount(account);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Account not found');
      }

      throw error;
    }
  }

  async updateStatus(
    id: string,
    status: AccountStatus,
  ) {
    if (!id?.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    if (!Object.values(AccountStatus).includes(status)) {
      throw new BadRequestException('Invalid account status');
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM accounts
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new NotFoundException('Account not found');
      }

      const account = await tx.account.findUnique({
        where: { id },
      });

      if (!account) {
        throw new NotFoundException('Account not found');
      }

      if (account.status === AccountStatus.CLOSED) {
        throw new ConflictException(
          'Closed accounts cannot be reactivated or changed',
        );
      }

      if (account.status === status) {
        throw new ConflictException(
          'Account already has this status',
        );
      }

      if (
        status === AccountStatus.CLOSED &&
        account.balance !== 0n
      ) {
        throw new ConflictException(
          'Account must have zero balance before closing',
        );
      }

      const updated = await tx.account.update({
        where: { id },
        data: { status },
      });

      return this.serializeAccount(updated);
    });
  }

  private validateCreateInput(
    input: CreateAccountInput,
  ): CreateAccountInput {
    if (!input.code?.trim()) {
      throw new BadRequestException(
        'Account code is required',
      );
    }

    if (input.code.trim().length > 50) {
      throw new BadRequestException(
        'Account code must not exceed 50 characters',
      );
    }

    if (!input.name?.trim()) {
      throw new BadRequestException(
        'Account name is required',
      );
    }

    if (input.name.trim().length > 120) {
      throw new BadRequestException(
        'Account name must not exceed 120 characters',
      );
    }

    if (!Object.values(AccountType).includes(input.type)) {
      throw new BadRequestException('Invalid account type');
    }

    if (
      !Object.values(AccountNormalBalance).includes(
        input.normalBalance,
      )
    ) {
      throw new BadRequestException(
        'Invalid account normal balance',
      );
    }

    return {
      code: input.code.trim(),
      name: input.name.trim(),
      type: input.type,
      normalBalance: input.normalBalance,
    };
  }

  private serializeAccount<
    T extends { balance: bigint },
  >(account: T) {
    return {
      ...account,
      balance: account.balance.toString(),
    };
  }
}
