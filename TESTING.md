# The thousand test citizens

A standing population of 1,000 synthetic accounts for exercising the platform at
a size three hand-made accounts cannot reach: whether a delegation chain still
resolves with 900 people behind it, whether a feed paginates, whether a tally is
right when a thousand voices land on one record.

They are not people. They have no names worth reading, no addresses that can
receive mail, and they live in a database the public site never opens.

---

## Why they are in a database of their own

The platform publishes the Public Pulse as the aggregated will of real people,
and this codebase has already had to strip out one layer of invented votes.

A thousand synthetic citizens sitting in the live database would put that layer
straight back, and it would be invisible — they would look exactly like everyone
else. Every "exclude test users" filter is one forgotten query away from
counting them.

So there is no flag and no filter. There is a separate database, and code that
refuses to write anywhere that has not been named as one. A query cannot forget
a row that is not there.

Three things enforce it, and each is tested:

| Guard | What it stops |
|---|---|
| `TEST_POPULATION_DATABASE_URL` is required, and never falls back to `DATABASE_URL` | Reaching the live database has to be a deliberate act |
| The target database's name must contain `test` or `population` | A typo cannot select a database holding real people |
| Nothing under `backend/src/` may import the builder | The running server has no code path that could create one |

They are recognisable anyway, on purpose: every id starts with `pop-` and every
address ends in `.invalid`, a domain [RFC 2606](https://www.rfc-editor.org/rfc/rfc2606)
reserves so it can never exist.

---

## Building them

Once, to make the database and give it the schema:

```bash
createdb civicvoice_population        # or CREATE DATABASE from psql

cd backend
DATABASE_URL='postgresql://…/civicvoice_population' \
DIRECT_URL='postgresql://…/civicvoice_population' \
  bunx prisma migrate deploy
```

Then, whenever you want the population — it takes about a second:

```bash
cd backend
TEST_POPULATION_DATABASE_URL='postgresql://…/civicvoice_population' \
  bun run seed-test-population

# a smaller one
TEST_POPULATION_DATABASE_URL='…' bun run seed-test-population 250
```

Safe to re-run. Citizen 417 has the same id, address and password every time, so
a failure can be reproduced rather than described.

---

## Using them

**Against a running system.** Point a backend at the population database and use
the site normally:

```bash
cd backend
DATABASE_URL='postgresql://…/civicvoice_population' \
DIRECT_URL='postgresql://…/civicvoice_population' \
  bun run start
```

Sign in as any of them:

```
citizen-0001@population.invalid … citizen-1000@population.invalid
password: test-population-password-not-a-real-one
```

The password is not a secret. It unlocks a thousand accounts that hold nothing,
in a database that serves nobody.

**From a test.** Build them on demand — the suite does this rather than assuming
somebody seeded first:

```ts
import { buildPopulation, citizen } from "../scripts/lib/test-population";

const everyone = await buildPopulation(prisma, 1_000);
```

`backend/tests/population.test.ts` shows the shapes: signing one in over HTTP,
a thousand votes on one record, 900 delegators behind a single delegate, and a
chain deeper than the delegation cap.

---

## Checking a real database is clean

Run this against production whenever you want the reassurance. It is read-only
and deletes nothing:

```bash
cd backend
DATABASE_URL='<the production URL>' bun run check-no-population
```

It exits non-zero and names what it found. If it ever fires, work out how they
arrived before removing anything — their votes may already be inside a published
tally.

---

## What building them turned up

Deleting a user does **not** delete their votes. `GovernmentReferenceVote.userId`
is a plain string with no relation to `User`, so the database does not cascade
it — and the same is true of `PostLike`, `PostSave`, `PostShare`,
`UserInteraction`, `UserFeedProfile`, `CreatorMetrics` and `Media`.

For the test population this is handled: `removePopulation()` deletes those rows
itself, and a test proves nothing is left behind.

For real accounts it is not handled, and it means **a person who deletes their
account keeps voting**. Their votes stay in every published tally for good.
Fixing it means adding foreign keys to a schema shared with another project, so
it is written up rather than done — see the note in `HANDOFF.md`.
