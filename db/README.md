# Database

One Supabase Postgres instance (project ref `osvquqtywladyaycycnu`) backs both
`apps/web` and `apps/mobile`, through the Hono backend in `backend/`. There is
no second database — the two clients share every table.

That sharing is the single most important fact about this database. A schema
change made for one client lands on the other immediately.

## The two oldest migrations cannot run on Postgres

`20260310204227_initial` and `20260310204800_add_government_reference_system`
are **SQLite dialect** — `DATETIME` columns, `PRAGMA` statements, and SQLite's
table-rebuild dance (`CREATE new_Post` / `INSERT SELECT` / `DROP TABLE` /
`RENAME`). They are leftovers from the Vibecode template's SQLite era. Postgres
has no `PRAGMA` and no `DATETIME` type, so neither file can execute against it.

Production is unaffected because both are **baselined**: `_prisma_migrations`
records them with `applied_steps_count = 0`, meaning marked applied without ever
running. That is why `migrate deploy` succeeds against the live database.

It would **fail on the first migration against an empty one**. An earlier version
of this document claimed the repo could rebuild the database; it could not.

For a fresh database, use `db/postgres-baseline.sql` — generated from
`schema.prisma` via `prisma migrate diff --from-empty` and therefore genuine
Postgres DDL — then baseline the two SQLite migrations and apply the rest:

```bash
# 1. create the schema
psql "$SUPABASE_DIRECT_URL" -f db/postgres-baseline.sql

# 2. mark the two SQLite migrations applied so deploy skips them
cd backend
bunx prisma migrate resolve --applied 20260310204227_initial
bunx prisma migrate resolve --applied 20260310204800_add_government_reference_system

# 3. apply the Postgres-dialect migrations normally
bunx prisma migrate deploy
```

This procedure has been run end to end against a real, empty Postgres 16 — not
reasoned about. The result: 30 tables (29 models plus `_prisma_migrations`),
`migrate deploy` reporting "All migrations have been successfully applied", and
the check that actually settles it:

```bash
bunx prisma migrate diff --from-url "$URL" \
  --to-schema-datamodel prisma/schema.prisma --exit-code
# No difference detected.
```

A database built this way is equivalent to `schema.prisma`, not merely close to
it. Re-run that diff after changing any migration.

The first attempt **failed**, and what it exposed is worth keeping in mind
before editing any migration in this repo. Step 3 stopped with:

```
ERROR: column "citizenBrief" of relation "GovernmentReference" already exists
DbError { code: SqlState(E42701) }
```

`postgres-baseline.sql` is generated from `schema.prisma`, so it already
contains every object the later migrations add. A migration that assumes an
object is absent therefore cannot survive the baseline path.
`20260808134500_restore_web_adminsession_and_govref_fields` was written without
guards and had to be made idempotent (`ADD COLUMN IF NOT EXISTS`,
`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

**Rule for new migrations: guard every statement.** Two independent forces make
this non-optional here — the baseline path above, and the fact that this
database has been reshaped underneath the application by an external writer
many times. Note that Postgres has no `IF NOT EXISTS` for a multi-column
`ALTER TABLE`, so a combined `ADD COLUMN, ADD COLUMN` must be split into one
statement per column.

The four newer migrations are all Postgres-safe and run normally.

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

Their definitions are now captured in `live-objects/search-objects.sql`.

Capturing them turned up two things worth knowing.

**They do not read the Prisma tables.** All four data-touching objects target the
snake_case `legacy` schema, not `public."Bill"` and friends. The search
infrastructure and the application schema are two separate worlds that happen to
share a database.

**Two of the three functions are broken in production.**

| Object | State |
|---|---|
| `mv_bills_search` | working, populated |
| `mv_legislative_search` | working, populated |
| `refresh_search_materialized_views` | working |
| `get_bill_with_cache_check` | **broken** — `42P01: relation "bill_cache" does not exist` |
| `upsert_search_caches_from_bills` | **broken** — every relation it names is missing from `public` |

`get_bill_with_cache_check` declares `RETURNS SETOF legacy.bill_cache` but
queries `bill_cache` unqualified, so it resolves against a search_path that does
not include `legacy`. Confirmed by calling it: every call throws.

`upsert_search_caches_from_bills` reads `public.bills` and writes
`public.bill_cache` / `public.ai_search_cache`. None of those exist in `public` —
they are in `legacy`. It was left behind when the tables moved schema, and it is
`SECURITY DEFINER`, so it bypasses RLS if repaired carelessly.

Both are preserved as-is rather than fixed. Repairing them means first deciding
whether the legacy search path is still wanted, and nothing in this repo calls
either one. `search-objects.sql` documents the fix for each.

## `legacy/`

- `0001_init_supabase_native_UNAPPLIED.sql` — an earlier Supabase-native schema
  using snake_case tables (`bills`, `votes`, `feed_items`, `bill_cache`,
  `timeline_posts`) plus RLS policies and a `search_bills` function. A completely
  different design from the Prisma schema.

  The `_UNAPPLIED` suffix is **misleading and kept only for filename stability**.
  This design *was* deployed — it lives in a separate `legacy` schema, which
  still holds `legacy.bills`, `legacy.legislative_items` and `legacy.bill_cache`
  with data in them. It is not in `public`, which is why it does not show up in
  the PostgREST table listing (PostgREST exposes `public` only).

  Do not apply this file to `public`. The search objects in `live-objects/` read
  from `legacy`, so the schema cannot simply be dropped either — see below.

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
