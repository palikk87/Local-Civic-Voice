# Deploying Civic Voice

> **Before anything else, read [SHIPPING.md](SHIPPING.md).** It is one page and
> it answers the question this document cannot: whether the code you deployed is
> the code that is running. Both apps now report the commit they were built
> from, and `bun run deploy-check` compares that to `main`.

Two pieces go to two places: the **API** (`backend/`) runs as a container, and
the **web app** (`apps/web/`) is a static site. The phone app talks to the same
API.

Every account below is created by you, under your own email, with your own
billing. Nothing in this repo contains a credential, a project ref, a bucket
name, or a hostname — it all arrives through environment variables, which is
what makes each of these services replaceable.

`.env.example` lists every variable, tagged `[API]`, `[WEB]`, or `[MOBILE]`.

Do the steps in this order — the web app needs the API's address, and the API
needs the web app's.

---

## 0. Create the accounts

Do these first; one of them has a wait built in.

| Service | For | Free tier | Wait |
|---|---|---|---|
| Postgres provider | the database | Supabase and Neon both have one | none |
| Container host | the API | Railway ~$5/mo after trial; Fly and Render have free tiers | none |
| Static host | the web app | Vercel, Netlify, Cloudflare Pages all free at this size | none |
| Object storage | user photos and video | Cloudflare R2 free to 10 GB; Backblaze B2 similar | none |
| [Resend](https://resend.com) | password-reset and sign-in emails | 3,000/month free | **DNS verification, hours** |
| [congress.gov API](https://api.congress.gov/sign-up/) | bill data | free | key by email, minutes |
| [CourtListener](https://www.courtlistener.com/) | Supreme Court data | free | sign up, then Profile → API |

Start the Resend domain verification now. It is the only step whose duration is
out of your hands, and password reset cannot deliver until it finishes.

---

## 1. The database

Create an **empty** Postgres. Do not import anything into it, and do not point it
at anything that existed before.

From your provider you need two connection strings:

- a **pooled** one → `DATABASE_URL`
- a **direct / unpooled** one → `DIRECT_URL`

On Supabase both are under **Project Settings → Database → Connection string**.
On Neon the pooled endpoint has `-pooler` in the hostname. On a plain Postgres
server, use the same URL twice.

Both are needed, and they must not be the same mode. Migrations take an advisory
lock and issue session-level statements, which a *transaction* pooler drops on
the floor. So:

| Variable | Supabase option | Port | Why |
|---|---|---|---|
| `DATABASE_URL` | Transaction pooler | 6543 | many short-lived queries, one process |
| `DIRECT_URL` | Session pooler *or* Direct connection | 5432 | migrations need a connection they keep |

Append `?pgbouncer=true` to `DATABASE_URL` only. It tells Prisma to stop using
prepared statements, which a transaction pooler cannot support.

Using the **session pooler** for `DIRECT_URL` rather than the true direct
connection is fine, and is the right call on any host without IPv6 — session
mode holds a dedicated connection, so the advisory lock works.

### The password

**Save the database password when you create the project.** Supabase shows it
once and it cannot be retrieved afterwards — the dashboard prints
`[YOUR-PASSWORD]` as a placeholder in the connection strings, not the real value.

If it is already lost, that is not a problem: **Project Settings → Database →
Reset database password**, then paste the new one into both connection strings.
Nothing else depends on it, and on an empty database there is nothing to break.

**You do not run any SQL.** The API applies the schema itself on first boot.

---

## 2. The API — a container host

Railway is the example below because it reads a Dockerfile with no configuration.
Render, Fly, and a plain VPS work the same way; nothing in the image is
Railway-specific.

1. Sign in at [railway.app](https://railway.app).
2. **New Project → Deploy from GitHub repo**, pick this repository.
3. Set the service's **root directory** to `backend`. It finds the `Dockerfile`
   on its own.
4. Add the variables tagged `[API]` in `.env.example`. At minimum:
   `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET`, `BACKEND_URL`,
   `APP_ORIGINS`, `APP_SCHEMES`, `NODE_ENV=production`, the `S3_*` set,
   `RESEND_API_KEY`, `EMAIL_FROM`, `CONGRESS_API_KEY`,
   `COURTLISTENER_API_KEY`, at least one of `GEMINI_API_KEY` /
   `OPENAI_API_KEY`, and optionally `TAVILY_API_KEY`.

   The two model keys are not optional in practice: without one, no Citizen's
   Brief can be written for any law on any branch. They were absent from this
   list and from `.env.example` for a long time while the brief pipeline
   depended on them, so a by-the-book deployment produced an app whose central
   feature silently did nothing. `backend/tests/env-keys.test.ts` now fails if a
   key in the schema is missing from either document.

   Once deployed, **`GET /api/admin/keys`** reports which keys this API process
   actually holds — presence, a four-character fingerprint so you can tell
   whether the server has the value you pasted, and what stops working without
   each. It never returns a key.

   The six `B2B_*` values are **not** service variables. They are tagged
   `[SEED]` in `.env.example` and belong in the shell that runs
   [Seed the B2B portal accounts](#seed-the-b2b-portal-accounts) below. Setting
   them here does nothing — the server does not read them.

   `APP_ORIGINS` needs the web address, which you do not have yet. Put a
   placeholder and come back to it in step 4 — login will not work until it is
   right.

5. **Set the instance count to exactly 1**, and do not enable autoscaling. This
   is not a preference — see [One instance only](#one-instance-only).
6. **Make the port agree.** `backend/Dockerfile` sets `PORT=3000`, so the app
   binds 3000 unless you override it. If the host routes to a different port —
   Railway's generated domains often default to 8080 — either set a `PORT`
   variable matching it, or change the host's target port to 3000.

   Get this wrong and the server starts perfectly, the logs look clean, and
   every request returns 502. It reads exactly like a crash.
7. Deploy, then check `https://<your-api>/health` returns JSON.

On first boot the log should show the schema being created, then:

```
[Storage] driver=s3 — bucket <yours> at <endpoint>
✅ Environment variables validated successfully
```

If it says `driver=local` in production, fix `MEDIA_STORAGE` before anyone
uploads anything: local means the container's own disk, and that disk is replaced
on every deploy.

### Seed the admin account

Once, after the first successful deploy, from the host's shell (Railway:
`railway run`) or locally with the same `DATABASE_URL`:

```bash
cd backend
ADMIN_EMAIL=you@example.com \
ADMIN_USERNAME=yourname \
ADMIN_PASSWORD='a real password' \
bun scripts/seed-admin.ts
```

All three are required. `ADMIN_NAME` is optional and defaults to the username.
Set them for that command only — the server never reads them.

**This script also needs the API's own variables**, unlike the B2B one below.
It creates the account by calling Better Auth rather than writing rows by hand,
so that the password hash and the credential record come out exactly as a real
signup would — and Better Auth validates the full environment when it loads. On
Railway, `railway run` supplies them and there is nothing to do. Running it from
a laptop means having `BETTER_AUTH_SECRET`, `BACKEND_URL`, `APP_ORIGINS`,
`APP_SCHEMES` and `MEDIA_STORAGE` set as well. It fails loudly and names the
missing one, so you will not be guessing.

**Re-running it never changes the password, and there is no flag that makes it.**
A missing account is created; an existing one has only its role, username and
display name refreshed. It used to rewrite the password on every run, so
correcting a username silently re-keyed the super-admin.

To change the super-admin's password: sign in and use **Settings → Change
password**, or **Forgot password** with a code to that inbox. The admin console
verifies against the same User row an ordinary sign-in does, so both work for it.

The one thing the script does without being asked is set a password on an account
that has **no credential row at all** — nobody can sign in to such an account, so
nothing is taken from anyone, and it is the only way back from an account created
by an older bug. It says so when it does it.

### Seed the B2B portal accounts

Same idea, same moment, different script. The two business-dashboard logins are
rows in the `B2BClient` table with hashed credentials; this is what creates them.
**Until it has run, nobody can sign in to `/b2b`** — the login endpoint has no
accounts to check against and answers 401. Nothing else is affected: the rest of
the API boots and serves normally with the table empty.

```bash
cd backend
B2B_DEMO_USERNAME=demo \
B2B_DEMO_PASSWORD='a real password' \
B2B_DEMO_API_KEY="$(openssl rand -base64 48)" \
B2B_ADMIN_USERNAME=civicadmin \
B2B_ADMIN_PASSWORD='a different real password' \
B2B_ADMIN_API_KEY="$(openssl rand -base64 48)" \
bun scripts/seed-b2b.ts
```

Capture the two API keys as you generate them — they are hashed on the way in
and cannot be read back out. Losing one means running this again with a new one.

All six are required and the script names every one it is missing.

**Re-running it never changes a credential, and there is no flag that makes it.**
A missing account is created; an existing one keeps its password and API key, and
only its display name, type and tier are refreshed. This used to work the other
way — every run re-keyed every account it touched, so setting up the second login
silently rotated the first one's password out from under whoever was using it,
with nothing recorded anywhere.

To rotate a B2B credential, a super admin uses
`POST /api/admin/b2b-clients/:id/rotate`. It records who did it and why, revokes
the sessions the old password opened, and shows the new values once.

### No backend process can re-key anybody

That is the rule, and it is enforced rather than documented.

**Nothing in the backend changes a credential that already works.** No script, no
job, no boot step, no override flag — an override is a thing that gets used at 2am
by somebody who has not read the comment above it, which is how the B2B password
changed in the first place. `backend/tests/credential-writes.test.ts` reads the
source and fails if a rotation path reappears in either seed, or if any file other
than `backend/src/services/credentials.ts` hashes a password or writes
`passwordHash`, `apiKeyHash`, or an account's password.

**People still have full control.** Three ways, each of which records a name:

| Who | What they can do | Where |
|---|---|---|
| Anyone, for their own account | Change their password | Settings → Change password (web and mobile), or Forgot password |
| Super admin | Reset any person's password, ending their sessions | `POST /api/admin/users/:id/reset-password` — a reason is required |
| Super admin | Rotate a B2B password or API key | `POST /api/admin/b2b-clients/:id/rotate` |

### Every credential change is recorded

`backend/src/services/credentials.ts` is the only thing in the backend that may
hash a password or write `passwordHash`, `apiKeyHash`, or an account's password —
enforced by `backend/tests/credential-writes.test.ts`, which reads the source and
fails the day a second writer appears. Every change through it needs an actor and
a reason, and writes the audit row **before** returning, so a script that exits
the moment its work is done cannot leave the change unrecorded.

Where to look when something changed:

- **Admin portal → Logs**, filtered to `system`. Actions are `create_b2b_client`,
  `rotate_b2b_client`, `set_user_password`, `rotate_user_password`. The actor
  says which kind of change it was: an admin's username when an administrator
  did it, `self:<username>` when the account holder did it themselves, and
  `cli:<script>` for the one script path that can give a credential to an account
  that has none. "I changed my password" and "somebody changed my password" are
  different events and only one of them should alarm anybody.
- **`GET /api/b2b/account/security`** — a business client can read its own
  history without asking anyone: when its credentials were last rotated, how many
  times, and by whom.

Unlike the admin seed, this one needs only `DATABASE_URL` and `DIRECT_URL` — it
writes rows directly and never loads the auth stack.

**After the first deploy you will not need this script again.** The admin
console has a B2B clients tab (web) / screen (mobile) that creates accounts,
rotates passwords and API keys, changes tiers and revokes access, all without
shell access. This script exists for the cold start, when there is no admin
account yet to log in with.

The two keys must differ from each other. Generate them with `openssl rand
-base64 48` rather than typing something: an API key is stored as a plain
SHA-256 digest with no key-stretching — deliberately, because it is looked up by
that digest — so its entropy is the whole defence. Passwords are stored with
scrypt and are checked one row at a time, which is why they can afford to be
human-chosen.

---

## 3. Object storage

Create a bucket with your storage provider, then an access key scoped **to that
bucket** — not an account-wide token.

The bucket must be publicly readable, or `MEDIA_PUBLIC_URL` must point at a CDN
in front of it that is. This app serves media by URL and does not issue signed
read links.

**So the object key is the access control.** Anyone who knows a key can fetch
that object, whether or not the post it belongs to was ever published. Keys are
128 bits of CSPRNG output for exactly that reason, and they deliberately do not
contain the upload time or the uploader's original filename — both of which they
used to, which made one person's uploads enumerable by a stranger who could
bracket when they posted.

Two consequences worth being deliberate about:

- **Do not enable bucket listing.** Unguessable keys are worthless if the bucket
  will hand out an index of them. On R2 and B2 listing is off by default; on AWS
  S3, check that `s3:ListBucket` is not in the public policy.
- **Deleting a post deletes its media objects, and fails loudly if it cannot.**
  `DELETE /api/posts/:id` removes the bucket objects first and only then the
  row. If storage refuses, the API returns 500, logs every key it could not
  remove, and leaves the post intact — because the key lives only in that row,
  so destroying the row would leave an object nothing can ever find, still
  readable by anyone holding its URL. Retrying is safe: an object that is
  already gone counts as success.

  If you see `Refusing to delete post` or `Refusing to delete media` in the
  logs, that is this check firing. It means the bucket credentials or
  permissions are wrong, not that the user did anything unusual.

- **Deleting a user removes everything they uploaded**, including files they
  attached to the composer and never posted. `Media.userId` has no foreign key
  and no cascade, so those rows are found by an explicit query rather than by
  the database — worth knowing if you ever delete a user with raw SQL, because
  a plain `DELETE FROM "User"` will not reach them and will leave the objects
  behind.

- **Uploads that were never posted are not collected while the user exists.**
  A `Media` row is created when the file is uploaded, before any post exists, so
  a user who attaches a photo and abandons the composer leaves a row with
  `postId` null and an object in the bucket. Deleting the user clears them;
  nothing else does. They are not reachable through the app, but they occupy
  storage and their keys stay valid.

Provider quirks, since they cost time otherwise:

- **Cloudflare R2** — `S3_REGION=auto`. The endpoint is the bucket's "S3 API"
  URL, `https://<account-id>.r2.cloudflarestorage.com`.
- **Backblaze B2** — the endpoint is region-specific and shown on the bucket page.
- **MinIO / self-hosted** — set `S3_FORCE_PATH_STYLE=true`.
- **Supabase Storage** — works through its S3-compatible endpoint,
  `https://<project-ref>.supabase.co/storage/v1/s3`, with credentials created
  under Storage → S3 Access Keys.

---

## 4. The web app — a static host

1. **Edit `apps/web/vercel.json` first.** Replace `REPLACE_WITH_API_HOST` with
   the API host from step 2 — no `https://`, just the hostname:

   ```json
   "destination": "https://civic-voice-api.up.railway.app/api/:path*"
   ```

   Skip this and every page loads while nothing works, because the app asks a
   nonexistent server for its data.

2. Sign in at [vercel.com](https://vercel.com), **Add New → Project**, pick the
   repo.
3. Set **root directory** to `apps/web`.
4. **Delete every environment variable Vercel created for you.** Its importer
   scans the repository, finds `.env.example`, and silently creates all ~24
   variables on the project — including `DATABASE_URL` and
   `BETTER_AUTH_SECRET`, on a static frontend that has no server to read them.
   They arrive empty, so nothing breaks immediately, but a database URL and an
   auth secret sitting on the wrong project is a footgun waiting for someone to
   helpfully fill them in.

   This project needs **zero** environment variables. In particular
   `VITE_BACKEND_URL` must stay unset: the rewrite below sends `/api/*` to the
   API, so the browser talks to one address and the session cookie stays
   first-party. Setting it would send data requests somewhere else while auth
   stayed here.

5. Deploy.
6. Go back to the API host, set `APP_ORIGINS` to the real web URL, and redeploy.
   **Login will not work until you do** — see [Why login breaks](#why-login-breaks).

### What a correct deploy looks like before the API exists

If you deploy the web app first — which is reasonable, since the API needs the
web address for `APP_ORIGINS` — expect this and do not chase it:

```
GET /            200   pages render
GET /api/bills   502   DNS_HOSTNAME_NOT_FOUND
```

That is the `REPLACE_WITH_API_HOST` placeholder, resolving to nothing. The site
is a shell: static pages load, no data, no login. It is not a broken build, and
the fix is step 1 of this section once the API host exists.

Rewrites are applied per request, not compiled, so Vercel never validates the
destination — the placeholder builds green every time.

On Netlify or Cloudflare Pages the build is identical (`bun run build`, output
`dist`); only the rewrite syntax differs — `_redirects` on Netlify, a redirect
rule on Cloudflare. Both need the same two rules: `/api/*` proxied to the API,
and everything else falling back to `index.html` so deep links survive a refresh.

---

## Ownership and exit

Every external account this app needs, what it does, what it costs, and how to
leave it. You should be able to walk away from any one of them without touching
application code.

### Postgres — the database

- **Supplies:** `DATABASE_URL`, `DIRECT_URL`
- **Cost:** free tier is enough to start on both Supabase and Neon; roughly
  $25/month when you outgrow it
- **Lock-in:** none by design. The app uses Prisma and standard SQL — no
  row-level-security auth, no edge functions, no PostgREST, no vendor client
  library anywhere in the codebase.
- **To leave:** dump from the old provider, restore into the new one, change the
  two variables, redeploy.
  ```bash
  pg_dump "$OLD_DIRECT_URL" -Fc -f civicvoice.dump
  pg_restore -d "$NEW_DIRECT_URL" civicvoice.dump
  ```
  On a database with no data worth keeping it is simpler still: point
  `DATABASE_URL` at the empty one and let `migrate deploy` build it.

### Container host — the API

- **Supplies:** nothing. It consumes variables, it does not provide any.
- **Cost:** Railway ~$5/month at this size; Fly and Render have free tiers that
  sleep when idle.
- **Lock-in:** none. `backend/Dockerfile` is an ordinary image with no host SDK,
  no buildpack, and no magic environment variables. `scripts/start` switches on
  `NODE_ENV` and nothing else.
- **To leave:** point another host at the same repo with root directory
  `backend`, copy the environment variables across, deploy, then update the
  `/api/*` rewrite on the web host and `EXPO_PUBLIC_BACKEND_URL` for the next
  mobile build.

### Static host — the web app

- **Supplies:** nothing.
- **Cost:** free at this size on Vercel, Netlify, and Cloudflare Pages.
- **Lock-in:** none. A standard Vite build to static files. `vercel.json` is a
  handful of rewrite rules with direct equivalents everywhere else; there are no
  serverless functions, no edge middleware, no Vercel-only primitives.
- **To leave:** new host, root directory `apps/web`, build `bun run build`,
  output `dist`, then re-create the two rewrite rules from step 4.

### Object storage — user media

- **Supplies:** `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, optionally `S3_FORCE_PATH_STYLE` and `MEDIA_PUBLIC_URL`
- **Cost:** Cloudflare R2 is free to 10 GB with no egress fees, which is the
  reason to prefer it.
- **Lock-in:** none — the S3 API is the interchange format, and this app speaks
  only that.
- **To leave:** copy the bucket, change the variables, redeploy. Because the
  database stores object *keys* rather than URLs, no rows need rewriting.
  ```bash
  rclone sync old:civicvoice-media new:civicvoice-media
  ```

### Resend — transactional email

- **Supplies:** `RESEND_API_KEY`, `EMAIL_FROM`
- **Required for anyone to finish signing up.** The verification gate means an
  account cannot vote, delegate or post until its emailed code is entered. With
  no key set, sign-up creates the account, the screen asks for a code, and no
  code exists. The API warns about this at boot, `/health` reports
  `email.configured: false`, and the sign-up screen tells the person in front of
  it rather than pretending a message went out.
- **A key that is definitely set and still sends nothing is almost always the
  sender domain.** Resend refuses any message whose `From` is on a domain the
  account has not verified, and that refusal is indistinguishable from a bad key
  from the outside. The default `EMAIL_FROM` is a placeholder
  (`noreply@civicvoice.app`) — unless that domain is verified in the Resend
  account the key belongs to, every send is refused.

  Two ways to find out which it is, without guessing:

  ```
  GET  /api/admin/email-health              # key present? fingerprint? sender domain?
  POST /api/admin/email-health/test { to }  # actually sends, returns Resend's own words
  ```

  The first reports whether a key is present, a four-character fingerprint of it
  (so you can tell whether the server has the value you pasted), whether it looks
  like a Resend key at all, and what domain it is sending from — never the key
  itself. The second sends a real message and hands back exactly what the provider
  said. Superadmin only, because it spends the mail quota.
- **Cost:** 3,000 emails/month free; $20/month above that
- **Lock-in:** minimal. One file, `backend/src/services/email.ts`, one HTTPS POST
  to their send endpoint, no SDK.
- **To leave:** rewrite that one function against another provider's send API —
  Postmark, SES, and Mailgun are all a single POST — and swap the key. The domain
  verification has to be redone wherever you go; that is DNS, not lock-in.

### Government data APIs

- **Supplies:** `CONGRESS_API_KEY`, `COURTLISTENER_API_KEY`
- **Cost:** free, both.
- **Lock-in:** none, and no alternative either — these are the official sources.
- **Note:** without them `GovernmentReference` stays empty and Discover has
  nothing in it. They are how the product gets its content.

### B2B portal accounts

- **Supplies:** the six `B2B_*` values, as input to `scripts/seed-b2b.ts`
- **Cost:** none — these are values you generate, not a service you buy
- **Lock-in:** none. They end up as two rows in your own Postgres, hashed. They
  move with the database dump like any other data.
- **Note:** the values that used to be compiled into `routes/b2b.ts` are in this
  repository's git history and on any clone. They are burned. Set new ones.
- **Recovery:** if you lose the API keys, re-run the seed script with new ones.
  Nothing can read them back out — that is the point of storing digests.

### What stays yours regardless

Your domain registrar, your GitHub account, and this repository. The repo is the
only thing that must be preserved — everything above can be rebuilt from it.

---

## Why login breaks

Signing in sets a cookie. Browsers only send cookies back to servers allowed to
receive them, and the API keeps that list in `APP_ORIGINS`. If your web address
is not on it, sign-in appears to succeed and then every request behaves as if you
were signed out, with no error explaining why.

The `/api/*` rewrite is what keeps this simple: the browser only ever sees your
web address, so the cookie is first-party.

Both the CORS list and Better Auth's trusted origins come from that one variable
(`backend/src/env.ts`). They used to be two hardcoded lists that could disagree,
which produced exactly this failure.

## One instance only

Four things in the API keep state in memory rather than in the database: the
background job queue and its daily government sync, the response cache, the rate
limiter, and the admin ban and announcement lists.

Run two copies and the daily sync runs twice, rate limits count half your
traffic, and admin bans appear or vanish depending on which copy answered. Keep
it at one.

## Custom domain

Add it on the web host, then add it to `APP_ORIGINS` on the API — comma-separated,
no trailing slash, including both apex and `www` if both resolve — and redeploy
the API.

## After the first deploy

- `https://<api>/health` returns JSON, including `email.configured`
- The API log shows `[Storage] driver=s3` with no warning
- `https://<web>/` loads the feed with real bills in it (the government sync runs
  at boot; give it a minute)
- Sign in, then reload — you should still be signed in
- Upload a photo, redeploy the API, confirm the photo still loads. This is the
  check that proves media is not on disposable storage.
- Request a password reset and confirm the email arrives

---

## Upgrading an already-running deployment

Ordinary deploys need nothing here. These are the ones with a step you would
otherwise find out about from a user.

### One-time: admin and B2B sessions are all signed out

The deploy carrying migration `20260815150608_invalidate_weak_session_tokens`
deletes every row in `AdminSession` and `B2BSession`.

Session tokens used to be built from `Date.now()` and `Math.random()`, neither
of which is unpredictable, so every token issued before that deploy is weaker
than it looks. Changing the generator does not repair tokens already handed out
— they would stay valid for the rest of their 24-hour life. Deleting them is
what ends it.

What it costs: anyone signed in to the admin console or the `/b2b` dashboard at
that moment is signed out and signs in again with the same credentials. Nothing
else changes and nothing is lost. **Ordinary user accounts are not affected** —
those sessions are Better Auth's, in a different table, with a different
generator.

It runs automatically as part of `prisma migrate deploy` at container start.
There is nothing to do except not be surprised by it.
