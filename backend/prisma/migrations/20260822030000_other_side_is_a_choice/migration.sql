-- Bill of Rights Article II: the other-side floor becomes the citizen's choice.
--
-- The feed reserves up to a fifth of itself for people who voted the opposite
-- way on a record the reader also voted on. However good the intent, a
-- platform reserving space by viewpoint is the platform deciding prominence,
-- and Article II says only the verifiable weight of Liquid Democracy should.
--
-- Article II also says the platform is "a neutral conduit for human intent".
-- A citizen choosing this for themselves is human intent; the platform
-- choosing it for them is not. So it becomes a switch they own.
--
-- Defaults to true, which is a judgement call and reversible in one line: it
-- is the behaviour that shipped, it is disclosed on the settings screen, and
-- turning it off takes one tap.
--
-- Additive and idempotent. IF NOT EXISTS because this database is shared.

-- AlterTable
ALTER TABLE "NotificationPreference"
  ADD COLUMN IF NOT EXISTS "showOtherSide" BOOLEAN NOT NULL DEFAULT true;
