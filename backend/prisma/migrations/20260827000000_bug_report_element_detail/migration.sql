-- What a bug report was actually pointing at, as opposed to what it said.
--
-- The report carried the visible words and a path of tag names and Tailwind
-- classes. The word is the one thing the admin already had — it is in the
-- complaint. This holds the identity: which component rendered it, which
-- record it was showing, a selector that finds it again, and the markup.
--
-- Additive and nullable: every report written before this has no detail, and
-- that is the honest answer for them rather than a backfilled guess.
ALTER TABLE "BugReport" ADD COLUMN IF NOT EXISTS "elementDetail" JSONB;
