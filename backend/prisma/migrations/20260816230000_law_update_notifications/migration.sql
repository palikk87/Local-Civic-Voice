-- "A law you shared has been updated."
--
-- Somebody who put their name to a position on a bill has a stake in knowing
-- the bill moved. Their post is never edited — their words stay their words —
-- but the law underneath it moves forward, and a silent change is how a person
-- ends up standing behind text they never read.
--
-- On by default for that reason. It is the one notification that carries
-- information the reader cannot get any other way: a like or a follow is
-- visible on the post, a law amended in committee is not.
--
-- ADDITIVE and IDEMPOTENT: one boolean column with a default, so existing rows
-- are covered without a backfill.
--
-- Touches only NotificationPreference. This database is shared with another
-- project.

ALTER TABLE "NotificationPreference"
  ADD COLUMN IF NOT EXISTS "lawUpdates" BOOLEAN NOT NULL DEFAULT true;
