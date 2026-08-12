-- Content pipeline bookkeeping for the master reference cache.
-- All columns are nullable and additive, so this is safe on a populated table:
-- existing rows keep their fullText/citizenBrief and get backfilled lazily the
-- next time a user opens or shares the law.
ALTER TABLE "GovernmentReference" ADD COLUMN "citizenBriefJson" TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN "citizenBriefAt" DATETIME;
ALTER TABLE "GovernmentReference" ADD COLUMN "citizenBriefModel" TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN "fullTextSource" TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN "fullTextUrl" TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN "fullTextHash" TEXT;
ALTER TABLE "GovernmentReference" ADD COLUMN "fullTextAt" DATETIME;
ALTER TABLE "GovernmentReference" ADD COLUMN "sourceCheckedAt" DATETIME;
ALTER TABLE "GovernmentReference" ADD COLUMN "contentStatus" TEXT;
