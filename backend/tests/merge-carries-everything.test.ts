/**
 * One law, one record, one number — including everything built after the merge
 * was written.
 *
 * THE MERGE IS A LIST THAT HAS TO BE MAINTAINED BY HAND, and that is the flaw
 * this file exists to cover. `mergeReferences` moves votes, posts, merge
 * chains and names, because those were the tables that existed when it was
 * written. Two more have been added since — the position ledger and the
 * congressional roll calls — and neither was in the list.
 *
 * The symptom is quiet and bad: after two records are merged, a citizen's own
 * history on the losing record stops appearing anywhere, and the Representation
 * Gap disappears from the surviving record because the government's vote is
 * still attached to a tombstone. Nothing errors. The numbers just get smaller.
 *
 * The last test is the one that matters most: it reads the schema and fails if
 * ANY table keyed on a record is neither carried by the merge nor explicitly
 * declared exempt. It is the reason the next table cannot be forgotten.
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
import { mergeReferences } from "../src/services/deduplication-service";
import { parseHouseRollCall, storeRollCall, houseRollCallUrl } from "../src/services/roll-call";

const houseXml = readFileSync(
  join(import.meta.dir, "fixtures", "rollcall", "house-2025-roll300.xml"),
  "utf8",
);

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
    email: `merge${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `Merge ${seq}`,
  });
}

let refCounter = 0;
async function law(masterReferenceId?: string) {
  refCounter += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: masterReferenceId ?? `hr-${6400 + refCounter}-119`,
      referenceType: "bill",
      title: `A bill numbered ${6400 + refCounter}`,
      status: "proposed",
      category: "healthcare",
    },
  });
}

function vote(cookie: string, referenceId: string, position: string, reason?: string) {
  return fetch(`${BASE_URL}/api/government-references/${referenceId}/vote`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify(reason ? { position, reason } : { position }),
  });
}

/** The ledger is written after the vote responds, so wait for it. */
async function ledgerSettled(referenceId: string, expected: number) {
  const deadline = Date.now() + 5_000;
  let count = await prisma.positionEvent.count({ where: { governmentReferenceId: referenceId } });
  while (count < expected && Date.now() < deadline) {
    await Bun.sleep(100);
    count = await prisma.positionEvent.count({ where: { governmentReferenceId: referenceId } });
  }
  return count;
}

describe("a merge carries the position ledger", () => {
  test("a citizen's record follows the law, not the tombstone", async () => {
    const person = await citizen();
    const duplicate = await law();
    const survivor = await law();

    await vote(person.cookie, duplicate.id, "support", "The cap is the whole bill.");
    await vote(person.cookie, duplicate.id, "oppose", "They stripped the cap out.");
    expect(await ledgerSettled(duplicate.id, 2)).toBe(2);

    await mergeReferences(duplicate.id, survivor.id);

    // Everything they ever said about this law, on the record that survived.
    const moved = await prisma.positionEvent.findMany({
      where: { governmentReferenceId: survivor.id },
      orderBy: { createdAt: "asc" },
    });
    expect(moved).toHaveLength(2);
    expect(moved.map((e) => e.reason)).toEqual([
      "The cap is the whole bill.",
      "They stripped the cap out.",
    ]);
    expect(
      await prisma.positionEvent.count({ where: { governmentReferenceId: duplicate.id } }),
    ).toBe(0);
  });

  test("the change of mind still shows on the surviving record", async () => {
    const person = await citizen();
    const duplicate = await law();
    const survivor = await law();

    await vote(person.cookie, duplicate.id, "support");
    await vote(person.cookie, duplicate.id, "oppose");
    await ledgerSettled(duplicate.id, 2);

    await mergeReferences(duplicate.id, survivor.id);

    // "Who changed their mind" reads the ledger by record id. Before this
    // fix the crossing was stranded on the tombstone and the panel went quiet.
    const response = await fetch(
      `${BASE_URL}/api/government-references/${survivor.id}/turning-points`,
      { headers: freshClientHeaders({}) },
    );
    const body = (await response.json()) as { total: number; people: number };
    expect(body.total).toBe(1);
    expect(body.people).toBe(1);
  });

  test("their own record page still shows the position afterwards", async () => {
    const person = await citizen();
    const duplicate = await law();
    const survivor = await law();

    await vote(person.cookie, duplicate.id, "support");
    await ledgerSettled(duplicate.id, 1);

    await mergeReferences(duplicate.id, survivor.id);

    const response = await fetch(`${BASE_URL}/api/users/${person.userId}/positions`, {
      headers: freshClientHeaders({ cookie: person.cookie }),
    });
    const body = (await response.json()) as {
      results: { reference: { id: string } }[];
      summary: { total: number };
    };

    // Still one position, now pointing at the law that survived.
    expect(body.summary.total).toBe(1);
    expect(body.results[0]!.reference.id).toBe(survivor.id);
  });
});

describe("a merge carries the government's own vote", () => {
  test("the roll call follows the law, so the gap survives", async () => {
    const duplicate = await law("hr-4058-119");
    const survivor = await law("hr-9100-119");

    const parsed = parseHouseRollCall(houseXml, houseRollCallUrl(2025, 300))!;
    const stored = await storeRollCall(parsed, prisma);
    expect(
      (await prisma.rollCall.findUniqueOrThrow({ where: { id: stored.id } }))
        .governmentReferenceId,
    ).toBe(duplicate.id);

    // Enough real voices for a gap to be reportable at all.
    //
    // Actual vote rows, not a written-in tally: the merge recomputes the
    // published numbers from the votes that exist, which is exactly the
    // behaviour that stops a merge inventing support. A faked tally is wiped
    // by it, and rightly.
    for (let i = 0; i < 12; i += 1) {
      const voter = await citizen();
      await prisma.governmentReferenceVote.create({
        data: {
          governmentReferenceId: survivor.id,
          userId: voter.userId,
          position: i < 3 ? "support" : "oppose",
        },
      });
    }

    await mergeReferences(duplicate.id, survivor.id);

    const response = await fetch(
      `${BASE_URL}/api/government-references/${survivor.id}/representation-gap`,
      { headers: freshClientHeaders({}) },
    );
    const body = (await response.json()) as { gap: { officialYea: number } | null };

    // Without the fix this is null: the government's vote was left attached to
    // a record nothing points at any more.
    expect(body.gap).not.toBeNull();
    expect(body.gap!.officialYea).toBe(380);
  });

  test("member-level votes come with it", async () => {
    const duplicate = await law("hr-4058-119");
    const survivor = await law("hr-9100-119");

    await storeRollCall(parseHouseRollCall(houseXml, houseRollCallUrl(2025, 300))!, prisma);
    await mergeReferences(duplicate.id, survivor.id);

    const response = await fetch(
      `${BASE_URL}/api/government-references/${survivor.id}/official-vote`,
      { headers: freshClientHeaders({}) },
    );
    const body = (await response.json()) as { roll: { members: unknown[] } | null };
    expect(body.roll!.members).toHaveLength(433);
  });
});

describe("the Article V reset journal comes with it", () => {
  test("a journaled vote moves to the survivor, so undoing a reset restores it there", async () => {
    const duplicate = await law();
    const survivor = await law();
    const person = await citizen();

    const reset = await prisma.systemReset.create({
      data: {
        filedById: person.userId,
        status: "executed",
        grounds: "Grounds long enough to be a real filing rather than a placeholder string.",
        evidence: "Evidence long enough to be a real filing rather than a placeholder string.",
        expiresAt: new Date(),
        eligibleCount: 1,
        executedAt: new Date(),
      },
    });

    const journaled = await prisma.systemResetJournalVote.create({
      data: {
        resetId: reset.id,
        governmentReferenceId: duplicate.id,
        userId: person.userId,
        position: "support",
        isAnonymous: false,
        castAt: new Date(),
      },
    });

    await mergeReferences(duplicate.id, survivor.id);

    // Left behind, undoing the reset would put this position back on a
    // tombstone: a vote that exists and appears in no tally anywhere.
    expect(
      (
        await prisma.systemResetJournalVote.findUniqueOrThrow({
          where: { id: journaled.id },
        })
      ).governmentReferenceId,
    ).toBe(survivor.id);

    await prisma.systemReset.delete({ where: { id: reset.id } });
  });

  test("a person who was journaled on both keeps a row for each", async () => {
    // The key is (reset, record, voter). Moving both would break it, and
    // deleting one would make the undo lossy — so the duplicate stays put.
    const duplicate = await law();
    const survivor = await law();
    const person = await citizen();

    const reset = await prisma.systemReset.create({
      data: {
        filedById: person.userId,
        status: "executed",
        grounds: "Grounds long enough to be a real filing rather than a placeholder string.",
        evidence: "Evidence long enough to be a real filing rather than a placeholder string.",
        expiresAt: new Date(),
        eligibleCount: 1,
        executedAt: new Date(),
      },
    });

    for (const referenceId of [duplicate.id, survivor.id]) {
      await prisma.systemResetJournalVote.create({
        data: {
          resetId: reset.id,
          governmentReferenceId: referenceId,
          userId: person.userId,
          position: "support",
          isAnonymous: false,
          castAt: new Date(),
        },
      });
    }

    // Merging must not throw on the unique key, and must not lose a row.
    await mergeReferences(duplicate.id, survivor.id);

    expect(
      await prisma.systemResetJournalVote.count({ where: { resetId: reset.id } }),
    ).toBe(2);

    await prisma.systemReset.delete({ where: { id: reset.id } });
  });
});

describe("the guard that stops the next table being forgotten", () => {
  test("every table keyed on a record is either carried by the merge or declared exempt", () => {
    // THIS IS THE POINT OF THE FILE. The merge is a hand-maintained list, and
    // two tables were added after it was written without being added to it.
    // Reading the schema means the third one cannot be missed quietly: adding
    // a model with a governmentReferenceId fails this test until somebody has
    // decided, in writing, what a merge should do with it.
    const schema = readFileSync(
      join(import.meta.dir, "..", "prisma", "schema.prisma"),
      "utf8",
    );

    const keyed = new Set<string>();
    for (const block of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      const [, name, body] = block;
      if (/^\s*governmentReferenceId\s+String/m.test(body!)) keyed.add(name!);
    }

    // The record itself is the thing being merged, not a thing carried.
    keyed.delete("GovernmentReference");

    const merge = readFileSync(
      join(import.meta.dir, "..", "src", "services", "deduplication-service.ts"),
      "utf8",
    );
    const carried = merge.slice(merge.indexOf("export async function mergeReferences"));

    /**
     * Tables a merge deliberately does NOT move, and why.
     *
     * Empty today. Anything added here needs a reason in this comment, not
     * just an entry — the whole value of this test is that it forces the
     * decision to be made and written down rather than defaulted into.
     */
    const exempt = new Set<string>([]);

    const missing = [...keyed].filter((model) => {
      if (exempt.has(model)) return false;
      // The merge touches a table either through Prisma or through raw SQL.
      const prismaName = model.charAt(0).toLowerCase() + model.slice(1);
      return !carried.includes(`tx.${prismaName}.`) && !carried.includes(`"${model}"`);
    });

    expect(missing).toEqual([]);
    // And the guard is doing something: there is more than one such table.
    expect(keyed.size).toBeGreaterThan(2);
  });
});

describe("a roll call finds its record through every name it has had", () => {
  test("it resolves through a former name, not just the current one", async () => {
    // MRID rule 3: a record answers to every name it has ever had. The Senate
    // and the clerk print what they print; a record whose id was later
    // corrected must still be found, or the government's own vote sits on
    // nothing.
    const bill = await law("hr-4058-119");
    await prisma.governmentReference.update({
      where: { id: bill.id },
      data: { masterReferenceId: "hr-4058-119-corrected" },
    });
    await prisma.referenceName.create({
      data: {
        name: "hr-4058-119",
        referenceId: bill.id,
        isCurrent: false,
        learnedFrom: "renamed",
      },
    });

    const stored = await storeRollCall(
      parseHouseRollCall(houseXml, houseRollCallUrl(2025, 300))!,
      prisma,
    );

    expect(stored.linked).toBe(true);
    expect(
      (await prisma.rollCall.findUniqueOrThrow({ where: { id: stored.id } }))
        .governmentReferenceId,
    ).toBe(bill.id);
  });

  test("a vote that arrived before the record finds it when the record appears", async () => {
    // The chambers publish a vote whether or not this platform has heard of
    // the measure. Those are kept unlinked rather than thrown away — and this
    // is the other half of that promise.
    const stored = await storeRollCall(
      parseHouseRollCall(houseXml, houseRollCallUrl(2025, 300))!,
      prisma,
    );
    expect(stored.linked).toBe(false);

    const { findOrCreateReference } = await import("../src/services/deduplication-service");
    const created = await findOrCreateReference({
      masterReferenceId: "hr-4058-119",
      referenceType: "bill",
      title: "Enhancing Stakeholder Support and Outreach for Preparedness Grants Act",
      status: "proposed",
      category: "public_safety",
    });

    const row = await prisma.rollCall.findUniqueOrThrow({ where: { id: stored.id } });
    expect(row.governmentReferenceId).toBe(created.reference.id);
  });
});
