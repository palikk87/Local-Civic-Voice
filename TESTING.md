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

## The social side

`backend/tests/social.test.ts` covers it, over real HTTP: following, feeds,
posting, liking, commenting, replying, deleting, saving, sharing, messaging,
notifications, search and discovery. None of it had a test before.

**There are no "friends" on this platform.** There is no mutual-consent
relationship and no friend request — the only tie between two people is a
follow, which is one-directional and needs nobody's permission. Two people who
follow each other are, in effect, friends, but nothing in the schema or the UI
calls them that. If mutual friendship is wanted, it is a feature to build, not
a bug to fix.

---

## Safety: blocking, muting, reporting

`backend/tests/safety.test.ts`. A block is only as good as its least careful
query — hiding somebody from the feed while leaving them in search, in a comment
thread, or reachable by message is the same failure to the person who blocked
them. So there is one case per surface.

| | Block | Mute |
|---|---|---|
| Their posts leave your feed and every list | yes | yes |
| Their comments leave threads you read | yes | no |
| They vanish from search and suggestions | yes | no |
| They can follow, message or reply to you | no | yes |
| Existing follows severed | both directions | untouched |
| A delegation between you withdrawn | yes, tally moves at once | no |
| They are told | never | never |

Nothing anywhere says "you have been blocked". A blocked person's request looks
exactly like one aimed at an account that does not exist — telling them is an
invitation to open a second account, and the point of a block is that contact
stops.

Reports are evidence, never an action: nothing is hidden or removed because
somebody complained. They queue at `GET /api/admin/reports` for a person to
read.

---

## Reach: reposting, messages, search, hashtags

`backend/tests/reach.test.ts`. Everything here existed as a fragment before it
existed as a feature.

- **Reposting.** A repost points at the original, never at another repost, so a
  post's count is the number of people who passed it on rather than the depth of
  a game of telephone. A plain repost toggles; a quote does not, because several
  quotes say different things. It inherits the original's law — a repost about a
  different bill would be a new post.
- **Messages notify.** A direct message notified nobody, so it was only ever
  seen if the recipient happened to open the inbox.
- **Post search** matches the words written and the title of the law they were
  written about, because people search for what a law does and the post may
  never use the word.
- **Hashtags** are extracted, counted, and have a page. Nothing wrote to the
  Hashtag table before, so the trending list had always been empty.

---

## What this platform can do that others cannot

Four features that fall straight out of the premise — every post attached to a
government record, and votes that can be lent — and are covered by
`backend/tests/position-record.test.ts` and `backend/tests/other-side.test.ts`.

**Receipts for a lent voice.** Liquid democracy is sold as convenience and then
goes quiet: you are told how many delegations you have made, never what was done
with them. Each receipt names the record, the position taken in your name, and
who actually cast it — which is not always the person you chose, because a voice
travels the chain. Derived from the same walk that produces the tally, never
recorded separately, so the receipts cannot describe a count nobody published.

**A citizen's record.** Every position, kept forever, with the version of the
law it was taken on. Append-only: changing your mind adds a row and never erases
one, and "changed my mind" is shown rather than buried. A change of mind means
crossing sides — withdrawing is its own act, and re-affirming after a withdrawal
is somebody returning to where they were.

**"The text moved."** You backed this in March; it has been amended twice since.
Nothing is ever withdrawn automatically, because silence is not a change of mind
and a platform that decides what your silence meant has taken the position for
you.

**The other side.** Not an algorithm and not a curated panel. Every post is
attached to a record and every position on it is known, so the other side is
literally the people who voted the opposite way on this exact bill and wrote
about it — ordered by how much people engaged with the argument, not how much
they liked it. Shows nothing until you have taken a position yourself; without
one there is no "other" side, and picking one for you is the thing being
avoided.

**How opinion moved.** Readable only because positions are kept as events. The
day the text changed is marked, because on this platform the amendment is
usually the answer to what turned it.

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
