-- Accepting the Terms is a fact about a person, not about a browser.
--
-- It was written to localStorage and nowhere else, so accepting on a phone left
-- a computer asking again, clearing a browser erased the agreement, and the
-- platform kept no record of who had accepted which version.
--
-- Versioned rather than a boolean, so a later material change to the Terms
-- re-prompts instead of being assumed from a yes that has forgotten what it was
-- answering.
--
-- Additive and idempotent. This database is shared with another project.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "termsAcceptedVersion" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);
