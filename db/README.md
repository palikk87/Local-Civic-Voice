# Database

One Postgres, one schema file, one migration.

`backend/prisma/schema.prisma` is the source of truth. Everything else is
generated from it.

## Bringing up a new database

```bash
cd backend
export DATABASE_URL="postgresql://…"   # pooled
export DIRECT_URL="postgresql://…"     # unpooled
bunx prisma migrate deploy
```

That is the whole procedure. No baseline file, no `migrate resolve`, no SQL
pasted into a dashboard, no manual repair step.

Verified end to end against a genuinely empty Postgres 16 — created empty
(`tables_before=0`), then `migrate deploy` and nothing else:

```
tables  30   (29 models + _prisma_migrations)
indexes 122
fkeys   26

prisma migrate diff --from-url $DATABASE_URL \
  --to-schema-datamodel prisma/schema.prisma --exit-code
→ No difference detected.
```

The database is *equivalent to* `schema.prisma`, not approximately it. Re-running
`migrate deploy` is a no-op and `migrate status` reports "Database schema is up
to date!".

## Why there is only one migration

The old history was six migrations, and it could not be replayed. The two oldest
were SQLite dialect — `DATETIME` columns and `PRAGMA` statements, left over from
a template that assumed local SQLite — so `migrate deploy` against an empty
Postgres died on the first file with `42704: type "datetime" does not exist`.

The live database only tolerated them because they had been *baselined*: recorded
in `_prisma_migrations` with `applied_steps_count = 0`, meaning marked applied
without ever running. That worked exactly as long as nobody needed a second
database.

It was replaced rather than repaired. The history was deleted and one migration
was generated from the schema with `prisma migrate dev --name init`. Nothing was
lost: the schema is the same 29 models, and the old files remain in git history.

## Adding a migration

```bash
cd backend
bunx prisma migrate dev --name what_you_changed
```

Commit the generated folder. Never edit an applied migration, and never run
`prisma db push` against a deployed database — it reshapes the database to match
the schema by any means available, including dropping columns. A CI job fails the
build if `db push` reappears anywhere in the repo.

## Adding a column safely

Prisma generates `ALTER TABLE "T" ADD COLUMN "c" TEXT NOT NULL;` for a required
column, which fails on a table with rows. Either give it a default or add it
nullable, backfill, then tighten — same as anywhere else.

## Connection variables

| Variable | What it is | Used by |
|---|---|---|
| `DATABASE_URL` | pooled connection | the running server |
| `DIRECT_URL` | unpooled connection | `prisma migrate` |

On Supabase these are the "Transaction pooler" and "Direct connection" strings
respectively. Migrations need the direct one — the transaction pooler does not
support the session-level statements Prisma issues.

Neither variable has a fallback. If either is missing the process fails at
startup instead of quietly connecting somewhere else. That is deliberate: the
previous setup had a fallback chain that silently pointed the backend at a local
SQLite file in production, and every API call returned 502 until someone worked
out why.

## Seeding content

`GovernmentReference` rows (bills, executive orders, court cases) are populated
from the upstream government APIs, not from a database dump. See
`backend/src/services/government-sync.ts` and `MIGRATION.md`.
