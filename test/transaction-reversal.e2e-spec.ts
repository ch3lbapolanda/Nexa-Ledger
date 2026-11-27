
import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordHasherService } from '../src/modules/identity/password-hasher.service.js';
import { TransactionReversalService } from '../src/modules/transaction/transaction-reversal.service.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';

describe('Transaction Reversal (e2e)', () => {
  let app: INestApplication<App>;

  const activeUser = {
    id: '7fe023a4-c564-48b4-9ab7-ce41dc1648aa',
    email: 'admin@nexaledger.test',
    fullName: 'NexaLedger Admin',
    role: 'ADMIN' as 'ADMIN' | 'CUSTOMER',
    status: 'ACTIVE',
    credentials: [{ passwordHash: 'mock-hash' }],
  };

  let currentUser: typeof activeUser | null;

  const prismaMock = {
    user: {
      findUnique: vi.fn(),
    },
  };

  const passwordHasherMock = {
    verify: vi.fn(),
    hash: vi.fn(),
  };

  const reversalMock = {
    reverse: vi.fn(),
  };

  beforeEach(async () => {
    currentUser = { ...activeUser };

    prismaMock.user.findUnique.mockImplementation(
      async () => currentUser,
    );

    passwordHasherMock.verify.mockImplementation(
      async (password: string) =>
        password === 'CorrectPassword123!',
    );

    reversalMock.reverse.mockResolvedValue({
      originalTransactionId:
        'a1b2c3d4-e5f6-4789-8123-456789abcdef',
      originalReference: 'TRF-ORIGINAL',
      originalStatus: 'REVERSED',
      reversalTransaction: {
        id: 'b1b2c3d4-e5f6-4789-8123-456789abcdef',
        reference: 'REV-TEST',
        amount: '75000',
      },
    });

    const moduleFixture: TestingModule =
      await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(prismaMock)
        .overrideProvider(PasswordHasherService)
        .useValue(passwordHasherMock)
        .overrideProvider(TransactionReversalService)
        .useValue(reversalMock)
        .compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        forbidUnknownValues: true,
      }),
    );

    app.useGlobalFilters(new HttpExceptionFilter());

    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  async function loginAs(
    role: 'ADMIN' | 'CUSTOMER',
  ): Promise<string> {
    currentUser = {
      ...activeUser,
      role,
    };

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: activeUser.email,
        password: 'CorrectPassword123!',
      })
      .expect(201);

    return response.body.data.accessToken as string;
  }

  describe('POST /transactions/:id/reversal', () => {
    const transactionId =
      'a1b2c3d4-e5f6-4789-8123-456789abcdef';

    it('should reject request without access token', async () => {
      await request(app.getHttpServer())
        .post(`/transactions/${transactionId}/reversal`)
        .expect(401);

      expect(reversalMock.reverse).not.toHaveBeenCalled();
    });

    it('should reject CUSTOMER role', async () => {
      const accessToken = await loginAs('CUSTOMER');

      await request(app.getHttpServer())
        .post(`/transactions/${transactionId}/reversal`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);

      expect(reversalMock.reverse).not.toHaveBeenCalled();
    });

    it('should allow ADMIN to reverse a transaction', async () => {
      const accessToken = await loginAs('ADMIN');

      await request(app.getHttpServer())
        .post(`/transactions/${transactionId}/reversal`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);

      expect(reversalMock.reverse).toHaveBeenCalledOnce();

      expect(reversalMock.reverse).toHaveBeenCalledWith({
        transactionId,
        actorId: activeUser.id,
      });
    });

    it('should use authenticated user ID instead of actorId from request body', async () => {
      const accessToken = await loginAs('ADMIN');

      await request(app.getHttpServer())
        .post(`/transactions/${transactionId}/reversal`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          actorId: '11111111-1111-4111-8111-111111111111',
        })
        .expect(201);

      expect(reversalMock.reverse).toHaveBeenCalledWith({
        transactionId,
        actorId: activeUser.id,
      });
    });

    it('should reject invalid transaction UUID', async () => {
      const accessToken = await loginAs('ADMIN');

      await request(app.getHttpServer())
        .post('/transactions/invalid-id/reversal')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      expect(reversalMock.reverse).not.toHaveBeenCalled();
    });
  });
});
