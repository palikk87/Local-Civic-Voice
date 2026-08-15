# Deploying Civic Voice

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
   `RESEND_API_KEY`, `EMAIL_FROM`, `CONGRESS_API_KEY`, `COURTLISTENER_API_KEY`.

   `APP_ORIGINS` needs the web address, which you do not have yet. Put a
   placeholder and come back to it in step 4 — login will not work until it is
   right.

5. **Set the instance count to exactly 1**, and do not enable autoscaling. This
   is not a preference — see [One instance only](#one-instance-only).
6. Deploy, then check `https://<your-api>/health` returns JSON.

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

---

## 3. Object storage

Create a bucket with your storage provider, then an access key scoped **to that
bucket** — not an account-wide token.

The bucket must be publicly readable, or `MEDIA_PUBLIC_URL` must point at a CDN
in front of it that is. This app serves media by URL and does not issue signed
read links.

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
