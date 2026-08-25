# The compass: what it plots, and what feeds it

**Asked for as a report, and delivered as one. Nothing was changed.**

---

## The finding

**There is no compass.**

Not a hidden one, not a broken one, not one behind a flag. I searched the web
app, the mobile app and the shared package for a political compass, a spectrum,
a quadrant plot, an axis, a scatter chart, a radar chart, and for any custom SVG
that positions a point in two dimensions. The only chart primitives in the
repository are the unused shadcn `chart.tsx` wrapper and one decorative
`Seal.tsx`.

The word "Compass" appears seven times. Every one is the Lucide icon of that
name, used in five places:

| Where | What it is |
|---|---|
| `AppShell.tsx` | the **Discover** item's icon in the web sidebar |
| `(tabs)/_layout.tsx` | the **Discover** tab's icon in the mobile tab bar |
| `Auth.tsx`, `login.tsx`, `signup.tsx` | decoration beside a line of sign-in copy |
| `AuthGate.tsx` | decoration on the signed-out prompt |

So the thing on screen that reads as "the compass" is almost certainly the
**Discover tab**. What Discover plots is nothing — it is a list. It shows
trending references, latest references, and branch filters, all of them read
from `GovernmentReference` and all of them ordinary rows in an ordinary feed.

---

## If a real compass is wanted, here is the honest constraint

A political compass places a *person* on axes. To do that truthfully you need
something recorded about that person along each axis. We record:

- `PositionEvent` — that a user supported or opposed a specific reference, and
  when, and whether they later changed their mind.
- `GovernmentReferenceVote` — their standing position on a reference.
- `User.stateCode` / `User.districtId` — optional, self-declared, and used only
  in aggregate above a floor of five (see `backend/src/services/jurisdiction.ts`).

We record **nothing** that says where a user sits ideologically. There is no
ideology column, no leaning, no self-placement, no survey. The only party data
in the entire schema belongs to legislators — `GovernmentReference.sponsorParty`
and `RollCallMemberVote.party` — and it is a fact about a member of Congress,
not about a citizen.

That means a compass could be built one of two ways:

1. **From declared positions only.** Each axis would have to be a real,
   nameable quantity — "supported N of the M bills sponsored by each party",
   say — and the label would have to say exactly that. This is buildable and it
   is true. It is also not really a compass; it is a tally with a picture.

2. **By inferring ideology from voting behaviour.** This is what a compass
   normally is, and on this platform it would be a fabricated number: a model
   output presented as a fact about a person, on their own profile, with no
   source they could check. That is the exact thing the rest of this codebase
   has spent weeks removing.

There is a third answer, and on a platform whose Bill of Rights is enforced in
code it is the strong one: **a compass may be the wrong instrument entirely.**
Placing citizens on a left–right picture invites them to read their own dot as
an identity and other people's as a team. The platform already has a feature
that does the opposite job honestly — "Where you stand alone" on the record
page, which is deliberately not a score, and Common Ground, which finds actual
agreement on actual bills between two specific people.

---

## What I did not do

I did not build a compass, remove an icon, rename the Discover tab, or change
any behaviour. If "the compass" means something I have not found — a mock, a
design file, a screen in a build that is not in this repository — say which
screen it was on and I will look again at that screen specifically.
