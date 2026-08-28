-- Constitution Article III §2, the Right to Audit: "Any user or group of users
-- may demand an Integrity Audit of a specific vote if there is evidence of bot
-- interference or system malfunction."
--
-- Until now that clause described nothing. This table is where an audit lives.
--
-- WHY IT IS KEPT AND NEVER DELETED. An audit nobody can point at afterwards is
-- not a remedy, it is a reassurance. A civil leader who runs one on their own
-- support every month should end up with a record they can show; a proceeding
-- should carry the audit that ran when it opened. Both need the rows to still
-- be here later.
--
-- WHAT IS NOT IN THIS TABLE: anybody's name. The findings column holds counts,
-- distributions and plain sentences. It never holds an account, a username or
-- an email, and services/integrity-audit.ts is scanned by a test to keep it
-- that way.
--
-- ADDITIVE AND IDEMPOTENT. This database is shared with another project, so
-- every statement is guarded and nothing existing is altered or dropped.

CREATE TABLE IF NOT EXISTS "IntegrityAudit" (
    "id"            TEXT NOT NULL,
    -- reference | leader | impeachment | reset
    "subjectType"   TEXT NOT NULL,
    "subjectId"     TEXT NOT NULL,
    -- Null when the platform ran it itself, which happens on an impeachment
    -- filing. A citizen asked for every other one.
    "requestedById" TEXT,
    -- Set when this audit was run because articles were filed, so the
    -- proceeding can show it beside them.
    "impeachmentId" TEXT,
    "runAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- One object per check: what it looked at, what it found, and the numbers.
    "findings"      JSONB NOT NULL,
    -- True when at least one check found something worth a person reading.
    -- An audit never accuses; this only says "look here".
    "flagged"       BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "IntegrityAudit_pkey" PRIMARY KEY ("id")
);

-- Every read is "the audits on this subject, newest first".
CREATE INDEX IF NOT EXISTS "IntegrityAudit_subjectType_subjectId_runAt_idx"
    ON "IntegrityAudit"("subjectType", "subjectId", "runAt");
CREATE INDEX IF NOT EXISTS "IntegrityAudit_requestedById_idx"
    ON "IntegrityAudit"("requestedById");
CREATE INDEX IF NOT EXISTS "IntegrityAudit_impeachmentId_idx"
    ON "IntegrityAudit"("impeachmentId");

-- Foreign keys, added only if absent. ADD CONSTRAINT has no IF NOT EXISTS in
-- PostgreSQL 16, so each one is guarded by a lookup instead.
--
-- ON DELETE SET NULL on the requester: a citizen leaving must not erase an
-- audit other people have relied on, and the audit never held their name in the
-- first place.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IntegrityAudit_requestedById_fkey') THEN
        ALTER TABLE "IntegrityAudit" ADD CONSTRAINT "IntegrityAudit_requestedById_fkey"
            FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IntegrityAudit_impeachmentId_fkey') THEN
        ALTER TABLE "IntegrityAudit" ADD CONSTRAINT "IntegrityAudit_impeachmentId_fkey"
            FOREIGN KEY ("impeachmentId") REFERENCES "Impeachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
