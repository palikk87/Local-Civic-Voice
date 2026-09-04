-- Whether a Supreme Court ruling is binding law, in CourtListener's own
-- vocabulary: Published, Unpublished, Errata, Separate, In-chambers,
-- Relating-to, Unknown.
--
-- Additive and nullable. Null means we have not established it yet, which is
-- deliberately NOT the same as the source answering "Unknown" — one is our gap
-- and the other is theirs, and a badge that cannot tell them apart would mark
-- the platform down for the Court's own uncertainty.
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "precedentialStatus" TEXT;
