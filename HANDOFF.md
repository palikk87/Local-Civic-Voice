# What still needs you

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

There are 147 tests, and each one was verified by breaking the thing it covers
and watching it fail. That includes the two paths that used to be excused as
"needs a real API call": the auto-merge runs against congress.gov responses
recorded from the live API and replayed offline, and the brief pipeline runs end
to end with the model answered at the network boundary — the classifier, the
chunker, the prompts, the fact-check pass and the version pin all real.
