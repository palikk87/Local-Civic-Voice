-- Article V, part two: the System-Wide Reset.
--
-- The heavier remedy. Impeachment recalls one person's borrowed power; this
-- returns all of it and zeroes every published tally, so the Pulse genuinely
-- starts again. Two weeks of voting, a majority of the platform having to turn
-- out at all, two thirds of those who did, and then FORTY-EIGHT HOURS before
-- anything happens — announced, with a full account of what is about to be
-- lost. Nobody loses their delegations to a vote that closed while they slept.
--
-- Everything it destroys is journaled by id inside the same transaction that
-- destroys it, so it can be put back. PositionEvent is not touched at all:
-- every citizen keeps their own record of every position they ever took.
--
-- ADDITIVE AND IDEMPOTENT. This database is shared with another project.

CREATE TABLE IF NOT EXISTS "SystemReset" (
    "id"            TEXT NOT NULL,
    "filedById"     TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'voting',
    "grounds"       TEXT NOT NULL,
    "evidence"      TEXT NOT NULL,
    "openedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"     TIMESTAMP(3) NOT NULL,
    "decidedAt"     TIMESTAMP(3),
    "executeAfter"  TIMESTAMP(3),
    "executedAt"    TIMESTAMP(3),
    "eligibleCount" INTEGER NOT NULL,
    "revertedAt"    TIMESTAMP(3),
    "revertedBy"    TEXT,
    CONSTRAINT "SystemReset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SystemResetBallot" (
    "id"        TEXT NOT NULL,
    "resetId"   TEXT NOT NULL,
    "voterId"   TEXT NOT NULL,
    "support"   BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SystemResetBallot_pkey" PRIMARY KEY ("id")
);

-- The journal. Written in the same transaction as the mutation it records.
CREATE TABLE IF NOT EXISTS "SystemResetJournalDelegation" (
    "id"           TEXT NOT NULL,
    "resetId"      TEXT NOT NULL,
    "delegationId" TEXT NOT NULL,
    CONSTRAINT "SystemResetJournalDelegation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SystemResetJournalVote" (
    "id"                    TEXT NOT NULL,
    "resetId"               TEXT NOT NULL,
    "governmentReferenceId" TEXT NOT NULL,
    "userId"                TEXT NOT NULL,
    "position"              TEXT NOT NULL,
    "isAnonymous"           BOOLEAN NOT NULL,
    "castAt"                TIMESTAMP(3) NOT NULL,
    "restoredAt"            TIMESTAMP(3),
    CONSTRAINT "SystemResetJournalVote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SystemReset_status_idx" ON "SystemReset"("status");
CREATE INDEX IF NOT EXISTS "SystemReset_status_expiresAt_idx" ON "SystemReset"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "SystemReset_status_executeAfter_idx" ON "SystemReset"("status", "executeAfter");
CREATE UNIQUE INDEX IF NOT EXISTS "SystemResetBallot_resetId_voterId_key" ON "SystemResetBallot"("resetId", "voterId");
CREATE INDEX IF NOT EXISTS "SystemResetBallot_resetId_support_idx" ON "SystemResetBallot"("resetId", "support");
CREATE UNIQUE INDEX IF NOT EXISTS "SystemResetJournalDelegation_resetId_delegationId_key" ON "SystemResetJournalDelegation"("resetId", "delegationId");
CREATE INDEX IF NOT EXISTS "SystemResetJournalDelegation_resetId_idx" ON "SystemResetJournalDelegation"("resetId");
CREATE UNIQUE INDEX IF NOT EXISTS "SystemResetJournalVote_resetId_governmentReferenceId_userId_key" ON "SystemResetJournalVote"("resetId", "governmentReferenceId", "userId");
CREATE INDEX IF NOT EXISTS "SystemResetJournalVote_resetId_userId_idx" ON "SystemResetJournalVote"("resetId", "userId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SystemResetBallot_resetId_fkey') THEN
        ALTER TABLE "SystemResetBallot" ADD CONSTRAINT "SystemResetBallot_resetId_fkey"
            FOREIGN KEY ("resetId") REFERENCES "SystemReset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SystemResetJournalDelegation_resetId_fkey') THEN
        ALTER TABLE "SystemResetJournalDelegation" ADD CONSTRAINT "SystemResetJournalDelegation_resetId_fkey"
            FOREIGN KEY ("resetId") REFERENCES "SystemReset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SystemResetJournalVote_resetId_fkey') THEN
        ALTER TABLE "SystemResetJournalVote" ADD CONSTRAINT "SystemResetJournalVote_resetId_fkey"
            FOREIGN KEY ("resetId") REFERENCES "SystemReset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
