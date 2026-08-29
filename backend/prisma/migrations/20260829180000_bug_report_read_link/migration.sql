-- A READ LINK FOR THE BUG QUEUE, AND NOTHING ELSE.
--
-- The bug reporter is where the owner writes down what needs fixing. Getting
-- that list to whoever does the fixing meant signing into the admin panel and
-- copying it out by hand, every time. The obvious shortcut — handing over an
-- admin password — is the wrong one: it grants everything forever to solve a
-- problem that is reading one table.
--
-- So: a link that reads bug reports, expires, and can be revoked. It is a
-- capability, not an account. It carries no identity, cannot write anything,
-- and cannot see any other part of the platform.
--
-- The token itself is never stored. Only its SHA-256 digest is, exactly as a
-- B2B client's API key is handled, so this table leaking does not hand anybody
-- a working link. The plaintext is shown once, at creation, and then it is the
-- holder's problem.
--
-- ADDITIVE AND IDEMPOTENT. This database is shared with another project, so
-- this creates and never alters, and can be re-run without effect.
CREATE TABLE IF NOT EXISTS "BugReportReadLink" (
  "id"         TEXT NOT NULL,
  -- SHA-256 of the token. Unique so a lookup is one indexed read.
  "tokenHash"  TEXT NOT NULL,
  -- What it is for, in the owner's words. A link nobody can identify is a link
  -- nobody dares revoke.
  "label"      TEXT NOT NULL,
  -- Enough to recognise a token without being enough to use one.
  "fingerprint" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdBy"   TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Every link ends. A link with no expiry is a password with extra steps.
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "revokedAt"  TIMESTAMP(3),
  "revokedBy"  TEXT,
  -- So the owner can see it being used, and notice if it is used when it
  -- should not be. A capability nobody can audit is one nobody should issue.
  "lastUsedAt" TIMESTAMP(3),
  "useCount"   INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "BugReportReadLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BugReportReadLink_tokenHash_key"
  ON "BugReportReadLink"("tokenHash");

-- The live-links list the panel shows: newest first, expired and revoked ones
-- filtered in the query rather than deleted, because a link that vanishes
-- takes its usage history with it.
CREATE INDEX IF NOT EXISTS "BugReportReadLink_createdAt_idx"
  ON "BugReportReadLink"("createdAt");
