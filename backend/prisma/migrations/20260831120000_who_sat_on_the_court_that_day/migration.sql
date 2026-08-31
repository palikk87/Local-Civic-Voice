-- Every person who has ever sat on the Supreme Court, so a per curiam ruling
-- can name who is answerable for it.
--
-- A per curiam opinion is the Court speaking as one body, with no individual
-- author, so those rulings carried nobody's name on this platform at all. The
-- only honest answer to "who decided this" is the bench on the day it came
-- down, and that needs the Court's service dates.
--
-- Filled from supremecourt.gov's own "Justices 1789 to Present" table, not
-- typed into the repo: a hardcoded list is wrong the day somebody is confirmed.
--
-- Additive and idempotent. This database is shared with another project.
CREATE TABLE IF NOT EXISTS "Justice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "appointedBy" TEXT,
    "isChief" BOOLEAN NOT NULL DEFAULT false,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Justice_pkey" PRIMARY KEY ("id")
);

-- A justice elevated from Associate to Chief appears twice, once per office,
-- and both spans are real service. Name plus swearing-in day is the identity.
CREATE UNIQUE INDEX IF NOT EXISTS "Justice_name_startDate_key" ON "Justice"("name", "startDate");
CREATE INDEX IF NOT EXISTS "Justice_startDate_endDate_idx" ON "Justice"("startDate", "endDate");
