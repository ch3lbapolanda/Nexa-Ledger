ALTER TABLE "financial_transactions"
ADD COLUMN "reversalOfId" UUID;

CREATE UNIQUE INDEX "financial_transactions_reversalOfId_key"
ON "financial_transactions"("reversalOfId");

ALTER TABLE "financial_transactions"
ADD CONSTRAINT "financial_transactions_reversalOfId_fkey"
FOREIGN KEY ("reversalOfId")
REFERENCES "financial_transactions"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
