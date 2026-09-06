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
import { presidentOn, storedPortrait, surnameOf } from "../data/portraits";

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
 * EVERY ORDER WAS SIGNED BY SOMEBODY, and every order carries the date it was
 * signed. Khalid: "each one was signed by a president. so they have a name on
 * them." So where the Federal Register gave us a name we keep it, and where it
 * did not — which is all 1,532 orders in the archive today — the date answers.
 *
 * The stored name still wins. It is what the government itself printed on the
 * document; the date is how we work it out when nobody told us.
 */
export function presidentAttribution(
  name: string | null | undefined,
  signedDate?: Date | string | null,
): Attribution | null {
  const term = presidentOn(signedDate);
  const trimmed = name?.trim();
  if (!trimmed) {
    return term ? { name: term.name, role: "Signed by", photoUrl: term.photoUrl } : null;
  }

  /*
   * THE NAME AND THE FACE COME FROM DIFFERENT PLACES, ON PURPOSE.
   *
   * A stored name is what the government itself printed on the document, so it
   * is what we print. But it is not always the name our list files him under:
   * the Federal Register says "William J. Clinton" where the portrait list says
   * "Bill Clinton", and those are one man.
   *
   * The date already told us WHO held the office that day, and that is a
   * stronger identifier than either spelling. So when the stored name and the
   * term agree on a surname, the term supplies the face — which is how "William
   * J. Clinton" gets Bill Clinton's portrait without either name matching the
   * other. Where they disagree, we do not reconcile them: a name lookup is
   * tried, and failing that the record shows a name with no face.
   */
  const sameMan = term && surnameOf(trimmed) === surnameOf(term.name);
  return {
    name: trimmed,
    role: "Signed by",
    photoUrl: (sameMan ? term.photoUrl : null) ?? storedPortrait(trimmed),
  };
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
/**
 * Did the Court sign this ruling, or deliberately not sign it?
 *
 * The distinction matters beyond attribution, so it lives in one place. A
 * ruling recorded as "Per Curiam" is unsigned BY CHOICE — the Court's own
 * answer to who wrote it — and that is a complete record, not a missing one.
 * A ruling with no author recorded at all is our gap, and reads differently
 * everywhere it is used.
 */
export function isPerCuriam(name: string | null | undefined): boolean {
  const trimmed = name?.trim();
  return Boolean(trimmed) && /^per\s*curiam$/i.test(trimmed!);
}

export function justiceAttribution(name: string | null | undefined): Attribution | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;

  if (isPerCuriam(trimmed)) {
    return {
      name: "The Supreme Court",
      role: "Decided per curiam by",
      photoUrl: null,
      perCuriam: true,
    };
  }

  return { name: trimmed, role: "Majority opinion by", photoUrl: null };
}

/**
 * A RULING NOBODY IS NAMED ON — decided by the Court as it sat that day.
 *
 * Khalid, on the executive orders: "the date they were signed tells you who was
 * in the role." For an order that names one person, because the office has one
 * holder. The Court has nine, so the same date tells you who SAT, not who
 * WROTE — and putting one of their faces on it would be inventing the fact the
 * record is missing.
 *
 * So the date answers the question it can answer. The bench is who is
 * answerable for what the Court issued, which is the same ground the per curiam
 * panel already stands on; the difference is only in what we say. A per curiam
 * ruling is unsigned BY CHOICE and says so. This one is a ruling whose author
 * we do not hold, and it says that instead.
 */
export function unattributedCourt(): Attribution {
  return {
    name: "The Supreme Court",
    role: "Decided by",
    photoUrl: null,
    // Same flag, same meaning it has always had: no one face goes on this, and
    // the bench that sat is looked up from the decision date.
    perCuriam: true,
  };
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

  /*
   * ALREADY IN HAND. Every president and every justice since 1789 is held in
   * data/portraits.ts — the set of people who can sign an order or write an
   * opinion is closed and small, so it was downloaded once rather than looked
   * up forever. No network, no rate limit, no waiting.
   */
  const held = storedPortrait(name);
  if (held) return held;

  // Not on the list, which in practice means somebody who has just taken
  // office. Ask once, and the answer is stored on the record from here.
  return lookupPortrait(name);
}

// ---------------------------------------------------------------------------
// ONE SHAPE, THREE BRANCHES
// ---------------------------------------------------------------------------

/** The columns of a GovernmentReference this needs. Nothing more is read. */
export interface AttributableReference {
  referenceType: string;
  /** An executive order's signing date — who held the office that day. */
  signedDate?: Date | string | null;
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
    const base = presidentAttribution(ref.sponsorName, ref.signedDate);
    return base && { ...base, photoUrl: base.photoUrl ?? ref.sponsorPhotoUrl ?? null };
  }

  if (ref.referenceType === "scotus_case") {
    const base = justiceAttribution(ref.sponsorName) ?? unattributedCourt();
    // A PER CURIAM RULING TAKES NO PORTRAIT. A stored photo on such a record
    // can only be somebody the sync guessed at, and putting one face on an
    // opinion the Court deliberately issued unsigned is exactly the false
    // claim this whole path exists to avoid. The bench answers for it instead.
    if (base.perCuriam) return base;
    return { ...base, photoUrl: base.photoUrl ?? ref.sponsorPhotoUrl ?? null };
  }

  const name = ref.sponsorName?.trim();
  if (!name) return null;
  const bioguideId = ref.sponsorBioguideId?.trim() || null;
  return {
    name,
    role: "Sponsored by",
    /*
     * ONE ADDRESS FOR A FACE, AND IT IS OURS.
     *
     * This used to be null so every client could build a congress.gov URL
     * itself. Measured across the live set, that source has no photograph for
     * several sitting members and serves 64KB of something that is not an
     * image for at least one — which killed the share card that tried to draw
     * it. services/member-portraits.ts asks the official source first, then
     * two mirrors, checks the bytes really are a picture, and keeps whatever
     * answered. Pointing here means the page, the card and the phone all get
     * the same face from the same place, and get it once.
     */
    photoUrl: bioguideId
      ? `${(process.env.BACKEND_URL || "http://localhost:3000").replace(/\/+$/, "")}/api/portraits/${bioguideId}.jpg`
      : (ref.sponsorPhotoUrl ?? null),
    bioguideId,
    party: ref.sponsorParty ?? null,
    state: ref.sponsorState ?? null,
  };
}

// ---------------------------------------------------------------------------
// FACES ARE FOUND WHEN SOMEBODY OPENS THE LAW, NOT BEFORE
// ---------------------------------------------------------------------------
//
// THE SWEEP THIS REPLACES walked the archive filling portraits nobody had asked
// to see. 1,532 executive orders are held; most will never be opened by anyone,
// and paying Wikipedia for all of them to serve the handful that are read is
// backwards. Khalid: "rather than forcing it to backfil why not fill it as
// things are opened. that way we aren't filling stuff that never need it."
//
// So it works the way the Citizen's Brief already does — nothing starts by
// itself, the first reader triggers it, and everybody after gets the stored
// answer for free.
//
// AND ONE ANSWER FILLS MANY RECORDS. The lookup is by PERSON, so opening a
// single Obama order writes the portrait onto every order he signed. The
// archive fills itself along the paths people actually walk.
//
// NEVER ON THE CRITICAL PATH. The reader who triggers it does not wait for it —
// their page renders with the name and no face, and the next view has both. A
// portrait is not worth a second of somebody's page load.

/**
 * People already asked about in this process, so one unfindable name does not
 * cost a request on every card that shows them.
 *
 * In memory on purpose: it resets on restart, which is the behaviour we want —
 * a name that failed because Wikipedia was briefly unreachable gets another go
 * tomorrow, rather than being written off in the database forever.
 */
const attempted = new Set<string>();

/**
 * ONE AT A TIME, SPACED.
 *
 * A feed page is twenty law cards, and each one wants a face. Firing twenty
 * lookups at once would be the fastest way to get this platform rate-limited by
 * Wikimedia, so they queue behind a single worker instead. Nobody is waiting on
 * any of it — the card that triggered a lookup renders the name immediately and
 * the face appears for the next reader.
 */
const queue: Array<{ name: string; bioguideId: string | null }> = [];
let draining = false;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const person = queue.shift()!;
      try {
        const photoUrl = await resolvePortrait({
          name: person.name,
          bioguideId: person.bioguideId,
        });
        // Nothing found, or the page failed the office guard. Nothing is
        // written: a wrong face is worse than no face, and the card shows the
        // name alone, which is true.
        if (!photoUrl) continue;

        // EVERY record this person is behind, in one write. Opening one order
        // Obama signed gives a face to all three hundred of them.
        const written = await prisma.governmentReference.updateMany({
          where: {
            sponsorName: person.name,
            sponsorBioguideId: person.bioguideId,
            sponsorPhotoUrl: null,
            mergedIntoId: null,
          },
          data: { sponsorPhotoUrl: photoUrl },
        });
        if (written.count > 0) {
          console.log(`[Portraits] ${person.name}: ${written.count} record(s) given a face`);
        }
      } catch (error) {
        console.warn(`[Portraits] could not resolve ${person.name}:`, error);
      }
      // Wikimedia asks automated clients to be gentle, and nobody is waiting.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    draining = false;
  }
}

/**
 * A law card is loading — make sure its person has a face, for the next reader.
 *
 * Returns immediately and never throws. Safe to call for every card on a page:
 * a person is only ever asked about once per process, and one answer fills
 * every record they are behind.
 */
export function ensurePortraitFor(ref: {
  sponsorName: string | null;
  sponsorBioguideId?: string | null;
  sponsorPhotoUrl: string | null;
}): void {
  const name = ref.sponsorName?.trim();
  // Already has one, has no person, or we have already asked this run.
  if (!name || ref.sponsorPhotoUrl) return;

  const bioguideId = ref.sponsorBioguideId ?? null;
  const key = `${name}|${bioguideId ?? ""}`;
  if (attempted.has(key)) return;
  attempted.add(key);

  queue.push({ name, bioguideId });
  void drain();
}

/** Test seam: forget what has been attempted, so a case can run twice. */
export function resetPortraitAttempts(): void {
  attempted.clear();
  queue.length = 0;
}
