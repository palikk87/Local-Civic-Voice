-- Jurisdiction on an account: which state and district a person's voice
-- belongs to, and nothing else.
--
-- Bill of Rights Article IV names jurisdiction as a legitimate collection
-- purpose and caps collection at the minimum needed for it. So: two columns and
-- a timestamp. No street, no ZIP retained after resolution, no coordinates.
--
-- ALL NULLABLE, NO DEFAULT, NO BACKFILL. Every account that exists keeps
-- reading as "has not said", which is the truth about every one of them. A
-- default here would be an invented answer to a question nobody was asked.
--
-- ADDITIVE AND IDEMPOTENT. This database is shared with another project.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stateCode"         TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "districtId"        TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "jurisdictionSetAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_stateCode_idx"  ON "User"("stateCode");
CREATE INDEX IF NOT EXISTS "User_districtId_idx" ON "User"("districtId");
