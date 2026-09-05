-- An executive order now reaches the platform the day it is signed, read from
-- whitehouse.gov, which is three to seven days before the Federal Register
-- publishes it. The Register is the office that assigns order numbers, so for
-- those days the record genuinely has no number: it carries a starred date
-- (eo-2026-09-04*) and these columns say where the real number stands.
--
-- All additive and nullable. Null on every record that is not an executive
-- order, and on the 356 orders already held, which came in through the
-- Register and were numbered on arrival.

-- "pending" | "confirmed" | "never_numbered".
--
-- never_numbered is a permanent answer, not a failure. The Register publishes
-- some presidential documents with the number field empty — subtype
-- "Presidential Order" or "Other" — and a record in that state stops being
-- asked about rather than being retried forever.
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "numberStatus" TEXT;

-- When the Register answered, either with a number or with "there isn't one".
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "numberConfirmedAt" TIMESTAMP(3);

-- When we last asked. Separate from numberConfirmedAt deliberately: "asked and
-- it has not published yet" and "could not reach it" must never look like
-- "answered", or an outage would quietly close the question.
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "numberAskedAt" TIMESTAMP(3);

-- The order's full text as a JSON array of floats, written only for records
-- whose number is still pending. Those are the ones a Federal Register search
-- cannot return, because the Register does not have them yet.
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "textEmbedding" TEXT;

-- The fullTextHash the embedding was computed from, so changed text is
-- re-embedded rather than searched against a vector of the old words.
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "textEmbeddingHash" TEXT;

-- The daily pass reads exactly one slice of this table: orders still waiting on
-- a number. Without this it is a sequential scan of every record on the
-- platform to find a median of two rows.
CREATE INDEX IF NOT EXISTS "GovernmentReference_numberStatus_idx"
  ON "GovernmentReference" ("numberStatus");
