# What still needs you

> **How work reaches you: see [SHIPPING.md](SHIPPING.md).** `main` is the
> product; anything not on it is not live. `bun run verify` before pushing,
> `bun run deploy-check` after, and the second one tells you whether the site
> and the API are actually running what you think they are.

Everything in this file requires an account, a password, a card, or a decision
that is yours to make. None of it can be done from inside a coding session, and
none of it has been done on your behalf — by design. Every service here is
registered to you, billed to you, and logged into by you.

The code is finished. This is the list of switches only you can throw.

Ordered by what blocks what.

---

## 1. Railway — is the API actually up? (blocks everything below)

**Status: unknown.** The last thing you told me was that Railway was blocked. I
have no way to check from here.

Go to the service and confirm `https://<your-api>/health` returns JSON. If it
does, skip to step 2.

If it does not, the three things that produce a healthy-looking failure:

- **Port mismatch.** `backend/Dockerfile` sets `PORT=3000`. Railway's generated
  domains often route to 8080. Wrong either way and the server starts perfectly,
  the logs look clean, and every request returns 502. Either set a `PORT`
  variable matching the target port, or change the target port to 3000.
- **`DATABASE_URL` / `DIRECT_URL` reversed.** Migrations need the session or
  direct connection (port 5432), not the transaction pooler (6543). The pooler
  drops the advisory lock migrations take.
- **A missing required variable.** The boot names every one it is missing and
  exits. Read the deploy log rather than guessing.

The full variable list is in `.env.example`, tagged `[API]`. Note the six
`B2B_*` values are tagged `[SEED]`, not `[API]` — the server does not read them
any more, and setting them on Railway does nothing.

---

## 2. Run the two seed scripts, once

Nothing can log in until these run. The database is otherwise correct but empty
of accounts.

```bash
cd backend

# Needs the API's own variables too — it creates the account through Better
# Auth. `railway run` supplies them; from a laptop you need BETTER_AUTH_SECRET,
# BACKEND_URL, APP_ORIGINS, APP_SCHEMES and MEDIA_STORAGE set as well.
ADMIN_EMAIL=you@example.com \
ADMIN_USERNAME=yourname \
ADMIN_PASSWORD='a real password' \
bun scripts/seed-admin.ts

# Needs only DATABASE_URL and DIRECT_URL.
B2B_DEMO_USERNAME=demo \
B2B_DEMO_PASSWORD='a real password' \
B2B_DEMO_API_KEY="$(openssl rand -base64 48)" \
B2B_ADMIN_USERNAME=civicadmin \
B2B_ADMIN_PASSWORD='a different real password' \
B2B_ADMIN_API_KEY="$(openssl rand -base64 48)" \
bun scripts/seed-b2b.ts
```

**Capture the two API keys as they scroll past.** They are hashed on the way in
and cannot be read back — only rotated.

Both are safe to re-run; re-running is how you rotate a password or a key.

After this you will not need `seed-b2b.ts` again: the admin console has a **B2B
clients** tab that creates accounts, rotates credentials, changes tiers and
revokes access without shell access. The script exists for the cold start, when
there is no admin account to log in with yet.

While you have a shell open, clear the two test posts a since-fixed bug
orphaned (they cannot be reached from the UI that made them):

```bash
cd backend
railway run bun scripts/delete-posts.ts --confirm \
  --content "Parity audit test post - please ignore. Will delete." \
  --content "Pagination probe A - will delete"
```

Drop `--confirm` to see what it matches first. It matches exact text only, so it
cannot take a real post with a similar opening line.

**Do not skip the B2B half.** A parity audit found `/b2b/login` rejecting every
credential on the deployed app, which looked like a broken portal and made all
eleven B2B functions untestable. The portal was fine — the table was empty.
There is nothing to log in as until either this script runs or an admin creates
a client in **Admin → B2B clients**, and the admin console says so in as many
words when the list is empty. Whichever route you take, it has to happen once
per environment.

**One-time effect of this deploy:** a migration deletes every row in
`AdminSession` and `B2BSession`. Anyone signed in to the admin console or the
`/b2b` dashboard at that moment is signed out and signs in again with the same
credentials. Ordinary user accounts are unaffected. Every one of those session
tokens was generated with `Math.random()`, so leaving them alive would have kept
the weakness alive for another 24 hours.

---

## 3. Object storage — create the bucket

`MEDIA_STORAGE=s3` with the `S3_*` set pointed at any S3-compatible provider:
Cloudflare R2, Backblaze B2, MinIO, AWS S3, DigitalOcean Spaces, Wasabi, or
Supabase Storage's S3 endpoint. Nothing in the code knows which.

Create the bucket, then an access key **scoped to that bucket**, not an
account-wide token.

Two settings that matter more than they look:

- **The bucket must be publicly readable** (or fronted by a CDN that is). The
  app serves media by URL and issues no signed links.
- **Do not enable bucket listing.** Object keys are 128 bits of CSPRNG output
  precisely because the key is the access control. Unguessable keys are
  worthless if the bucket will hand out an index of them. Off by default on R2
  and B2; on AWS S3, check `s3:ListBucket` is not in the public policy.

If the log says `driver=local` in production, fix `MEDIA_STORAGE` before anyone
uploads anything — local means the container's own disk, replaced on every
deploy.

---

## 4. Resend — verify a sending domain

`RESEND_API_KEY` and `EMAIL_FROM`. Password reset and sign-in codes do not
deliver until the domain is verified, and verification is DNS, so it takes hours
and is out of your hands once started. Start it early.

`EMAIL_FROM` currently defaults to Resend's shared onboarding sender, which
works for testing and will land in spam in production.

`/health` reports `email.configured` honestly. If it says false, reset is dead
and nothing else will tell you.

---

## 5. Government data — two free API keys

`CONGRESS_API_KEY` from api.congress.gov and `COURTLISTENER_API_KEY` from
CourtListener. Both free, both issued in minutes.

Without them `GovernmentReference` stays empty and Discover has nothing in it.
This is how the product gets its content, so it is not optional in practice.

If you ever need to refresh the recorded congress.gov fixtures the tests replay
(`backend/tests/fixtures/congress/`), that is the one place a real key is used
outside production:

```bash
cd backend
CONGRESS_API_KEY=... bun scripts/record-lineage-fixtures.ts
```

It strips the echoed request before writing, so no key lands in the repository.
The tests never touch the network.

`CONGRESS_API_KEY` now does a second job. Once a day the server asks
congress.gov which stored records are really the same law and reads the
published relationships — the ones the House, the Senate or the Congressional
Research Service assigned. A pair labelled "Identical bill" is merged
automatically, because that label means a Library of Congress analyst read both
texts and confirmed they match. Everything else goes to **Merge review** in the
admin console for you to answer once.

That sweep is one request per stored bill. A signed key allows 1,000 an hour and
the sweep is capped at 50 records a night, so it cannot starve search of the
same budget. Without the key nothing breaks — no lineage is fetched and the
queue simply stays empty.

---

## 6. Rotate everything that was ever in the repository

You said you would do this at launch rather than during the rebuild, which was
the right call — but it is now the last thing standing between you and a clean
slate.

Anything that ever appeared in this repository's git history must be treated as
public, because it is:

- the Supabase `service_role` key
- any AI provider keys
- the old B2B passwords and API keys
- the old admin password
- the database password

Generate new values, set them, and do not reuse anything from the old
deployment. Rotating the database password on Supabase is Project Settings →
Database → Reset database password, then paste the new one into both connection
strings.

---

## 7. Apple / EAS — the mobile build

`apps/mobile/eas.json` exists and the app is named, slugged and identified
(`com.civicvoice.app`). What is left needs your Apple Developer account:

- Enrol / sign in to Apple Developer
- `eas build --platform ios --profile production`
- Submit to TestFlight

Build from **your GitHub repository**, not from anything hosted elsewhere. A
build from another copy ships that copy's code and points at its infrastructure.

---

## 8. Custom domain (optional, whenever you want)

Vercel is live on its generated URL. When you point a real domain at it, update
`APP_ORIGINS` on the API to the new origin — no trailing slash — or login will
fail with no useful error. `APP_ORIGINS` accepts a comma-separated list, so you
can keep both during the switch.

---

## What this deploy changes that you will notice

**Vote counts drop to zero on most cards.** Every record carried a fabricated
tally — between 400 and 4,999 invented supporters and between 300 and 3,999
invented opponents, derived from a hash of its id — and those numbers were
inside the public count. A live check found all 33 stored records carrying them
and not one carrying a real vote, so the entire published pulse was invented. A
migration subtracts the fabricated layer and leaves exactly the real weighted
count, which for most records is nothing.

That is the correct number. A card saying nobody has voted yet is telling the
truth; a card saying four thousand people support a bill nobody has read is not,
and that number fed the trending list and the enterprise feed.

**Some record ids change.** Four of the eight congressional measure types were
being stored under mangled names — `sres-829-119` was written as
`s-res-829-119`, which no search could find and no government API could refresh.
A migration gives those records their real names back and keeps the old name, so
links already shared under it still work. Where the correct name was already
taken by another record, the pair is left alone and appears in Merge review
instead.

**A new admin tab: Merge review.** Two records that might be one law, with the
government's own label, who assigned it, and a link to the congress.gov page.
Approving is superadmin-only because it rewrites which record every affected
post and vote belongs to.

**People get notified when a law they shared changes.** Their post is never
edited — the card carries a badge saying the law has moved since it was posted.
On by default; it is in notification preferences like any other.

---

## Still open in the code

### Social features that do not exist yet

Built and tested: following, feeds, posts, likes, comments, replies, comment
likes, saves, shares, reposting and quoting, messaging with notifications,
notifications, searching people and posts, hashtags, discovery, blocking,
muting and reporting.

Also built, and this is the half no other platform has, because none of them
have a shared public record to compute it from:

- **Your record.** Every position you have ever taken, on which version of the
  text, and why if you said. Kept as events rather than as a current state, so
  reconsidering adds to the record instead of erasing it.
- **The review queue.** "You backed this in March, it has been amended since,
  still with it?" Nothing is ever withdrawn for you: silence is not a change
  of mind.
- **Who changed their mind.** Per record, who crossed sides, which way, why,
  and whether the government had amended the text between their two positions.
  Everywhere else a change of mind is a screenshot-ready liability; here it is
  the most useful sentence on the page.
- **The other side.** The people who voted the opposite way on this exact
  record and then wrote about it. Not inferred from clicks, not a curated
  panel — a matter of record.
- **Common ground.** On any profile: what the two of you have both taken a
  position on, split into agreements and disagreements. Both halves always,
  because showing only the agreements is a matchmaker for the echo chamber.
- **Where you stand alone.** Not a score. The positions where fewest people
  are with you, measured against direct votes only.
- **Delegation receipts, and a notification the moment your voice is used.**
  Named delegate, position, record, and the chain if it travelled past the
  person you chose — arriving while a direct vote can still override it.
- **A delegate's agreement with you**, on the delegate directory, before you
  hand anything over. Null below three shared records rather than a
  flattering percentage.
- **An onboarding that starts from positions, not popularity.** `/start` asks a
  new account about the records the room is most split on, then shows the
  people who agreed with them and the people who did not — both lists, always,
  and nobody at all until three positions are in.

Not built:

- **Friend requests.** Friendship is now *named* — two people who follow each
  other are friends, there is a count on the profile and a list at
  `/api/users/:id/friends` — but it is still only a mutual follow. There is no
  request to accept, no private tier, and nothing a friend can see that a
  follower cannot.

  That is naming an existing relationship, not building mutual consent. If a
  friendship should grant something, that is a product decision with a real
  design in it: what does it unlock, can you be unfriended without being
  unfollowed, does a request expire. Left for a person to decide rather than
  guessed at.
- **Editing a post.** Deliberate — a post is a public statement attached to a
  law, and the platform's own rule is that no post is ever edited. Worth
  confirming that is still the intent rather than an omission.
- **Pinning a post, muting a thread, and a public list of who blocked whom** —
  none of these exist and none of them should without a reason.

### The Representation Gap — built, and it never needed a key

**Correction to what this document used to say.** It said the gap was blocked
on a `CONGRESS_API_KEY` this environment does not have. That was wrong. Both
chambers publish every roll call themselves, as XML, unauthenticated:

- `https://www.senate.gov/legislative/LIS/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{roll}.xml`
- `https://clerk.house.gov/evs/{year}/roll{roll}.xml`
- Index: `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_{congress}_{session}.xml`

Both carry member-level detail — name, party, state, how each one voted — with
the official ids (LIS for the Senate, Bioguide for the House). Real responses
from the 119th Congress are recorded in `tests/fixtures/rollcall/` and replayed
in the tests.

What now exists: `RollCall` and `RollCallMemberVote` tables; parsers for both
chambers; `bun run sync-roll-calls` to pull and store them; and
`GET /:id/representation-gap` plus `GET /:id/official-vote`. The record
endpoint now sets `officialVotes`, which is the field PulseGap and the
"Official Vote" block have keyed on since the beginning and which nothing had
ever populated — so those panels render for a real record for the first time.

**Run the sync to see it.** Nothing is backfilled automatically:

```bash
cd backend
bun run sync-roll-calls --chamber house --house-year 2025 --limit 400
bun run sync-roll-calls --chamber senate --congress 119 --session 1
```

A gap only appears where both halves are real — a stored roll call AND at least
10 citizen votes on this platform. Below that it returns null and the panels
stay hidden, which is deliberate: an absent feature beats an invented number.

**Still missing: "how did MY representative vote."** The member-level data is
stored and the endpoint returns the whole chamber, but nothing knows which
district a given citizen is in. The Census geocoder answers that for free and
with no key (`https://geocoding.geo.census.gov/geocoder/geographies/address`,
verified working), but it needs a home address — and Bill of Rights Article IV
says collect "only the minimum data necessary". Storing an address to
personalise a panel is a real privacy decision, not a technical one, so it is
written up rather than guessed at. A district (not an address) could be stored
instead, which is the version worth considering first.

**Do not** use `officialVotes` from `government-data.ts`. Those are hardcoded
fixtures from the original prototype and are not real.

### A deleted account keeps voting

`GovernmentReferenceVote.userId` is a plain `String` with no relation to `User`,
so deleting a user does not delete their votes. They stay in the published tally
for good — the Pulse keeps counting a person who left.

Seven tables have the same shape: `GovernmentReferenceVote`, `PostLike`,
`PostSave`, `PostShare`, `UserInteraction`, `UserFeedProfile`, `CreatorMetrics`,
`Media`. The vote table is the one that matters; the rest inflate engagement
counts.

The fix is a migration adding the foreign keys with `onDelete: Cascade`. It is
**not applied**, for two reasons worth a decision rather than a guess:

1. The schema is shared with another project, and a new constraint affects both.
2. If orphaned rows already exist, the constraint will not build until they are
   cleared — and clearing them changes published tallies, which is a call for a
   person to make, not a migration to make quietly.

To find out whether there are any, before deciding:

```sql
SELECT count(*) FROM "GovernmentReferenceVote" v
  LEFT JOIN "User" u ON u.id = v."userId" WHERE u.id IS NULL;
```



Nothing blocking, and nothing that needs you. Recorded so it is not forgotten:

- **Uploads that were never posted are not collected while their owner exists.**
  A `Media` row is created at upload time, before any post, so abandoning the
  composer leaves a row and a stored object. Deleting the user clears them;
  nothing else does. Fixing it properly needs a scheduled sweep and a retention
  decision — how old is abandoned? — which is a policy question, not a bug.
- **`Media.userId` has no foreign key**, so a hand-written `DELETE FROM "User"`
  will not reach a user's unattached media. The API handles it; raw SQL will not.
- **Two clients still share ~15,000 hand-copied lines** between web and mobile.
  The identical half was moved into `packages/civic-core`; the drifted half was
  not. It works, it is just duplicated.
- **`connect` on already-attached media moves it** rather than sharing it, and
  the ownership check verifies only the uploader, not that the media is free.
- **Executive orders and Supreme Court cases have no lineage check.** The
  matchmaker only asks congress.gov, which only knows about bills. Orders are
  numbered uniquely and dockets are unique per term, so duplicates there are far
  less likely — but nothing is watching.
- **Reintroduction across Congresses is not detected.** A bill that dies and is
  filed again next session gets a new number and no published relationship to
  the old one. Catching that needs text comparison, not a lookup.
- **The text fingerprint is whitespace-sensitive.** A source that re-wraps
  identical text reads as a new version of the law, which would badge posts and
  regenerate a brief for nothing. Changing it invalidates every stored hash and
  regenerates every brief once, so it was left alone rather than swapped on a
  guess. If you see version numbers climbing on records nobody has amended, this
  is why.
- **The daily lineage sweep is capped at 50 records a night** so it cannot spend
  the congress.gov budget search shares. Past a few hundred stored bills that is
  a slow full pass, not a broken one.

---

## What is already done

For contrast, so you know what you are not being asked to do:

The schema builds from empty with one command and reports zero drift. Every
credential is in environment variables or hashed in the database, none in
source. Session tokens and media keys come from the CSPRNG. Deleting a post, a
media item, or an entire account removes the stored files and fails loudly if it
cannot. Admin and B2B login no longer leak which accounts exist. Bans,
announcements, audit logs, direct messages and both kinds of session survive a
restart. The mobile app builds. The web app builds.

One law now has one record and one vote count. Every congressional measure type
is named the same way by every part of the system, and a record answers to every
name it has ever had, so no shared link dies when a name is corrected. Merging
two records moves every vote into one pool without counting anybody twice,
without losing a post, and without losing or rewriting a citizen brief. Posts
read the law live instead of a copy frozen when they were written. A brief is
generated once per version of the law and reused by everyone after. And no
number this platform publishes is invented.

A post has an address (`/post/:id` on both clients), an account can be edited
after the day it was made, and media attached to a post resolves to a URL a
browser can actually load — none of which were true a day ago.

There are 420 tests across 24 files, and each one was verified by breaking the
thing it covers and watching it fail. That includes the two paths that used to be excused as
"needs a real API call": the auto-merge runs against congress.gov responses
recorded from the live API and replayed offline, and the brief pipeline runs end
to end with the model answered at the network boundary — the classifier, the
chunker, the prompts, the fact-check pass and the version pin all real.

## Anti-bot: what "verified" means here, and what it does not

Constitution Article I, Section 3 — "Only verified human beings may contribute
to the Pulse" — is now enforced. An account that has not entered the code
emailed at signup gets a 403 (`code: "email_verification_required"`) from
voting, delegating, posting, commenting and reposting. Reading stays completely
open: every law, brief, tally and argument is visible without an account at
all, because the government's business is the public good and the Pulse is the
part that needs protecting.

**Be honest about the strength of this.** A code to an inbox raises the cost of
a thousand accounts from nothing to something. It is not proof of personhood —
disposable inboxes defeat it, and anyone determined will get through. The copy
in the app does not claim more than that, and neither should any marketing.

If you want something stronger, the two realistic options both need a decision
and an account from you, and neither should be guessed at:

- **Phone (SMS)**: a real deterrent, because numbers cost money and are harder
  to farm. Needs an SMS provider (Twilio, MessageBird, Vonage). The code path
  is already generic — `services/email.ts` sends the code and `auth.ts` chooses
  the channel — so adding SMS is a new sender plus a `phoneNumber` column, not
  a redesign. **Not built**: it needs an account and a paid credential, and I do
  not create accounts or handle credentials.
- **Identity verification** (Persona, Stripe Identity, ID.me): the only thing
  that would honestly justify the phrase "verified citizen" in the Constitution.
  A product and legal decision as much as a technical one.

The `emailVerified` column is the single gate for all of these — whatever you
add later sets the same flag, and nothing downstream changes.
