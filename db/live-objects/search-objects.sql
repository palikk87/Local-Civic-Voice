-- Search objects captured from the live database (project ref osvquqtywladyaycycnu).
--
-- These five objects exist in production but appear in no migration and no
-- source file in either Vibecode export. They were created out of band, through
-- the Supabase SQL editor. Captured here so the database can be rebuilt.
--
-- Captured via pg_matviews.definition and pg_get_functiondef(). Reformatted for
-- readability; the SQL semantics are unchanged.
--
-- IMPORTANT: these objects do NOT read the Prisma tables. They read a separate
-- `legacy` schema holding snake_case tables (legacy.bills,
-- legacy.legislative_items, legacy.bill_cache) — the deployed form of the older
-- Supabase-native design preserved at db/legacy/0001_init_supabase_native_UNAPPLIED.sql.
-- The Prisma schema (public."Bill", public."Post", …) is a separate world. See
-- db/README.md.
--
-- Two of these functions are BROKEN in production. See the notes below each.


-- ---------------------------------------------------------------------------
-- Materialized views — both WORKING and populated.
-- ---------------------------------------------------------------------------

CREATE MATERIALIZED VIEW public.mv_bills_search AS
SELECT
    id AS bill_uuid,
    title,
    short_title,
    full_text,
    simplified_text,
    updated_at
  FROM legacy.bills b;


CREATE MATERIALIZED VIEW public.mv_legislative_search AS
SELECT
    gov_api_id,
    title,
    summary,
    created_at
  FROM legacy.legislative_items l;


-- ---------------------------------------------------------------------------
-- refresh_search_materialized_views — WORKING.
-- Refreshes both views above. Nothing schedules it; it is called manually.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refresh_search_materialized_views()
 RETURNS void
 LANGUAGE sql
AS $function$
REFRESH MATERIALIZED VIEW public.mv_bills_search;
REFRESH MATERIALIZED VIEW public.mv_legislative_search;
$function$;


-- ---------------------------------------------------------------------------
-- get_bill_with_cache_check — BROKEN IN PRODUCTION.
--
-- Calling it fails with:
--     42P01: relation "bill_cache" does not exist
--
-- The return type is qualified (SETOF legacy.bill_cache) but the two queries in
-- the body reference `bill_cache` unqualified, so they resolve against the
-- function's search_path — which does not include `legacy`. Every call throws.
--
-- Preserved verbatim rather than repaired: fixing it means deciding whether the
-- legacy cache path is still wanted at all, and nothing in this repo calls it.
-- To repair, qualify both references as legacy.bill_cache, or add
--     SET search_path = legacy, public
-- to the function definition.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_bill_with_cache_check(search_id text)
 RETURNS SETOF legacy.bill_cache
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- 1. Check if we have it
  IF EXISTS (SELECT 1 FROM bill_cache WHERE id = search_id) THEN
    RETURN QUERY SELECT * FROM bill_cache WHERE id = search_id;
  ELSE
    -- 2. If not found, return nothing (App then knows to call API)
    RETURN;
  END IF;
END;
$function$;


-- ---------------------------------------------------------------------------
-- upsert_search_caches_from_bills — BROKEN IN PRODUCTION.
--
-- Every relation it names is in the `public` schema, and none of them exist
-- there. Confirmed against the live database:
--     public.bills             -> 404 (PGRST205, hint: "Perhaps you meant public.Bill")
--     public.bill_cache        -> 404
--     public.ai_search_cache   -> 404
--
-- The tables it wants live in `legacy`, so this fails on its first statement.
-- Note the inconsistency with the materialized views above, which correctly say
-- legacy.bills — this function was left behind when those tables moved schema.
--
-- Not invoked during capture: it performs INSERTs, and a broken write function
-- is not something to test against production.
--
-- SECURITY DEFINER: runs with the definer's privileges, so it bypasses RLS.
-- Worth reviewing before any repair.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_search_caches_from_bills()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Upsert bill_cache
  INSERT INTO public.bill_cache (
    bill_id, title, short_title, category, raw_text, source_url,
    last_updated, updated_at, master_reference_id
  )
  SELECT
    b.id::text, b.title, b.short_title, b.category,
    COALESCE(b.simplified_text, b.full_text), NULL,
    b.updated_at, b.updated_at, b.official_id
  FROM public.bills b
  ON CONFLICT (bill_id) DO UPDATE
  SET title               = EXCLUDED.title,
      short_title         = EXCLUDED.short_title,
      category            = EXCLUDED.category,
      raw_text            = EXCLUDED.raw_text,
      last_updated        = EXCLUDED.last_updated,
      updated_at          = EXCLUDED.updated_at,
      master_reference_id = COALESCE(EXCLUDED.master_reference_id,
                                     public.bill_cache.master_reference_id);

  -- Upsert ai_search_cache: store structured raw_data
  INSERT INTO public.ai_search_cache (
    id, user_query, ai_interpretation, source_api, raw_data,
    created_at, master_reference_id
  )
  SELECT
    gen_random_uuid(), NULL, NULL, 'bills_sync',
    to_jsonb(json_build_object(
      'bill_id',         b.id::text,
      'official_id',     b.official_id,
      'title',           b.title,
      'short_title',     b.short_title,
      'summary',         b.summary,
      'simplified_text', b.simplified_text,
      'full_text',       b.full_text,
      'updated_at',      b.updated_at
    )),
    now(), b.official_id
  FROM public.bills b
  ON CONFLICT (master_reference_id) DO UPDATE
  SET raw_data            = EXCLUDED.raw_data,
      created_at          = now(),
      master_reference_id = COALESCE(EXCLUDED.master_reference_id,
                                     public.ai_search_cache.master_reference_id);
END;
$function$;
