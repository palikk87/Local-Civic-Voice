-- Constitution Article IV: the Judiciary — Community Juries.
--
-- "Disputes are settled by randomly chosen trusted users."
--
-- There has been a "report this post" button since the first build. Its reports
-- went into a queue NO SCREEN ANYWHERE SHOWED. They were written down and then
-- nothing happened to them, for anybody, ever. These two tables are the branch
-- of government that clause promised.
--
-- WHY THE SEATS ARE ROWS AND NOT A COUNT. A jury has to be checkable afterwards
-- — who was summoned, who answered, who went quiet, who stepped aside and why,
-- and which seat replaced which. A count cannot answer any of that, and a draw
-- nobody can audit is a draw nobody should trust. Every seat ever created is
-- kept, including the ones that lapsed; that record is also what the Trust
-- Score reads.
--
-- ADDITIVE AND IDEMPOTENT. This database is shared with another project, so
-- every statement is guarded and nothing existing is altered or dropped.

CREATE TABLE IF NOT EXISTS "Jury" (
    "id"                    TEXT NOT NULL,
    "reportId"              TEXT NOT NULL,
    -- WHO IS ACTUALLY ON TRIAL, resolved once at the draw: the author for a
    -- post or a comment, the account itself for an account report. Stored
    -- rather than re-derived, because a post can be deleted and a finding
    -- against a person has to outlive the thing that was reported.
    "accusedId"             TEXT NOT NULL,
    -- comment | post | leader
    "panelKind"             TEXT NOT NULL,
    -- 5 for a comment or an ordinary member's post, 7 for a civil leader's.
    "seats"                 INTEGER NOT NULL,
    -- 3 of 5, or 4 of 7.
    "votesToDecide"         INTEGER NOT NULL,
    -- drawing | deliberating | decided | abandoned
    "status"                TEXT NOT NULL DEFAULT 'drawing',
    -- upheld | dismissed. Null until decided.
    "verdict"               TEXT,
    -- Frozen at the draw. A person who crosses fifty delegations mid-case does
    -- not change the size of the jury already hearing it.
    "accusedDelegations"    INTEGER NOT NULL DEFAULT 0,
    "openedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt"             TIMESTAMP(3),
    CONSTRAINT "Jury_pkey" PRIMARY KEY ("id")
);

-- One jury per report. A second jury on the same complaint is a retrial nobody
-- asked for.
CREATE UNIQUE INDEX IF NOT EXISTS "Jury_reportId_key" ON "Jury"("reportId");
CREATE INDEX IF NOT EXISTS "Jury_status_openedAt_idx" ON "Jury"("status", "openedAt");
-- "What has this person been found to have done" — the read job 5 lives on.
CREATE INDEX IF NOT EXISTS "Jury_accusedId_verdict_idx" ON "Jury"("accusedId", "verdict");

CREATE TABLE IF NOT EXISTS "JurySeat" (
    "id"             TEXT NOT NULL,
    "juryId"         TEXT NOT NULL,
    "jurorId"        TEXT NOT NULL,
    -- summoned | accepted | voted | lapsed | recused
    "state"          TEXT NOT NULL DEFAULT 'summoned',
    "summonedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt"     TIMESTAMP(3),
    -- uphold | dismiss
    "vote"           TEXT,
    -- Why. Required to vote: a verdict nobody had to explain is a verdict
    -- nobody can answer.
    "reasoning"      TEXT,
    "votedAt"        TIMESTAMP(3),
    "recusedReason"  TEXT,
    "closedAt"       TIMESTAMP(3),
    -- The seat this one was drawn to replace, so the whole draw can be walked
    -- backwards afterwards.
    "replacesSeatId" TEXT,
    CONSTRAINT "JurySeat_pkey" PRIMARY KEY ("id")
);

-- Nobody sits twice on the same jury, however many times the draw comes round.
CREATE UNIQUE INDEX IF NOT EXISTS "JurySeat_juryId_jurorId_key" ON "JurySeat"("juryId", "jurorId");
-- "Is this person sequestered right now" is the hottest read in the system:
-- it runs on every request a juror makes.
CREATE INDEX IF NOT EXISTS "JurySeat_jurorId_state_idx" ON "JurySeat"("jurorId", "state");
CREATE INDEX IF NOT EXISTS "JurySeat_juryId_state_idx" ON "JurySeat"("juryId", "state");
-- The sweeps look for seats that have run out of time.
CREATE INDEX IF NOT EXISTS "JurySeat_state_summonedAt_idx" ON "JurySeat"("state", "summonedAt");
CREATE INDEX IF NOT EXISTS "JurySeat_state_acceptedAt_idx" ON "JurySeat"("state", "acceptedAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Jury_reportId_fkey') THEN
        ALTER TABLE "Jury" ADD CONSTRAINT "Jury_reportId_fkey"
            FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Jury_accusedId_fkey') THEN
        ALTER TABLE "Jury" ADD CONSTRAINT "Jury_accusedId_fkey"
            FOREIGN KEY ("accusedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JurySeat_juryId_fkey') THEN
        ALTER TABLE "JurySeat" ADD CONSTRAINT "JurySeat_juryId_fkey"
            FOREIGN KEY ("juryId") REFERENCES "Jury"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JurySeat_jurorId_fkey') THEN
        ALTER TABLE "JurySeat" ADD CONSTRAINT "JurySeat_jurorId_fkey"
            FOREIGN KEY ("jurorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
