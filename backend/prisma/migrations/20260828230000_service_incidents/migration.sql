-- WHAT IS BROKEN, WHAT IS CARRYING IT, AND HAS ANYBODY SEEN IT.
--
-- The Citizen's Brief stopped working three times. Every time, the cause was a
-- model the provider no longer serves under that name, and every time the only
-- trace was a log line on a host nobody reads. What reached the owner was a
-- screen saying "try again shortly" about a failure that would never resolve.
--
-- The fix has two halves and this is the second one. The first is a chain of
-- models, so one name going dead costs quality rather than the whole feature.
-- The second is this: the platform says out loud that it is running on the
-- safety net, and keeps saying it until a person acknowledges the row.
--
-- ADDITIVE AND IDEMPOTENT. This database is shared with another project, so
-- this creates and never alters, and can be re-run without effect.
CREATE TABLE IF NOT EXISTS "ServiceIncident" (
  "id"             TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "subject"        TEXT NOT NULL,
  "fallback"       TEXT,
  "detail"         TEXT NOT NULL,
  "firstSeenAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "occurrences"    INTEGER NOT NULL DEFAULT 1,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedBy" TEXT,
  CONSTRAINT "ServiceIncident_pkey" PRIMARY KEY ("id")
);

-- One row per distinct failure. The same model dying on every request must
-- update one row, not write a million.
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceIncident_kind_subject_key"
  ON "ServiceIncident" ("kind", "subject");

-- The panel's query: what is still open, most recent first.
CREATE INDEX IF NOT EXISTS "ServiceIncident_acknowledgedAt_lastSeenAt_idx"
  ON "ServiceIncident" ("acknowledgedAt", "lastSeenAt");
