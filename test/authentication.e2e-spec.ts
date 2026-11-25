import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordHasherService } from '../src/modules/identity/password-hasher.service.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';

describe('Authentication (e2e)', () => {
  let app: INestApplication<App>;

  const activeUser = {
    id: '7fe023a4-c564-48b4-9ab7-ce41dc1648aa',
    email: 'budi@nexaledger.test',
    fullName: 'Budi Santoso',
    role: 'CUSTOMER',
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

  beforeEach(async () => {
    currentUser = { ...activeUser };

    prismaMock.user.findUnique.mockImplementation(
      async () => currentUser,
    );

    passwordHasherMock.verify.mockImplementation(
      async (password: string) =>
        password === 'CorrectPassword123!',
    );

    const moduleFixture: TestingModule =
      await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(prismaMock)
        .overrideProvider(PasswordHasherService)
        .useValue(passwordHasherMock)
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

  describe('POST /auth/login', () => {
    it('should login with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'budi@nexaledger.test',
          password: 'CorrectPassword123!',
        })
        .expect(201);

      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.tokenType).toBe('Bearer');
      expect(response.body.data.expiresIn).toBe(900);

      expect(response.body.data.user).toMatchObject({
        id: activeUser.id,
        email: activeUser.email,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      });
    });

    it('should reject incorrect password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'budi@nexaledger.test',
          password: 'WrongPassword123!',
        })
        .expect(401);
    });

    it('should reject unknown email', async () => {
      currentUser = null;

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'unknown@nexaledger.test',
          password: 'CorrectPassword123!',
        })
        .expect(401);

      expect(passwordHasherMock.verify).not.toHaveBeenCalled();
    });

    it('should reject suspended account', async () => {
      currentUser = {
        ...activeUser,
        status: 'SUSPENDED',
      };

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'budi@nexaledger.test',
          password: 'CorrectPassword123!',
        })
        .expect(403);
    });

    it('should reject account pending verification', async () => {
      currentUser = {
        ...activeUser,
        status: 'PENDING_VERIFICATION',
      };

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'budi@nexaledger.test',
          password: 'CorrectPassword123!',
        })
        .expect(403);
    });

    it('should reject invalid request payload', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'not-an-email',
          password: '123',
        })
        .expect(400);
    });

    it('should reject requests exceeding login rate limit', async () => {
      const loginRequest = () =>
        request(app.getHttpServer())
          .post('/auth/login')
          .send({
            email: 'budi@nexaledger.test',
            password: 'CorrectPassword123!',
          });

      for (let attempt = 0; attempt < 5; attempt++) {
        await loginRequest().expect(201);
      }

      await loginRequest().expect(429);
    });
  });

  describe('GET /auth/me', () => {
    it('should reject request without access token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .expect(401);
    });

    it('should reject token when account becomes suspended', async () => {
  const loginResponse = await request(app.getHttpServer())
    .post('/auth/login')
    .send({
      email: 'budi@nexaledger.test',
      password: 'CorrectPassword123!',
    })
    .expect(201);

  const accessToken = loginResponse.body.data.accessToken;

  currentUser = {
    ...activeUser,
    status: 'SUSPENDED',
  };

  await request(app.getHttpServer())
    .get('/auth/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(401);
});

it('should reject token when user role has changed', async () => {
  const loginResponse = await request(app.getHttpServer())
    .post('/auth/login')
    .send({
      email: 'budi@nexaledger.test',
      password: 'CorrectPassword123!',
    })
    .expect(201);

  const accessToken = loginResponse.body.data.accessToken;

  currentUser = {
    ...activeUser,
    role: 'ADMIN',
  };

  await request(app.getHttpServer())
    .get('/auth/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(401);
});

it('should reject token when user no longer exists', async () => {
  const loginResponse = await request(app.getHttpServer())
    .post('/auth/login')
    .send({
      email: 'budi@nexaledger.test',
      password: 'CorrectPassword123!',
    })
    .expect(201);

  const accessToken = loginResponse.body.data.accessToken;

  currentUser = null;

  await request(app.getHttpServer())
    .get('/auth/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(401);
});

    it('should reject invalid access token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should return authenticated user with valid access token', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'budi@nexaledger.test',
          password: 'CorrectPassword123!',
        })
        .expect(201);

      const accessToken = loginResponse.body.data.accessToken;

      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data).toMatchObject({
        sub: activeUser.id,
        email: activeUser.email,
        role: 'CUSTOMER',
      });
    });
  });
});