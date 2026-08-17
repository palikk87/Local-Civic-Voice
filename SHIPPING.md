# How work reaches you

One page. Read it once; after that it is two commands.

---

## The rule

**`main` is the product.** Vercel builds the website from it and Railway builds
the API from it. Code that is not on `main` is not in the product, no matter how
finished, how tested, or how green its CI run was.

There is no second place work lives. No long-running branches, no staging
branch, no "I'll merge it later".

---

## Why this page exists

A fix for post deletion was written, reviewed, tested, and pushed — to a branch
nothing deploys. Every check was green. The repository was correct. The product
was unchanged, and stayed unchanged, until somebody clicked the button by hand
and saw the old behaviour.

That is the dangerous part. A delete button gets clicked. A migration that never
ran, a cache fix that never shipped, a nightly job that never swept — nobody
clicks those. They would have sat undeployed indefinitely, looking finished from
every angle except the only one that counts.

So the product now says out loud which version of itself it is running, and
there is one command that compares that to `main`.

---

## The three commands

### Before pushing

```bash
bun run verify
```

Runs everything: both typechecks, both lint passes, the backend suite against a
real database, the web build, and three browser checks that execute the built
bundle rather than trusting that it compiled. Ten checks, one verdict. Each
prints what it guards, so a failure explains itself.

### After pushing

```bash
bun run deploy-check
```

Asks the live API and the live website which commit they are running, and
compares both to `main`. Three answers:

- **LIVE** — running exactly what is on `main`
- **BEHIND** — running older code; it names the commits that have not shipped
- **UNKNOWN** — the build carries no stamp, so it cannot be trusted either way

Set `CHECK_API_URL` and `CHECK_WEB_URL` once (see `.env.example`). They are
addresses, not secrets.

### Any time you want to know what is stranded

```bash
bun run branches
```

The other half of the same question. `deploy-check` asks whether `main` is
live; this asks whether anything finished is sitting short of `main`. Every
branch on the remote is listed as either **merged** — every change it carries
is already on `main`, so it is clutter — or **AHEAD**, with the commits that
would be lost by deleting it.

It compares what each commit *does*, not which id it has, so a branch that
landed via rebase or cherry-pick is correctly read as landed.

```bash
bun run branches --prune
```

Deletes the merged ones. It refuses to touch `main` or any branch carrying work
of its own, and it prints each deleted branch's commit id, so any of them can be
put back with `git push origin <sha>:refs/heads/<name>`.

CI runs the report on every `main` build and writes it into the run summary, so
a forgotten branch surfaces on its own rather than waiting to be noticed.

---

## How the stamp works

Neither app can lie about its own version, because neither is told what to say
at runtime.

**API** — the commit is baked into the container at image build
(`ARG GIT_SHA` in `backend/Dockerfile`; Railway supplies
`RAILWAY_GIT_COMMIT_SHA`). It comes back from `GET /health`:

```json
{ "status": "ok", "version": { "commit": "0784f10…", "builtAt": "…" } }
```

The same response also says whether the **database** matches the code:

```json
{ "schema": { "applied": 12, "expected": 12, "latest": "20260817…", "pending": [], "inSync": true } }
```

`inSync: false` means the container is running the right commit against the
wrong schema — a migration that shipped and never ran. Nobody clicks a
migration, so without this the first symptom is a 500 from whichever endpoint
touches the missing column.

**Website** — a Vite plugin writes `dist/version.json` at build time, from
`VERCEL_GIT_COMMIT_SHA` or the local git HEAD:

```json
{ "commit": "0784f10…", "builtAt": "…" }
```

CI fails the build if that file is missing or unstamped, because an unstamped
build makes the whole check meaningless.

---

## If a branch is unavoidable

Sometimes work genuinely needs to sit somewhere before it lands. When it does,
CI writes a banner on the run saying, in as many words, that this branch is not
deployed and how many commits are waiting. Green CI on a branch never reads as
"shipped".

Merge it to `main` as soon as it is ready, run `deploy-check` to confirm it
shipped, and clear the branch with `bun run branches --prune`.

---

## When deploy-check says BEHIND

The deploy did not happen or did not finish. In order of likelihood:

1. **It is still building.** Vercel and Railway take a few minutes. Wait, re-run.
2. **The build failed.** Open the deployment log on the provider. A failed build
   leaves the previous version serving, which is exactly why this looks like
   nothing happened.
3. **A required environment variable is missing.** The API names every one it is
   missing and exits; the log says which.
4. **The provider is watching a different branch.** Check the service settings.

---

## What still needs a person

Two things, once per environment, both in `HANDOFF.md`: seeding a B2B account so
`/b2b/login` works, and clearing the two orphaned test posts. Everything else in
this repo deploys itself from `main`.
