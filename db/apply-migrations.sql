-- GENERATED FILE — do not hand-edit.
--
-- Concatenation of the two pending migrations in backend/prisma/migrations/,
-- for operators who need to apply them through the Supabase SQL Editor rather
-- than `prisma migrate deploy`. The migration directories remain the source of
-- truth; this file is a convenience copy.
--
-- WHAT IT DOES, in full:
--   * ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS  x12
--   * CREATE TABLE IF NOT EXISTS "AdminSession" (+2 indexes)
--   * CREATE TABLE IF NOT EXISTS "Conversation" (+1 index)
--   * CREATE TABLE IF NOT EXISTS "ConversationParticipant" (+2 indexes)
--   * CREATE TABLE IF NOT EXISTS "Message" (+2 indexes)
--   * INSERT 2 bookkeeping rows into "_prisma_migrations", guarded by
--     WHERE NOT EXISTS on migration_name
--   * DELETE duplicate "_prisma_migrations" rows for those two migration names
--
-- SAFETY, stated precisely so it survives a grep:
--
--   * No DROP, no TRUNCATE, no UPDATE statement.
--   * There IS one DELETE, and it touches only the "_prisma_migrations"
--     bookkeeping table, only rows whose migration_name is one of the two names
--     added by this file, and only duplicates of them (it keeps the earliest row
--     per name). It cannot touch application data — no user, post, vote, or
--     reference row is reachable from it.
--   * No existing table is altered except "GovernmentReference", and only by
--     ADD COLUMN IF NOT EXISTS. No column is removed, retyped, or renamed.
--   * Every schema statement is guarded by IF NOT EXISTS, so a second run is a
--     no-op.
--   * The whole thing is wrapped in BEGIN/COMMIT — it applies completely or
--     not at all.
--
-- Why the DELETE exists: the bookkeeping INSERT previously used
-- `VALUES (gen_random_uuid(), …) ON CONFLICT DO NOTHING`. The id is fresh on
-- every run, so it never collided and the conflict clause never fired — each
-- re-run appended another row instead of doing nothing. That left several rows
-- per migration_name and made _prisma_migrations useless as evidence of what
-- had actually been applied. The DELETE clears that up; the INSERT is now
-- guarded on migration_name so it cannot recur.
--
-- Grepping for "delete" WILL return four hits. They are ON DELETE CASCADE
-- clauses in the foreign keys of the three NEW messaging tables:
--
--     ConversationParticipant.conversationId -> Conversation.id
--     ConversationParticipant.userId         -> User.id
--     Message.conversationId                 -> Conversation.id
--     Message.senderId                       -> User.id
--
-- Those are column definitions inside CREATE TABLE, not delete statements. They
-- mean "if a conversation or user is deleted later, clean up its messages" —
-- ordinary referential integrity on a child table. No cascade is added to any
-- existing table; "User" and every other current table are untouched by them.
--
-- To confirm nothing destructive executes, ignore comment lines and read the
-- statements themselves:
--
--     grep -v '^--' db/apply-migrations.sql | grep -inE '\b(drop|truncate)\b'
--     grep -v '^--' db/apply-migrations.sql | grep -inE '^ *update\b'
--
-- Both return nothing. A search for DELETE returns the single
-- "_prisma_migrations" de-duplication described above and the four
-- ON DELETE CASCADE column definitions — read them and confirm for yourself.
--
-- The two INTEGER columns are added NOT NULL DEFAULT 0, which backfills existing
-- rows to 0 — the correct seed value for a vote counter.

-- Civic Voice: apply the two pending migrations.
-- Paste into the Supabase SQL Editor and Run. Safe to run more than once:
-- every schema statement is IF NOT EXISTS and the bookkeeping insert is guarded
-- on migration_name.
--
-- Generated from the migration files committed on
-- claude/migrate-vibecode-projects-jrasfg (193c622).

BEGIN;

-- ===========================================================================
-- 20260812150000_repair_govref_columns_and_adminsession
-- ===========================================================================
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

-- ===========================================================================
-- 20260812151000_add_direct_messaging
-- ===========================================================================
-- Direct messaging persistence.
--
-- routes/messages.ts previously served an in-memory mock: a hardcoded
-- "current_user", module-level arrays, and integer counters. Every restart wiped
-- it, and every caller saw the same fake conversations. These tables replace it.
--
-- SAFETY
--
-- Additive only. Every statement is IF NOT EXISTS, so this is safe to re-run and
-- safe against a database the mobile client is also writing to. Foreign keys are
-- declared inline in CREATE TABLE (Postgres has no ADD CONSTRAINT IF NOT EXISTS),
-- which keeps the whole migration idempotent without DO blocks.

CREATE TABLE IF NOT EXISTS "Conversation" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- Conversation lists are ordered by most recent activity.
CREATE INDEX IF NOT EXISTS "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");

CREATE TABLE IF NOT EXISTS "ConversationParticipant" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "userId"         TEXT NOT NULL REFERENCES "User"("id")         ON DELETE CASCADE ON UPDATE CASCADE,
    "lastReadAt"     TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per user per conversation. Also the membership lookup that every
-- message endpoint uses to authorize a caller.
CREATE UNIQUE INDEX IF NOT EXISTS "ConversationParticipant_conversationId_userId_key"
    ON "ConversationParticipant"("conversationId", "userId");
CREATE INDEX IF NOT EXISTS "ConversationParticipant_userId_idx"
    ON "ConversationParticipant"("userId");

CREATE TABLE IF NOT EXISTS "Message" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "senderId"       TEXT NOT NULL REFERENCES "User"("id")         ON DELETE CASCADE ON UPDATE CASCADE,
    "content"        TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Paging a thread is (conversationId, createdAt) ordered.
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx"
    ON "Message"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_senderId_idx" ON "Message"("senderId");

-- ===========================================================================
-- Record both as applied, so prisma migrate deploy does not re-run them.
--
-- Checksums are the sha256 of the committed migration.sql files, which is what
-- Prisma compares against.
--
-- INSERT ... SELECT ... WHERE NOT EXISTS, not ON CONFLICT DO NOTHING. The id is
-- a fresh gen_random_uuid() every run, so it never collides with an existing
-- row and the conflict clause never fires — re-running this file appended a
-- duplicate row each time instead of doing nothing. Keying the guard on
-- migration_name is what actually makes it idempotent.
--
-- The DELETE first clears duplicates a previous run left behind, keeping the
-- earliest row per migration_name. It touches only these two names.
-- ===========================================================================

DELETE FROM "_prisma_migrations" a
USING "_prisma_migrations" b
WHERE a.migration_name = b.migration_name
  AND a.migration_name IN (
    '20260812150000_repair_govref_columns_and_adminsession',
    '20260812151000_add_direct_messaging'
  )
  AND a.ctid > b.ctid;

INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, 'b30e5ab6b9797b47e7f737ef2acd485df5958ab609df17a19235451b0cdeef23', now(), '20260812150000_repair_govref_columns_and_adminsession', NULL, NULL, now(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260812150000_repair_govref_columns_and_adminsession'
);

INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, '5a26bbc0eab125cb7c414ef8ab4199ab3aa892d2973838a26dd08065786e6eea', now(), '20260812151000_add_direct_messaging', NULL, NULL, now(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260812151000_add_direct_messaging'
);

COMMIT;
