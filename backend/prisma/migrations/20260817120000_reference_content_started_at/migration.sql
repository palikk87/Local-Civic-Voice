-- When the current contentStatus started, for the two working states.
--
-- "fetching" and "brief_pending" mean work is in flight. Nothing recorded when
-- that work began, so a job lost to a restart or a deploy left the row claiming
-- to be busy permanently, and the reader watched a spinner that could never
-- resolve. Reloading did not help: the stuck state was stored, not local.
--
-- Additive and idempotent. This database is shared.
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "contentStartedAt" TIMESTAMP(3);

-- Rows already stranded in a working state get released.
--
-- They have no start time, so nothing can age them out, and every reader who
-- opens one sees the spinner forever. Setting them to NULL puts them back to
-- "no brief yet", which is the honest description and the state that offers
-- the button. No brief, text, or vote is touched.
UPDATE "GovernmentReference"
   SET "contentStatus" = NULL
 WHERE "contentStatus" IN ('fetching', 'brief_pending')
   AND "contentStartedAt" IS NULL;
