-- A RECORD GETS AN ADDRESS A PERSON COULD HAVE TYPED.
--
-- Every law on this platform lived at /reference/<cuid> — an address that
-- matches no query anybody has ever entered, and tells a reader who is handed
-- the link nothing at all about what is on the other end.
--
-- masterReferenceId is already unique and already readable for two branches of
-- three (hr-10184-119, eo-14421). It is not the slug itself, though, because
-- the Supreme Court's ids are docket numbers — 24-20, cl-84759 — which nobody
-- searches for and nobody recognises. Those get a slug built from the case
-- name instead, so the column has to be its own thing.
--
-- Nullable and additive: a row without one keeps working on its cuid, which is
-- what every link ever shared already uses. The backfill fills them in; the
-- ingest fills in every record that arrives after.
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "slug" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "GovernmentReference_slug_key"
  ON "GovernmentReference"("slug");
