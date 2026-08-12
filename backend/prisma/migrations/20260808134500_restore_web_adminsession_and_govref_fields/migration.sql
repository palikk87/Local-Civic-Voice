-- Restore the schema objects that Civic Voice web owns and that our
-- boot-time `prisma db push --accept-data-loss` had dropped from the
-- shared Supabase Postgres database.
--
-- This migration is strictly additive: 3 ADD COLUMN, 1 CREATE TABLE,
-- 2 CREATE INDEX. It contains no DROP statements and does not modify
-- any existing row.

-- AlterTable
ALTER TABLE "GovernmentReference" ADD COLUMN     "citizenBrief" TEXT,
ADD COLUMN     "seedOppose" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "seedSupport" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AdminSession" (
    "token" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "AdminSession_adminId_idx" ON "AdminSession"("adminId");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
