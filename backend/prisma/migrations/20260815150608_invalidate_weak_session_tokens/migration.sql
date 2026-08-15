-- Invalidate every session token issued by the old generator.
--
-- Until the commit this migration ships with, both routers built their session
-- tokens as `<prefix>_${Date.now()}_${Math.random().toString(36)...}`. Neither
-- half is unpredictable: the timestamp is public to the millisecond, and V8's
-- Math.random() is an xorshift128+ PRNG whose internal state can be solved for
-- from a handful of observed outputs — after which every token it goes on to
-- produce is known.
--
-- Every row in AdminSession and B2BSession right now was minted by that
-- generator. Changing the generator does not help those rows: they stay valid
-- for the rest of their 24-hour lifetime, so the weakness would outlive the fix
-- by a day. Deleting them is what actually ends it.
--
-- NOT ADDITIVE, and that is deliberate rather than an oversight. Every other
-- migration in this project is additive because the tables it touches hold data
-- somebody would miss. These two hold bearer tokens that expire within 24 hours
-- by construction and carry no state beyond "who is signed in" — the cost of
-- deleting them is that whoever is looking at the admin console or the B2B
-- dashboard at that moment signs in again. Nothing is lost that was not going
-- to be gone by tomorrow anyway.
--
-- Consumer accounts are untouched. Those sessions live in the Better Auth
-- `Session` table, which uses Better Auth's own token generator, not this one.
--
-- Idempotent twice over: DELETE against already-empty tables is a no-op, and
-- Prisma records the migration so it runs once per database regardless. On a
-- fresh database both tables are empty and this does nothing at all.
--
-- The to_regclass guards exist so a database that somehow reaches this point
-- without one of the tables fails the deploy no more loudly than it has to.
-- This migration is not the right place to discover a missing table.

DO $$
BEGIN
  IF to_regclass('public."AdminSession"') IS NOT NULL THEN
    DELETE FROM "AdminSession";
  END IF;

  IF to_regclass('public."B2BSession"') IS NOT NULL THEN
    DELETE FROM "B2BSession";
  END IF;
END
$$;
