-- The review queue: two records that might be one law.
--
-- Congress.gov publishes, for every bill, which other bills it is related to
-- and how, along with who made the call — the House, the Senate, or the
-- Congressional Research Service. That is the government's own lineage data,
-- and "Identical bill" specifically means a Library of Congress analyst read
-- both texts and confirmed they match. That is the only evidence good enough to
-- join two records without a person looking at them.
--
-- Everything else lands in this table as a question, with the government's page
-- attached, for a human to answer once. "Related bill" never lands here at all:
-- related means a different law on the same subject, which is the opposite of a
-- duplicate.
--
-- The pair is stored ordered — leftId sorts before rightId — so the same two
-- records are always the same row. Without that, A-B and B-A are two rows and
-- the unique constraint stops meaning anything, which is how a review queue
-- fills up with the same question asked twice.
--
-- ADDITIVE and IDEMPOTENT: one new table, nothing else read or written. This
-- database is shared with another project.

CREATE TABLE IF NOT EXISTS "ReferenceMergeCandidate" (
    "id" TEXT NOT NULL,
    "leftId" TEXT NOT NULL,
    "rightId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "identifiedBy" TEXT,
    "evidenceUrl" TEXT,
    "similarity" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferenceMergeCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReferenceMergeCandidate_leftId_rightId_key"
  ON "ReferenceMergeCandidate"("leftId", "rightId");
CREATE INDEX IF NOT EXISTS "ReferenceMergeCandidate_status_idx"
  ON "ReferenceMergeCandidate"("status");
CREATE INDEX IF NOT EXISTS "ReferenceMergeCandidate_leftId_idx"
  ON "ReferenceMergeCandidate"("leftId");
CREATE INDEX IF NOT EXISTS "ReferenceMergeCandidate_rightId_idx"
  ON "ReferenceMergeCandidate"("rightId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferenceMergeCandidate_leftId_fkey') THEN
    ALTER TABLE "ReferenceMergeCandidate"
      ADD CONSTRAINT "ReferenceMergeCandidate_leftId_fkey"
      FOREIGN KEY ("leftId") REFERENCES "GovernmentReference"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferenceMergeCandidate_rightId_fkey') THEN
    ALTER TABLE "ReferenceMergeCandidate"
      ADD CONSTRAINT "ReferenceMergeCandidate_rightId_fkey"
      FOREIGN KEY ("rightId") REFERENCES "GovernmentReference"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
