# Migrating Civic Voice off Vibecode

What changed in the code, and what only you can do.

---

## Part 1 — What changed in code

### The platform is gone

All five `@vibecodeapp/*` packages are removed, along with the proxy import, the
Vite plugin, and the Metro wrapper. SVG handling that the Metro wrapper provided
is wired explicitly to `react-native-svg-transformer`.

`EXPO_PUBLIC_VIBECODE_BACKEND_URL` became `EXPO_PUBLIC_BACKEND_URL` (the old name
still works as a fallback), and the `candy-lark.vibecode.run` default host is
gone — previously, an unset variable silently pointed the app at Vibecode.

That those packages were private to Vibecode's registry is why `bun install`
succeeding now is the real proof the project is off the platform.

### `prisma db push` is gone, and cannot come back

This was the most destructive thing in the project.

Both backends ran `bunx prisma db push --accept-data-loss` at boot. `db push`
makes the database match the local schema by whatever means necessary, including
dropping columns and tables — and both backends shared **one** Postgres
instance. Whichever booted last reshaped the database under the other.

Confirmed damage:

- 423 rows of `User.banned` destroyed (recorded in the migration comments)
- 12 `GovernmentReference` columns and the entire `AdminSession` table dropped
  and recreated **507 times in 16 days**
- Both `20260808` migrations recorded as applied in `_prisma_migrations` with
  none of their effects present in the database

Boot now runs `prisma migrate deploy`, which applies only committed migrations
and never drops anything. Two guards stop it returning:

- `backend/scripts/start` refuses to boot if the command reappears in it. The
  Vibecode template used to regenerate this file, so deleting the line by hand
  did not keep it deleted.
- A CI job scans every executable file for it.

### One backend, one schema

The two exports each carried a full backend copy, and they had diverged. The
webapp-side copy was a strict superset — same 26 models, no missing exports,
plus extra routes and services — so it became the single backend. There is now
exactly one `schema.prisma`.

Migration history was reassembled from three locations, since no single copy had
all four applied migrations, and an ordering bug was fixed:
`001_add_admin_session` sorted *before* the migration creating the `User` table
it alters, so a rebuild from scratch would have failed.

### Auth is one system

Mobile mounted two session providers at once — Better Auth, wrapped in a
Supabase-Auth provider that was never populated. Three tab screens read the dead
one, so a signed-in user was `undefined` to half the app: they saw a Follow
button on their own profile card, and every user's suggestions collapsed into one
shared cache entry.

Better Auth is now the only session. `SUPABASE_ENABLED` gates data only, on both
platforms. `lib/auth-context.tsx` is retained but unmounted, with a header
explaining why it must not be rewired.

Better Auth is pinned to exactly 1.6.24 across all three packages — mobile had
been running a 1.5 client against a 1.6 server.

### Password reset was broken and is fixed

The OTP handler opened with `if (type !== "sign-in") return;`. Forgot-password
sends `type: "forget-password"`, so reset codes were generated, written to the
database, and dropped — no error, no log. Anyone who requested a reset never
received one.

It now sends every code type through **Resend**. When `RESEND_API_KEY` is unset
the send path throws rather than returning quietly.

### Features that were broken or missing

- **Messaging was a mock** — hardcoded `current_user`, in-memory arrays, wiped on
  every restart. Now Prisma-backed with real read state.
- **Three endpoints the clients always called but which never existed**: comment
  replies, comment delete, and b2b issue forecast.
- **`refresh-creator-metrics/me`** always returned 403 — the client sent the
  literal `"me"`, which never equals a user id.
- **`/api/ai/generate` had no auth** while spending your OpenAI and Gemini keys.
- **Stale-cache bug** in `useLibraryBrief`, a `ShareModal` crash, and a
  non-deterministic b2b forecast that changed on every page load.

### Deployment

`backend/Dockerfile` (Bun + ffmpeg — the media pipeline degrades silently
without it), `apps/web/vercel.json` (SPA fallback plus an `/api/*` rewrite that
keeps the browser on one origin so the session cookie stays first-party), and CI
running typecheck, lint, and build across all three packages.

CORS and Better Auth's trusted origins now derive from one `APP_ORIGINS`
variable. They were two hardcoded lists where CORS was the narrower — an origin
accepted by one and refused by the other fails a login with no useful error.

---

## Part 2 — What only you can do

I have no infrastructure access. These are yours.

### 1. Stop the `candy-lark` deployment — do this first

`candy-lark.vibecode.run` is the backend the mobile app points at. It is
**crash-looping**: it returns 502 on roughly five of every six requests, and
briefly 200 in between. Each restart re-runs `db push` with an outdated schema
and reverts the database.

That is why applied migrations vanish within seconds, and it is also the entire
Supabase egress overage — a flat ~300 MB/day with no day/night variation, 100%
pooler egress, one full schema introspection every ~26 seconds.

For comparison, `civicvoice.vibecode.run` has been up 6.15 days without
restarting. It is not the offender.

**Impact of stopping it: effectively none.** Web users are unaffected — that runs
on its own host. The mobile app loses its backend, but it is already
unreachable, and no store build has ever shipped. Your 423 accounts are in
Postgres and are untouched.

### 2. Apply the migration

Once `candy-lark` is stopped, run `db/apply-migrations.sql` in the Supabase SQL
Editor. It is additive, idempotent, and safe to re-run. This fixes, in one go:

| Currently broken | Cause |
|---|---|
| Main feed (500) | missing columns |
| Posts (500) | missing columns |
| Trending references (500) | missing columns |
| Admin portal (500) | missing `AdminSession` table |

The admin login failure is a server error, not a rejected password — it fails
before your credentials are checked.

### 3. Verify a sending domain in Resend

The API key works, but no verified domain exists on the account, and
`EMAIL_FROM` points at `civicvoice.app`, which isn't in Resend at all. Password
reset cannot deliver until a domain is verified. DNS propagation is the slow
part, so start it early.

### 3b. Building on a *fresh* Postgres

This is now the plan of record: a new database that Vibecode has never had
credentials for. It works, and it has been proven rather than assumed.

`prisma migrate deploy` **on its own cannot build this schema from empty.** The
two oldest migrations are SQLite dialect — running them against Postgres fails
immediately with `42704: type "datetime" does not exist`. Production only
survives them because they were baselined years of drift ago.

The three-step procedure in `db/README.md` (`db/postgres-baseline.sql` → baseline
the two SQLite migrations → `migrate deploy`) does build it. Verified against a
real, empty Postgres 16: 30 tables, and `prisma migrate diff` against
`schema.prisma` reports **no difference detected**.

Finding that took spinning up an actual database. The first run of my own
documented procedure failed — `20260808134500` had no `IF NOT EXISTS` guards and
collided with the baseline. That migration is now idempotent. The lesson is in
`db/README.md`: every new migration here must guard every statement.

### 4. Deploy

Full walkthrough in `DEPLOYMENT.md`. Summary:

- **API → Railway** (or Render/Fly): root directory `backend`, set the
  environment variables listed there, and **pin it to exactly one instance** —
  the job queue, cache, rate limiter, and admin ban list are all per-process.
- **Web → Vercel**: root directory `apps/web`. **Edit the placeholder in
  `apps/web/vercel.json` first** — leaving it loads every page and breaks all
  data.
- Set `APP_ORIGINS` on the API to your web address, then redeploy. Login will not
  work until you do.

### 5. Point DNS, then retire Vibecode

Keep the Vibecode deployment serving until the new host is verified — it is
currently the live product. Note that `civicvoice.vibecode.run` disappears when
you leave, and nobody holding that link gets a redirect.

### 6. Rotate credentials before launch

Deferred by choice, listed so it isn't forgotten: the Supabase `service_role`
key and five AI provider keys are in the public repo's history, the admin
password was hardcoded in `scripts/seed-admin.ts` (now environment-driven), and
the admin and B2B passwords have been shared in chat.

---

## Still outstanding in code

- Web has no messaging UI, no forgot-password page, and one `/admin` page with
  tabs where mobile has 8 URLs — so a mobile admin link 404s on web
- `apps/web/src/lib/mobile/` is 15,016 lines hand-copied from mobile and drifting
- Mobile has no colour theme; web's semantic tokens should be ported
- App identity is still `vibecode` in `app.json`; no `eas.json` exists, so no
  binary can be built
- No tests in any package
