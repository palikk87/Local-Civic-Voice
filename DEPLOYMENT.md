# Deploying Civic Voice

Two pieces go to two places: the **API** (`backend/`) runs as a container, and
the **web app** (`apps/web/`) is a static site. The phone app talks to the same
API.

Do them in this order — the web app needs the API's address.

---

## 1. The API — Railway

Railway is suggested because the backend needs a long-lived process, and that
rules out most "serverless" hosts. Render or Fly work identically if you prefer
them.

1. Sign in at [railway.app](https://railway.app) with GitHub.
2. **New Project → Deploy from GitHub repo → `palikk87/local-civic-voice`**.
3. Set the service's **root directory** to `backend`. It will find the
   `Dockerfile` on its own.
4. Add these environment variables:

   | Variable | Value |
   |---|---|
   | `SUPABASE_DATABASE_URL` | Supabase → Settings → Database → **Connection pooling** URI (port 6543) |
   | `SUPABASE_DIRECT_URL` | the same page's **direct** URI (port 5432) |
   | `SUPABASE_URL` | `https://osvquqtywladyaycycnu.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → `service_role` |
   | `BETTER_AUTH_SECRET` | any long random string — `openssl rand -base64 32` |
   | `APP_ORIGINS` | your web address, e.g. `https://civicvoice.vercel.app` |
   | `APP_SCHEMES` | `vibecode` (becomes `civicvoice` after the app rename) |
   | `RESEND_API_KEY` | from [resend.com](https://resend.com) |
   | `EMAIL_FROM` | a verified sender, e.g. `Civic Voice <noreply@yourdomain>` |
   | `NODE_ENV` | `production` |

   Plus any of `OPENAI_API_KEY`, `GEMINI_API_KEY`, `CONGRESS_API_KEY`,
   `COURTLISTENER_API_KEY`, `TAVILY_API_KEY` you use.

5. **Set the instance count to exactly 1**, and do not enable autoscaling. This
   is not a preference — see [One instance only](#one-instance-only).
6. Deploy. Railway gives you a URL like `civic-voice-api.up.railway.app`. Check
   `https://<that>/health` returns JSON.

Migrations run automatically on every deploy (`prisma migrate deploy` in the
Dockerfile's start command). Nothing is ever dropped.

---

## 2. The web app — Vercel

1. **Edit `apps/web/vercel.json` first.** Replace `REPLACE_WITH_API_HOST` with
   the Railway host from step 1 — no `https://`, just the hostname:

   ```json
   "destination": "https://civic-voice-api.up.railway.app/api/:path*"
   ```

   If you skip this, every page loads and nothing works, because the app will
   ask a nonexistent server for its data.

2. Sign in at [vercel.com](https://vercel.com) with GitHub, **Add New → Project**,
   pick the repo.
3. Set **root directory** to `apps/web`.
4. Add one environment variable: `VITE_BACKEND_URL` = empty string, or leave it
   unset. The rewrite above sends `/api/*` to Railway, so the browser talks to
   one address only.
5. Deploy.
6. Go back to Railway and set `APP_ORIGINS` to the Vercel URL, then redeploy the
   API. **Login will not work until you do this** — see
   [Why login breaks](#why-login-breaks).

---

## Why login breaks

Signing in sets a cookie. Browsers only send cookies back to servers that are
allowed to receive them, and the API keeps that list in `APP_ORIGINS`. If your
web address isn't on it, sign-in appears to succeed and then every request comes
back as if you were signed out — with no error explaining why.

The `/api/*` rewrite in `vercel.json` is what keeps this simple: the browser only
ever sees your Vercel address, so the cookie is first-party. Vercel forwards to
Railway behind the scenes.

Both the CORS list and Better Auth's trusted origins now come from that one
variable (`backend/src/env.ts`). They used to be two hardcoded lists that could
disagree, which produced exactly this failure.

## One instance only

Four things in the API keep state in memory rather than the database: the
background job queue and its daily government sync, the response cache, the rate
limiter, and the admin ban/announcement lists.

Run two copies and you get the daily sync running twice, rate limits that only
count half your traffic, and admin bans that appear or vanish depending on which
copy answered. Keep it at one.

## Custom domain

Add it in Vercel under **Settings → Domains**, then add it to `APP_ORIGINS` on
Railway (comma-separated, no trailing slash) and redeploy the API.

## After the first deploy

- `https://<api>/health` returns JSON, including `email.configured`
- `https://<web>/` loads the feed
- Sign in, then reload — you should still be signed in
- Request a password reset and confirm the email arrives
