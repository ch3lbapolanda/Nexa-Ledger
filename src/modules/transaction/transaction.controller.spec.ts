
import {
  ForbiddenException,
} from '@nestjs/common';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { UserRole } from '../../generated/prisma/client.js';

import { TransactionHistoryQueryDto } from './transaction-history-query.dto.js';
import { TransactionController } from './transaction.controller.js';
import { TransactionReversalService } from './transaction-reversal.service.js';
import { TransactionService } from './transaction.service.js';

describe('TransactionController', () => {
  let controller: TransactionController;

  const transactionServiceMock = {
    list: vi.fn(),
  };

  const reversalServiceMock = {
    reverse: vi.fn(),
  };

  const transactionId =
    '22222222-2222-4222-8222-222222222222';

  const userId =
    '44444444-4444-4444-8444-444444444444';

  beforeEach(() => {
    vi.clearAllMocks();

    controller = new TransactionController(
      transactionServiceMock as unknown as TransactionService,
      reversalServiceMock as unknown as TransactionReversalService,
    );
  });

  describe('findAll', () => {
    it('should forward user identity, role, and query to TransactionService', async () => {
      const query = {
        page: 2,
        limit: 10,
      } as TransactionHistoryQueryDto;

      const expectedResult = {
        data: [],
        meta: {
          page: 2,
          limit: 10,
          total: 0,
          totalPages: 0,
        },
      };

      transactionServiceMock.list.mockResolvedValue(
        expectedResult,
      );

      const request = {
        user: {
          sub: userId,
          email: 'admin@nexa.test',
          role: UserRole.ADMIN,
        },
      };

      const result = await controller.findAll(
        query,
        request,
      );

      expect(
        transactionServiceMock.list,
      ).toHaveBeenCalledWith(
        userId,
        UserRole.ADMIN,
        query,
      );

      expect(result).toEqual(expectedResult);
    });
  });

  describe('reverse', () => {
    it('should forward reversal request with actor ID, IP, and User-Agent', async () => {
      const expectedResult = {
        originalTransactionId: transactionId,
        originalStatus: 'REVERSED',
      };

      reversalServiceMock.reverse.mockResolvedValue(
        expectedResult,
      );

      const request = {
        user: {
          sub: userId,
          email: 'admin@nexa.test',
          role: UserRole.ADMIN,
        },
        ip: '192.168.1.10',
        headers: {
          'user-agent': 'NexaLedger-Test/1.0',
        },
      };

      const result = await controller.reverse(
        transactionId,
        request,
      );

      expect(
        reversalServiceMock.reverse,
      ).toHaveBeenCalledWith({
        transactionId,
        actorId: userId,
        ipAddress: '192.168.1.10',
        userAgent: 'NexaLedger-Test/1.0',
      });

      expect(result).toEqual(expectedResult);
    });

    it('should use null when IP and User-Agent are unavailable', async () => {
      reversalServiceMock.reverse.mockResolvedValue({});

      const request = {
        user: {
          sub: userId,
          email: 'admin@nexa.test',
          role: UserRole.ADMIN,
        },
        headers: {},
      };

      await controller.reverse(
        transactionId,
        request,
      );

      expect(
        reversalServiceMock.reverse,
      ).toHaveBeenCalledWith({
        transactionId,
        actorId: userId,
        ipAddress: null,
        userAgent: null,
      });
    });

    it('should reject CUSTOMER from reversing transactions', async () => {
      const request = {
        user: {
          sub: userId,
          email: 'customer@nexa.test',
          role: UserRole.CUSTOMER,
        },
        ip: '192.168.1.20',
        headers: {
          'user-agent': 'NexaLedger-Test/1.0',
        },
      };

      await expect(
        controller.reverse(transactionId, request),
      ).rejects.toThrow(ForbiddenException);

      expect(
        reversalServiceMock.reverse,
      ).not.toHaveBeenCalled();
    });

    it('should reject reversal for unsupported roles', async () => {
      const request = {
        user: {
          sub: userId,
          email: 'unknown@nexa.test',
          role: 'UNKNOWN' as UserRole,
        },
        headers: {},
      };

      await expect(
        controller.reverse(transactionId, request),
      ).rejects.toThrow(ForbiddenException);

      expect(
        reversalServiceMock.reverse,
      ).not.toHaveBeenCalled();
    });
  });
});
