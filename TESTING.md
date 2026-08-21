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

## Driving the whole system with them

```bash
cd backend
TEST_POPULATION_DATABASE_URL='postgresql://…/civicvoice_population' \
  bun run system-check
```

This is the only check that runs the **whole stack**: the real backend, a real
Postgres, the real built site, and a real browser clicking real buttons. The
other browser checks serve the built site against a stub, which is right for
asking "does this page render" and cannot answer "does delegating actually move
the number".

The citizens do this, in order, and every assertion reads the number back from
the public API afterwards rather than trusting the screen:

1. sign in through the form
2. vote on a record — the Pulse moves
3. a second citizen delegates to the first — the lent voice joins at once
4. the Pulse reads as direct votes and delegated weight, separately
5. the second citizen votes for themselves — it overrides their delegate
6. and does not cost them the delegation
7. they withdraw their own vote — the weight goes back to the delegate
8. they revoke — the borrowed voice leaves immediately

It needs `apps/web/dist` built first (`cd apps/web && bun run build`). Set
`SYSTEM_CHECK_DEBUG=1` to have it print cookies and the session body at each
sign-in.

Adding a feature to the check means adding a journey to
`apps/web/scripts/system-check-journeys.mjs` and nothing else.

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


---

## One fault this found that is not fully closed

The system check once left a record publishing **two** supporters when one
person had voted and nobody had lent a voice — confirmed against the database
afterwards.

Recounting is a read followed by a write, and two of them overlapping can lose
one: the slower request writes a total it worked out before the faster one
changed anything, and the stale number then sits on the card until the next vote
happens to correct it. `applyWeightedTally` now holds a row lock (`FOR UPDATE`)
so that whoever writes last has also read last.

Be precise about what that means: the fault was seen **once** and has not
recurred, with or without the lock. Races do not appear on demand. The lock is
there because the hazard is structural and visible in the code, not because a
test can summon it — the concurrency test in `population.test.ts` passes either
way and says so in its own comments. Anyone tempted to remove the lock for want
of a failing test should reproduce the interleaving first.
