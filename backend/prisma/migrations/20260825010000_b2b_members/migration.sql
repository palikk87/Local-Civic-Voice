-- Seats on a B2B account: a person, not a company.
--
-- ADDITIVE AND IDEMPOTENT. This database is shared with another project, so
-- nothing is dropped and nothing existing is rewritten. The three columns added
-- to B2BSession are all nullable with no default, which is what makes ADD
-- COLUMN safe on a live table: every session already open keeps working and
-- reads as the account owner, which is exactly what it was.
CREATE TABLE IF NOT EXISTS "B2BMember" (
    "id"           TEXT NOT NULL,
    "clientId"     TEXT NOT NULL,
    "username"     TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "email"        TEXT,
    "role"         TEXT NOT NULL DEFAULT 'analyst',
    "passwordHash" TEXT NOT NULL,
    "disabled"     BOOLEAN NOT NULL DEFAULT false,
    "lastAccessAt" TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "B2BMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "B2BMember_username_key" ON "B2BMember"("username");
CREATE INDEX IF NOT EXISTS "B2BMember_clientId_idx" ON "B2BMember"("clientId");

ALTER TABLE "B2BSession" ADD COLUMN IF NOT EXISTS "memberId"   TEXT;
ALTER TABLE "B2BSession" ADD COLUMN IF NOT EXISTS "memberRole" TEXT;
ALTER TABLE "B2BSession" ADD COLUMN IF NOT EXISTS "memberName" TEXT;

CREATE INDEX IF NOT EXISTS "B2BSession_memberId_idx" ON "B2BSession"("memberId");
