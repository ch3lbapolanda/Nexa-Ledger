BEGIN;

CREATE TYPE "TransactionType" AS ENUM (
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER'
);

CREATE TYPE "TransactionStatus" AS ENUM (
  'COMPLETED',
  'REVERSED'
);

CREATE TABLE financial_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  reference VARCHAR(100) NOT NULL,
  type "TransactionType" NOT NULL,
  status "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
  amount BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'IDR',
  description VARCHAR(255) NOT NULL,
  "journalEntryId" UUID NOT NULL,
  "completedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT financial_transactions_pkey
    PRIMARY KEY (id),

  CONSTRAINT financial_transactions_reference_key
    UNIQUE (reference),

  CONSTRAINT financial_transactions_journalEntryId_key
    UNIQUE ("journalEntryId"),

  CONSTRAINT financial_transactions_amount_check
    CHECK (amount > 0),

  CONSTRAINT financial_transactions_journalEntryId_fkey
    FOREIGN KEY ("journalEntryId")
    REFERENCES journal_entries(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE INDEX financial_transactions_type_status_createdAt_idx
  ON financial_transactions (type, status, "createdAt");

CREATE INDEX financial_transactions_createdAt_idx
  ON financial_transactions ("createdAt");

COMMIT;
