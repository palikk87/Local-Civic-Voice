-- The missing half of the Representation Gap: how Congress actually voted.
--
-- The platform could say "73% of citizens here oppose this" and had nothing to
-- compare it against. `officialVotes` on the bill card was set by nothing, and
-- the PulseGap component had never once rendered for a real record.
--
-- Sourced from senate.gov and clerk.house.gov, both of which publish every
-- roll call as XML with NO API KEY. This was previously written up as blocked
-- on a congress.gov key; it never needed one.
--
-- Additive: two new tables and one nullable column. Nothing existing changes.
-- IF NOT EXISTS throughout because this database is shared with another
-- project.

CREATE TABLE IF NOT EXISTS "RollCall" (
  "id"                    TEXT NOT NULL,
  "chamber"               TEXT NOT NULL,
  "congress"              INTEGER NOT NULL,
  "session"               INTEGER NOT NULL,
  "rollNumber"            INTEGER NOT NULL,
  "year"                  INTEGER,
  "legisNumber"           TEXT,
  "masterReferenceId"     TEXT,
  "governmentReferenceId" TEXT,
  "question"              TEXT NOT NULL,
  "result"                TEXT NOT NULL,
  "description"           TEXT,
  "votedAt"               TIMESTAMP(3) NOT NULL,
  "yea"                   INTEGER NOT NULL,
  "nay"                   INTEGER NOT NULL,
  "present"               INTEGER NOT NULL DEFAULT 0,
  "notVoting"             INTEGER NOT NULL DEFAULT 0,
  "sourceUrl"             TEXT NOT NULL,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RollCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RollCallMemberVote" (
  "id"         TEXT NOT NULL,
  "rollCallId" TEXT NOT NULL,
  "memberId"   TEXT NOT NULL,
  "lastName"   TEXT NOT NULL,
  "firstName"  TEXT,
  "party"      TEXT NOT NULL,
  "state"      TEXT NOT NULL,
  "district"   TEXT,
  "voteCast"   TEXT NOT NULL,
  CONSTRAINT "RollCallMemberVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RollCall_chamber_congress_session_rollNumber_key"
  ON "RollCall"("chamber", "congress", "session", "rollNumber");
CREATE INDEX IF NOT EXISTS "RollCall_governmentReferenceId_idx" ON "RollCall"("governmentReferenceId");
CREATE INDEX IF NOT EXISTS "RollCall_masterReferenceId_idx" ON "RollCall"("masterReferenceId");
CREATE INDEX IF NOT EXISTS "RollCall_votedAt_idx" ON "RollCall"("votedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "RollCallMemberVote_rollCallId_memberId_key"
  ON "RollCallMemberVote"("rollCallId", "memberId");
CREATE INDEX IF NOT EXISTS "RollCallMemberVote_memberId_idx" ON "RollCallMemberVote"("memberId");
CREATE INDEX IF NOT EXISTS "RollCallMemberVote_state_district_idx" ON "RollCallMemberVote"("state", "district");

-- SetNull on delete: a merged-away record must not take the government's own
-- vote with it.
DO $$ BEGIN
  ALTER TABLE "RollCall" ADD CONSTRAINT "RollCall_governmentReferenceId_fkey"
    FOREIGN KEY ("governmentReferenceId") REFERENCES "GovernmentReference"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RollCallMemberVote" ADD CONSTRAINT "RollCallMemberVote_rollCallId_fkey"
    FOREIGN KEY ("rollCallId") REFERENCES "RollCall"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
