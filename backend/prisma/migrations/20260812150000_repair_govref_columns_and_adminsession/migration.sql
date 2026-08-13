-- Repairs schema drift between prisma/schema.prisma and the production database.
--
-- WHY THIS EXISTS
--
-- _prisma_migrations records 20260808134500_restore_web_adminsession_and_govref_fields
-- and 20260808140357_add_admin_session as applied, but their effects are not in
-- the database. Verified directly against production: selecting any of the
-- columns below returns PostgreSQL 42703 (undefined_column) — the same error a
-- deliberately fake column name returns, and it survives a schema-cache reload.
--
-- The likely cause is the `prisma db push --accept-data-loss` that used to run on
-- every backend boot (removed in the Vibecode migration). It reshaped the database
-- to match whichever service booted last, against an instance shared by the web
-- and mobile clients. The same mechanism destroyed 423 rows of User.banned — see
-- the comment in 20260808140357_add_admin_session/migration.sql.
--
-- IMPACT WITHOUT THIS MIGRATION
--
-- Prisma names columns explicitly in its generated SQL, so every query selecting
-- these fields throws 42703. That includes:
--   services/post-reference-view.ts   citizenBrief        -> Citizen's Brief
--   services/delegation-service.ts    seedSupport/Oppose  -> delegation tallies
--   services/reference-content.ts     contentStatus, etc. -> brief generation
--
-- SAFETY
--
-- Every statement is ADD COLUMN IF NOT EXISTS / CREATE ... IF NOT EXISTS. This
-- migration is purely additive: it adds nothing that can overwrite existing data
-- and drops nothing. It is safe to run repeatedly, and safe against a database
-- the other client is writing to concurrently. Do not add a DROP here.

-- ---------------------------------------------------------------------------
-- GovernmentReference: the 12 columns confirmed missing in production.
-- Defaults match prisma/schema.prisma exactly.
-- ---------------------------------------------------------------------------

ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "citizenBrief"      TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "citizenBriefJson"  TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "citizenBriefAt"    TIMESTAMP(3);
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "citizenBriefModel" TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "fullTextSource"    TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "fullTextUrl"       TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "fullTextHash"      TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "fullTextAt"        TIMESTAMP(3);
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "sourceCheckedAt"   TIMESTAMP(3);
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "contentStatus"     TEXT;

-- These two are NOT NULL with a default in the schema. Adding them with the
-- default backfills existing rows to 0, which is the correct seed value.
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "seedSupport" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "seedOppose"  INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- AdminSession: admin login writes here, so its absence breaks the admin panel.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "AdminSession" (
    "token"     TEXT NOT NULL PRIMARY KEY,
    "adminId"   TEXT NOT NULL,
    "username"  TEXT NOT NULL,
    "role"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "AdminSession_adminId_idx"   ON "AdminSession"("adminId");
CREATE INDEX IF NOT EXISTS "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
