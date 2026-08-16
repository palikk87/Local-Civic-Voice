-- When the LAW changed, as opposed to when the row was written.
--
-- `updatedAt` on GovernmentReference moves every time somebody votes, because a
-- vote writes the denormalised tally back to the row. So it cannot answer the
-- one question a badge on a post and a notification to its author both depend
-- on: has this law actually moved since I shared it?
--
-- `lawChangedAt` is set only when the official source reports something
-- genuinely different — a new title, a new status, or text that no longer
-- hashes the same. Vote traffic never touches it.
--
-- `lawVersion` increments alongside it. The citizen brief is written for one
-- version of a law and reused until this number moves, which is what turns
-- "one brief per version" from an intention into something the code can check.
--
-- ADDITIVE and IDEMPOTENT. Two nullable/defaulted columns on one table. Existing
-- rows start at version 1 with no recorded change, which is correct: nothing is
-- known to have changed under anybody's post yet, so nothing gets badged
-- retroactively for a change that may never have happened.
--
-- Touches only GovernmentReference. This database is shared with another
-- project.

ALTER TABLE "GovernmentReference"
  ADD COLUMN IF NOT EXISTS "lawChangedAt" TIMESTAMP(3);

ALTER TABLE "GovernmentReference"
  ADD COLUMN IF NOT EXISTS "lawVersion" INTEGER NOT NULL DEFAULT 1;
