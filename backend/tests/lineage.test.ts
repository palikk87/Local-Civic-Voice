/**
 * The matchmaker, against congress.gov's real answers.
 *
 * Its entire value is what it refuses to do on its own, and that judgement is
 * only worth anything if it is tested against what the government actually
 * returns. Testing it against JSON I wrote myself would prove that the code
 * agrees with my idea of congress.gov, which is not the thing at risk.
 *
 * So the responses in tests/fixtures/congress/ were recorded from the live API
 * with a real key (scripts/record-lineage-fixtures.ts) and are replayed here.
 * No network, no key, no rate limit, and the same answers every run.
 *
 * Recording them immediately found a bug no amount of reading would have: the
 * API returns "Procedurally related" with no hyphen. The code was matching
 * "Procedurally-related", so every one of those relationships was silently
 * dropped and never reached the review queue — silently, because an
 * unrecognised label is just skipped.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_URL, prisma, resetData, startServer, stopServer } from "./helpers/server";
import {
  CandidateStatus,
  LOOK_ALIKE,
  Relationship,
  syncLineageFor,
} from "../src/services/reference-lineage";

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "congress");

function fixture(masterReferenceId: string): unknown {
  const raw = readFileSync(join(FIXTURE_DIR, `relatedbills-${masterReferenceId}.json`), "utf8");
  return (JSON.parse(raw) as { body: unknown }).body;
}

/**
 * Serve the recorded responses instead of calling congress.gov.
 *
 * Deliberately a stub at the network boundary rather than an injected client:
 * everything above it — the URL that gets built, the JSON that gets parsed, the
 * labels that get compared — is real code running against real bytes. A fake
 * inserted higher up would skip exactly the parts that were wrong.
 */
const realFetch = globalThis.fetch;

function serveFixtures(): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    const match = /api\.congress\.gov\/v3\/bill\/(\d+)\/([a-z]+)\/(\d+)\/relatedbills/.exec(url);
    if (match) {
      const id = `${match[2]}-${match[3]}-${match[1]}`;
      try {
        return new Response(JSON.stringify(fixture(id)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        // Nothing recorded for this bill: the same answer congress.gov gives
        // for a bill with no published lineage, which 7 of 13 stored bills
        // have.
        return new Response(JSON.stringify({ relatedBills: [] }), { status: 200 });
      }
    }

    return realFetch(input, init);
  }) as typeof fetch;
}

/** A stored record, registered the way every writer in the app registers one. */
async function record(masterReferenceId: string, title: string) {
  const row = await prisma.governmentReference.create({
    data: { masterReferenceId, referenceType: "bill", title, status: "proposed" },
  });
  await prisma.referenceName.create({
    data: { name: masterReferenceId, referenceId: row.id, isCurrent: true, learnedFrom: "created" },
  });
  return row;
}

async function candidateFor(aId: string, bId: string) {
  const [leftId, rightId] = aId < bId ? [aId, bId] : [bId, aId];
  return prisma.referenceMergeCandidate.findUnique({ where: { leftId_rightId: { leftId, rightId } } });
}

beforeAll(async () => {
  // The server is not what these tests drive — they call the service directly —
  // but starting it applies the migrations and is what makes the harness point
  // this process at the same database.
  await startServer();
  process.env.CONGRESS_API_KEY ??= "recorded-fixtures-no-real-key-needed";
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await stopServer();
});

beforeEach(async () => {
  await resetData();
  serveFixtures();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("what the government actually says", () => {
  test("the recorded responses carry the labels this code depends on", async () => {
    // Pinning the shape of the real API. If congress.gov renames a label, this
    // is the test that says so — rather than the review queue quietly emptying
    // and nobody noticing for a month.
    const labels = new Set<string>();
    for (const id of ["hr-3194-119", "hr-7744-119", "hr-1-119"]) {
      const body = fixture(id) as {
        relatedBills: Array<{ relationshipDetails?: Array<{ type?: string }> }>;
      };
      for (const bill of body.relatedBills) {
        for (const detail of bill.relationshipDetails ?? []) {
          if (detail.type) labels.add(detail.type);
        }
      }
    }

    expect([...labels].sort()).toEqual([
      "Identical bill",
      "Procedurally related",
      "Public law contains the text",
      "Related bill",
    ]);
    // The exact string the code compares against. It had a hyphen and matched
    // nothing.
    expect(labels.has(Relationship.PROCEDURAL)).toBe(true);
  });
});

describe("congress.gov lineage, replayed", () => {
  test("an Identical bill merges on its own, with the analyst named", async () => {
    // The LOCOMOTIVES Act: CRS records hr-3194-119 and s-1779-119 as identical
    // from both directions. That label means a Library of Congress analyst read
    // both texts, which is the only evidence in this system strong enough to
    // join two records without a person.
    const house = await record("hr-3194-119", "LOCOMOTIVES Act of 2025");
    const senate = await record("s-1779-119", "LOCOMOTIVES Act of 2025");

    const result = await syncLineageFor(house.id);
    expect(result.merged).toBe(1);

    // One of them is now a tombstone pointing at the other, and nothing is left
    // splitting the count.
    const [a, b] = await Promise.all([
      prisma.governmentReference.findUniqueOrThrow({ where: { id: house.id } }),
      prisma.governmentReference.findUniqueOrThrow({ where: { id: senate.id } }),
    ]);
    const survivors = [a, b].filter((r) => r.mergedIntoId === null);
    expect(survivors.length).toBe(1);
    expect([a.mergedIntoId, b.mergedIntoId].filter(Boolean)).toEqual([survivors[0]!.id]);

    // The decision is on the record with its evidence, so an admin opening the
    // queue later can see what merged these and who said so.
    const decided = await candidateFor(house.id, senate.id);
    expect(decided).not.toBeNull();
    expect(decided!.status).toBe(CandidateStatus.APPROVED);
    expect(decided!.relationship).toBe(Relationship.IDENTICAL);
    expect(decided!.identifiedBy).toBe("CRS");
    expect(decided!.evidenceUrl).toContain("congress.gov");
    expect(decided!.note).toContain("identified by CRS");
    // Nobody approved it, because nobody had to.
    expect(decided!.decidedById).toBeNull();
  });

  test("the auto-merge is the same either way round", async () => {
    // CRS publishes the relationship on both bills. Running the sweep from the
    // Senate side has to reach the same conclusion, or which record survives
    // would depend on which one the sweep happened to reach first.
    const house = await record("hr-3194-119", "LOCOMOTIVES Act of 2025");
    const senate = await record("s-1779-119", "LOCOMOTIVES Act of 2025");

    const result = await syncLineageFor(senate.id);
    expect(result.merged).toBe(1);

    const decided = await candidateFor(house.id, senate.id);
    expect(decided!.status).toBe(CandidateStatus.APPROVED);
  });

  test("a Related bill is never a candidate, however many there are", async () => {
    // The single most important refusal in the system. Related means a
    // different law on the same subject — merging those destroys two real
    // positions to manufacture one false one. DHS appropriations publishes
    // seven of them and not one Identical.
    const dhs = await record("hr-7744-119", "Department of Homeland Security Appropriations Act");
    const related = await record("hr-4213-119", "A different homeland security bill");

    const result = await syncLineageFor(dhs.id);
    expect(result.merged).toBe(0);

    expect(await candidateFor(dhs.id, related.id)).toBeNull();
    expect(
      await prisma.governmentReference.findUniqueOrThrow({ where: { id: related.id } }),
    ).toMatchObject({ mergedIntoId: null });
  });

  test("a Procedurally related bill goes to the queue, not to a merge", async () => {
    // The relationship that was silently dropped until the fixtures were
    // recorded, because the code spelled it with a hyphen and the API does not.
    const dhs = await record("hr-7744-119", "Department of Homeland Security Appropriations Act");
    const rule = await record("hres-1095-119", "Providing for consideration of H.R. 7744");

    const result = await syncLineageFor(dhs.id);
    expect(result.merged).toBe(0);
    expect(result.queued).toBe(1);

    const queued = await candidateFor(dhs.id, rule.id);
    expect(queued).not.toBeNull();
    expect(queued!.status).toBe(CandidateStatus.PENDING);
    expect(queued!.relationship).toBe(Relationship.PROCEDURAL);
    expect(queued!.identifiedBy).toBe("House");
    // Not a guess this platform made up.
    expect(queued!.relationship).not.toBe(LOOK_ALIKE);
    // And both records are still standing, untouched.
    expect(
      await prisma.governmentReference.findUniqueOrThrow({ where: { id: rule.id } }),
    ).toMatchObject({ mergedIntoId: null });
  });

  test("a bill whose text was enacted inside a public law goes to the queue", async () => {
    // "Public law contains the text" — the same words, carrying the same legal
    // force, in a different vehicle. That is exactly the call a person should
    // make and a machine should not.
    const hr1 = await record("hr-1-119", "One Big Beautiful Bill Act");
    const absorbed = await record("hr-1403-119", "A bill whose text was enacted inside H.R. 1");

    const result = await syncLineageFor(hr1.id);
    expect(result.merged).toBe(0);

    const queued = await candidateFor(hr1.id, absorbed.id);
    expect(queued).not.toBeNull();
    expect(queued!.status).toBe(CandidateStatus.PENDING);
    // This bill carries BOTH "Related bill" and "Public law contains the text".
    // The stronger one has to win, or the pair is thrown away on the weaker.
    expect(queued!.relationship).toBe(Relationship.ENACTED_INSIDE);
  });

  test("a bill nobody here has stored is left where it is", async () => {
    // hr-1-119 publishes thirty-four relationships. Pulling them all in would
    // fill the database with laws nobody asked about, and a bill nobody on this
    // platform has shared is not splitting anybody's vote.
    const hr1 = await record("hr-1-119", "One Big Beautiful Bill Act");
    const result = await syncLineageFor(hr1.id);

    // Named, not counted.
    //
    // This asserted a global row count, which any writer anywhere can break —
    // and one did: the test server enqueues a government sync at boot, the
    // Federal Register needs no key, and a real executive order landing in the
    // database mid-assertion failed a test about congress.gov lineage. Green
    // locally, red in CI, for a reason with nothing to do with the claim.
    //
    // The claim is about these bills: hr-1-119 publishes thirty-four
    // relationships and none of them may become a record here.
    const related = await prisma.governmentReference.findMany({
      where: { referenceType: "bill" },
      select: { masterReferenceId: true },
    });
    expect(related.map((r) => r.masterReferenceId)).toEqual(["hr-1-119"]);

    expect(result.merged).toBe(0);
    expect(result.queued).toBe(0);
    expect(await prisma.referenceMergeCandidate.count()).toBe(0);
  });

  test("a bill with no published lineage is reported, not treated as a failure", async () => {
    // 7 of 13 stored bills have none. That is a fact about the government's
    // records, and it is why the look-alike suggestion list exists at all.
    const orphan = await record("hr-9999-119", "A bill congress.gov links to nothing");

    const result = await syncLineageFor(orphan.id);
    expect(result).toMatchObject({ checked: 1, merged: 0, queued: 0, noLineage: 1, skipped: 0 });
  });

  test("a record already merged elsewhere is skipped", async () => {
    const house = await record("hr-3194-119", "LOCOMOTIVES Act of 2025");
    const senate = await record("s-1779-119", "LOCOMOTIVES Act of 2025");
    await syncLineageFor(house.id);

    // Whichever became the tombstone must not be swept again — it is not its
    // own record any more.
    const tombstone = await prisma.governmentReference.findFirstOrThrow({
      where: { mergedIntoId: { not: null } },
    });
    expect(await syncLineageFor(tombstone.id)).toMatchObject({ skipped: 1, merged: 0 });
  });

  test("running the sweep twice merges once and queues once", async () => {
    // The sweep runs nightly. A pair it already handled must not be re-merged,
    // re-queued, or put back in front of a reviewer who has moved on.
    const dhs = await record("hr-7744-119", "Department of Homeland Security Appropriations Act");
    await record("hres-1095-119", "Providing for consideration of H.R. 7744");
    const house = await record("hr-3194-119", "LOCOMOTIVES Act of 2025");
    await record("s-1779-119", "LOCOMOTIVES Act of 2025");

    await syncLineageFor(house.id);
    await syncLineageFor(dhs.id);
    const afterFirst = await prisma.referenceMergeCandidate.count();

    await syncLineageFor(house.id);
    await syncLineageFor(dhs.id);

    expect(await prisma.referenceMergeCandidate.count()).toBe(afterFirst);
    expect(
      await prisma.governmentReference.count({ where: { mergedIntoId: { not: null } } }),
    ).toBe(1);
  });
});
