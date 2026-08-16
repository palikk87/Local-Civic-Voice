-- Every name a record has ever answered to, in one indexed place.
--
-- Until now the answer lived in a TEXT column holding a JSON array, which meant
-- looking a record up by a former name was a LIKE across every row, and writing
-- one meant reading the blob, parsing it, appending, and writing it back — a
-- read-modify-write with no constraint underneath it, so two writers could
-- silently drop each other's name.
--
-- `name` is UNIQUE across every record deliberately. One name means one piece of
-- government business. Two records claiming the same name is not a state worth
-- supporting: it is a duplicate, and the constraint is what makes it visible
-- instead of letting a lookup quietly pick whichever row the planner returned.
--
-- ADDITIVE. Creates one table and backfills it from data that already exists.
-- No existing column is dropped or rewritten; `GovernmentReference.aliases`
-- stays exactly as it is and is maintained from here on as a mirror, because
-- the search that has not been rebuilt yet still does a LIKE against it.
--
-- IDEMPOTENT. IF NOT EXISTS on the table, ON CONFLICT DO NOTHING on every
-- insert. Running it twice inserts nothing the second time.
--
-- Touches only GovernmentReference and this new table. This database is shared
-- with another project; nothing else is read or written.

CREATE TABLE IF NOT EXISTS "ReferenceName" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "learnedFrom" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceName_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReferenceName_name_key" ON "ReferenceName"("name");
CREATE INDEX IF NOT EXISTS "ReferenceName_referenceId_idx" ON "ReferenceName"("referenceId");
CREATE INDEX IF NOT EXISTS "ReferenceName_referenceId_isCurrent_idx" ON "ReferenceName"("referenceId", "isCurrent");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ReferenceName_referenceId_fkey'
  ) THEN
    ALTER TABLE "ReferenceName"
      ADD CONSTRAINT "ReferenceName_referenceId_fkey"
      FOREIGN KEY ("referenceId") REFERENCES "GovernmentReference"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- Backfill, current names first.
--
-- Order matters because of the unique constraint: if a record's current name
-- happens to also sit in another record's alias list, the record that is
-- actually called that should be the one holding the claim. Inserting every
-- current name before any former name is what guarantees that, regardless of
-- what order the rows come back in.
--
-- gen_random_uuid() rather than a cuid: Prisma's @default(cuid()) is applied by
-- the client, and this insert does not go through it. The column is an opaque
-- primary key, so the shape does not matter — only that it is unique.

INSERT INTO "ReferenceName" ("id", "name", "referenceId", "isCurrent", "learnedFrom", "firstSeenAt")
SELECT
  gen_random_uuid()::text,
  "masterReferenceId",
  "id",
  true,
  'backfilled',
  "createdAt"
FROM "GovernmentReference"
WHERE "masterReferenceId" <> ''
ON CONFLICT ("name") DO NOTHING;

-- Former names out of the JSON array.
--
-- A row at a time inside an exception handler rather than one set-based insert,
-- because `aliases` is TEXT with no constraint: some rows hold a JSON array,
-- some hold an empty string, and at least one in the wild held plain prose. A
-- single cast over the whole table dies on the first of those and backfills
-- nothing. Per row, an unreadable blob contributes no names — which is exactly
-- what the application already does with it — and every other row still lands.
DO $$
DECLARE
  ref        RECORD;
  alias_list JSONB;
  alias_name TEXT;
  recovered  INT := 0;
  unreadable INT := 0;
BEGIN
  FOR ref IN
    SELECT "id", "masterReferenceId", "aliases", "createdAt"
    FROM "GovernmentReference"
    WHERE "aliases" IS NOT NULL AND btrim("aliases") <> ''
  LOOP
    BEGIN
      alias_list := ref."aliases"::jsonb;
    EXCEPTION WHEN others THEN
      unreadable := unreadable + 1;
      CONTINUE;
    END;

    IF jsonb_typeof(alias_list) <> 'array' THEN
      unreadable := unreadable + 1;
      CONTINUE;
    END IF;

    FOR alias_name IN SELECT jsonb_array_elements_text(alias_list) LOOP
      CONTINUE WHEN alias_name IS NULL
                 OR btrim(alias_name) = ''
                 OR alias_name = ref."masterReferenceId";

      INSERT INTO "ReferenceName" ("id", "name", "referenceId", "isCurrent", "learnedFrom", "firstSeenAt")
      VALUES (gen_random_uuid()::text, alias_name, ref."id", false, 'backfilled', ref."createdAt")
      ON CONFLICT ("name") DO NOTHING;

      recovered := recovered + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE '[reference-names] backfilled % former name(s); % row(s) had an unreadable alias blob',
    recovered, unreadable;
END
$$;
