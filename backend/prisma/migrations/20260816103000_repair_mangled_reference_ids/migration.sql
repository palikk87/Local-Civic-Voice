-- Give every record back the name it should always have had.
--
-- WHAT WENT WRONG
--
-- normalizeReferenceId() matched a bill's type prefix against an alternation
-- written shortest-first:
--
--   /^(h\.?r\.?|s\.?|h\.?j\.?res\.?|...|h\.?res\.?|s\.?res\.?)[\s-]*/
--
-- JavaScript alternation is leftmost-first, not longest-match, and nothing
-- after the group forced the engine to backtrack into a longer branch. So the
-- first branch that matched any prefix of the type won:
--
--   hres-1443-119    -> hr-es-1443-119      (matched "hr")
--   sres-829-119     -> s-res-829-119       (matched "s")
--   sjres-88-119     -> s-jres-88-119       (matched "s")
--   sconres-14-119   -> s-conres-14-119     (matched "s")
--
-- hr, s, hjres and hconres were reachable first and came through intact, which
-- is exactly why nobody noticed: half the types worked.
--
-- Two smaller faults in the same function, repaired here for the same reason:
--
--   "H.R. 4836"   -> h-r-4836   separators became hyphens before the prefix
--                               was matched, so the prefix no longer matched
--   "No. 22-451"  -> -22-451    the "No." prefix was stripped after the dot had
--                               become a hyphen, and nothing re-trimmed it
--
-- WHY THIS MATTERS ENOUGH TO TOUCH DATA
--
-- The master reference id is how a law is found — by search, by the daily sync,
-- by the government's own API. A record named `s-res-829-119` is a record no
-- search can reach and no source can refresh, because that string is not the
-- name of anything. It sits there accumulating nothing while a correctly-named
-- second record collects the votes. One law, two pulses. That is the failure
-- the whole master reference system exists to prevent.
--
-- Confirmed live before writing this: `s-res-829-119` is in the production
-- database today, and search computes `sres-829-119` for the same resolution.
--
-- WHAT THIS DOES NOT DO
--
-- It never merges. If the correct name is already taken by another row, the two
-- rows are a genuine duplicate pair with two vote pools, and combining them is
-- a merge — which has to move votes, posts and briefs, and is the next piece of
-- work. This migration leaves that pair exactly as it found it and says so in
-- the deploy log rather than silently picking a winner.
--
-- It never deletes, and it never loses the old name: the previous id is
-- appended to the row's `aliases` list, so a link, a bookmark or a stored
-- reference using the old string still resolves to the same record.
--
-- It touches only `GovernmentReference`. This database is shared with another
-- project; nothing outside that one table is read or written.
--
-- IDEMPOTENT. Prisma records the migration so it runs once per database, and
-- even run again it would be a no-op: a repaired id no longer matches any of
-- the patterns, and an alias already present is not appended twice. On an empty
-- database it does nothing at all.

DO $$
DECLARE
  row_to_fix   RECORD;
  repaired_id  TEXT;
  alias_list   JSONB;
  renamed      INT := 0;
  blocked      INT := 0;
BEGIN
  IF to_regclass('public."GovernmentReference"') IS NULL THEN
    RAISE NOTICE '[repair-ids] GovernmentReference does not exist yet — nothing to repair';
    RETURN;
  END IF;

  FOR row_to_fix IN
    SELECT "id", "masterReferenceId", "referenceType", "aliases"
    FROM "GovernmentReference"
    WHERE
      -- The four mangled bill prefixes, plus the dotted-initials case. Anchored
      -- and type-scoped: `s-res-` is only wrong on a bill, and a record of some
      -- other kind that happens to start that way is left alone.
      (
        "referenceType" = 'bill'
        AND (
          "masterReferenceId" LIKE 'hr-es-%'
          OR "masterReferenceId" LIKE 's-res-%'
          OR "masterReferenceId" LIKE 's-jres-%'
          OR "masterReferenceId" LIKE 's-conres-%'
          OR "masterReferenceId" LIKE 'h-r-%'
        )
      )
      -- A leading hyphen is never part of any id, of any kind.
      OR "masterReferenceId" LIKE '-%'
    ORDER BY "masterReferenceId"
  LOOP
    repaired_id := row_to_fix."masterReferenceId";

    IF row_to_fix."referenceType" = 'bill' THEN
      repaired_id := regexp_replace(repaired_id, '^hr-es-',    'hres-');
      repaired_id := regexp_replace(repaired_id, '^s-res-',    'sres-');
      repaired_id := regexp_replace(repaired_id, '^s-jres-',   'sjres-');
      repaired_id := regexp_replace(repaired_id, '^s-conres-', 'sconres-');
      repaired_id := regexp_replace(repaired_id, '^h-r-',      'hr-');
    END IF;

    repaired_id := regexp_replace(repaired_id, '^-+', '');

    CONTINUE WHEN repaired_id = row_to_fix."masterReferenceId" OR repaired_id = '';

    IF EXISTS (
      SELECT 1 FROM "GovernmentReference" WHERE "masterReferenceId" = repaired_id
    ) THEN
      blocked := blocked + 1;
      RAISE NOTICE
        '[repair-ids] % is really % but that record already exists — left alone; these two are a duplicate pair for the merge step, not a rename',
        row_to_fix."masterReferenceId", repaired_id;
      CONTINUE;
    END IF;

    -- Keep the old name reachable. `aliases` is a TEXT column holding a JSON
    -- array; anything that is not a readable array is treated as empty, because
    -- the application already skips aliases it cannot parse, so there is
    -- nothing there to lose.
    BEGIN
      alias_list := CASE
        WHEN row_to_fix."aliases" IS NULL THEN '[]'::jsonb
        WHEN btrim(row_to_fix."aliases") = '' THEN '[]'::jsonb
        ELSE row_to_fix."aliases"::jsonb
      END;
      IF jsonb_typeof(alias_list) <> 'array' THEN
        alias_list := '[]'::jsonb;
      END IF;
    EXCEPTION WHEN others THEN
      alias_list := '[]'::jsonb;
    END;

    IF NOT (alias_list @> to_jsonb(row_to_fix."masterReferenceId")) THEN
      alias_list := alias_list || to_jsonb(row_to_fix."masterReferenceId");
    END IF;

    UPDATE "GovernmentReference"
       SET "masterReferenceId" = repaired_id,
           "aliases"           = alias_list::text
     WHERE "id" = row_to_fix."id";

    renamed := renamed + 1;
    RAISE NOTICE '[repair-ids] % -> % (old name kept as an alias)',
      row_to_fix."masterReferenceId", repaired_id;
  END LOOP;

  RAISE NOTICE '[repair-ids] done — % renamed, % left for the merge step', renamed, blocked;
END
$$;
