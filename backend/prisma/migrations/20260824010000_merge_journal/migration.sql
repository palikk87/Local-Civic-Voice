-- What a merge did, in enough detail to undo it.
--
-- Merging was one-way, which is the real reason it needed an admin standing in
-- front of it: a wrong merge pooled two different laws' votes into one number
-- permanently, and the duplicate votes it deleted were simply gone.
--
-- Making it reversible is what makes automating the decision safe rather than
-- reckless. A machine may act on evidence when a mistake is a button.
--
-- Additive: two new tables, nothing existing changes.

CREATE TABLE IF NOT EXISTS "MergeJournal" (
  "id"               TEXT NOT NULL,
  "sourceId"         TEXT NOT NULL,
  "targetId"         TEXT NOT NULL,
  "decidedBy"        TEXT NOT NULL,
  "reason"           TEXT NOT NULL,
  "evidenceUrl"      TEXT,
  "confidence"       DOUBLE PRECISION,
  "deletedVotes"     TEXT NOT NULL DEFAULT '[]',
  "supersededVotes"  TEXT NOT NULL DEFAULT '[]',
  "commentsAbsorbed" INTEGER NOT NULL DEFAULT 0,
  "sharesAbsorbed"   INTEGER NOT NULL DEFAULT 0,
  "adoptedBrief"     BOOLEAN NOT NULL DEFAULT false,
  "adoptedText"      BOOLEAN NOT NULL DEFAULT false,
  "revertedAt"       TIMESTAMP(3),
  "revertedBy"       TEXT,
  "revertReason"     TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MergeJournal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MergeJournalRow" (
  "id"        TEXT NOT NULL,
  "journalId" TEXT NOT NULL,
  "model"     TEXT NOT NULL,
  "rowId"     TEXT NOT NULL,
  CONSTRAINT "MergeJournalRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MergeJournal_sourceId_idx"   ON "MergeJournal"("sourceId");
CREATE INDEX IF NOT EXISTS "MergeJournal_targetId_idx"   ON "MergeJournal"("targetId");
CREATE INDEX IF NOT EXISTS "MergeJournal_decidedBy_idx"  ON "MergeJournal"("decidedBy");
CREATE INDEX IF NOT EXISTS "MergeJournal_revertedAt_idx" ON "MergeJournal"("revertedAt");
CREATE INDEX IF NOT EXISTS "MergeJournalRow_journalId_model_idx" ON "MergeJournalRow"("journalId", "model");

DO $$ BEGIN
  ALTER TABLE "MergeJournalRow" ADD CONSTRAINT "MergeJournalRow_journalId_fkey"
    FOREIGN KEY ("journalId") REFERENCES "MergeJournal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
