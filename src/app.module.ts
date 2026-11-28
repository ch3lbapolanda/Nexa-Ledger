import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import Joi from 'joi';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { AuthenticationModule } from './modules/authentication/authentication.module.js';
import { WalletModule } from './modules/wallet/wallet.module.js';
import { TransactionModule } from './modules/transaction/transaction.module.js';
import { TransferModule } from './modules/transfer/transfer.module.js';
import { AccountModule } from './modules/account/account.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        PORT: Joi.number().port().default(3000),
        DATABASE_URL: Joi.string().required(),
        JWT_SECRET: Joi.string().min(32).required(),
      }),
    }),

    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),

    DatabaseModule,
    IdentityModule,
    AuthenticationModule,
    AccountModule,
    WalletModule,
    TransactionModule,
    TransferModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}