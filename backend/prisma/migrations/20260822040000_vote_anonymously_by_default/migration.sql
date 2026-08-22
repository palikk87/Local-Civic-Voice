-- Bill of Rights Article IV: a standing "vote anonymously" preference.
--
-- The per-vote flag landed in 20260822020000. This is the standing choice the
-- server applies when a vote does not say either way, so the right works from
-- every surface that can cast a vote rather than only the ones that grew a
-- toggle. A single request still overrides it in both directions.
--
-- Off by default: anonymity has to be chosen. A platform that quietly
-- anonymised everybody would be making the choice for them just as surely as
-- one that never offered it.
--
-- Its own migration rather than an edit to the one above, because that one has
-- already been applied — Prisma records applied migrations by checksum, so
-- editing one in place means the new statement never runs and the checksum no
-- longer matches. That is exactly what happened once here.
--
-- Additive and idempotent. IF NOT EXISTS because this database is shared.

-- AlterTable
ALTER TABLE "NotificationPreference"
  ADD COLUMN IF NOT EXISTS "voteAnonymously" BOOLEAN NOT NULL DEFAULT false;
