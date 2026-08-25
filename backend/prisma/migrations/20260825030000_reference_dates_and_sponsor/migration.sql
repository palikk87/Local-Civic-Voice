-- When a law actually happened, and who sponsored it.
--
-- These columns did not exist, so reference-mappers.ts filled introducedDate
-- and lastActionDate with the row's own createdAt — meaning a 2007 statute
-- displayed as introduced today — and invented a sponsor of
-- "U.S. House of Representatives / Independent - US" for every bill.
--
-- ALL NULLABLE, NO BACKFILL. Every existing row reads as "we do not know yet",
-- which is true until the next sync fills it from congress.gov. A default here
-- would be the same invented value in a new place.
--
-- ADDITIVE AND IDEMPOTENT. This database is shared with another project.
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "introducedDate"    TIMESTAMP(3);
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "lastActionDate"    TIMESTAMP(3);
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "lastActionText"    TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "sponsorBioguideId" TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "sponsorName"       TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "sponsorParty"      TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "sponsorState"      TEXT;

CREATE INDEX IF NOT EXISTS "GovernmentReference_introducedDate_idx" ON "GovernmentReference"("introducedDate");
