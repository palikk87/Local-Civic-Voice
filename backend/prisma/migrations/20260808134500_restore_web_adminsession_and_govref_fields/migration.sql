-- Restore the schema objects that Civic Voice web owns and that a boot-time
-- `prisma db push --accept-data-loss` had dropped from the shared Supabase
-- Postgres database.
--
-- Strictly additive: 3 ADD COLUMN, 1 CREATE TABLE, 2 CREATE INDEX. No DROP
-- statements, no row is modified.
--
-- IDEMPOTENT ON PURPOSE. Every statement is guarded, for two reasons:
--
--   1. Building a fresh database starts from db/postgres-baseline.sql, which
--      already contains every object in schema.prisma. Without these guards
--      `migrate deploy` fails here with 42701 "column citizenBrief of relation
--      GovernmentReference already exists" — verified against a real Postgres,
--      not assumed.
--
--   2. This database has been reshaped underneath the application repeatedly, so
--      a migration that cannot tolerate objects already existing is a migration
--      that will eventually fail at the worst moment.
--
-- Splitting the combined ALTER into three separate statements is what allows
-- per-column guards; Postgres has no IF NOT EXISTS for a multi-column ALTER.

-- AlterTable
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "citizenBrief" TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "seedOppose"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "seedSupport" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AdminSession" (
    "token" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminSession_adminId_idx" ON "AdminSession"("adminId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
