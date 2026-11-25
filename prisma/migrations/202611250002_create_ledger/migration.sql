
CREATE TYPE "JournalEntryStatus" AS ENUM (
  'DRAFT',
  'POSTED'
);

CREATE TYPE "JournalLineSide" AS ENUM (
  'DEBIT',
  'CREDIT'
);

CREATE TABLE "journal_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reference" VARCHAR(100),
  "description" VARCHAR(255) NOT NULL,
  "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
  "postedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "journal_entries_pkey"
    PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "journal_entries_reference_key"
ON "journal_entries"("reference");

CREATE INDEX "journal_entries_status_createdAt_idx"
ON "journal_entries"("status", "createdAt");

CREATE INDEX "journal_entries_postedAt_idx"
ON "journal_entries"("postedAt");

CREATE TABLE "journal_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "journalEntryId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "side" "JournalLineSide" NOT NULL,
  "amount" BIGINT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "journal_lines_pkey"
    PRIMARY KEY ("id"),

  CONSTRAINT "journal_lines_amount_positive"
    CHECK ("amount" > 0),

  CONSTRAINT "journal_lines_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId")
    REFERENCES "journal_entries"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "journal_lines_accountId_fkey"
    FOREIGN KEY ("accountId")
    REFERENCES "accounts"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE INDEX "journal_lines_journalEntryId_idx"
ON "journal_lines"("journalEntryId");

CREATE INDEX "journal_lines_accountId_createdAt_idx"
ON "journal_lines"("accountId", "createdAt");
