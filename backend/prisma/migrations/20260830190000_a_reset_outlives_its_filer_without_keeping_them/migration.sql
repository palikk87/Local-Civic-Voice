-- A system reset survives its filer. It does not keep them.
--
-- SystemReset."filedById" has never had a foreign key — deliberately, so that a
-- proceeding affecting every account on the platform cannot be erased by the
-- one person who brought it closing their own account. The side effect nobody
-- accounted for is that nothing ever cleared the column either: a deleted
-- account's id stayed written into the reset for good.
--
-- Closing an account is supposed to remove all trace of the person. This makes
-- the column nullable so the deletion routine can null it, the same way
-- Impeachment."filedById" is nulled. The reset, its articles, its evidence and
-- every ballot cast in it are untouched.
--
-- Additive and idempotent. This database is shared with another project, so it
-- drops a constraint that may already be gone rather than assuming.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'SystemReset'
      AND column_name = 'filedById'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "SystemReset" ALTER COLUMN "filedById" DROP NOT NULL;
  END IF;
END
$$;
