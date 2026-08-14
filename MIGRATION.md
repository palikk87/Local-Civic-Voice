# Migrating Civic Voice onto its own infrastructure

The old plan was to repair the existing Supabase database and stop whatever kept
rewriting it. That plan is abandoned. This one starts from an empty database on
accounts you own, and does not touch the old one at all.

Two documents: this one says what changed and why. `DEPLOYMENT.md` is the
step-by-step for standing it up.

---

## Part 1 — What changed in code

### The database can now be built from the repo

This had never worked. Six migrations existed and none of them could create a
database: the two oldest were SQLite dialect, left over from a template that
assumed local SQLite, and `migrate deploy` against an empty Postgres died on the
first file with `type "datetime" does not exist`. Production survived only
because those two had been *baselined* — recorded as applied without ever
running. That holds exactly as long as you never need a second database, which
is the situation you are now in.

The history is replaced with one migration generated from `schema.prisma`.
Verified against a real, empty Postgres 16 — created empty, then `migrate
deploy` and nothing else:

```
tables_before = 0
tables_after  = 30   (29 models + _prisma_migrations)
indexes       = 122
foreign keys  = 26

prisma migrate diff --from-url $DATABASE_URL \
  --to-schema-datamodel prisma/schema.prisma --exit-code
→ No difference detected.
```

CI now runs that same check on every push, against a real Postgres service.
Assertions in comments are what let this project believe something untrue for
months; this one is executed.

### Nothing references Vibecode

`scripts/env.sh` is deleted — it existed to be regenerated from a template that
injected `DATABASE_URL="file:/data/production.db"` in production, silently
replacing the real database. The `SUPABASE_DATABASE_URL` indirection that hid
the connection string from that template is deleted with it. The datasource
reads `DATABASE_URL` and `DIRECT_URL` like any other project.

`scripts/start` is rewritten around `NODE_ENV` alone. App identity is Civic
Voice: slug `civic-voice`, scheme `civicvoice`, bundle id `com.civicvoice.app`.

### No vendor is load-bearing

This is the part that matters beyond this migration. Nothing in the codebase
encodes whose account it runs in, so any one of the three services can be
replaced without an application change.

- **Database** — plain Postgres over a connection string, through Prisma and
  standard SQL. No RLS-dependent auth, no edge functions, no PostgREST. Point
  `DATABASE_URL` at a different Postgres and the app works.
- **Backend host** — one Dockerfile, no host-specific APIs or buildpacks. Runs
  on Railway, Fly, Render, or a VPS.
- **Web host** — a standard Vite build producing static files. Vercel, Netlify,
  Cloudflare Pages, or any static host.
- **Media** — S3-compatible storage, so the same code and env vars run against
  Cloudflare R2, Backblaze B2, MinIO, DigitalOcean Spaces, AWS S3, or Supabase's
  S3 endpoint.

`@supabase/supabase-js` is removed from all three packages. The client-side
Supabase data layer went with it — 21 hooks, six timeline functions and a
`system_settings` lookup, all querying a snake_case schema unrelated to
`schema.prisma`, every one behind a gate that has always been false. Their
signatures and disabled-path return values are preserved exactly, so screens
compile and behave as they did.

### `prisma db push` cannot come back

Both backends used to run `bunx prisma db push --accept-data-loss` at boot
against one shared Postgres. `db push` makes the database match the local schema
by whatever means necessary, including dropping columns. On the record: 423 rows
of `User.banned` destroyed, and twelve `GovernmentReference` columns plus the
whole `AdminSession` table dropped and recreated 507 times in 16 days.

Boot runs `prisma migrate deploy`. A CI job fails the build if `db push`
reappears in any script, workflow, Dockerfile, or package.json.

### Auth is one system

Mobile had two session providers mounted at once — Better Auth wrapped in a
never-populated Supabase provider. Three tab screens read the dead one, so a
signed-in user was `undefined` to half the app: a Follow button on their own
profile card, and every user's suggestions collapsing into one shared cache
entry. Better Auth is now the only session, pinned to 1.6.24 across all three
packages.

Profile fields (`username`, `bio`, `location`, `role`) travel in the session
itself, so the same account shows the same handle on both platforms by
construction rather than through two hand-maintained code paths.

### Password reset was broken and is fixed

The OTP handler opened with `if (type !== "sign-in") return;`. Forgot-password
sends `type: "forget-password"`, so reset codes were generated, written to the
database, and dropped — no error, no log. Every code type now sends, through
Resend, and the send path throws rather than returning quietly when unconfigured.

### Features that were broken or missing

- **Messaging was a mock** — hardcoded `current_user`, in-memory arrays, wiped on
  every restart. Now Prisma-backed with real read state.
- **Three endpoints the clients always called but which never existed**: comment
  replies, comment delete, and b2b issue forecast.
- **`refresh-creator-metrics/me`** always returned 403 — the client sent the
  literal `"me"`, which never equals a user id.
- **`/api/ai/generate` had no auth** while spending your AI provider keys.
- A stale-cache bug in `useLibraryBrief`, a `ShareModal` crash, and a
  non-deterministic b2b forecast that changed on every page load.

---

## Part 2 — The content question, answered

**`GovernmentReference` does not need exporting from the old database. It
re-seeds itself from the upstream sources.**

This was worth checking rather than assuming, so here is the evidence.

`backend/src/services/government-sync.ts` pulls all three content types from the
government's own APIs, at boot and then daily:

| Content | Source | Key needed |
|---|---|---|
| Bills | congress.gov, recently-updated bills of the current congress | `CONGRESS_API_KEY` |
| Executive orders | Federal Register, newest EOs, including full text | none |
| SCOTUS cases | CourtListener, newest opinions | `COURTLISTENER_API_KEY` |

Rows are upserted by `masterReferenceId`, so a fresh database fills itself on
first boot with no manual step.

Three details that make the re-seed faithful rather than approximate:

1. **The seeded vote tallies reproduce exactly.** `seedTallyFor()` is a
   deterministic hash of `masterReferenceId`, not a random draw. The same bill
   gets the same starting numbers on the new database as on the old one.
2. **Citizen briefs and full text regenerate on demand.** `ensureReferenceContent()`
   is triggered lazily when a reference is viewed or resolved, so the AI-written
   brief, the fetched full text, and the content hashes all rebuild themselves.
   They cost AI provider calls, not a data migration.
3. **The seeded set is small by design** — ten items per branch, which is what
   the Discover page serves. You are not reproducing a large corpus.

Two caveats, stated plainly:

- **Community activity on those rows does not survive**: votes, comments, shares,
  and vote counts belong to the 423 dummy accounts, which are disposable.
- **References created by hand** through `POST /api/government-references` (the
  admin path) would not be re-seeded, since they came from a person rather than
  an upstream feed. Whether any exist can only be answered by querying the old
  database. If that matters, the check is one query before you walk away from it:
  ```sql
  SELECT count(*) FROM "GovernmentReference"
  WHERE "masterReferenceId" NOT LIKE 'bill-%'
    AND "masterReferenceId" NOT LIKE 'eo-%'
    AND "masterReferenceId" NOT LIKE 'scotus-%';
  ```

**User accounts** are explicitly disposable — the 423 are test data — so there is
no user migration path, by decision.

**Media** is the one category that genuinely cannot be regenerated. If any
uploaded photo or video is worth keeping, copy it out of the old deployment
before that deployment goes away; nothing recreates it.

---

## Part 3 — What only you can do

Full walkthrough in `DEPLOYMENT.md`, including what each account costs and how to
leave it. In short:

1. **Create the accounts** — Postgres, container host, static host, object
   storage, Resend, and the two government API keys. All under your own email
   and billing, so you hold the keys to every piece.
2. **Verify a sending domain in Resend.** DNS propagation is the slow part; start
   it early. Password reset cannot deliver until it is done.
3. **Fill in the environment variables** from `.env.example`, which tags every
   variable with the platform that needs it.
4. **Seed the admin account** — one command, `bun scripts/seed-admin.ts`, with
   `ADMIN_USERNAME` and `ADMIN_PASSWORD` set for that command only.
5. **Point DNS**, and keep the old deployment serving until the new one is
   verified.
6. **Rotate credentials before launch.** Deferred by your decision, listed so it
   is not forgotten: the old service-role key and several AI provider keys are in
   this repo's git history, and the admin password has been shared in chat. The
   new accounts should get new secrets, not the old ones.

---

## Still outstanding in code

Not blockers for standing the app up, but real:

- Web has no messaging UI, and one `/admin` page with tabs where mobile has 8
  URLs — so a mobile admin link 404s on web
- `apps/web/src/lib/mobile/` is 15,016 lines hand-copied from mobile and drifting
- Mobile has no colour theme; web's semantic tokens should be ported
- No `eas.json`, so no mobile binary can be built yet
- No tests in any package
