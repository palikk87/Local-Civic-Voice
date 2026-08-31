/**
 * THE BADGE RATES OUR OWN RECORD, AND HAS TO BE ABLE TO SAY WE FELL SHORT.
 *
 * WHAT WENT WRONG BEFORE. The badge this replaces scored a law with arithmetic
 * over constants: 40 points from one hardcoded source, invented weights for the
 * rest, and a ceiling of 80 against a top bar of 90 — so its best badge was
 * unreachable for every law on every screen, and the feed's mapper dropped the
 * only fields that moved it at all. Every post read "? Unverified", forever.
 *
 * So the first thing this file proves is that ALL FOUR LEVELS ARE REACHABLE,
 * because a badge that can only say one thing is not a badge.
 *
 * The second is that each check moves the answer ON ITS OWN. A checklist whose
 * lines are not independent is a score with extra steps.
 *
 * The third is APPLICABILITY. An executive order has no floor vote and a bill
 * in committee never had one; marking either down for a fact that cannot exist
 * is the same mistake as calling a 1964 statute unverified.
 */

import { describe, expect, test } from "bun:test";
import {
  COMPLETENESS_LEVELS,
  recordCompleteness,
  type CompletableReference,
} from "../src/services/record-completeness";

const NOW = new Date("2026-08-31T12:00:00Z");

/** A bill with nothing outstanding. Every test below takes something away. */
function complete(over: Partial<CompletableReference> = {}): CompletableReference {
  return {
    referenceType: "bill",
    status: "committee",
    sourceUrl: "https://www.congress.gov/bill/119th-congress/house-bill/1",
    fullText: "Be it enacted...",
    fullTextSource: "congress.gov",
    sourceCheckedAt: new Date("2026-08-29T12:00:00Z"),
    introducedDate: new Date("2026-01-05T00:00:00Z"),
    signedDate: null,
    decidedDate: null,
    sponsorName: "Adam Smith",
    sponsorBioguideId: "S000510",
    sponsorPhotoUrl: null,
    citizenBriefJson: '{"theGoal":"..."}',
    citizenBriefVersion: 1,
    lawVersion: 1,
    ...over,
  };
}

const idsOf = (ref: CompletableReference) =>
  recordCompleteness(ref, NOW).checks.map((c) => c.id);
const missing = (ref: CompletableReference) =>
  recordCompleteness(ref, NOW).checks.filter((c) => !c.met).map((c) => c.id);

describe("all four badges are reachable", () => {
  test("nothing outstanding is Verified", () => {
    const result = recordCompleteness(complete(), NOW);
    expect(result.level).toBe("verified");
    expect(result.label).toBe("Verified");
    expect(result.met).toBe(result.applicable);
  });

  test("one outstanding is Confirmed", () => {
    expect(recordCompleteness(complete({ citizenBriefJson: null }), NOW).level).toBe("confirmed");
  });

  test("two outstanding is Unconfirmed", () => {
    const result = recordCompleteness(
      complete({ citizenBriefJson: null, sponsorBioguideId: null }),
      NOW,
    );
    expect(result.level).toBe("unconfirmed");
  });

  test("three or more outstanding is Unverified", () => {
    const result = recordCompleteness(
      complete({ citizenBriefJson: null, sponsorBioguideId: null, sourceUrl: null }),
      NOW,
    );
    expect(result.level).toBe("unverified");
  });

  test("A BARELY-STARTED RECORD IS NOT SILENTLY FLATTERED", () => {
    // Freshly created from a search result, before the sync has reached it.
    const result = recordCompleteness(
      complete({
        sourceUrl: null,
        fullText: null,
        fullTextSource: null,
        sourceCheckedAt: null,
        introducedDate: null,
        sponsorName: null,
        sponsorBioguideId: null,
        citizenBriefJson: null,
      }),
      NOW,
    );
    expect(result.met).toBe(0);
    expect(result.level).toBe("unverified");
  });

  test("the four levels are distinct and ordered", () => {
    expect(COMPLETENESS_LEVELS.map((l) => l.level)).toEqual([
      "verified",
      "confirmed",
      "unconfirmed",
      "unverified",
    ]);
  });
});

describe("THE BOTTOM RUNG STAYS TRUE", () => {
  test("a record we HAVE verified against a source is never called Unverified", () => {
    // The heavy names were chosen deliberately, so "Unverified" must never land
    // on a record whose official source and text we hold. It cannot: four of
    // the six always-applicable checks are sourcing, so falling to three
    // outstanding requires losing one of them.
    const sourced = complete({
      citizenBriefJson: null,
      sponsorName: null,
      sponsorBioguideId: null,
    });
    const result = recordCompleteness(sourced, NOW);

    expect(result.checks.find((c) => c.id === "source")?.met).toBe(true);
    expect(result.checks.find((c) => c.id === "text")?.met).toBe(true);
    expect(result.level).not.toBe("unverified");
  });
});

describe("each check moves the answer on its own", () => {
  const cases: Array<[string, Partial<CompletableReference>]> = [
    ["source", { sourceUrl: null }],
    ["text", { fullText: null }],
    ["text", { fullTextSource: null }],
    ["rechecked", { sourceCheckedAt: null }],
    ["dates", { introducedDate: null }],
    ["attribution", { sponsorBioguideId: null, sponsorPhotoUrl: null }],
    ["brief", { citizenBriefJson: null }],
  ];

  for (const [id, over] of cases) {
    test(`removing ${id} (${Object.keys(over).join(", ")}) is the only thing that drops`, () => {
      expect(missing(complete(over))).toEqual([id]);
    });
  }

  test("a stale recheck counts as not checked", () => {
    // Held, but nobody has confirmed the source still says this in months.
    expect(missing(complete({ sourceCheckedAt: new Date("2026-01-01T00:00:00Z") }))).toEqual([
      "rechecked",
    ]);
  });

  test("A NAME WITHOUT A WAY TO PICTURE THEM DOES NOT COUNT", () => {
    // A face is what makes a law read as somebody's decision rather than a
    // filing, and a bare name gives the card nothing to draw.
    const nameOnly = complete({ sponsorBioguideId: null, sponsorPhotoUrl: null });
    expect(missing(nameOnly)).toEqual(["attribution"]);
    // ...but the name is still reported, so the panel can say who we know of.
    expect(
      recordCompleteness(nameOnly, NOW).checks.find((c) => c.id === "attribution")?.detail,
    ).toBe("Adam Smith");
  });

  test("a stored portrait satisfies attribution without a bioguide id", () => {
    // A President or a justice has no bioguide id — their portrait is resolved
    // and stored instead.
    expect(
      missing(
        complete({
          referenceType: "executive_order",
          signedDate: new Date("2014-06-01T00:00:00Z"),
          introducedDate: null,
          sponsorName: "Barack Obama",
          sponsorBioguideId: null,
          sponsorPhotoUrl: "https://upload.wikimedia.org/portrait.jpg",
        }),
      ),
    ).toEqual([]);
  });
});

describe("nothing is marked down for a fact that cannot exist", () => {
  test("AN EXECUTIVE ORDER IS NOT ASKED FOR A FLOOR VOTE", () => {
    const eo = complete({
      referenceType: "executive_order",
      status: "active",
      introducedDate: null,
      signedDate: new Date("2026-02-01T00:00:00Z"),
      sponsorName: "Donald J. Trump",
      sponsorBioguideId: null,
      sponsorPhotoUrl: "https://upload.wikimedia.org/portrait.jpg",
    });
    expect(idsOf(eo)).not.toContain("roll_call");
    expect(recordCompleteness(eo, NOW).level).toBe("verified");
  });

  test("neither is a court ruling", () => {
    const ruling = complete({
      referenceType: "scotus_case",
      status: "decided",
      introducedDate: null,
      decidedDate: new Date("2015-06-26T00:00:00Z"),
      sponsorName: "Anthony M. Kennedy",
      sponsorBioguideId: null,
      sponsorPhotoUrl: "https://upload.wikimedia.org/portrait.jpg",
    });
    expect(idsOf(ruling)).not.toContain("roll_call");
    expect(recordCompleteness(ruling, NOW).level).toBe("verified");
  });

  test("A BILL SITTING IN COMMITTEE IS NOT ASKED FOR ONE EITHER", () => {
    // Most bills die there and never get a recorded vote. Marking them down for
    // it would put every one of them a rung below where it belongs.
    expect(idsOf(complete({ status: "committee" }))).not.toContain("roll_call");
  });

  test("but a bill that reached a vote IS asked, and drops without it", () => {
    const passed = complete({ status: "passed", hasRollCall: false });
    expect(idsOf(passed)).toContain("roll_call");
    expect(missing(passed)).toEqual(["roll_call"]);

    expect(missing(complete({ status: "passed", hasRollCall: true }))).toEqual([]);
  });

  test("the brief-is-current check only applies once the law has moved", () => {
    // A law on version 1 has no earlier version for the brief to be stuck on.
    expect(idsOf(complete({ lawVersion: 1 }))).not.toContain("brief_current");
    expect(idsOf(complete({ lawVersion: 2, citizenBriefVersion: 2 }))).toContain("brief_current");
  });

  test("and it is not asked when there is no brief at all", () => {
    // Otherwise a record with no brief would be marked down twice for it.
    const noBrief = complete({ citizenBriefJson: null, lawVersion: 3 });
    expect(idsOf(noBrief)).not.toContain("brief_current");
    expect(missing(noBrief)).toEqual(["brief"]);
  });

  test("A BRIEF LEFT BEHIND BY A CHANGED LAW DROPS A RUNG", () => {
    const stale = complete({ lawVersion: 3, citizenBriefVersion: 1 });
    expect(missing(stale)).toEqual(["brief_current"]);
    expect(recordCompleteness(stale, NOW).level).toBe("confirmed");
    expect(
      recordCompleteness(stale, NOW).checks.find((c) => c.id === "brief_current")?.detail,
    ).toBe("brief describes version 1, the law is on 3");
  });
});

describe("every line carries the real value behind it", () => {
  test("so the panel explains the badge instead of just worrying somebody", () => {
    const checks = recordCompleteness(complete(), NOW).checks;
    const detail = (id: string) => checks.find((c) => c.id === id)?.detail;

    expect(detail("source")).toBe("congress.gov");
    expect(detail("text")).toBe("from congress.gov");
    expect(detail("rechecked")).toBe("checked 2 days ago");
    expect(detail("dates")).toBe("Introduced January 5, 2026");
    expect(detail("attribution")).toBe("Adam Smith");
    expect(detail("brief")).toBe("written");
  });

  test("a missing brief says why, rather than leaving a blank", () => {
    const checks = recordCompleteness(complete({ citizenBriefJson: null }), NOW).checks;
    expect(checks.find((c) => c.id === "brief")?.detail).toBe("nobody has asked for one yet");
  });

  test("the date line names what the date IS, per branch", () => {
    const eo = recordCompleteness(
      complete({
        referenceType: "executive_order",
        introducedDate: null,
        signedDate: new Date("2026-02-01T00:00:00Z"),
      }),
      NOW,
    );
    expect(eo.checks.find((c) => c.id === "dates")?.detail).toBe("Signed February 1, 2026");
  });
});

// ---------------------------------------------------------------------------
// THE SAME LAW GETS THE SAME BADGE WHEREVER YOU MEET IT
// ---------------------------------------------------------------------------
//
// The badge this replaces disagreed with itself: the feed built a stripped-down
// copy of the law and scored that, so a card said "Unverified" while the
// record's own page — given the real fields — scored higher. A self-rating that
// changes depending on which screen you are on is not a rating.

import { afterAll, beforeAll, beforeEach } from "bun:test";
import { BASE_URL, prisma, resetData, startServer, stopServer } from "./helpers/server";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

interface WireCompleteness {
  level: string;
  label: string;
  met: number;
  applicable: number;
  checks: Array<{ id: string; label: string; met: boolean; detail: string | null }>;
}

describe("every endpoint reports the same badge for the same record", () => {
  async function seed(id: string, over: Record<string, unknown> = {}): Promise<string> {
    const row = await prisma.governmentReference.create({
      data: {
        id,
        masterReferenceId: id,
        referenceType: "bill",
        title: `Test ${id}`,
        status: "committee",
        sourceUrl: "https://www.congress.gov/bill/119th-congress/house-bill/1",
        fullText: "Be it enacted...",
        fullTextSource: "congress.gov",
        sourceCheckedAt: new Date(),
        introducedDate: new Date("2026-01-05T00:00:00Z"),
        sponsorName: "Adam Smith",
        sponsorBioguideId: "S000510",
        ...over,
      },
    });
    return row.id;
  }

  test("the list, the detail page and a post card all agree", async () => {
    const id = await seed("hr-agree-1-119", { citizenBriefJson: null });

    const detail = (await (
      await fetch(`${BASE_URL}/api/government-references/${id}`)
    ).json()) as { reference: { completeness: WireCompleteness } };

    const list = (await (
      await fetch(`${BASE_URL}/api/government-references?limit=100`)
    ).json()) as { references: Array<{ id: string; completeness: WireCompleteness }> };
    const fromList = list.references.find((r) => r.id === id);

    expect(detail.reference.completeness.level).toBe("confirmed");
    expect(fromList?.completeness).toEqual(detail.reference.completeness);
  });

  test("A CARD SAYS WHY, NOT JUST WHAT — the checklist travels with the badge", async () => {
    // The point of the whole change: "Unconfirmed" on its own makes somebody
    // wary about a law that is perfectly real. The reason is what earns trust.
    const id = await seed("hr-agree-2-119", { citizenBriefJson: null });

    const body = (await (
      await fetch(`${BASE_URL}/api/government-references/${id}`)
    ).json()) as { reference: { completeness: WireCompleteness } };
    const { checks } = body.reference.completeness;

    const brief = checks.find((c) => c.id === "brief");
    expect(brief?.met).toBe(false);
    expect(brief?.detail).toBe("nobody has asked for one yet");

    // And the things we DO hold are named, with their real values.
    expect(checks.find((c) => c.id === "source")?.detail).toBe("congress.gov");
    expect(checks.find((c) => c.id === "text")?.detail).toBe("from congress.gov");
  });

  test("a record holding everything reads Verified end to end", async () => {
    const id = await seed("hr-agree-3-119", {
      citizenBriefJson: '{"theGoal":"..."}',
      citizenBriefVersion: 1,
    });

    const body = (await (
      await fetch(`${BASE_URL}/api/government-references/${id}`)
    ).json()) as { reference: { completeness: WireCompleteness } };

    expect(body.reference.completeness.level).toBe("verified");
    expect(body.reference.completeness.checks.every((c) => c.met)).toBe(true);
  });
});
