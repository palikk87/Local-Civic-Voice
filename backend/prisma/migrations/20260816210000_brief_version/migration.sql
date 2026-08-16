-- Which version of the law the stored citizen brief was written for.
--
-- A brief costs a model call and describes one particular text. Until now,
-- "does this brief still describe this law" was answered by a variable that
-- lived for the length of one function call: if the text changed and the
-- regeneration then failed, the next reader saw a brief on the row, no recorded
-- change, and got a summary of a law that no longer exists — permanently.
--
-- Comparing this column to lawVersion makes "one brief per version of the law"
-- something the code checks rather than something it intends. It also makes the
-- opposite guarantee real: a brief that IS current is never regenerated, no
-- matter how many people open it.
--
-- Existing briefs are pinned to the version their record is on now. That is the
-- honest reading: nothing is known to have changed under them, and marking them
-- stale would spend money rewriting briefs that are fine.
--
-- Rows with no brief stay NULL rather than being given a version, so "no brief
-- yet" and "brief for version 1" remain different states.
--
-- ADDITIVE and IDEMPOTENT. One nullable column, backfilled with a guarded
-- UPDATE that matches nothing on a second run.
--
-- Touches only GovernmentReference. This database is shared with another
-- project.

ALTER TABLE "GovernmentReference"
  ADD COLUMN IF NOT EXISTS "citizenBriefVersion" INTEGER;

UPDATE "GovernmentReference"
   SET "citizenBriefVersion" = "lawVersion"
 WHERE "citizenBriefJson" IS NOT NULL
   AND "citizenBriefVersion" IS NULL;
