-- Every statement here is IF NOT EXISTS on purpose. Another project shares this
-- database and may have already created (or destroyed) these objects, so this
-- migration has to be safe to re-run at any time.

-- CreateTable AdminSession
CREATE TABLE IF NOT EXISTS "AdminSession" (
    "token" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminSession_adminId_idx" ON "AdminSession"("adminId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- Add missing columns to GovernmentReference
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "seedSupport" INTEGER DEFAULT 0;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "seedOppose" INTEGER DEFAULT 0;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "citizenBrief" TEXT;

-- NOTE: this migration previously ended with
--     ALTER TABLE "User" DROP COLUMN IF EXISTS "banned";
-- It was removed on 2026-08-08. That column belongs to the Civic Voice mobile
-- project, which shares this database; dropping it destroyed 423 rows' worth of
-- values and broke banning on mobile. See the comment on User.banned in
-- schema.prisma. Do not reintroduce a DROP here.

-- Keep this migration additive: it must be safe to run against a database that
-- the mobile project is also writing to.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "banned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "banReason" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "banExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "displayUsername" TEXT;
