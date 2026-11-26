
import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service.js';

import {
  AccountNormalBalance,
  AccountStatus,
  AccountType,
  JournalLineSide,
  Prisma,
  TransactionType,
  WalletStatus,
} from '../../generated/prisma/client.js';

import { LedgerService } from '../ledger/ledger.service.js';
import { TransactionService } from '../transaction/transaction.service.js';

type TransferTransaction = Prisma.TransactionClient;

export interface CreateTransferInput {
  receiverWalletId: string;
  amount: bigint;
  idempotencyKey: string;
  description: string;
}

@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly transactionService: TransactionService,
  ) {}

  async create(
    userId: string,
    input: CreateTransferInput,
  ) {
    this.validateInput(input);

    const senderWallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!senderWallet) {
      throw new NotFoundException('Sender wallet not found');
    }

    if (senderWallet.id === input.receiverWalletId) {
      throw new BadRequestException(
        'Cannot transfer to the same wallet',
      );
    }

    const requestHash = this.createRequestHash(input);

    try {
      return await this.prisma.$transaction(async (tx) => {
        return this.executeTransfer(
          tx,
          userId,
          senderWallet.id,
          input,
          requestHash,
        );
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.resolveIdempotency(
          userId,
          senderWallet.id,
          input.idempotencyKey,
          requestHash,
        );
      }

      throw error;
    }
  }

  private async executeTransfer(
    tx: TransferTransaction,
    userId: string,
    senderWalletId: string,
    input: CreateTransferInput,
    requestHash: string,
  ) {
    const walletIds = [
      senderWalletId,
      input.receiverWalletId,
    ].sort();

    // Lock both wallets in deterministic order.
    const lockedWallets = await tx.$queryRaw<
      Array<{ id: string }>
    >`
      SELECT id
      FROM wallets
      WHERE id IN (${Prisma.join(walletIds)})
      ORDER BY id
      FOR UPDATE
    `;

    if (lockedWallets.length !== 2) {
      throw new NotFoundException('One or more wallets not found');
    }

    // Idempotency check happens after acquiring wallet locks.
    const existing = await this.findExistingTransfer(
      tx,
      senderWalletId,
      input.idempotencyKey,
    );

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency key already used with different request data',
        );
      }

      return this.serialize(existing);
    }

    const wallets = await tx.wallet.findMany({
      where: {
        id: { in: walletIds },
      },
      include: {
        account: true,
      },
    });

    const sender = wallets.find(
      (wallet) => wallet.id === senderWalletId,
    );

    const receiver = wallets.find(
      (wallet) => wallet.id === input.receiverWalletId,
    );

    if (!sender || !receiver) {
      throw new NotFoundException('Wallet not found');
    }

    if (sender.userId !== userId) {
      throw new BadRequestException(
        'Invalid sender wallet ownership',
      );
    }

    if (
      sender.status !== WalletStatus.ACTIVE ||
      receiver.status !== WalletStatus.ACTIVE
    ) {
      throw new BadRequestException(
        'Both wallets must be active',
      );
    }

    if (sender.currency !== receiver.currency) {
      throw new BadRequestException(
        'Wallet currencies do not match',
      );
    }

    if (sender.currency !== 'IDR') {
      throw new BadRequestException(
        'Only IDR transfers are supported',
      );
    }

    const senderAccount = sender.account;
    const receiverAccount = receiver.account;

    if (!senderAccount || !receiverAccount) {
      throw new BadRequestException(
        'One or more wallets have no ledger account',
      );
    }

    for (const account of [senderAccount, receiverAccount]) {
      if (
        account.status !== AccountStatus.ACTIVE ||
        account.type !== AccountType.LIABILITY ||
        account.normalBalance !== AccountNormalBalance.CREDIT
      ) {
        throw new BadRequestException(
          'Wallet ledger account is invalid or inactive',
        );
      }
    }

    const reference = `TRF-${randomUUID()}`;
    const description = input.description.trim();

    // 1. Create balanced journal draft.
    const journal = await this.ledgerService.createDraft(tx, {
      reference,
      description,
      lines: [
        {
          accountId: senderAccount.id,
          side: JournalLineSide.DEBIT,
          amount: input.amount,
        },
        {
          accountId: receiverAccount.id,
          side: JournalLineSide.CREDIT,
          amount: input.amount,
        },
      ],
    });

    // 2. Post journal and update account balances.
    await this.ledgerService.postJournal(tx, journal.id);

    // 3. Create financial transaction.
    const transaction = await this.transactionService.create(tx, {
      reference,
      type: TransactionType.TRANSFER,
      amount: input.amount,
      currency: sender.currency,
      description,
      journalEntryId: journal.id,
    });

    // 4. Save transfer details.
    const transfer = await tx.transfer.create({
      data: {
        transactionId: transaction.id,
        senderWalletId: sender.id,
        receiverWalletId: receiver.id,
        idempotencyKey: input.idempotencyKey,
        requestHash,
      },
      include: {
        transaction: true,
      },
    });

    return this.serialize(transfer);
  }

  private async findExistingTransfer(
    tx: TransferTransaction,
    senderWalletId: string,
    idempotencyKey: string,
  ) {
    return tx.transfer.findUnique({
      where: {
        senderWalletId_idempotencyKey: {
          senderWalletId,
          idempotencyKey,
        },
      },
      include: {
        transaction: true,
      },
    });
  }

  private async resolveIdempotency(
    userId: string,
    senderWalletId: string,
    idempotencyKey: string,
    requestHash: string,
  ) {
    const existing = await this.prisma.transfer.findUnique({
      where: {
        senderWalletId_idempotencyKey: {
          senderWalletId,
          idempotencyKey,
        },
      },
      include: {
        transaction: true,
      },
    });

    if (!existing) {
      throw new ConflictException(
        'Transfer conflicts with an existing record',
      );
    }

    if (existing.senderWalletId !== senderWalletId) {
      throw new NotFoundException('Transfer not found');
    }

    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency key already used with different request data',
      );
    }

    return this.serialize(existing);
  }

  private createRequestHash(
    input: CreateTransferInput,
  ): string {
    const canonicalRequest = JSON.stringify({
      receiverWalletId: input.receiverWalletId,
      amount: input.amount.toString(),
      currency: 'IDR',
      description: input.description.trim(),
    });

    return createHash('sha256')
      .update(canonicalRequest)
      .digest('hex');
  }

  private serialize<T extends {
    transaction: { amount: bigint };
  }>(transfer: T) {
    return {
      ...transfer,
      transaction: {
        ...transfer.transaction,
        amount: transfer.transaction.amount.toString(),
      },
    };
  }

  private validateInput(input: CreateTransferInput): void {
    if (!input.receiverWalletId) {
      throw new BadRequestException(
        'Receiver wallet ID is required',
      );
    }

    if (input.amount <= 0n) {
      throw new BadRequestException(
        'Transfer amount must be positive',
      );
    }

    if (input.amount > 9223372036854775807n) {
      throw new BadRequestException(
        'Transfer amount exceeds the supported limit',
      );
    }

    if (
      !input.idempotencyKey?.trim() ||
      input.idempotencyKey.trim().length > 100
    ) {
      throw new BadRequestException(
        'Idempotency key must contain 1-100 characters',
      );
    }

    if (!input.description?.trim()) {
      throw new BadRequestException(
        'Transfer description is required',
      );
    }

    if (input.description.trim().length > 255) {
      throw new BadRequestException(
        'Transfer description must not exceed 255 characters',
      );
    }
  }
}
