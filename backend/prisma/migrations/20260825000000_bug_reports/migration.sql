-- Bug reports from the people using the app.
--
-- ADDITIVE AND IDEMPOTENT, like every migration here: this database is shared
-- with another project, so a migration that drops or rewrites anything can take
-- something that is not ours with it. IF NOT EXISTS throughout, no ALTER of an
-- existing table, and no data touched.
CREATE TABLE IF NOT EXISTS "BugReport" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT,
    "username"     TEXT,
    "pageUrl"      TEXT NOT NULL,
    "pagePath"     TEXT NOT NULL,
    "elementLabel" TEXT,
    "elementPath"  TEXT,
    "problem"      TEXT NOT NULL,
    "wanted"       TEXT,
    "userAgent"    TEXT,
    "viewport"     TEXT,
    "appCommit"    TEXT,
    "status"       TEXT NOT NULL DEFAULT 'open',
    "adminNote"    TEXT,
    "resolvedBy"   TEXT,
    "resolvedAt"   TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BugReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BugReport_status_createdAt_idx" ON "BugReport"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "BugReport_userId_idx" ON "BugReport"("userId");
