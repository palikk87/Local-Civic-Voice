# If the API host goes away

Measured, not reasoned about. Every number here came from running it.

Reproduce with:

```bash
cd apps/web
VITE_BACKEND_URL=http://127.0.0.1:59999 bun run build
node scripts/backend-down-check.mjs gone         # nothing listening
node scripts/backend-down-check.mjs suspended    # the edge answers 404 HTML
```

Nothing is mocked. The bundle is built pointing at a port that is genuinely
empty, so the browser produces its own `ECONNREFUSED`. A test that fakes the
failure can only prove the fake was handled.

---

## What stops, and what does not

| | With the API host gone |
|---|---|
| The API | down — it is the only thing the container runs |
| The database | untouched. It is a separate service; every account, vote and brief is where it was |
| The web app | still served. Static host, unaffected |
| The phone app | opens, and every screen that needs data is empty |
| Daily government sync, job queue | stopped until the container runs somewhere |
| Keys held in the host's variables | must be re-typed at the new host |
| Keys stored in the database | move with the database. Nothing to re-type |

Nothing else in the codebase is host-specific. One variable is read —
`RAILWAY_GIT_COMMIT_SHA`, for the build stamp on `/health` — and it already
falls back to `RENDER_GIT_COMMIT`, `SOURCE_COMMIT`, a committed file, and then
the word "unknown". `PORT` is read the way every host sets it.

**Verified by running it:** the API boots under `env -i` with no `RAILWAY_*`
variables at all, on a port it has never used, against a database it has never
seen — migrations applied clean, `/health` reporting `inSync: true`, and every
missing key named out loud rather than papered over.

Not verified here: `docker build` itself, which this sandbox cannot run —
Docker Hub rate-limits its shared address. The image is an ordinary
`oven/bun:1.3-slim` with `ffmpeg`, and nothing in it names a host.

---

## What a person sees, on all 50 web routes

Identical results whether the host refuses the connection or answers 404 from
its edge:

| | Routes |
|---|---|
| Blank page | **0** |
| Threw a JavaScript error | **0** |
| Said something is wrong | 8 |
| Rendered, said nothing about the outage | **42** |

Nothing white-screens, which is the important half. The other half is worse
than it sounds, because several of those 42 pages do not merely stay quiet —
they state something untrue:

| Route | What it says with the API unreachable |
|---|---|
| `/user/:id`, `/profile` | "This account isn't here — may have been deleted" |
| `/post/:id` | "This post isn't here — may never have existed" |
| `/hashtag/:tag` | "Nothing under this tag yet" |
| `/trending` | "No trending references" |
| `/people` | "No suggestions available right now" |
| `/record/review` | "The text moved — these laws changed after you took a position" |
| `/analytics` | "Loading Analytics…", forever |
| 15 signed-in routes | "Sign in to continue", to somebody who is signed in |

The eight that get it right — the three detail pages, `/government`, `/feed`,
`/reference/:id` — say "Couldn't load this. Check your connection and try
again."

### And then they try to sign in

`node scripts/backend-down-signin.mjs` fills the form and presses the button:

```
FORM FILLED: identifier=reader@example.com, password=28 chars
API REQUESTS CAUSED BY THE CLICK: 1   (POST /api/login, failed)
AFTER: … Email or username Password Failed to fetch Sign In …
```

So the form does say something, and what it says is `Failed to fetch` — the
browser's own exception text, rendered where a sentence should be. It is the
correct fact in the wrong language: nothing about it tells a citizen that the
service is down rather than their password wrong.

### Why

Two causes, both small.

1. **`isError || !data` collapses two different facts.** "The server said this
   is gone" and "there is no server" arrive at the same branch, and the copy
   written for the first is shown for both. `ApiError` carries a `status`; a
   404 is a deletion and anything else is an outage.

2. **`useCurrentUser` drops `error` from the session query.** A session that
   could not be *asked about* is indistinguishable from a session that does not
   *exist*, so `RouteGuard` shows the sign-in wall — and the sign-in that
   follows cannot work either. One file on each platform:
   `apps/web/src/hooks/use-civic-auth.tsx` and
   `apps/mobile/src/lib/auth/use-civic-auth.tsx`.

Not fixed here. This document is the measurement.
