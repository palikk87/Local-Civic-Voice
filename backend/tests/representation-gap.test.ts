/**
 * "The people here said 73% oppose. The House passed it 218-210."
 *
 * The most compelling sentence this product can say, and it could not say it:
 * nothing stored a roll call, `officialVotes` was set by nothing, and the
 * PulseGap component had never rendered for a real record.
 *
 * IT WAS NEVER BLOCKED ON AN API KEY. It was written up as needing a
 * congress.gov key this environment does not have. Both chambers publish every
 * roll call themselves as unauthenticated XML, and the fixtures below are
 * exactly those documents, recorded from senate.gov and clerk.house.gov and
 * replayed offline — the same rule the rest of this suite follows.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASE_URL,
  prisma,
  resetData,
  freshClientHeaders,
  signUp,
  startServer,
  stopServer,
} from "./helpers/server";
import {
  parseHouseRollCall,
  parseSenateRollCall,
  parseSenateMenu,
  referenceIdFromLegisNumber,
  storeRollCall,
  senateRollCallUrl,
  houseRollCallUrl,
  fetchSenateRollCall,
  fetchHouseRollCall,
  fetchSenateMenu,
} from "../src/services/roll-call";

const FIXTURES = join(import.meta.dir, "fixtures", "rollcall");
const senateXml = readFileSync(join(FIXTURES, "senate-119-1-00654.xml"), "utf8");
const houseXml = readFileSync(join(FIXTURES, "house-2025-roll300.xml"), "utf8");
const menuXml = readFileSync(join(FIXTURES, "senate-menu-119-1.xml"), "utf8");

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
  await prisma.rollCallMemberVote.deleteMany();
  await prisma.rollCall.deleteMany();
});

let seq = 0;
async function citizen() {
  seq += 1;
  return signUp({
    email: `gap${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `Gap ${seq}`,
  });
}

async function law(masterReferenceId: string, title: string) {
  return prisma.governmentReference.create({
    data: {
      masterReferenceId,
      referenceType: "bill",
      title,
      status: "proposed",
      category: "healthcare",
    },
  });
}

/** The Pulse, set the way applyWeightedTally sets it. */
async function pulse(referenceId: string, support: number, oppose: number) {
  await prisma.governmentReference.update({
    where: { id: referenceId },
    data: { supportVotes: support, opposeVotes: oppose },
  });
}

async function gap(referenceId: string) {
  const response = await fetch(
    `${BASE_URL}/api/government-references/${referenceId}/representation-gap`,
    { headers: freshClientHeaders({}) },
  );
  return {
    status: response.status,
    body: (await response.json()) as {
      gap: {
        publicSupportPct: number;
        officialSupportPct: number;
        gapPct: number;
        opposite: boolean;
        officialYea: number;
        officialNay: number;
        chamber: string;
        sourceUrl: string;
      } | null;
    },
  };
}

describe("reading what the chambers publish", () => {
  test("a real Senate roll call parses, members and all", () => {
    const parsed = parseSenateRollCall(senateXml, "https://example.invalid");

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      chamber: "senate",
      congress: 119,
      session: 1,
      rollNumber: 654,
      yea: 50,
      nay: 50,
      masterReferenceId: "sjres-82-119",
    });
    // A full chamber, and the official member id that makes "how did MY
    // senator vote" answerable.
    expect(parsed!.members).toHaveLength(100);
    expect(parsed!.members[0]).toMatchObject({
      memberId: "S428",
      lastName: "Alsobrooks",
      party: "D",
      state: "MD",
      voteCast: "Yea",
    });
    expect(parsed!.votedAt.getUTCFullYear()).toBe(2025);
  });

  test("a real House roll call parses, members and all", () => {
    const parsed = parseHouseRollCall(houseXml, "https://example.invalid");

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      chamber: "house",
      congress: 119,
      rollNumber: 300,
      yea: 380,
      nay: 45,
      notVoting: 8,
      masterReferenceId: "hr-4058-119",
      result: "Passed",
    });
    expect(parsed!.members).toHaveLength(433);
    expect(parsed!.members[0]).toMatchObject({
      memberId: "A000370",
      lastName: "Adams",
      party: "D",
      state: "NC",
      voteCast: "Yea",
    });
  });

  test("every spelling the two chambers use lands on one id", () => {
    expect(referenceIdFromLegisNumber("H R 4058", 119)).toBe("hr-4058-119");
    expect(referenceIdFromLegisNumber("S. J. Res. 82", 119)).toBe("sjres-82-119");
    expect(referenceIdFromLegisNumber("H.RES. 12", 119)).toBe("hres-12-119");
    expect(referenceIdFromLegisNumber("S. 1071", 119)).toBe("s-1071-119");
  });

  test("a nomination or a motion is not a measure, and says so", () => {
    // The Senate votes on nominations constantly. There is no bill record to
    // hang a gap on, and guessing one would attach the government's vote to
    // the wrong thing.
    expect(referenceIdFromLegisNumber("PN373", 119)).toBeNull();
    expect(referenceIdFromLegisNumber("PN615-2", 119)).toBeNull();
    expect(referenceIdFromLegisNumber("", 119)).toBeNull();
    expect(referenceIdFromLegisNumber(null, 119)).toBeNull();
  });

  test("the Senate's own index separates measures from nominations", () => {
    const entries = parseSenateMenu(menuXml, 119);

    expect(entries.length).toBeGreaterThan(0);
    const measures = entries.filter((e) => e.masterReferenceId !== null);
    const nominations = entries.filter((e) => e.masterReferenceId === null);
    expect(measures.length).toBeGreaterThan(0);
    expect(nominations.length).toBeGreaterThan(0);
    expect(nominations.every((e) => !/^(H|S)[\s.]/.test(e.issue))).toBe(true);
  });

  test("rubbish in gets null, not a half-built roll call", () => {
    expect(parseSenateRollCall("<html>not xml</html>", "u")).toBeNull();
    expect(parseHouseRollCall("<html>not xml</html>", "u")).toBeNull();
    expect(parseSenateRollCall("", "u")).toBeNull();
  });

  test("the URLs match what the chambers actually serve", () => {
    // Verified against live responses when these fixtures were recorded.
    expect(senateRollCallUrl(119, 1, 654, "https://www.senate.gov")).toBe(
      "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00654.xml",
    );
    expect(houseRollCallUrl(2025, 300, "https://clerk.house.gov")).toBe("https://clerk.house.gov/evs/2025/roll300.xml");
  });
});

describe("storing a roll call against the record it belongs to", () => {
  test("it links to the bill by its canonical id", async () => {
    const bill = await law("hr-4058-119", "Enhancing Stakeholder Support Act");
    const parsed = parseHouseRollCall(houseXml, houseRollCallUrl(2025, 300))!;

    const stored = await storeRollCall(parsed, prisma);
    expect(stored.linked).toBe(true);

    const row = await prisma.rollCall.findUniqueOrThrow({ where: { id: stored.id } });
    expect(row.governmentReferenceId).toBe(bill.id);
    expect(row.yea).toBe(380);
    // Traceable to an official page, always.
    expect(row.sourceUrl).toContain("clerk.house.gov");

    expect(await prisma.rollCallMemberVote.count({ where: { rollCallId: stored.id } })).toBe(433);
  });

  test("a re-sync corrects the record instead of duplicating it", async () => {
    await law("hr-4058-119", "Enhancing Stakeholder Support Act");
    const parsed = parseHouseRollCall(houseXml, houseRollCallUrl(2025, 300))!;

    await storeRollCall(parsed, prisma);
    // The chambers do correct their own records — the Senate document even
    // carries a modify_date for it.
    await storeRollCall({ ...parsed, yea: 381, nay: 44 }, prisma);

    const rows = await prisma.rollCall.findMany({ where: { rollNumber: 300 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.yea).toBe(381);
    expect(await prisma.rollCallMemberVote.count({ where: { rollCallId: rows[0]!.id } })).toBe(433);
  });

  test("a roll call for a bill this platform has never heard of is kept, unlinked", async () => {
    const parsed = parseHouseRollCall(houseXml, houseRollCallUrl(2025, 300))!;

    const stored = await storeRollCall(parsed, prisma);
    expect(stored.linked).toBe(false);

    // Kept anyway: the record may be created later, and the government's own
    // vote is worth having either way.
    const row = await prisma.rollCall.findUniqueOrThrow({ where: { id: stored.id } });
    expect(row.masterReferenceId).toBe("hr-4058-119");
    expect(row.governmentReferenceId).toBeNull();
  });
});

describe("the gap itself", () => {
  test("it reports both halves and the distance between them", async () => {
    const bill = await law("hr-4058-119", "Enhancing Stakeholder Support Act");
    await pulse(bill.id, 20, 80); // 20% support here.
    await storeRollCall(parseHouseRollCall(houseXml, houseRollCallUrl(2025, 300))!, prisma);

    const { status, body } = await gap(bill.id);
    expect(status).toBe(200);

    // 380 yea / 425 cast = 89% official, against 20% here.
    expect(body.gap).toMatchObject({
      publicSupportPct: 20,
      officialSupportPct: 89,
      gapPct: 69,
      opposite: true,
      officialYea: 380,
      officialNay: 45,
      chamber: "house",
    });
    expect(body.gap!.sourceUrl).toContain("clerk.house.gov");
  });

  test("agreement is not a gap, and is not reported as one", async () => {
    const bill = await law("hr-4058-119", "Enhancing Stakeholder Support Act");
    await pulse(bill.id, 90, 10);
    await storeRollCall(parseHouseRollCall(houseXml, houseRollCallUrl(2025, 300))!, prisma);

    const { body } = await gap(bill.id);
    expect(body.gap!.opposite).toBe(false);
    expect(body.gap!.gapPct).toBeLessThan(5);
  });

  test("no roll call means no gap, not a zero", async () => {
    const bill = await law("hr-9999-119", "A bill Congress has not voted on");
    await pulse(bill.id, 70, 30);

    const { status, body } = await gap(bill.id);
    expect(status).toBe(200);
    // Null, so the panel stays hidden. An absent feature beats an invented
    // number.
    expect(body.gap).toBeNull();
  });

  test("a handful of voices here is not a public, and does not get a headline", async () => {
    const bill = await law("hr-4058-119", "Enhancing Stakeholder Support Act");
    await pulse(bill.id, 2, 1);
    await storeRollCall(parseHouseRollCall(houseXml, houseRollCallUrl(2025, 300))!, prisma);

    expect((await gap(bill.id)).body.gap).toBeNull();
  });

  test("the latest roll call is the one compared against", async () => {
    const bill = await law("hr-4058-119", "Enhancing Stakeholder Support Act");
    await pulse(bill.id, 50, 50);

    const parsed = parseHouseRollCall(houseXml, houseRollCallUrl(2025, 300))!;
    // An earlier procedural vote that went the other way.
    await storeRollCall(
      { ...parsed, rollNumber: 299, yea: 10, nay: 400, votedAt: new Date("2025-01-01") },
      prisma,
    );
    await storeRollCall(parsed, prisma);

    // A bill is voted on many times. The honest comparison is where the
    // chamber last stood, not whichever roll call flatters the gap.
    expect((await gap(bill.id)).body.gap!.officialYea).toBe(380);
  });

  test("a made-up record is a 404", async () => {
    const response = await fetch(
      `${BASE_URL}/api/government-references/not-a-record/representation-gap`,
      { headers: freshClientHeaders({}) },
    );
    expect(response.status).toBe(404);
  });
});

describe("how each member voted", () => {
  test("the whole chamber comes back, ordered the way the chamber prints it", async () => {
    const bill = await law("hr-4058-119", "Enhancing Stakeholder Support Act");
    await storeRollCall(parseHouseRollCall(houseXml, houseRollCallUrl(2025, 300))!, prisma);

    const response = await fetch(
      `${BASE_URL}/api/government-references/${bill.id}/official-vote`,
      { headers: freshClientHeaders({}) },
    );
    const body = (await response.json()) as {
      roll: { members: { state: string; voteCast: string; memberId: string }[] } | null;
    };

    expect(body.roll!.members).toHaveLength(433);
    const states = body.roll!.members.map((m) => m.state);
    expect([...states].sort()).toEqual(states);
    expect(body.roll!.members.every((m) => m.memberId.length > 0)).toBe(true);
  });

  test("no roll call means no list, not an empty one", async () => {
    const bill = await law("hr-9999-119", "A bill Congress has not voted on");

    const response = await fetch(
      `${BASE_URL}/api/government-references/${bill.id}/official-vote`,
      { headers: freshClientHeaders({}) },
    );
    expect(((await response.json()) as { roll: unknown }).roll).toBeNull();
  });

  test("a citizen can read the gap without an account", async () => {
    // The government's own vote is the public's business. Constitution Article
    // III, Section 1 — publicly auditable — and there is nothing to protect
    // here anyway.
    const bill = await law("hr-4058-119", "Enhancing Stakeholder Support Act");
    await pulse(bill.id, 20, 80);
    await storeRollCall(parseHouseRollCall(houseXml, houseRollCallUrl(2025, 300))!, prisma);

    await citizen(); // Somebody exists; the reader is not them.
    const { status, body } = await gap(bill.id);
    expect(status).toBe(200);
    expect(body.gap).not.toBeNull();
  });
});

/**
 * The fetch path itself, run against a local server replaying the recorded
 * documents.
 *
 * The parsers above are proven against the real XML, but a parser nothing
 * calls is not a feature. This runs fetchSenateRollCall / fetchHouseRollCall /
 * fetchSenateMenu for real — the same functions the sync script uses, over
 * actual HTTP — with only the hostname pointed somewhere reproducible. Hitting
 * senate.gov from a test suite would be a flake waiting to happen, and would
 * make a green run depend on the Senate's uptime.
 */
describe("fetching from the chambers", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let origin = "";

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const { pathname } = new URL(request.url);
        // The real paths, so a typo in a URL builder fails here.
        if (pathname === "/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00654.xml") {
          return new Response(senateXml, { headers: { "content-type": "application/xml" } });
        }
        if (pathname === "/legislative/LIS/roll_call_lists/vote_menu_119_1.xml") {
          return new Response(menuXml, { headers: { "content-type": "application/xml" } });
        }
        if (pathname === "/evs/2025/roll300.xml") {
          return new Response(houseXml, { headers: { "content-type": "application/xml" } });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    origin = `http://127.0.0.1:${server.port}`;
    process.env.SENATE_ORIGIN = origin;
    process.env.HOUSE_ORIGIN = origin;
  });

  afterAll(() => {
    server?.stop(true);
    delete process.env.SENATE_ORIGIN;
    delete process.env.HOUSE_ORIGIN;
  });

  test("a Senate roll call is fetched, parsed and stored in one pass", async () => {
    const bill = await law("sjres-82-119", "A joint resolution on the APA rule");

    const parsed = await fetchSenateRollCall(119, 1, 654, origin);
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({ chamber: "senate", yea: 50, nay: 50 });

    const stored = await storeRollCall(parsed!, prisma);
    expect(stored.linked).toBe(true);

    const row = await prisma.rollCall.findUniqueOrThrow({ where: { id: stored.id } });
    expect(row.governmentReferenceId).toBe(bill.id);
    expect(await prisma.rollCallMemberVote.count({ where: { rollCallId: stored.id } })).toBe(100);
  });

  test("a House roll call is fetched, parsed and stored in one pass", async () => {
    const bill = await law("hr-4058-119", "Enhancing Stakeholder Support Act");

    const parsed = await fetchHouseRollCall(2025, 300, origin);
    expect(parsed).not.toBeNull();

    const stored = await storeRollCall(parsed!, prisma);
    expect(stored.linked).toBe(true);
    expect(
      (await prisma.rollCall.findUniqueOrThrow({ where: { id: stored.id } })).governmentReferenceId,
    ).toBe(bill.id);
  });

  test("the Senate index is fetched and split into measures and nominations", async () => {
    const entries = await fetchSenateMenu(119, 1, origin);

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.masterReferenceId !== null)).toBe(true);
    expect(entries.some((e) => e.masterReferenceId === null)).toBe(true);
  });

  test("a roll call the chamber does not serve is null, not a crash", async () => {
    // The sync walks roll numbers until the clerk stops answering; a 404 has
    // to be an ordinary end-of-list rather than an exception.
    expect(await fetchHouseRollCall(2025, 9999, origin)).toBeNull();
    expect(await fetchSenateRollCall(119, 1, 9999, origin)).toBeNull();
    expect(await fetchSenateMenu(999, 9, origin)).toEqual([]);
  });
});
