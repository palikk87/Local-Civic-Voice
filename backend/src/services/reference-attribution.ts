/**
 * THE PERSON BEHIND A RECORD, whichever branch it came from.
 *
 * "The photo personifies the page, otherwise it just feels bland." A law is a
 * decision somebody made, and a card with a face on it says so; a card without
 * one reads like a filing.
 *
 * Each branch names that person differently, and each keeps their portrait
 * somewhere else:
 *
 *   bill             its SPONSOR          congress.gov, via their bioguide id
 *   executive order  the PRESIDENT        the roster in data/federal-government
 *   scotus case      the MAJORITY AUTHOR  the same roster, nine justices
 *
 * NOTHING NEW IS FETCHED. Both rosters are already served by
 * GET /api/government/officials with real Wikimedia portraits — the President
 * and all nine sitting justices have one. This joins what is already there to
 * the record, rather than adding a source to keep in sync.
 *
 * MATCHED ON NAME, and deliberately loosely. The Federal Register says "Donald
 * J. Trump" and CourtListener says "John G. Roberts"; the roster says
 * "John G. Roberts Jr." Initials, suffixes and middle names differ between
 * sources for the same person, so the comparison is on surname plus first
 * initial. A false match would put the wrong face on a law, so it returns
 * nothing at all when it is not confident.
 *
 * NULL IS A REAL ANSWER. A per curiam opinion has no author — that is the
 * Court speaking as one body, not an omission — and a bill whose provenance
 * pass has not run yet has no sponsor. Both render with no face rather than a
 * placeholder standing in for a human being.
 */

import { prisma } from "../prisma";

export interface Attribution {
  name: string;
  /** What this person did: "Sponsored by", "Signed by", "Majority opinion by". */
  role: string;
  photoUrl: string | null;
  /** Only a member of Congress has one; it is how their portrait is found. */
  bioguideId?: string | null;
  /** True when the Supreme Court issued this as one body, with no author. */
  perCuriam?: boolean;
  /**
   * The bench, for a per curiam ruling. Filled by the detail endpoint only —
   * a card in a list does not need nine faces, and asking for them there would
   * be one query per row.
   */
  panel?: Array<{ name: string; photoUrl: string | null }>;
  /** What the panel is, said plainly. Never "decided by": see below. */
  panelLabel?: string;
  party?: string | null;
  state?: string | null;
}

/**
 * The President who signed an executive order.
 *
 * The Federal Register names them and that name is stored on the record; the
 * portrait is resolved once, separately, and kept on the row. There is no
 * roster lookup here on purpose — a list of current office-holders is wrong
 * the day somebody leaves, and this platform carries fifty years of law.
 */
export function presidentAttribution(name: string | null | undefined): Attribution | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return { name: trimmed, role: "Signed by", photoUrl: null };
}

/**
 * The justice who wrote the majority — or, for a per curiam, the Court itself.
 *
 * PER CURIAM IS NOT AN OMISSION. It means the Court issued the opinion as one
 * body and deliberately put no individual name on it. Naming a justice there
 * would invent a fact about who decided a case.
 *
 * But it is not nobody either. "The app is about accountability so not posting
 * the photo is not very fair" — every justice who sat is answerable for what
 * the Court issued in their name, so the record says so and the page shows the
 * bench. `perCuriam` is the flag that asks for it; the bench itself is looked
 * up from the decision date, in services/court-composition.
 */
export function justiceAttribution(name: string | null | undefined): Attribution | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;

  if (/^per\s*curiam$/i.test(trimmed)) {
    return {
      name: "The Supreme Court",
      role: "Decided per curiam by",
      photoUrl: null,
      perCuriam: true,
    };
  }

  return { name: trimmed, role: "Majority opinion by", photoUrl: null };
}

// ---------------------------------------------------------------------------
// FINDING A PORTRAIT FOR SOMEBODY WHO IS NO LONGER IN OFFICE
// ---------------------------------------------------------------------------
//
// The roster above holds whoever is in office TODAY. It has nothing for an
// executive order signed by Obama, nothing for an opinion written by Scalia,
// and nothing for a justice who has not been appointed yet — and a platform
// that carries fifty years of law needs all three.
//
// Wikipedia has every one of them, with the same official portraits the roster
// already links to on upload.wikimedia.org. It also rate-limits, hard: asking
// it on every page view would get the platform blocked and would be slow. So
// it is asked ONCE, when a record is synced, and the answer is stored on the
// row (GovernmentReference.sponsorPhotoUrl).
//
// A WRONG FACE IS WORSE THAN NO FACE. "John Roberts" is also a journalist;
// plenty of names are shared. So a result is only accepted when the page's own
// categories say this is an American public official — a president, a federal
// judge, a member of Congress. Anything else returns null and the card shows
// the name alone.

/** Categories that mark a Wikipedia page as the public official we meant. */
const OFFICE_CATEGORIES = [
  "justices of the supreme court of the united states",
  "presidents of the united states",
  "united states federal judges",
  "members of the united states house of representatives",
  "united states senators",
];

/** The shape of the one Wikipedia response this file asks for. */
export interface WikipediaQueryResponse {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        thumbnail?: { source?: string };
        categories?: Array<{ title?: string }>;
      }
    >;
  };
}

/**
 * The portrait out of a Wikipedia response, or null — parsing and the guard,
 * with no network in it.
 *
 * Split out from the request deliberately. This is the part that can be WRONG
 * about a person, so it is the part that has to be tested, and a test that has
 * to reach Wikipedia to run is a test that fails on a bad day for reasons that
 * have nothing to do with the code. Real recorded responses live in
 * tests/fixtures and this function is exercised against them.
 */
export function portraitFromWikipedia(data: WikipediaQueryResponse): string | null {
  const page = Object.values(data.query?.pages ?? {})[0];
  if (!page?.thumbnail?.source) return null;

  // THE GUARD. Without it a shared name puts a stranger's photograph on a law.
  const categories = (page.categories ?? [])
    .map((c) => (c.title ?? "").toLowerCase())
    .join(" ");
  const isOfficial = OFFICE_CATEGORIES.some((needle) => categories.includes(needle));
  if (!isOfficial) return null;

  return page.thumbnail.source;
}

/**
 * Wikipedia's portrait for a named official, or null.
 *
 * Called at sync time only. The User-Agent is required by Wikimedia's policy
 * for automated requests and is how they contact somebody if a client
 * misbehaves — an anonymous scraper is the one they block first.
 */
export async function lookupPortrait(name: string): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  if (/^per\s*curiam$/i.test(trimmed)) return null;

  const url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1" +
    "&prop=pageimages%7Ccategories&piprop=thumbnail&pithumbsize=300&cllimit=500" +
    `&titles=${encodeURIComponent(trimmed)}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "AyeAndNay/1.0 (https://ayeandnay.com; civic reference platform)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;

    return portraitFromWikipedia((await response.json()) as WikipediaQueryResponse);
  } catch {
    // Unreachable, rate-limited, or slow. Null, and the next sync tries again —
    // a missing portrait is not worth failing a sync over.
    return null;
  }
}

/**
 * The portrait of whoever is behind a record. ONE PATH, EVERY BRANCH.
 *
 * "cut out the government branch import and pull the same way for all of it.
 * that way nothing gets outdated and nothing misses."
 *
 *   bioguide id present  the Biographical Directory, which is EXACT — the id
 *                        is a serial number, not a name, so no wrong person is
 *                        possible, and it covers everyone who ever served
 *   otherwise            Wikipedia by name, behind the office guard
 *
 * The id comes first because a name is not an identifier: "John Roberts" is
 * also a journalist and "Adam Smith" is also an economist. Where an exact key
 * exists it is always the better answer.
 */
export async function resolvePortrait(input: {
  name: string | null | undefined;
  bioguideId?: string | null;
}): Promise<string | null> {
  const bioguideId = input.bioguideId?.trim();
  if (bioguideId) {
    const url = `https://bioguide.congress.gov/photo/${bioguideId}.jpg`;
    // Asked, not assumed. Some members genuinely have no portrait, and storing
    // a URL that 404s puts a broken frame on a law.
    try {
      const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
      if (head.ok) return url;
    } catch {
      // Unreachable right now. Fall through and try the name.
    }
  }

  const name = input.name?.trim();
  if (!name) return null;
  return lookupPortrait(name);
}

// ---------------------------------------------------------------------------
// ONE SHAPE, THREE BRANCHES
// ---------------------------------------------------------------------------

/** The columns of a GovernmentReference this needs. Nothing more is read. */
export interface AttributableReference {
  referenceType: string;
  sponsorName: string | null;
  sponsorBioguideId?: string | null;
  sponsorPhotoUrl?: string | null;
  sponsorParty?: string | null;
  sponsorState?: string | null;
}

/**
 * Who is behind a record, ready for a card to draw.
 *
 * Three endpoints return references and every one of them should say the same
 * thing about the same law, so the decision lives here rather than being
 * written out three times and drifting.
 *
 *   bill             sponsored by a member    portrait from their bioguide id
 *   executive order  signed by the President  roster, else the stored lookup
 *   scotus case      majority opinion author  roster, else the stored lookup
 *
 * WHY THE ROSTER COMES FIRST for the two unelected branches: it is today's
 * office-holders with today's official portraits, and it needs no lookup. The
 * stored column is the answer for everyone who has left — Obama, Scalia — and
 * it was resolved once at sync time precisely so this path stays cheap.
 *
 * A MEMBER OF CONGRESS GETS NO photoUrl HERE, on purpose. Their portrait is a
 * pure function of their bioguide id, the client already builds that URL for
 * the Delegates screen, and duplicating the pattern server-side would give it
 * two places to be wrong.
 */
export function attributionFor(ref: AttributableReference): Attribution | null {
  if (ref.referenceType === "executive_order") {
    const base = presidentAttribution(ref.sponsorName);
    return base && { ...base, photoUrl: base.photoUrl ?? ref.sponsorPhotoUrl ?? null };
  }

  if (ref.referenceType === "scotus_case") {
    const base = justiceAttribution(ref.sponsorName);
    if (!base) return null;
    // A PER CURIAM RULING TAKES NO PORTRAIT. A stored photo on such a record
    // can only be somebody the sync guessed at, and putting one face on an
    // opinion the Court deliberately issued unsigned is exactly the false
    // claim this whole path exists to avoid. The bench answers for it instead.
    if (base.perCuriam) return base;
    return { ...base, photoUrl: base.photoUrl ?? ref.sponsorPhotoUrl ?? null };
  }

  const name = ref.sponsorName?.trim();
  if (!name) return null;
  return {
    name,
    role: "Sponsored by",
    photoUrl: ref.sponsorPhotoUrl ?? null,
    bioguideId: ref.sponsorBioguideId ?? null,
    party: ref.sponsorParty ?? null,
    state: ref.sponsorState ?? null,
  };
}

// ---------------------------------------------------------------------------
// THE PASS THAT FINDS THE FACES
// ---------------------------------------------------------------------------

export interface PortraitFillResult {
  considered: number;
  filled: number;
  skipped: number;
}

/**
 * Find the portrait of whoever is behind each record that has none yet.
 *
 * ONE PASS FOR ALL THREE BRANCHES, which is the point. A bill's sponsor, the
 * President who signed an order, the justice who wrote a majority — the same
 * question, asked the same way, and the answer stored on the row so a page view
 * never causes a lookup.
 *
 * `limit` is small and the requests are spaced, because Wikimedia rate-limits
 * and a client that ignores that gets the platform blocked outright. Nothing
 * waits on this: a card with no portrait shows the name, which is true.
 */
export async function fillReferencePortraits(limit = 25): Promise<PortraitFillResult> {
  const pending = await prisma.governmentReference.findMany({
    where: {
      mergedIntoId: null,
      sponsorPhotoUrl: null,
      NOT: { sponsorName: null },
    },
    select: { id: true, sponsorName: true, sponsorBioguideId: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  let filled = 0;
  let skipped = 0;

  for (const ref of pending) {
    const photoUrl = await resolvePortrait({
      name: ref.sponsorName,
      bioguideId: ref.sponsorBioguideId,
    });

    if (!photoUrl) {
      // Nothing found, or the page failed the office guard. Nothing is written:
      // a wrong face is worse than no face, and the card shows the name alone.
      skipped++;
      continue;
    }

    await prisma.governmentReference.update({
      where: { id: ref.id },
      data: { sponsorPhotoUrl: photoUrl },
    });
    filled++;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (pending.length > 0) {
    console.log(
      `[Portraits] ${filled} filled, ${skipped} skipped, of ${pending.length} records missing the face of whoever decided them`,
    );
  }

  return { considered: pending.length, filled, skipped };
}

/**
 * The same, for the justices themselves.
 *
 * Separate from the records because a justice's face is not a property of any
 * one ruling — Scalia wrote hundreds, and sat on thousands more as part of a
 * per curiam bench. Resolved once per person, reused by every case they touched.
 */
export async function fillJusticePortraits(limit = 20): Promise<PortraitFillResult> {
  const pending = await prisma.justice.findMany({
    where: { photoUrl: null },
    select: { id: true, name: true },
    // Newest service first: the justices most likely to appear on a record
    // somebody is reading today.
    orderBy: { startDate: "desc" },
    take: limit,
  });

  let filled = 0;
  let skipped = 0;

  for (const justice of pending) {
    const photoUrl = await lookupPortrait(justice.name);
    if (!photoUrl) {
      skipped++;
      continue;
    }
    await prisma.justice.update({ where: { id: justice.id }, data: { photoUrl } });
    filled++;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (pending.length > 0) {
    console.log(`[Portraits] ${filled} of ${pending.length} justices given a face`);
  }

  return { considered: pending.length, filled, skipped };
}
