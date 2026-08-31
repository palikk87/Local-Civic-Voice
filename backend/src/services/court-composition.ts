/**
 * WHO WAS ON THE SUPREME COURT ON A GIVEN DAY.
 *
 * WHY THIS EXISTS. A per curiam opinion is the Court speaking as one body, with
 * no individual author — so a ruling that shaped the country used to render on
 * this platform as a docket number and an outcome, with nobody's face on it.
 *
 * The owner's answer: "the app is about accountability so not posting the photo
 * is not very fair." Every justice who sat is answerable for what the Court
 * issued in their name. So the card shows them.
 *
 * WHERE THE DATA COMES FROM. supremecourt.gov's own "Justices 1789 to Present"
 * table — the Court's roster of itself. That is deliberately the same class of
 * source as congress.gov and federalregister.gov, which this platform already
 * reads: the institution's own record of itself, not somebody's summary of it.
 * It carries the oath date and the service-terminated date for all 121 people
 * who have ever served, which is exactly what "who sat on this day" needs.
 *
 * NOT A HARDCODED TABLE. A list of justices typed into this repo would be
 * wrong the day somebody is confirmed, and nobody would notice until a card
 * lied. This is fetched and refreshed, so the answer keeps up on its own.
 *
 * VERIFIED AGAINST COURTS WE KNOW:
 *   1971-06-30  Burger, Black, Douglas, Harlan, Brennan, Stewart, White,
 *               Marshall, Blackmun — the Pentagon Papers Court, itself a
 *               per curiam, which is the case this feature exists for
 *   2016-06-01  EIGHT, correctly: Scalia had died and Gorsuch was not yet
 *               confirmed. A hardcoded nine would have invented a justice.
 */

import { prisma } from "../prisma";

export interface JusticeTenure {
  /** As the Court prints it, reordered to how a person is addressed. */
  name: string;
  /** The day they took the judicial oath. */
  startDate: Date;
  /** The day their service ended, or null while they are still sitting. */
  endDate: Date | null;
  /** The President who appointed them, as the Court's table gives it. */
  appointedBy: string | null;
  /**
   * Chief Justice for this span of service.
   *
   * The Court's page marks this only by WHICH TABLE somebody is in — there are
   * two, headed "Chief Justices" and "Associate Justices", and no column says
   * so. It matters because a bench is listed Chief first, then Associates by
   * seniority, and a bench that opens with somebody else reads as wrong to
   * anyone who knows the Court.
   */
  isChief: boolean;
}

const ROSTER_URL = "https://www.supremecourt.gov/about/members_text.aspx";

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * A date from the Court's table, or null.
 *
 * The table is not uniformly punctuated — a century of separate edits shows.
 * Real examples from the live page: "December 10 1877" with no comma,
 * "June 5,1916" with no space, "(a) October 19, 1789" carrying a footnote
 * marker, and "September 26, 1986*" where the asterisk means the justice was
 * promoted to Chief. Parsing on an exact format silently drops those five
 * people, so this reads month/day/year out of whatever else is around them.
 */
export function parseCourtDate(raw: string): Date | null {
  const cleaned = raw.replace(/\([a-z]\)/gi, " ").replace(/[*,]/g, " ");
  const match = /([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})/.exec(cleaned);
  if (!match) return null;
  const month = MONTHS[match[1]!.toLowerCase()];
  if (!month) return null;
  return new Date(Date.UTC(Number(match[3]), month - 1, Number(match[2])));
}

const SUFFIX = /^(jr|sr|i{1,3}|iv)\.?$/i;

/**
 * "Roberts, John G., Jr." becomes "John G. Roberts Jr."
 *
 * The Court lists people surname-first for sorting. Everywhere a person is
 * shown they should read as their name, and the suffix has to travel to the
 * end rather than sitting in the middle — "John G., Jr. Roberts" is nobody.
 */
export function displayName(listed: string): string {
  const [surname = "", ...rest] = listed.split(",");
  const parts = rest.map((p) => p.trim()).filter(Boolean);
  const given = parts.filter((p) => !SUFFIX.test(p));
  const suffixes = parts.filter((p) => SUFFIX.test(p));
  return [...given, surname.trim(), ...suffixes].join(" ").trim();
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every justice in the Court's table, with the span they served.
 *
 * Pure, so it is tested against the real page recorded in
 * tests/fixtures/scotus-justices.html rather than against a hand-written
 * imitation of it — the parsing is the part that can be wrong, and a test that
 * needs supremecourt.gov to be up is a test that fails for reasons that have
 * nothing to do with this code.
 */
export function parseJusticeRoster(html: string): JusticeTenure[] {
  // Split on the section heading rather than matching rows across the whole
  // page: everything before "Associate Justices" is a Chief, and nothing in
  // either table says which is which.
  const associatesAt = html.search(/Associate\s+Justices/i);
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const found: JusticeTenure[] = [];

  let cursor = 0;
  for (const row of rows) {
    const rowAt = html.indexOf(row, cursor);
    cursor = rowAt >= 0 ? rowAt + row.length : cursor;
    const isChief = associatesAt >= 0 && rowAt >= 0 && rowAt < associatesAt;
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(stripTags);
    if (cells.length < 6) continue;

    const [, listed = "", , appointedBy = "", oath = "", terminated = ""] = cells;
    // The header row, and any layout row that is not a person.
    if (!listed.includes(",") || listed === "Name") continue;

    const startDate = parseCourtDate(oath);
    if (!startDate) continue;

    found.push({
      name: displayName(listed),
      startDate,
      // Empty means still serving. It must stay null rather than become today,
      // or tomorrow's rulings would show a Court that has already left.
      endDate: parseCourtDate(terminated),
      appointedBy: appointedBy.trim() || null,
      isChief,
    });
  }

  return found;
}

/**
 * The justices sitting on a given day, in seniority order as the table lists them.
 *
 * DEDUPED BY PERSON. Someone elevated from Associate to Chief — Rehnquist,
 * White, Stone, Hughes — appears twice in the Court's table, once per office.
 * Without this they would show up twice on the same card, which reads as a bug
 * and miscounts the bench.
 */
export function courtOn(when: Date, roster: JusticeTenure[]): JusticeTenure[] {
  const seen = new Set<string>();
  const sitting: JusticeTenure[] = [];

  for (const justice of roster) {
    if (justice.startDate > when) continue;
    if (justice.endDate && justice.endDate < when) continue;
    if (seen.has(justice.name)) continue;
    seen.add(justice.name);
    sitting.push(justice);
  }

  // The Chief leads, then the Associates by how long they have served. That is
  // how the Court lists itself, and a bench in any other order reads as wrong.
  return sitting.sort((a, b) => {
    if (a.isChief !== b.isChief) return a.isChief ? -1 : 1;
    return a.startDate.getTime() - b.startDate.getTime();
  });
}

/** The Court's own table, fetched. Null when it cannot be reached. */
export async function fetchJusticeRoster(): Promise<JusticeTenure[] | null> {
  try {
    const response = await fetch(ROSTER_URL, {
      headers: {
        "User-Agent": "AyeAndNay/1.0 (https://ayeandnay.com; civic reference platform)",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const parsed = parseJusticeRoster(await response.text());
    // A parse that finds almost nothing means the page was restructured. Better
    // to keep yesterday's roster than to overwrite it with a broken read.
    return parsed.length >= 100 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Refresh the stored roster from the Court.
 *
 * Additive by design: a justice is upserted, never deleted. If the page is
 * briefly wrong or a row is dropped, the platform keeps the person it already
 * knew rather than making a Court disappear from every ruling they sat on.
 */
export async function refreshJusticeRoster(): Promise<{ seen: number; written: number }> {
  const roster = await fetchJusticeRoster();
  if (!roster) return { seen: 0, written: 0 };

  let written = 0;
  for (const justice of roster) {
    await prisma.justice.upsert({
      where: { name_startDate: { name: justice.name, startDate: justice.startDate } },
      create: {
        name: justice.name,
        startDate: justice.startDate,
        endDate: justice.endDate,
        appointedBy: justice.appointedBy,
        isChief: justice.isChief,
      },
      // The portrait is deliberately not touched here. It is resolved once by a
      // separate pass and costs a request to find; re-running this must not
      // throw it away.
      update: {
        endDate: justice.endDate,
        appointedBy: justice.appointedBy,
        isChief: justice.isChief,
      },
    });
    written += 1;
  }

  console.log(`[Court] roster refreshed: ${written} justices`);
  return { seen: roster.length, written };
}

export interface SeatedJustice {
  name: string;
  photoUrl: string | null;
}

/**
 * The bench on the day a ruling came down, with faces, from the database.
 *
 * Empty when the roster has not been fetched yet, which renders as no panel —
 * a card with nobody on it is honest, a card with a guessed bench is not.
 */
export async function benchOn(when: Date): Promise<SeatedJustice[]> {
  const rows = await prisma.justice.findMany({
    where: {
      startDate: { lte: when },
      OR: [{ endDate: null }, { endDate: { gte: when } }],
    },
    select: { name: true, photoUrl: true, isChief: true, startDate: true },
    // Chief first, then Associates by seniority — the order the Court uses.
    orderBy: [{ isChief: "desc" }, { startDate: "asc" }],
  });

  const seen = new Set<string>();
  return rows
    .filter((row) => !seen.has(row.name) && seen.add(row.name))
    .map((row) => ({ name: row.name, photoUrl: row.photoUrl }));
}

// ---------------------------------------------------------------------------
// WHO DISSENTED — narrowing the bench to the majority
// ---------------------------------------------------------------------------
//
// A per curiam ruling is unsigned, so the bench that sat is who answers for it.
// But justices do dissent from per curiam rulings, and somebody who wrote
// "I dissent" should not appear under a heading that reads as agreement.
//
// CourtListener stores one decision as a CLUSTER of sub-opinions, each with a
// type — "020lead", "030concurrence", "040dissent" — plus the author and
// whoever joined them. That is enough to subtract.
//
// AN EMPTY RESULT IS NOT UNANIMITY. No recorded dissent could mean none was
// filed, or that none was digitised, and nothing here can tell those apart. So
// an empty list widens the card back to the whole bench under a label that
// only claims who SAT. Narrowing on absence would be inventing agreement.

/** The fields of a CourtListener sub-opinion this needs. */
interface ClusterOpinion {
  type?: string | null;
  author_str?: string | null;
  joined_by_str?: string | null;
}

/**
 * The justices who put their name to a dissent, out of a cluster's opinions.
 *
 * Pure, so the subtraction can be tested without the API — and it is the part
 * that decides whether somebody's face appears under "in the majority", which
 * is a claim about a person and has to be right.
 */
export function dissentersIn(opinions: ClusterOpinion[]): string[] {
  const names = new Set<string>();

  for (const opinion of opinions) {
    // "040dissent", and "dissent" inside a combined type. Concurrences are
    // deliberately NOT counted: a justice who concurs is in the majority.
    if (!/dissent/i.test(opinion.type ?? "")) continue;

    for (const field of [opinion.author_str, opinion.joined_by_str]) {
      for (const part of (field ?? "").split(/,|\band\b|;/)) {
        const name = part.trim();
        // Surnames arrive alone here — "Black", "Douglas" — which is what the
        // matching below expects. Anything shorter is punctuation, not a person.
        if (name.length > 2) names.add(name);
      }
    }
  }

  return [...names];
}

/**
 * Is this justice one of the dissenters?
 *
 * CourtListener names them by surname; the Court's roster gives a full name.
 * Matched on surname, and the comparison must be exact on that word — a
 * substring test would put "Marshall" inside "John Marshall Harlan" and quietly
 * drop a justice who did not dissent from the majority.
 */
export function isDissenter(fullName: string, dissenters: string[]): boolean {
  const words = fullName.toLowerCase().split(/\s+/).filter(Boolean);
  const surname = words[words.length - 1] === "jr." || words[words.length - 1] === "sr."
    ? words[words.length - 2]
    : words[words.length - 1];
  if (!surname) return false;

  return dissenters.some((dissenter) => {
    const parts = dissenter.toLowerCase().split(/\s+/).filter(Boolean);
    return parts.includes(surname);
  });
}

/**
 * Ask CourtListener who dissented, for per curiam rulings that have not been asked.
 *
 * ONE REQUEST PER RULING, and CourtListener allows FIVE A MINUTE across the
 * whole platform — see services/courtlistener.ts, where that ceiling is
 * measured rather than assumed. So the batch is tiny and the schedule is slow.
 * Nothing waits on this: until it runs, the card shows the whole bench under a
 * label that only claims who sat, which is true either way.
 *
 * `dissentCheckedAt` is written even when nothing is found, because "asked and
 * the source recorded none" and "never asked" are different states and only the
 * second is worth spending one of five requests on again.
 */
export async function fillScotusDissents(limit = 3): Promise<{ asked: number; found: number }> {
  const { env } = await import("../env");
  const apiKey = env.COURTLISTENER_API_KEY;
  if (!apiKey) {
    // Not an error worth shouting about on every sweep: the judicial branch
    // already logs this loudly where it actually blocks something.
    return { asked: 0, found: 0 };
  }

  const { fetchCourtListener } = await import("./courtlistener");

  const pending = await prisma.governmentReference.findMany({
    where: {
      referenceType: "scotus_case",
      mergedIntoId: null,
      dissentCheckedAt: null,
      // Only per curiam rulings need this. A signed opinion already names one
      // person, and that is who the card shows.
      sponsorName: { equals: "Per Curiam", mode: "insensitive" },
      NOT: { decidedDate: null },
    },
    select: { id: true, sourceUrl: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  let found = 0;
  const deadlineAt = Date.now() + 120_000;

  for (const ref of pending) {
    const clusterId = ref.sourceUrl?.match(/courtlistener\.com\/opinion\/(\d+)/)?.[1];
    if (!clusterId) {
      // No id to ask with. Marked as checked so it does not hold up the queue
      // ahead of records that can actually be answered.
      await prisma.governmentReference.update({
        where: { id: ref.id },
        data: { dissentCheckedAt: new Date() },
      });
      continue;
    }

    const data = await fetchCourtListener<{ results?: ClusterOpinion[] }>(
      `https://www.courtlistener.com/api/rest/v4/opinions/?cluster=${clusterId}`,
      { deadlineAt, apiKey, label: "per curiam dissents" },
    );

    // A failed request is NOT an answer. Leaving dissentCheckedAt null means
    // the next sweep tries again, rather than recording "no dissenters" because
    // the API was briefly down — which would quietly widen a card to the whole
    // bench and call it the majority.
    if (!data) continue;

    const dissenters = dissentersIn(data.results ?? []);
    await prisma.governmentReference.update({
      where: { id: ref.id },
      data: { dissentedBy: dissenters, dissentCheckedAt: new Date() },
    });
    if (dissenters.length > 0) found += 1;
  }

  if (pending.length > 0) {
    console.log(`[Court] dissents: asked ${pending.length}, ${found} rulings had one on record`);
  }

  return { asked: pending.length, found };
}
