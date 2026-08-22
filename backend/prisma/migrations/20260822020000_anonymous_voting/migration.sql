-- Bill of Rights Article IV: "Anonymous voting option."
--
-- The article lists it as a right of the people and there was no such column:
-- every position on this platform was attributable to a named account,
-- permanently and publicly.
--
-- THE VOTE STILL COUNTS. An anonymous position is carried into the Pulse
-- exactly like any other, including through delegation. Anonymity withholds
-- the NAME, never the voice — Article I's promise that the Pulse is the
-- aggregate of verified citizens and Article IV's promise of anonymity are
-- only compatible if the tally is blind to this flag.
--
-- Additive and idempotent: two booleans with defaults, so every existing row
-- keeps the attribution it already had. IF NOT EXISTS because this database is
-- shared with another project.

-- AlterTable
ALTER TABLE "GovernmentReferenceVote"
  ADD COLUMN IF NOT EXISTS "isAnonymous" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PositionEvent"
  ADD COLUMN IF NOT EXISTS "isAnonymous" BOOLEAN NOT NULL DEFAULT false;

