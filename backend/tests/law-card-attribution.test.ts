/**
 * EVERY LAW CARD SAYS WHO DECIDED IT.
 *
 * THE COMPLAINT THAT STARTED THIS: "why isn't there a photo of the rep in
 * every law card?" — and then, on being told they were all there, "thats not
 * true, some have it some don't." Both were right. A bill card carried its
 * sponsor's face; an executive order and a Supreme Court ruling carried a title
 * and a status, because nothing on either record named a person at all.
 *
 * Two thirds of the platform's records were anonymous. The Federal Register had
 * always named the President and CourtListener had always named the justice who
 * wrote the majority — neither field was read.
 *
 * WHAT THIS FILE HOLDS TO, through the real HTTP endpoints rather than the
 * service in isolation, because three of them return records and a reader can
 * arrive through any of them:
 *
 *   - all three endpoints agree about the same record
 *   - each branch is labelled with what that person actually did
 *   - a per curiam decision names NOBODY
 *   - a record with no known author renders no attribution rather than a blank
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { BASE_URL, prisma, resetData, startServer, stopServer } from "./helpers/server";
import { parseJusticeRoster } from "../src/services/court-composition";
import { readFileSync } from "node:fs";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

interface Attribution {
  name: string;
  role: string;
  photoUrl: string | null;
  bioguideId?: string | null;
  party?: string | null;
  state?: string | null;
  perCuriam?: boolean;
  panel?: Array<{ name: string; photoUrl: string | null }>;
  panelLabel?: string;
}

/**
 * Put the real Court on the test database.
 *
 * From the recorded supremecourt.gov page, not invented — the whole question
 * this answers is "were these the nine people actually sitting that day", and
 * a made-up bench could not fail.
 */
async function seedTheCourt(): Promise<void> {
  const html = readFileSync(
    new URL("./fixtures/scotus-justices.html", import.meta.url).pathname,
    "utf8",
  );
  // Cleared first, not upserted. resetData() does not touch this table, so a
  // row left by an earlier run would be seeded with whatever the code said
  // THEN — which is how the bench quietly came back in the wrong order.
  await prisma.justice.deleteMany({});
  await prisma.justice.createMany({
    data: parseJusticeRoster(html).map((j) => ({
      name: j.name,
      startDate: j.startDate,
      endDate: j.endDate,
      appointedBy: j.appointedBy,
      // Which table of the Court's page they came from. The bench is listed
      // Chief first, so dropping this reorders every panel.
      isChief: j.isChief,
      // Portraits are filled by a separate pass; the bench must be right
      // whether or not the faces have arrived yet.
      photoUrl: null,
    })),
    skipDuplicates: true,
  });
}

async function record(input: {
  id: string;
  referenceType: string;
  sponsorName?: string | null;
  sponsorPhotoUrl?: string | null;
  sponsorBioguideId?: string | null;
  decidedDate?: Date;
  dissentedBy?: string[];
}): Promise<string> {
  const row = await prisma.governmentReference.create({
    data: {
      id: input.id,
      // Its own master: an unmerged record points at itself.
      masterReferenceId: input.id,
      referenceType: input.referenceType,
      title: `Test ${input.id}`,
      status: "proposed",
      sponsorName: input.sponsorName ?? null,
      sponsorPhotoUrl: input.sponsorPhotoUrl ?? null,
      sponsorBioguideId: input.sponsorBioguideId ?? null,
      decidedDate: input.decidedDate ?? null,
      dissentedBy: input.dissentedBy ?? [],
    },
  });
  return row.id;
}

/** What GET /:id says about a record — the page a reader actually opens. */
async function detailAttribution(id: string): Promise<Attribution | null | undefined> {
  const response = await fetch(`${BASE_URL}/api/government-references/${id}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { reference: { attribution?: Attribution | null } };
  return body.reference.attribution;
}

/** What the list endpoint says about the same record. */
async function listAttribution(id: string): Promise<Attribution | null | undefined> {
  const response = await fetch(`${BASE_URL}/api/government-references?limit=100`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    references: Array<{ id: string; attribution?: Attribution | null }>;
  };
  const found = body.references.find((r) => r.id === id);
  expect(found).toBeTruthy();
  return found!.attribution;
}

describe("an executive order names the President who signed it", () => {
  test("with the portrait we hold, in preference to one stored from the web", async () => {
    const id = await record({
      id: "eo-test-obama",
      referenceType: "executive_order",
      sponsorName: "Barack Obama",
      // What an earlier background pass stored, once, from Wikipedia.
      sponsorPhotoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/obama.jpg",
    });

    const attribution = await detailAttribution(id);
    expect(attribution?.name).toBe("Barack Obama");
    expect(attribution?.role).toBe("Signed by");
    // OUR copy wins. The stored URL sends every reader's browser to Wikimedia,
    // which is the traffic that got this platform rate-limited; the file we
    // hold is the same man and costs an outside request nothing.
    expect(attribution?.photoUrl).toContain("/api/portraits/");

    // The same answer through the list, because a reader can arrive either way.
    expect(await listAttribution(id)).toEqual(attribution!);
  });

  test("every President has a face, including one who left office in 1885", async () => {
    const id = await record({
      id: "eo-test-arthur",
      referenceType: "executive_order",
      sponsorName: "Chester A. Arthur",
    });

    const attribution = await detailAttribution(id);
    expect(attribution?.name).toBe("Chester A. Arthur");
    expect(attribution?.role).toBe("Signed by");
    // The set of people who can ever sign an order is closed and small, and
    // all of them are held, so "we could not find a portrait" is not an answer
    // this path gives for anybody who actually held the office.
    expect(attribution?.photoUrl).toContain("/api/portraits/");
  });

  test("and shows the name alone for somebody who never held the office", async () => {
    const id = await record({
      id: "eo-test-unknown",
      referenceType: "executive_order",
      // Burr was Vice President and never President, so he is not in the list.
      sponsorName: "Aaron Burr",
    });

    const attribution = await detailAttribution(id);
    expect(attribution?.name).toBe("Aaron Burr");
    expect(attribution?.role).toBe("Signed by");
    // Null, not a placeholder standing in for a human being.
    expect(attribution?.photoUrl).toBeNull();
  });
});

describe("a Supreme Court ruling names the justice who wrote the majority", () => {
  test("with their portrait", async () => {
    const id = await record({
      id: "scotus-test-scalia",
      referenceType: "scotus_case",
      sponsorName: "Antonin Scalia",
      sponsorPhotoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/scalia.jpg",
    });

    const attribution = await detailAttribution(id);
    expect(attribution?.name).toBe("Antonin Scalia");
    expect(attribution?.role).toBe("Majority opinion by");
    expect(attribution?.photoUrl).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/scalia.jpg",
    );
    expect(await listAttribution(id)).toEqual(attribution!);
  });

  test("A PER CURIAM DECISION NAMES NO JUSTICE AS ITS AUTHOR", async () => {
    // The Court issuing an opinion as one body. CourtListener returns the
    // string in the same field as a name, and attributing it to somebody would
    // invent a fact about who decided a case.
    const id = await record({
      id: "scotus-test-percuriam",
      referenceType: "scotus_case",
      sponsorName: "Per Curiam",
      // Even with a stored portrait, which could only ever be the wrong face.
      sponsorPhotoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/x/xx/nobody.jpg",
      decidedDate: new Date("1971-06-30T00:00:00Z"),
    });

    const attribution = await detailAttribution(id);
    expect(attribution?.name).toBe("The Supreme Court");
    expect(attribution?.perCuriam).toBe(true);
    // No single face. The stored portrait must not leak through as an author.
    expect(attribution?.photoUrl).toBeNull();
  });

  test("BUT IT NAMES THE BENCH THAT SAT THAT DAY", async () => {
    // "The app is about accountability so not posting the photo is not very
    // fair." A per curiam has no author, and it is still nine people's ruling.
    //
    // 30 June 1971 is New York Times Co. v. United States — the Pentagon
    // Papers, itself per curiam, which is the case this exists for.
    await seedTheCourt();
    const id = await record({
      id: "scotus-test-pentagon-papers",
      referenceType: "scotus_case",
      sponsorName: "Per Curiam",
      decidedDate: new Date("1971-06-30T00:00:00Z"),
    });

    const attribution = await detailAttribution(id);
    const names = (attribution?.panel ?? []).map((p) => p.name);

    expect(names).toEqual([
      "Warren Earl Burger",
      "Hugo Lafayette Black",
      "William Orville Douglas",
      "John Marshall Harlan",
      "William J. Brennan Jr.",
      "Potter Stewart",
      "Byron Raymond White",
      "Thurgood Marshall",
      "Harry A. Blackmun",
    ]);

    // AS IT SAT, not "decided by". Justices dissent from per curiam rulings,
    // and saying these nine agreed would be a claim about individuals that the
    // record does not support.
    expect(attribution?.panelLabel).toBe("The Court as it sat on June 30, 1971");
    expect(attribution?.panelLabel).not.toMatch(/decided by|agreed|joined/i);
  });

  test("A RECORDED DISSENT NARROWS THE ROW TO THE MAJORITY", async () => {
    // The justices who dissented must not appear under a heading that reads as
    // agreement. Black and Douglas both filed in the Pentagon Papers case.
    await seedTheCourt();
    const id = await record({
      id: "scotus-test-narrowed",
      referenceType: "scotus_case",
      sponsorName: "Per Curiam",
      decidedDate: new Date("1971-06-30T00:00:00Z"),
      dissentedBy: ["Burger", "Harlan", "Blackmun"],
    });

    const attribution = await detailAttribution(id);
    const names = (attribution?.panel ?? []).map((p) => p.name);

    expect(names).toHaveLength(6);
    expect(names).not.toContain("Warren Earl Burger");
    expect(names).not.toContain("John Marshall Harlan");
    expect(names).not.toContain("Harry A. Blackmun");
    expect(names).toContain("Hugo Lafayette Black");

    // The label changes with the claim. It may only say "in the majority" when
    // the record actually supports it.
    expect(attribution?.panelLabel).toBe("In the majority on June 30, 1971");

    // AND THEY ARE NOT LISTED ANYWHERE ELSE. The panel answers "who is behind
    // this ruling"; somebody who dissented from it is not, and printing them
    // underneath put two rosters on one page.
    expect(JSON.stringify(attribution)).not.toContain("Burger");
  });

  test("NO RECORDED DISSENT IS NOT UNANIMITY", async () => {
    // Empty could mean none was filed, or none was digitised. Those are
    // indistinguishable, so the card widens back to the whole bench under a
    // label that only claims who SAT — never that they agreed.
    await seedTheCourt();
    const id = await record({
      id: "scotus-test-unrecorded",
      referenceType: "scotus_case",
      sponsorName: "Per Curiam",
      decidedDate: new Date("1971-06-30T00:00:00Z"),
      dissentedBy: [],
    });

    const attribution = await detailAttribution(id);
    expect(attribution?.panel).toHaveLength(9);
    expect(attribution?.panelLabel).toBe("The Court as it sat on June 30, 1971");
    expect(attribution?.panelLabel).not.toMatch(/majority|agreed|decided by/i);
  });

  test("a dissenter we cannot place on the bench does not shrink it", async () => {
    // A name that matches nobody sitting is a data problem, not grounds to
    // remove somebody. The panel stays whole and the label stays modest.
    await seedTheCourt();
    const id = await record({
      id: "scotus-test-unmatched",
      referenceType: "scotus_case",
      sponsorName: "Per Curiam",
      decidedDate: new Date("1971-06-30T00:00:00Z"),
      dissentedBy: ["Cardozo"],
    });

    const attribution = await detailAttribution(id);
    expect(attribution?.panel).toHaveLength(9);
    expect(attribution?.panelLabel).toBe("The Court as it sat on June 30, 1971");
  });

  test("a vacant seat is eight faces, not nine", async () => {
    // Scalia had died and Gorsuch was not yet confirmed. A fixed bench of nine
    // would have put a justice on a ruling they were never there for.
    await seedTheCourt();
    const id = await record({
      id: "scotus-test-vacancy",
      referenceType: "scotus_case",
      sponsorName: "Per Curiam",
      decidedDate: new Date("2016-06-01T00:00:00Z"),
    });

    const attribution = await detailAttribution(id);
    expect(attribution?.panel).toHaveLength(8);
    expect((attribution?.panel ?? []).map((p) => p.name)).not.toContain("Antonin Scalia");
  });

  test("a per curiam with no decision date shows no bench rather than a guessed one", async () => {
    await seedTheCourt();
    const id = await record({
      id: "scotus-test-undated",
      referenceType: "scotus_case",
      sponsorName: "Per Curiam",
    });

    const attribution = await detailAttribution(id);
    expect(attribution?.perCuriam).toBe(true);
    expect(attribution?.panel).toBeUndefined();
  });

  test("the list endpoint carries no bench — a card does not need nine faces", async () => {
    await seedTheCourt();
    const id = await record({
      id: "scotus-test-listcard",
      referenceType: "scotus_case",
      sponsorName: "Per Curiam",
      decidedDate: new Date("1971-06-30T00:00:00Z"),
    });

    // Asking for it there would be one query per row.
    expect((await listAttribution(id))?.panel).toBeUndefined();
  });
});

describe("a bill still names its sponsor, the way it always did", () => {
  test("and points its face at us rather than at congress.gov", async () => {
    const id = await record({
      id: "hr-test-1-119",
      referenceType: "bill",
      sponsorName: "Adam Smith",
      sponsorBioguideId: "S000510",
    });

    const attribution = await detailAttribution(id);
    expect(attribution?.name).toBe("Adam Smith");
    expect(attribution?.role).toBe("Sponsored by");
    expect(attribution?.bioguideId).toBe("S000510");
    // This used to be null, and the client built a congress.gov URL from the
    // bioguide id itself. That is how five sponsors ended up with no face:
    // measured across all 244 people who have sponsored something here, that
    // host has no photograph for four of them and answers a fifth with bytes
    // that are not an image. The address is ours now, and it is the server's to
    // give — there is one place a face comes from, and it is not a guess made
    // in two apps. See routes/portraits.ts.
    expect(attribution?.photoUrl).toEndWith("/api/portraits/S000510.jpg");
  });

  test("and a bill the provenance pass has not reached has no attribution at all", async () => {
    const id = await record({ id: "hr-test-2-119", referenceType: "bill" });

    expect(await detailAttribution(id)).toBeNull();
    expect(await listAttribution(id)).toBeNull();
  });
});
