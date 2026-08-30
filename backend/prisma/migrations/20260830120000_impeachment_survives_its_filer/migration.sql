-- AN IMPEACHMENT OUTLIVES THE PERSON WHO FILED IT.
--
-- Impeachment.filedById cascaded from User, so closing the filer's account
-- deleted the whole proceeding: the grounds, the evidence, and every elector's
-- vote in it. One person walking away erased other people's participation in a
-- constitutional act they had nothing to do with.
--
-- The decision, from the owner: the proceeding may survive its filer, and
-- everyone entitled to vote in it is notified that the filer has closed their
-- account.
--
-- SystemReset already worked this way — its filedById is a bare column with no
-- relation at all, for exactly this reason, and its schema comment says so.
--
-- WIDENING ONLY. The column becomes nullable and the foreign key becomes SET
-- NULL. No row is read, changed or removed, and every existing value stays
-- exactly as it is. Safe to run against a live database and safe to re-run —
-- every statement below is guarded.
--
-- The database is shared with another project, so nothing here touches a table
-- this project does not own.

-- 1. Let the column hold null.
ALTER TABLE "Impeachment" ALTER COLUMN "filedById" DROP NOT NULL;

-- 2. Replace the cascade with SET NULL. Dropped by name and recreated, because
--    Postgres has no ALTER CONSTRAINT for a referential action.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Impeachment_filedById_fkey'
      AND conrelid = '"Impeachment"'::regclass
  ) THEN
    ALTER TABLE "Impeachment" DROP CONSTRAINT "Impeachment_filedById_fkey";
  END IF;
END $$;

ALTER TABLE "Impeachment"
  ADD CONSTRAINT "Impeachment_filedById_fkey"
  FOREIGN KEY ("filedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
