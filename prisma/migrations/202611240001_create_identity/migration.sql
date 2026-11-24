
CREATE TYPE "UserRole" AS ENUM (
    'CUSTOMER',
    'ADMIN'
);

CREATE TYPE "UserStatus" AS ENUM (
    'ACTIVE',
    'SUSPENDED',
    'PENDING_VERIFICATION'
);

CREATE TYPE "AuthProvider" AS ENUM (
    'LOCAL',
    'GOOGLE',
    'APPLE'
);

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key"
ON "users"("email");

CREATE TABLE "user_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerUserId" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "user_credentials_userId_fkey"
        FOREIGN KEY ("userId")
        REFERENCES "users"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_credentials_provider_providerUserId_key"
ON "user_credentials"("provider", "providerUserId");

CREATE INDEX "user_credentials_userId_idx"
ON "user_credentials"("userId");
