-- HAS THIS PERSON BEEN ASKED YET?
--
-- `voteAnonymously` already exists and is off by default, which is the right
-- default: a platform that quietly anonymised everybody would be making the
-- choice for them just as surely as one that never offered it.
--
-- What was missing is the difference between "chose to vote publicly" and
-- "never knew there was a choice". Both read as `voteAnonymously = false`, and
-- the switch lives in Settings, so somebody who never opened Settings has been
-- putting their name on public positions without ever being told.
--
-- This column is the difference. False means nobody has asked them; the first
-- time they vote, the app asks, saves the answer here and in voteAnonymously,
-- and never asks again.
--
-- ADDITIVE AND IDEMPOTENT. This database is shared with another project.
-- Existing rows get `false`, which means everybody already on the platform gets
-- asked once the next time they vote — which is the point.
ALTER TABLE "NotificationPreference"
  ADD COLUMN IF NOT EXISTS "voteAnonymityChosen" BOOLEAN NOT NULL DEFAULT false;
