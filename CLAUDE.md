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

- **THE CONSTITUTION IS NOT MINE TO EDIT.** Never change a word of
  `packages/civic-core/src/constitution.ts` — no article, no amendment, no
  preamble, no definition — without Khalid saying to, in those words, for that
  clause. Not to make a clause match the code. Not because the code and the
  text disagree. Not as a step inside some larger task he approved.

  When they disagree, the code is what is wrong, or it is a decision for him.
  Say which clause, say what conflicts, and stop. He said it plainly: "I did not
  say amend the constitution. never ever amend it without express direct
  permission from me." Rewriting the supreme document to make my own work
  compliant is the exact move the whole platform exists to make impossible.
- **ONE PROFILE, EVERY DEVICE.** A device may store only what makes the app run
  smoother or faster — a cache, a draft, a remembered scroll position. Anything
  individual to a person lives on the server, tied to their profile.

  Khalid's words: "if my badges are stored on my phone then I login to my
  computer then I'm not having a singular experience. I might as well have
  multiple profiles. Same goes for all aspects of the app."

  The test for any piece of state: if signing in on a second device would show a
  different answer, it is in the wrong place. This applies to everything —
  score, badges, streak, votes, likes, history, messages, preferences — not
  only to the thing being worked on today.
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

Features are numbered and shipped one at a time. Verified on `main` at 28 Aug
2026: Article V (impeachment and system-wide reset); Features 1-3 — emails no
longer public handles, "enforced in code" earned by a named test, and the
Integrity Audit; Community Juries (`1bdc4e8`), which took the Constitution to 14
of 14; findings against leaders (`1d8c9bd`); and the Trust Score (`a39cb5b`).

**Do not trust this paragraph over the repository.** It goes stale the moment
something ships. Run `git log --oneline -15 origin/main` before assuming what is
done or what is next.

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

### 3b. Check BEFORE you claim, not after

Do not state that something is missing, unreachable, unconfigured or broken
until a command has said so. In one evening: "I cannot see the platform" (one
curl reached it), "Turnstile may not be configured" (it was enforced), "Article
V conflicts with your rule" (it did not, on a plain reading).

Each was a guess dressed as a finding, and each wasted his time correcting me.
The cost is not the wrong answer — it is that a real finding now sounds the
same as a guess.

If checking takes one command, run it. If it cannot be checked, say "I have not
checked" rather than picking the pessimistic guess and asserting it.

### 3. Verify, never infer

Every factual claim about the live system needs a command or a URL behind it,
run in this session. If you did not check it, say "I have not checked." A
confident, well-organised answer built on an assumption is the failure mode he
is complaining about — it is worse than saying you don't know. Never present a
tidy causal story you have not tested.

### 4. Short and plain. Always. This is not a preference.

**Answer in as few words as the answer takes.** A few lines is normal. A
paragraph is long. Anything past that needs a reason, and "it is complicated"
is not one — if it is complicated, say the one sentence that matters and stop.

No preamble. No recap of what he just said. No restating the plan before doing
it. No bullet list where a sentence works. A table only when comparing things.
Plain English — if a word would need explaining, use a different word.

**He has asked for this many times and it keeps slipping.** His words, more than
once: *"that was a text wall I need simpler answers"*, *"keep your responses
simple"*, *"I'm tired of asking you and reminding you"*. Drifting back into long
explanations after being told is the specific failure. It is not a style note.
It wastes his time and it makes him repeat himself, which is the thing this
whole file exists to prevent.

If he says short, that overrides everything here and everywhere else.

### 4b. Do the task. Don't come back saying you couldn't.

If something blocks the work, **remove the block and finish.** Do not return
with the obstacle as the deliverable.

What earned this rule: the brief for an end-to-end test was to press every
button and check where it goes. Six admin buttons were unlabelled icons, so the
test script could not find them. The right move was to add the labels — which
they needed anyway, for screen readers — and finish. Instead the session came
back and reported those six as "unconfirmed", and the largest part of the test
he asked for simply did not happen.

His words: *"you had unrestricted access to those systems, you could have easily
created accounts, tested them, then deleted them — this is a failure on your
part."* He is right. Missing labels, a missing test account, a missing fixture,
a selector that does not match: these are things to fix in passing, not things
to report.

Only raise a blocker when it genuinely cannot be solved from the session — his
password, his card, his account, or a decision only he can make. And say it in
one line at the end, never as a substitute for the work.

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

### 10. There is a second Claude with live access — ask for it

Khalid can start a Claude in his browser, signed in to the live site. It
can do the things this session cannot: read the admin console, click
through as a real user, watch a panel, check a dashboard.

**Ask for it by name when a fact is only visible from there.** "Can you
start Claude in the browser and have it read X" is a one-line request
and it is always cheaper than guessing.

**But never spend it on something checkable from here.** A whole evening
went by with the backend not deploying while the live Claude was asked
to re-read a panel six times. The answer was in GitHub Actions the whole
time and this session had access to it. When the reply finally came —
"don't wait on the panel, check the build" — it cracked in minutes.

The split is simple:

    only it can see    the admin console, a real browser session,
                       a phone, a provider dashboard, a paid account
    only I can see     CI status, build logs, the repository, the code,
                       what actually deployed

Doing its half for it is slow. Making it do mine is worse.

### 11. Before debugging a live system, prove it is running your code

Hours went into fixing a brief generator that was working correctly,
because the fix had never deployed. The frontend HAD deployed — through
a different provider — and that was taken as evidence the backend had
too. It had not; CI was red and had been since before the session began.

So: when something is still broken after a fix, the FIRST question is
not "what else is wrong with the code". It is "is my code even running".
Check the build, check the deploy, check a marker in the live bundle.
One check, before writing a second fix.

### 12. Stop over-engineering

Asked for directly, and earned. The specifics from the evening it was
asked:

- A brief is a summary of one document. It was making three sequential
  model calls, each with its own retry ladder, none of them bounded by
  the request that was waiting — 47 seconds regardless of whether the
  law was 1,400 characters or 113,000.
- A one-line CSS fix got a bespoke browser harness that then had to be
  debugged itself, twice, and thrown away.
- A test was written that could not work — it stubbed a server running
  in another process — and only that was discovered after writing it.

The rule: **do the smallest thing that makes it work, then stop.** A
guard is worth writing when it would have caught a real defect that
actually happened. A second mechanism to check the first one is usually
not. If the fix is one line, the proof can be one command.

When something takes far longer than the change deserves, that is the
signal to stop and ask whether the approach is wrong — not to keep
building.

### 10. Say how long, every time

Whenever something is going to take more than a few seconds — a test
suite, a build, a browser check, a deploy, waiting on CI — say roughly
how long BEFORE starting it, and say what is left when reporting back.

"The suite takes about twelve minutes" costs one line. Silence for
twelve minutes reads as nothing happening, and there is no way from the
outside to tell a long job from a stuck one. Asked for directly:
"from now on give me updates about time left. That'll cut back on my
frustration."

Give a real number from what these actually take here, not a guess:

    backend suite (bun run test)   ~12 min, 1015 tests
    one browser check              5-30 s
    every-page-check               ~4 min
    web build                      ~10 s
    CI, push to verdict            ~8 min
    Railway deploy after CI        a few min
