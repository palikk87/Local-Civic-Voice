# The database is shared with another project

**This is a report. It changes nothing.** It exists because the database this
app writes to is not this app's alone, and nobody had written down what that
actually means for us — which of our objects a co-tenant could collide with,
which of our migrations would fail if one did, and what the fix would cost.

Read the last section before deciding anything. The recommended change is
cheap today and expensive later, and it is not mine to make.

---

## What we occupy, by name

**Database name: `postgres`.** Not a name we chose — it is the default database
on a Supabase project, and the connection strings in `.env.example` point at it
on both the pooled (`:6543`) and direct (`:5432`) ports.

**Schema: `public`.** All of it. `schema.prisma` declares no `@@schema` and no
`@@map` on any model, so every table lands in `public` under the exact name of
its Prisma model.

**46 models. 46 tables.** Plus `_prisma_migrations`, which Prisma creates in
`public` and uses to decide what has already run.

---

## The collision surface

A shared database is only a problem where two tenants want the same name. Ours
are, for the most part, the most generic nouns available:

```
User      Session   Account   Verification   Post      Comment
Media     Follow    Bill      Vote           Message   Report
Block     Mute      Mention   Hashtag        Notification
```

Any of those is a name a second application would plausibly choose for itself.
Half of them are what Better Auth names its tables by default, so a co-tenant
that also uses Better Auth would want `User`, `Session`, `Account` and
`Verification` under exactly those names.

The rest of our tables are specific enough to be safe by accident —
`GovernmentReferenceVote`, `ReferenceMergeCandidate`, `RollCallMemberVote`,
`B2BClient`, `MergeJournalRow`, `PositionEvent` — but safety by accident is not
a property, it is a coincidence that holds until somebody else's schema grows.

**`_prisma_migrations` is the sharpest edge.** It is one table, in `public`,
keyed by migration name. If the co-tenant is also a Prisma project pointed at
this database, both projects read and write that one ledger — and each would
see the other's applied migrations as unknown entries. Neither Prisma is
designed to find migrations there it did not write.

---

## What we already do right

- **`prisma db push` is impossible.** CI fails the build if the phrase appears
  anywhere in the repo, and `scripts/no-db-push.sh` runs the same check
  locally. `db push` diffs the schema against the live database and *drops what
  it does not recognise* — on a shared database that is not a bad idea, it is a
  loaded weapon.
- **Drift is checked against a throwaway database.** `backend/scripts/drift-check.sh`
  builds its own empty database per run and never reads `DATABASE_URL` from the
  environment, so the check can never touch the real one.
- **No migration drops a column or a table.** Every one is additive.

## What is not yet right

Idempotency guards (`IF NOT EXISTS`) were adopted on 2026-08-22 and every
migration since carries them. Five earlier ones do not:

| Migration | DDL statements | Guarded |
|---|---:|---|
| `20260815011454_init` | 137 | none |
| `20260821000000_social_safety_and_comment_likes` | 23 | none |
| `20260821010000_reposts` | 3 | none |
| `20260821020000_message_notifications` | 1 | none |
| `20260822000000_position_ledger` | 6 | none |

On the database we run against today this is harmless — they have already
applied, and Prisma will not run them again. It matters in exactly one
situation, and it is a situation somebody will eventually be in: **bringing up
a second environment against a database that is not empty.** `init` would reach
`CREATE TABLE "User"` and stop, and because Prisma applies a migration in a
single transaction, it would stop having done nothing, with a failed entry in
`_prisma_migrations` that a human has to resolve by hand.

Retrofitting guards onto those five is safe (the statements are all `CREATE`),
but it edits migrations that have already run, and editing an applied migration
changes its checksum — Prisma will then refuse to proceed on any database that
recorded the old one. That is why it is listed here rather than done.

---

## The fix, and why it is a decision rather than a task

Two options. Both are one-time, both need coordinating with whoever owns the
other project, and both are far cheaper before the tables have more rows.

**1. Move to our own schema.** Put every model in a schema named for this
application — `ayeandnay` — instead of `public`. Prisma supports it directly
(`multiSchema` and `@@schema`), the connection string carries the search path,
and after it the two tenants cannot collide on a name at all, including on
`_prisma_migrations`. This is the real fix. It is also a move of every table,
which means a maintenance window and a rehearsal on a copy first.

**2. Prefix every table.** `@@map("an_user")` and so on. Cheaper to execute,
uglier forever, and it does nothing about `_prisma_migrations`, which is the
one table most likely to cause a confusing failure.

**Doing nothing is a real option too**, and it is the right one if the other
project is known, small, and not growing — the collision is only theoretical
until somebody adds a table. What makes it a decision is that the cost of
option 1 goes up every week and the cost of doing nothing goes up all at once,
on the day it bites.

---

## What would tell us more

Nothing in this repository can see the other tenant. Answering these needs
somebody with access to the database itself:

- What else is in `public`? (`\dt public.*`)
- Is the co-tenant a Prisma project? (does it have its own migrations ledger,
  or is it sharing ours?)
- Does anything outside this codebase read or write our tables?

Until those are answered, this report describes our side of the boundary only,
which is the half we control.
