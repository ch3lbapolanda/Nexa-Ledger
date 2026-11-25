CREATE TYPE "WalletStatus" AS ENUM (
  'ACTIVE',
  'FROZEN',
  'CLOSED'
);

CREATE TYPE "AccountType" AS ENUM (
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE'
);

CREATE TYPE "AccountNormalBalance" AS ENUM (
  'DEBIT',
  'CREDIT'
);

CREATE TYPE "AccountStatus" AS ENUM (
  'ACTIVE',
  'FROZEN',
  'CLOSED'
);

CREATE TABLE "wallets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'IDR',
  "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "wallets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallets_userId_fkey"
    FOREIGN KEY ("userId")
    REFERENCES "users"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "wallets_userId_key"
ON "wallets"("userId");

CREATE TABLE "accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "walletId" UUID,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "type" "AccountType" NOT NULL,
  "normalBalance" "AccountNormalBalance" NOT NULL,
  "balance" BIGINT NOT NULL DEFAULT 0,
  "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounts_walletId_fkey"
    FOREIGN KEY ("walletId")
    REFERENCES "wallets"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT "accounts_balance_nonnegative"
    CHECK ("balance" >= 0)
);

CREATE UNIQUE INDEX "accounts_walletId_key"
ON "accounts"("walletId");

CREATE UNIQUE INDEX "accounts_code_key"
ON "accounts"("code");

CREATE INDEX "accounts_type_status_idx"
ON "accounts"("type", "status");