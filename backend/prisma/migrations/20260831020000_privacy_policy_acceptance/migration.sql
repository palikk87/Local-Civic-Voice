-- Accepting the privacy policy, recorded separately from the Terms.
--
-- Two documents, two records. Jordan's Personal Data Protection Law No. 24 of
-- 2023 requires consent to be specific to a purpose, and a single combined yes
-- cannot say afterwards which document it answered. The privacy notice is also
-- the one that will change most often, as processors are added or dropped, so
-- it needs to re-prompt on its own schedule.
--
-- Additive and idempotent. This database is shared with another project.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "privacyAcceptedVersion" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "privacyAcceptedAt" TIMESTAMP(3);
