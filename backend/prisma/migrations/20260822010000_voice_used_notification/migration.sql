-- "Somebody voted in your name" becomes a notification you can turn off.
--
-- A delegation the delegator never hears about is a voice given away rather
-- than lent. On by default for that reason: the Constitution here says
-- political power is only ever borrowed, and borrowed means you are told when
-- it is used.
--
-- Additive and idempotent — one boolean with a default, so every existing row
-- gets it without a rewrite and nobody has to opt in to being told what was
-- said in their name. IF NOT EXISTS because this database is shared.

-- AlterTable
ALTER TABLE "NotificationPreference"
  ADD COLUMN IF NOT EXISTS "voiceUsed" BOOLEAN NOT NULL DEFAULT true;
