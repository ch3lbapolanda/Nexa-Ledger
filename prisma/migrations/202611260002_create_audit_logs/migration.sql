
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actorId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(100) NOT NULL,
    "entityId" UUID,
    "metadata" JSONB,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_logs_actorId_fkey"
        FOREIGN KEY ("actorId")
        REFERENCES "users"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE
);

CREATE INDEX "audit_logs_actorId_createdAt_idx"
    ON "audit_logs"("actorId", "createdAt");

CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx"
    ON "audit_logs"("entityType", "entityId", "createdAt");

CREATE INDEX "audit_logs_action_createdAt_idx"
    ON "audit_logs"("action", "createdAt");
