-- Article V, part one: impeachment.
--
-- The Article V page has existed since the first build and has always been
-- theatre — three hardcoded people, invented tallies, and a Vote to Impeach
-- button that flipped a variable in the browser. These two tables are what
-- makes the button mean something.
--
-- WHAT IMPEACHMENT DOES: suspends one person from RECEIVING delegated voice,
-- and nothing else. The account, the followers, the posts and the person's own
-- vote are untouched. The constitution says power here is borrowed;
-- impeachment calls in the loan, it does not silence a citizen.
--
-- ADDITIVE AND IDEMPOTENT. This database is shared with another project, so
-- every statement is guarded and nothing existing is altered or dropped.

CREATE TABLE IF NOT EXISTS "Impeachment" (
    "id"             TEXT NOT NULL,
    "leaderId"       TEXT NOT NULL,
    "filedById"      TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'open',
    "grounds"        TEXT NOT NULL,
    "evidence"       TEXT NOT NULL,
    "openedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"      TIMESTAMP(3) NOT NULL,
    "decidedAt"      TIMESTAMP(3),
    "suspendedUntil" TIMESTAMP(3),
    CONSTRAINT "Impeachment_pkey" PRIMARY KEY ("id")
);

-- The frozen electorate. A row is the right to vote; there is no other check.
CREATE TABLE IF NOT EXISTS "ImpeachmentElector" (
    "id"            TEXT NOT NULL,
    "impeachmentId" TEXT NOT NULL,
    "voterId"       TEXT NOT NULL,
    "votedAt"       TIMESTAMP(3),
    "proposedDays"  INTEGER,
    CONSTRAINT "ImpeachmentElector_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Impeachment_leaderId_status_idx" ON "Impeachment"("leaderId", "status");
CREATE INDEX IF NOT EXISTS "Impeachment_status_expiresAt_idx" ON "Impeachment"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "Impeachment_filedById_idx" ON "Impeachment"("filedById");
CREATE UNIQUE INDEX IF NOT EXISTS "ImpeachmentElector_impeachmentId_voterId_key" ON "ImpeachmentElector"("impeachmentId", "voterId");
CREATE INDEX IF NOT EXISTS "ImpeachmentElector_voterId_idx" ON "ImpeachmentElector"("voterId");

-- Foreign keys, added only if absent. ADD CONSTRAINT has no IF NOT EXISTS in
-- PostgreSQL 16, so each one is guarded by a lookup instead.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Impeachment_leaderId_fkey') THEN
        ALTER TABLE "Impeachment" ADD CONSTRAINT "Impeachment_leaderId_fkey"
            FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Impeachment_filedById_fkey') THEN
        ALTER TABLE "Impeachment" ADD CONSTRAINT "Impeachment_filedById_fkey"
            FOREIGN KEY ("filedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ImpeachmentElector_impeachmentId_fkey') THEN
        ALTER TABLE "ImpeachmentElector" ADD CONSTRAINT "ImpeachmentElector_impeachmentId_fkey"
            FOREIGN KEY ("impeachmentId") REFERENCES "Impeachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ImpeachmentElector_voterId_fkey') THEN
        ALTER TABLE "ImpeachmentElector" ADD CONSTRAINT "ImpeachmentElector_voterId_fkey"
            FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
