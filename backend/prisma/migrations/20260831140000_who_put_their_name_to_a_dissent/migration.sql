-- Who dissented from a Supreme Court ruling, so a per curiam card can narrow
-- from "the bench that sat" to "the justices in the majority".
--
-- A per curiam opinion carries no author. The bench that day is who answers
-- for it, minus whoever put their name to a dissent — and CourtListener
-- records separate opinions with a type, so the dissents are knowable.
--
-- An EMPTY list is not "unanimous": it means no dissent was recorded, which
-- could equally mean none was filed or none was digitised. dissentCheckedAt
-- distinguishes "asked and found none" from "never asked".
--
-- Additive and idempotent. This database is shared with another project.
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "dissentedBy" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "dissentCheckedAt" TIMESTAMP(3);
