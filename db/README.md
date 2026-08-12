# Database

One Supabase Postgres instance (project ref `osvquqtywladyaycycnu`) backs both
`apps/web` and `apps/mobile`, through the Hono backend in `backend/`. There is
no second database — the two clients share every table.

That sharing is the single most important fact about this database. A schema
change made for one client lands on the other immediately.

## Schema source of truth

`backend/prisma/schema.prisma` — 26 models. Migrations live in
`backend/prisma/migrations/` and are applied with:

```bash
cd backend && bunx prisma migrate deploy
```

## Migration history, and how it was repaired

The two Vibecode exports disagreed about history. Neither had the full set:

| Migration | in web export | in mobile export | applied in prod |
|---|:--:|:--:|:--:|
| `20260310204227_initial` | backup only | yes | yes (baselined) |
| `20260310204800_add_government_reference_system` | backup only | yes | yes (baselined) |
| `20260728160000_reference_content_cache` | backup only | no | **no** |
| `20260808134500_restore_web_adminsession_and_govref_fields` | no | yes | yes |
| `001_add_admin_session` | yes | no | yes |

Production was queried directly to settle it — the `_prisma_migrations` table is
the authority, and the table above reflects what it reported.

Two repairs were made:

1. **Assembled the full lineage.** The web export's active migrations folder held
   only `001_add_admin_session`; the other three applied migrations were copied
   in from the mobile export.

2. **Fixed the ordering bug.** Prisma applies migrations in lexicographic order.
   `001_add_admin_session` sorts *before* `20260310204227_initial`, but it runs
   `ALTER TABLE "User"` and `ALTER TABLE "GovernmentReference"` — tables that
   `initial` creates. Rebuilding from scratch would have failed on a fresh
   database. It was renamed to `20260808140357_add_admin_session`, matching the
   timestamp production recorded for it.

   Production's `_prisma_migrations` still records the old name
   `001_add_admin_session`. `migrate deploy` will therefore see the renamed
   migration as unapplied and run it. That is safe — every statement in it is
   `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, written that way precisely
   because two projects share this database. If you would rather it not re-run:

   ```bash
   bunx prisma migrate resolve --applied 20260808140357_add_admin_session
   ```

`20260728160000_reference_content_cache` was never applied to production and is
**not** in the active lineage. It is preserved in `legacy/sqlite-era-migrations/`.

## Objects that exist only in production

These five exist in the live database but appear in **no migration and no source
file** in either export. They were created out of band. If the database were
ever rebuilt from this repo, they would not come back:

| Object | Kind | Columns / args |
|---|---|---|
| `mv_bills_search` | materialized view | `bill_uuid`, `title`, `short_title`, `full_text`, `simplified_text`, `updated_at` |
| `mv_legislative_search` | materialized view | `gov_api_id`, `title`, `summary`, `created_at` |
| `get_bill_with_cache_check` | function | `search_id` |
| `refresh_search_materialized_views` | function | — |
| `upsert_search_caches_from_bills` | function | — |

Only their shape is recorded here — that is what the REST API exposes. The
defining SQL still needs capturing. Run this in the Supabase SQL Editor and save
the output as `db/live-objects/search-objects.sql`:

```sql
select 'MATERIALIZED VIEW ' || matviewname as object, definition
  from pg_matviews
 where schemaname = 'public'
union all
select 'FUNCTION ' || p.proname, pg_get_functiondef(p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'get_bill_with_cache_check',
     'refresh_search_materialized_views',
     'upsert_search_caches_from_bills'
   );
```

Until that lands, this repo cannot fully rebuild the database.

## `legacy/`

- `0001_init_supabase_native_UNAPPLIED.sql` — an earlier Supabase-native schema
  using snake_case tables (`bills`, `votes`, `feed_items`, `bill_cache`,
  `timeline_posts`) plus RLS policies and a `search_bills` function. It is a
  completely different design from the Prisma schema and was **never deployed** —
  production has the PascalCase Prisma tables. Kept for reference only. Do not
  apply it.

- `sqlite-era-migrations/` — migrations from when the backend targeted local
  SQLite, including the unapplied `reference_content_cache`.

## Historical note: `prisma db push --accept-data-loss`

`backend/scripts/start` used to run this on **every boot**:

```bash
bunx prisma db push --accept-data-loss
```

`db push` makes the database match `schema.prisma` by any means necessary,
including dropping columns, and `--accept-data-loss` suppresses the confirmation.
Pointed at a Postgres instance shared by two independently-deployed clients,
whichever service booted last would reshape the database under the other.

The comment in `20260808140357_add_admin_session/migration.sql` records the
outcome: a `DROP COLUMN` on `User.banned` destroyed 423 rows' worth of values and
broke banning on mobile.

The boot script now runs `prisma migrate deploy`, which applies only committed
migrations and never drops anything on its own.

## `SUPABASE_DATABASE_URL` vs `DATABASE_URL`

`schema.prisma` and `src/env.ts` read `SUPABASE_DATABASE_URL` / `SUPABASE_DIRECT_URL`
rather than the conventional names. This was not a style choice: the Vibecode
backend template regenerated `scripts/env.sh` and, in production only, did

```bash
export DATABASE_URL="file:/data/production.db"
```

assuming every backend was local SQLite. That silently replaced the real
database, the server refused to boot, and every `/api/*` call returned 502.
Editing the script fixed it only until the next template sync overwrote it.

Nothing regenerates `env.sh` anymore, so the indirection is no longer load-bearing.
To collapse it, point the datasource in `schema.prisma` and the resolver in
`src/env.ts` at `DATABASE_URL` / `DIRECT_URL`, then update the deployment's
environment variables in the same change. Both names are set today, so the
switch can be made without downtime.
