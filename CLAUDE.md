# AYE & NAY — palikk87/aye-and-nay

**This repo is the civics platform. It is not a garage door site.** If the chat
title, a branch name, or the working directory suggests anything else, stop and
say so before touching a file. Branch names are never derived from chat titles.

A social civics platform for the USA: citizens take a position on every bill,
executive order and court ruling, and can delegate their voice. Tagline: "Your
voice on every bill, order, and ruling."

Formerly called **Civic Voice** / **CivicSpeak** — same product, older names.
`archive-civic-voice-app` and `archive-civic-voice-app-update` are dead predecessors: read-only
history, never a build target.

## Ground truth

| | |
| --- | --- |
| Ships from | `main`. Nothing deploys from a branch — see `SHIPPING.md`. |
| Frontend | Vercel → `ayeandnay.com` (`apps/web`, Vite + React) |
| Backend | Railway → `api.ayeandnay.com` (`backend`, Bun + Hono + Prisma) |
| Mobile | `apps/mobile`, Expo / React Native |
| Database | Supabase Postgres, shared by web and mobile |
| Auth | Better Auth |
| Secrets | Railway holds **all** API keys, including `api.data.gov`. Railway is production, not optional. |
| Test data | `civicvoice_population` — 1,000 synthetic citizens. Never mix with production. |
| Brand | bg `#0F172A`, accent `#F59E0B`, Fraunces (display) + Public Sans |

Before pushing: `bun run verify`. After: `bun run deploy-check`.
`bun run branches` shows what is stranded off `main`.

## Settled — do not reopen

- **Terms of Use / governing jurisdiction.** Closed. Leave the files alone and
  never raise the subject again.
- **Vibecode.** No longer used for this project. Do not assume it, suggest it,
  or migrate toward it.
- **Audits never name a person.** They report counts, timings and distributions
  only, through the single privacy gate. Below the five-person floor an audit
  prints the withheld notice and drops the numbers with it — no rounded count,
  no share. The one documented exception is a record's own tally, which is
  already public on its card.
- **Nobody can stop a proceeding.** No route exists at any level, and
  source-scan tests keep it that way.
- **Delegated voice does not travel into a recall.** Proceedings report turnout,
  not a direct/delegated split.

## Where things stand

Features are numbered and shipped one at a time. Article V (impeachment and
system-wide reset) is built and on `main`. Features 1–3 — emails no longer
public handles, "enforced in code" earned by a named test, and the Integrity
Audit — are done and pushed. **Feature 4, Community Juries, is the current
job.** It is the last clause needed to reach 14 of 14.

Khalid keeps a hand-written status file (`AYEANDNAYstatusandplan.md`) and pastes
it into new sessions. If he does, that file wins over this section.

Feature-sized work is the unit. Do one feature, prove it by running it — not by
compiling it — merge to `main`, then stop and report.

## How to work with Khalid

He is the owner, not a reviewer. He is not going to read a wall of text, and he
should not have to re-explain the project, the stack, or a decision he already
made. Everything below is a rule, not a preference.

### 1. One job, then stop

Do the thing asked. Nothing adjacent, nothing "while I was in there." If you
spot something else worth doing, write it at the end under **Noticed** in one
line each — do not act on it. A session that does five things nobody asked for
is a failed session even if all five work.

### 2. "Done" has one meaning

Done = merged to `main` **and** verified running where users see it. A commit on
a branch is not done. A green build is not done. Never write "done", "shipped",
"live", or "complete" about work that is sitting on a branch, unpushed, or
undeployed — say exactly where it is instead.

### 3. Verify, never infer

Every factual claim about the live system needs a command or a URL behind it,
run in this session. If you did not check it, say "I have not checked." A
confident, well-organised answer built on an assumption is the failure mode he
is complaining about — it is worse than saying you don't know. Never present a
tidy causal story you have not tested.

### 4. Length

Lead with the answer. Default ceiling is ~150 words. No preamble, no recap of
what he just said, no restating the plan before doing it. A table only when
comparing things. If he asks for short, that overrides everything, including
this file. If he asks "explain", give plain English — no jargon, no essay.

### 5. Stop means stop

"Stop", "leave it", "don't bring that up again", "I don't care about that" end
the topic permanently for the session and for later sessions. Do not re-raise
it, do not re-litigate it, do not "flag it once more for completeness." In plan
mode, run nothing that changes state.

### 6. Don't hand him work

He has said, plainly: stop setting him tasks — that is what you are for. Do the
step yourself if it can be done from the session. Only escalate something that
genuinely requires his account, his card, his password, or a decision only he
can make. Cap that at **two items**, at the very end, one line each, in plain
language with no technical framing.

### 7. Research beats guessing

Decisions come from primary sources — the platform's own docs, the live site,
the actual dashboard — not from what sounds right. If sources disagree with
you, the source wins and you say so.

### 8. Don't wait on things that aren't coming

If a background job, subagent, or check has not reported, check it directly or
do the work yourself. Never idle in a poll loop and report it as progress.

### 9. Reporting format

    What changed:   one or two lines
    Where it is:    branch/commit, and whether it is live
    Proof:          the command or URL you actually ran
    Noticed:        (optional) things not acted on
    Needs you:      (optional, max 2, plain language)
