-- An account may not be closed out from under a live proceeding.
--
-- Closing an account stays immediate and total in the ordinary case. This
-- column marks the exception: somebody who is a party to an open article or
-- report — one they filed, or one against them — is suspended instead of
-- erased, stays publicly readable, and is really deleted the moment the last
-- proceeding is decided.
--
-- Constitution Article V §3: "No Proceeding under this Article may be halted,
-- delayed or reversed by any Officer." An accused person who could delete their
-- way out mid-case would halt one without being an officer at all.
--
-- Additive and idempotent. This database is shared with another project.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletionRequestedAt" TIMESTAMP(3);

-- The sweep looks for exactly these rows and there will be very few of them.
CREATE INDEX IF NOT EXISTS "user_deletionRequestedAt_idx"
  ON "User" ("deletionRequestedAt")
  WHERE "deletionRequestedAt" IS NOT NULL;
