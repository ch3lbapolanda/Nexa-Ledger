
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountNormalBalance,
  AccountStatus,
  AccountType,
  JournalLineSide,
  TransactionType,
  WalletStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { TransactionService } from '../transaction/transaction.service.js';
import { TransferService } from './transfer.service.js';

describe('TransferService', () => {
  let service: TransferService;

  let prisma: {
    wallet: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    transfer: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };

  let ledgerService: {
    createDraft: ReturnType<typeof vi.fn>;
    postJournal: ReturnType<typeof vi.fn>;
  };

  let transactionService: {
    create: ReturnType<typeof vi.fn>;
  };

  let tx: {
    $queryRaw: ReturnType<typeof vi.fn>;
    wallet: {
      findMany: ReturnType<typeof vi.fn>;
    };
    transfer: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };

  const userId = 'user-001';
  const senderWalletId = 'wallet-001';
  const receiverWalletId = 'wallet-002';

  const senderAccountId = 'account-001';
  const receiverAccountId = 'account-002';

  const amount = 100_000n;
  const idempotencyKey = 'transfer-request-001';
  const description = 'Transfer to another wallet';

  const input = {
    receiverWalletId,
    amount,
    idempotencyKey,
    description,
  };

  const senderWallet = {
    id: senderWalletId,
    userId,
    currency: 'IDR',
    status: WalletStatus.ACTIVE,
    account: {
      id: senderAccountId,
      type: AccountType.LIABILITY,
      normalBalance: AccountNormalBalance.CREDIT,
      status: AccountStatus.ACTIVE,
      balance: 500_000n,
    },
  };

  const receiverWallet = {
    id: receiverWalletId,
    userId: 'user-002',
    currency: 'IDR',
    status: WalletStatus.ACTIVE,
    account: {
      id: receiverAccountId,
      type: AccountType.LIABILITY,
      normalBalance: AccountNormalBalance.CREDIT,
      status: AccountStatus.ACTIVE,
      balance: 200_000n,
    },
  };

  const journal = {
    id: 'journal-001',
    status: 'DRAFT',
  };

  const transaction = {
    id: 'transaction-001',
    reference: 'TRF-test',
    type: TransactionType.TRANSFER,
    amount,
    currency: 'IDR',
    description,
    journalEntryId: journal.id,
  };

  function createRequestHash(
    transferInput = input,
  ): string {
    const canonicalRequest = JSON.stringify({
      receiverWalletId: transferInput.receiverWalletId,
      amount: transferInput.amount.toString(),
      currency: 'IDR',
      description: transferInput.description.trim(),
    });

    return createHash('sha256')
      .update(canonicalRequest)
      .digest('hex');
  }

  function existingTransfer(
    requestHash = createRequestHash(),
  ) {
    return {
      id: 'transfer-001',
      transactionId: transaction.id,
      senderWalletId,
      receiverWalletId,
      idempotencyKey,
      requestHash,
      createdAt: new Date(),
      transaction: {
        ...transaction,
      },
    };
  }

  beforeEach(() => {
    tx = {
      $queryRaw: vi.fn().mockResolvedValue([
        { id: senderWalletId },
        { id: receiverWalletId },
      ]),
      wallet: {
        findMany: vi.fn().mockResolvedValue([
          senderWallet,
          receiverWallet,
        ]),
      },
      transfer: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(
          existingTransfer(),
        ),
      },
    };

    prisma = {
      wallet: {
        findUnique: vi.fn().mockResolvedValue({
          id: senderWalletId,
        }),
      },
      transfer: {
        findUnique: vi.fn(),
      },
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };

    ledgerService = {
      createDraft: vi.fn().mockResolvedValue(journal),
      postJournal: vi.fn().mockResolvedValue({
        ...journal,
        status: 'POSTED',
      }),
    };

    transactionService = {
      create: vi.fn().mockResolvedValue(transaction),
    };

    service = new TransferService(
      prisma as unknown as PrismaService,
      ledgerService as unknown as LedgerService,
      transactionService as unknown as TransactionService,
    );
  });

  it('should create a transfer successfully', async () => {
    const result = await service.create(userId, input);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

    expect(tx.wallet.findMany).toHaveBeenCalledTimes(1);

    expect(ledgerService.createDraft).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        description,
        lines: [
          {
            accountId: senderAccountId,
            side: JournalLineSide.DEBIT,
            amount,
          },
          {
            accountId: receiverAccountId,
            side: JournalLineSide.CREDIT,
            amount,
          },
        ],
      }),
    );

    expect(ledgerService.postJournal).toHaveBeenCalledWith(
      tx,
      journal.id,
    );

    expect(transactionService.create).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: TransactionType.TRANSFER,
        amount,
        currency: 'IDR',
        journalEntryId: journal.id,
      }),
    );

    expect(tx.transfer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transactionId: transaction.id,
          senderWalletId,
          receiverWalletId,
          idempotencyKey,
          requestHash: createRequestHash(),
        }),
      }),
    );

    expect(result.transaction.amount).toBe('100000');
  });

  it('should reject when sender wallet does not exist', async () => {
    prisma.wallet.findUnique.mockResolvedValue(null);

    await expect(
      service.create(userId, input),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('should reject transfer to the same wallet', async () => {
    await expect(
      service.create(userId, {
        ...input,
        receiverWalletId: senderWalletId,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('should reject when receiver wallet does not exist', async () => {
    tx.$queryRaw.mockResolvedValue([
      { id: senderWalletId },
    ]);

    await expect(
      service.create(userId, input),
    ).rejects.toThrow(NotFoundException);

    expect(ledgerService.createDraft).not.toHaveBeenCalled();
  });

  it('should return existing transfer for the same idempotency request', async () => {
    const previousTransfer = existingTransfer();

    tx.transfer.findUnique.mockResolvedValue(
      previousTransfer,
    );

    const result = await service.create(userId, input);

    expect(result.id).toBe(previousTransfer.id);

    expect(result.transaction.amount).toBe('100000');

    expect(ledgerService.createDraft).not.toHaveBeenCalled();

    expect(transactionService.create).not.toHaveBeenCalled();

    expect(tx.transfer.create).not.toHaveBeenCalled();
  });

  it('should reject reused idempotency key with different request data', async () => {
    tx.transfer.findUnique.mockResolvedValue(
      existingTransfer(),
    );

    await expect(
      service.create(userId, {
        ...input,
        amount: 200_000n,
      }),
    ).rejects.toThrow(ConflictException);

    expect(ledgerService.createDraft).not.toHaveBeenCalled();
  });

  it('should reject when either wallet is inactive', async () => {
    tx.wallet.findMany.mockResolvedValue([
      senderWallet,
      {
        ...receiverWallet,
        status: WalletStatus.FROZEN,
      },
    ]);

    await expect(
      service.create(userId, input),
    ).rejects.toThrow(BadRequestException);

    expect(ledgerService.createDraft).not.toHaveBeenCalled();
  });

  it('should reject when wallet currencies do not match', async () => {
    tx.wallet.findMany.mockResolvedValue([
      senderWallet,
      {
        ...receiverWallet,
        currency: 'USD',
      },
    ]);

    await expect(
      service.create(userId, input),
    ).rejects.toThrow(BadRequestException);

    expect(ledgerService.createDraft).not.toHaveBeenCalled();
  });

  it('should reject when wallet account is invalid', async () => {
    tx.wallet.findMany.mockResolvedValue([
      senderWallet,
      {
        ...receiverWallet,
        account: {
          ...receiverWallet.account,
          type: AccountType.ASSET,
        },
      },
    ]);

    await expect(
      service.create(userId, input),
    ).rejects.toThrow(BadRequestException);

    expect(ledgerService.createDraft).not.toHaveBeenCalled();
  });

  it('should propagate insufficient balance error from LedgerService', async () => {
    ledgerService.postJournal.mockRejectedValue(
      new BadRequestException('Insufficient account balance'),
    );

    await expect(
      service.create(userId, input),
    ).rejects.toThrow('Insufficient account balance');

    expect(transactionService.create).not.toHaveBeenCalled();

    expect(tx.transfer.create).not.toHaveBeenCalled();
  });

  it('should not create transaction when journal creation fails', async () => {
    ledgerService.createDraft.mockRejectedValue(
      new Error('Journal creation failed'),
    );

    await expect(
      service.create(userId, input),
    ).rejects.toThrow('Journal creation failed');

    expect(ledgerService.postJournal).not.toHaveBeenCalled();

    expect(transactionService.create).not.toHaveBeenCalled();
  });

  it('should propagate transaction creation failure', async () => {
    transactionService.create.mockRejectedValue(
      new Error('Transaction creation failed'),
    );

    await expect(
      service.create(userId, input),
    ).rejects.toThrow('Transaction creation failed');

    expect(tx.transfer.create).not.toHaveBeenCalled();
  });

  it('should reject zero or negative transfer amount', async () => {
    await expect(
      service.create(userId, {
        ...input,
        amount: 0n,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.create(userId, {
        ...input,
        amount: -100n,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('should reject amount exceeding BIGINT maximum', async () => {
    await expect(
      service.create(userId, {
        ...input,
        amount: 9223372036854775808n,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject empty idempotency key', async () => {
    await expect(
      service.create(userId, {
        ...input,
        idempotencyKey: ' ',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject empty description', async () => {
    await expect(
      service.create(userId, {
        ...input,
        description: ' ',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
