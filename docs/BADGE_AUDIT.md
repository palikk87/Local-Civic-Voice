# The badge system, audited

Asked for as part of the UI pass. What it found is larger than a labelling
problem, so it is written down rather than buried in a diff.

**There are two badge systems. They do not know about each other. One of them
is invisible.**

---

## System one: `gamification.ts`

Nineteen badges, in five groups, each with a name, a description and an XP
reward. Awarded from a zustand store that also keeps a "civic score", a level
and a streak. Duplicated verbatim in `apps/web/src/lib/mobile/gamification.ts`
and `apps/mobile/src/lib/gamification.ts`.

### Seven of the nineteen could never be earned

There was no code path anywhere that awarded them. Not a broken path — no path:

| Badge | Description it advertised |
|---|---|
| `bipartisan_voter` | vote against your usual pattern |
| `early_voter` | vote on a bill in its first week |
| `local_champion` | engage with local legislation |
| `influencer` | your shares reach others |
| `community_builder` | bring people in |
| `voice_heard` | your position matched the outcome |
| `congress_watcher` | follow a bill through to a vote |

Read that list again: it is the platform's own statement of what it values —
crossing party lines, acting early, local engagement, staying with a law to the
end — and not one of them was something the app could notice you doing. They
have been deleted. The twelve with real award paths remain.

### Nothing renders any of them

Neither app has a screen that displays this badge list. The store accumulates
badges and XP into browser and device storage, and no view has ever read them
back. The score, the level and the streak ARE shown, in the Feed header. The
badges are not shown anywhere at all.

### It describes a device, not a person

The store is `persist`ed to `localStorage` on web and `AsyncStorage` on mobile.
So the score, the streak and every badge belong to one browser on one machine.
Vote all week on a laptop, sign in on a phone, and the phone says you have done
nothing. On a platform whose subject is the record of what you have stood for,
that is the same class of bug as the vote counts that were fixed this week — it
is just wearing a game's clothes.

---

## System two: the profile's "Achievements"

Four items, hardcoded inline in `Profile.tsx` and its mobile twin, computed on
every render. Different names, different thresholds, no relationship to the
nineteen above:

| Shown | Threshold | Was it reachable? |
|---|---|---|
| First Vote | 1 vote | yes |
| Voice Heard | 10 votes | yes — and it reuses a name from system one, for a different thing |
| Civic Hero | 50 votes | yes |
| Engaged | 5 followers | **no** |

**"Engaged" could never be earned by anybody.** It read `user.followers`, and
`user` there is built by `signed-in-identity.ts`, which sets `followers: 0` as a
literal because a session carries no such field. The live count was already
being fetched and displayed three lines above it. Fixed.

The three vote thresholds read a browser-local store until this week; they read
the server now, so they mean the same thing on every device.

---

## What was changed, and what was not

**Changed:** the seven unearnable badges are deleted. "Engaged" reads the real
follower count. The vote counts behind the other three come from the server.

**Not changed, deliberately:**

1. **The two systems are not merged.** Which set of achievements this platform
   wants is a product decision, not a cleanup. Merging them means choosing names
   and thresholds, and choosing what the app should praise — which is a question
   about what kind of civic behaviour it wants more of, and that is not mine to
   answer.

2. **The score is still device-local.** Making it real means recording activity
   server-side, per account, which is a schema change on a shared database and a
   migration. It is also worth asking first whether a civic score should exist:
   a number that goes up for participating is a nudge, and this platform's own
   Constitution is careful about nudges. The Feed header now says plainly what
   the number is — "your activity here" — which is honest but temporary.

3. **The twelve surviving badges are still invisible.** Rendering them would
   currently mean showing a person a set of achievements that resets when they
   change device. Deleting them would remove the only reward machinery the app
   has. Both are downstream of decision 1.

---

## The pattern worth naming

Every one of these is the same failure: **a promise written in one file and
never connected to anything in another.** Nineteen badges declared where twelve
are awarded. Four achievements shown where nineteen are defined. A follower
threshold read from a field that is always zero. None of it fails a typecheck,
a lint or a build, because nothing is malformed — the parts simply do not meet.

That is why this is a report and not just a commit: the fix for the rest of it
is a decision about what the badges are FOR, and once that is answered the code
is small.
