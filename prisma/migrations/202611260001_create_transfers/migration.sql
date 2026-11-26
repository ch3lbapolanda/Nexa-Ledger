
BEGIN;

CREATE TABLE transfers (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  "transactionId" UUID NOT NULL,
  "senderWalletId" UUID NOT NULL,
  "receiverWalletId" UUID NOT NULL,
  "idempotencyKey" VARCHAR(100) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT transfers_pkey
    PRIMARY KEY (id),

  CONSTRAINT transfers_transactionId_key
    UNIQUE ("transactionId"),

  CONSTRAINT transfers_sender_idempotency_key
    UNIQUE ("senderWalletId", "idempotencyKey"),

  CONSTRAINT transfers_different_wallets_check
    CHECK ("senderWalletId" <> "receiverWalletId"),

  CONSTRAINT transfers_transactionId_fkey
    FOREIGN KEY ("transactionId")
    REFERENCES financial_transactions(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT transfers_senderWalletId_fkey
    FOREIGN KEY ("senderWalletId")
    REFERENCES wallets(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT transfers_receiverWalletId_fkey
    FOREIGN KEY ("receiverWalletId")
    REFERENCES wallets(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE INDEX transfers_senderWalletId_createdAt_idx
  ON transfers ("senderWalletId", "createdAt");

CREATE INDEX transfers_receiverWalletId_createdAt_idx
  ON transfers ("receiverWalletId", "createdAt");

COMMIT;
