/**
 * Deciding automatically whether two records are one law.
 *
 * The review queue was the right design while a merge could not be undone: a
 * wrong merge pooled two different laws' votes into one published number and
 * deleted the duplicates of anybody who had voted on both. With an undo, the
 * decision can be made by a machine and corrected when it is wrong.
 *
 * The tests that matter most are the ones that REFUSE to merge. The load test
 * behind this system found three DHS appropriations bills with twenty-six
 * published relationships and no identical label, and two Venezuela bills with
 * nearly the same title that are different laws. Both shapes appear below.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
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
  adjudicate,
  sameText,
  structurallyMergeable,
  textFingerprint,
  recordFor,
  AI_MERGE_CONFIDENCE,
} from "../src/services/merge-adjudicator";
import { mergeReferences, unmergeReferences } from "../src/services/deduplication-service";
import { adjudicatePending, CandidateStatus } from "../src/services/reference-lineage";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
  await prisma.mergeJournalRow.deleteMany();
  await prisma.mergeJournal.deleteMany();
});

let seq = 0;
async function citizen() {
  seq += 1;
  return signUp({
    email: `adj${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `Adjudicator ${seq}`,
  });
}

let refCounter = 0;
async function law(overrides: Record<string, unknown> = {}) {
  refCounter += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${7700 + refCounter}-119`,
      referenceType: "bill",
      title: `A bill numbered ${7700 + refCounter}`,
      status: "proposed",
      category: "healthcare",
      congress: 119,
      ...overrides,
    },
  });
}

const REAL_TEXT =
  "SECTION 1. SHORT TITLE. This Act may be cited as the Enhancing Stakeholder " +
  "Support and Outreach for Preparedness Grants Act. SEC. 2. STAKEHOLDER " +
  "OUTREACH. The Administrator of the Federal Emergency Management Agency shall " +
  "carry out outreach to State, local, Tribal, and territorial governments " +
  "regarding preparedness grant programs administered by the Agency, including " +
  "the application process and allowable uses of grant funds. ".repeat(3);

describe("proof: the same text is the same measure", () => {
  test("identical official text merges without asking anybody", async () => {
    const a = await law({ masterReferenceId: "hr-4058-119", fullText: REAL_TEXT });
    const b = await law({ masterReferenceId: "s-1900-119", fullText: REAL_TEXT });

    const verdict = await adjudicate((await recordFor(a.id))!, (await recordFor(b.id))!);

    expect(verdict.verdict).toBe("same");
    expect(verdict.basis).toBe("same_text");
    expect(verdict.confidence).toBe(1);
    // No model was consulted: this is a fact, not an inference.
    expect(verdict.reason).toContain("identical");
  });

  test("formatting differences do not make two copies into two laws", () => {
    const plain = "SECTION 1. The Secretary shall do the thing described herein.";
    const html = "<p>SECTION&nbsp;1.  The Secretary shall do the thing described herein.</p>";

    expect(textFingerprint(plain)).toBe(textFingerprint(html));
  });

  test("one word apart is two versions, not one text", () => {
    const before = "The Secretary shall cap the price at 35 dollars per month.";
    const after = "The Secretary shall cap the price at 50 dollars per month.";

    // The whole point of the platform is that an amended bill is a different
    // thing. Smoothing this away would merge a law with its own amendment.
    expect(textFingerprint(before)).not.toBe(textFingerprint(after));
  });

  test("a stub or an error page is not a law to compare", async () => {
    const a = await law({ fullText: "Not found" });
    const b = await law({ fullText: "Not found" });

    // Two records whose text fetch failed identically are not one measure, and
    // this is exactly how an automated merger would run amok.
    expect(sameText((await recordFor(a.id))!, (await recordFor(b.id))!)).toBeNull();
  });

  test("a record with no text yet cannot be judged on text", async () => {
    const a = await law({ fullText: REAL_TEXT });
    const b = await law({ fullText: null });

    expect(sameText((await recordFor(a.id))!, (await recordFor(b.id))!)).toBeNull();
  });
});

describe("the pairs that must never merge", () => {
  test("two appropriations bills for the same agency in different congresses", async () => {
    // The DHS shape from the load test: heavily cross-referenced, obviously
    // related, and separate laws.
    const a = await law({
      masterReferenceId: "hr-4367-118",
      congress: 118,
      title: "Department of Homeland Security Appropriations Act, 2024",
    });
    const b = await law({
      masterReferenceId: "hr-4367-119",
      congress: 119,
      title: "Department of Homeland Security Appropriations Act, 2025",
    });

    const verdict = await adjudicate((await recordFor(a.id))!, (await recordFor(b.id))!, {
      allowAI: false,
    });

    // Refused on the record itself, before any model is asked. A model can be
    // talked into anything by two well-written appropriations bills.
    expect(verdict.verdict).toBe("different");
    expect(verdict.basis).toBe("structural");
    expect(verdict.reason).toContain("congress");
  });

  test("a bill and a resolution with the same number are not one measure", async () => {
    const a = await law({ masterReferenceId: "hr-100-119", referenceType: "bill" });
    const b = await law({ masterReferenceId: "eo-100", referenceType: "executive_order" });

    const verdict = await adjudicate((await recordFor(a.id))!, (await recordFor(b.id))!, {
      allowAI: false,
    });
    expect(verdict.verdict).toBe("different");
  });

  test("near-identical titles alone never reach a merge", async () => {
    // The two Venezuela bills. Same subject, almost the same title, different
    // laws — and no text to prove otherwise.
    const a = await law({
      masterReferenceId: "hr-3000-119",
      title: "Venezuela Sanctions Review Act",
      fullText: null,
    });
    const b = await law({
      masterReferenceId: "hr-3100-119",
      title: "Venezuela Sanctions Review and Reform Act",
      fullText: null,
    });

    const verdict = await adjudicate((await recordFor(a.id))!, (await recordFor(b.id))!, {
      allowAI: false,
    });

    // Not "same". A title is a suggestion; this system does not merge on one.
    expect(verdict.verdict).not.toBe("same");
  });

  test("a record cannot be merged into itself", async () => {
    const a = await law();
    const record = (await recordFor(a.id))!;

    expect(structurallyMergeable(record, record)).toMatchObject({ ok: false });
  });

  test("a model's 'same' below the bar is not acted on", () => {
    // The threshold is the thing standing between an automated merger and a
    // confident model having a bad day.
    expect(AI_MERGE_CONFIDENCE).toBeGreaterThanOrEqual(0.9);
  });
});

describe("undo: what makes deciding automatically defensible", () => {
  test("a merge can be put back exactly as it was", async () => {
    const voterBoth = await citizen();
    const voterSource = await citizen();

    const source = await law({ masterReferenceId: "hr-8100-119" });
    const target = await law({ masterReferenceId: "hr-8200-119" });

    // Somebody who voted on both — their duplicate is what a merge deletes.
    await prisma.governmentReferenceVote.create({
      data: {
        governmentReferenceId: target.id,
        userId: voterBoth.userId,
        position: "support",
        updatedAt: new Date("2026-01-01"),
      },
    });
    await prisma.governmentReferenceVote.create({
      data: {
        governmentReferenceId: source.id,
        userId: voterBoth.userId,
        position: "oppose",
        updatedAt: new Date("2026-02-01"),
      },
    });
    // And somebody who voted only on the record about to disappear.
    await prisma.governmentReferenceVote.create({
      data: {
        governmentReferenceId: source.id,
        userId: voterSource.userId,
        position: "support",
      },
    });

    const post = await prisma.post.create({
      data: {
        authorId: voterSource.userId,
        content: "Something about this bill.",
        governmentReferenceId: source.id,
      },
    });

    const report = await mergeReferences(source.id, target.id, {
      decidedBy: "same_text",
      reason: "The official texts are identical.",
    });
    expect(report.journalId).toBeTruthy();

    // The merge did what it does.
    expect(
      (await prisma.governmentReference.findUniqueOrThrow({ where: { id: source.id } }))
        .mergedIntoId,
    ).toBe(target.id);

    await unmergeReferences(report.journalId, "test", "Wrong call.");

    // The record stands on its own again.
    expect(
      (await prisma.governmentReference.findUniqueOrThrow({ where: { id: source.id } }))
        .mergedIntoId,
    ).toBeNull();

    // The post went home.
    expect(
      (await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).governmentReferenceId,
    ).toBe(source.id);

    // Both of the both-voter's positions exist again, one on each record.
    const theirVotes = await prisma.governmentReferenceVote.findMany({
      where: { userId: voterBoth.userId },
    });
    expect(theirVotes).toHaveLength(2);
    expect(
      theirVotes.find((v) => v.governmentReferenceId === target.id)!.position,
    ).toBe("support");
    expect(
      theirVotes.find((v) => v.governmentReferenceId === source.id)!.position,
    ).toBe("oppose");

    // And the vote that only ever belonged to the source is back on it.
    const soloVote = await prisma.governmentReferenceVote.findFirstOrThrow({
      where: { userId: voterSource.userId },
    });
    expect(soloVote.governmentReferenceId).toBe(source.id);
  });

  test("the published tallies are right on both records afterwards", async () => {
    const source = await law();
    const target = await law();

    for (let i = 0; i < 4; i += 1) {
      const voter = await citizen();
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: source.id, userId: voter.userId, position: "support" },
      });
    }

    const report = await mergeReferences(source.id, target.id);
    expect(
      (await prisma.governmentReference.findUniqueOrThrow({ where: { id: target.id } }))
        .supportVotes,
    ).toBe(4);

    await unmergeReferences(report.journalId, "test", "Wrong call.");

    // The survivor is no longer counting votes that have gone home, and the
    // separated record is counting its own again.
    expect(
      (await prisma.governmentReference.findUniqueOrThrow({ where: { id: target.id } }))
        .supportVotes,
    ).toBe(0);
    expect(
      (await prisma.governmentReference.findUniqueOrThrow({ where: { id: source.id } }))
        .supportVotes,
    ).toBe(4);
  });

  test("the position ledger and roll calls go home too", async () => {
    const person = await citizen();
    const source = await law();
    const target = await law();

    await prisma.positionEvent.create({
      data: {
        userId: person.userId,
        governmentReferenceId: source.id,
        position: "support",
        reason: "Said on the record that vanished.",
      },
    });

    const report = await mergeReferences(source.id, target.id);
    await unmergeReferences(report.journalId, "test", "Wrong call.");

    const events = await prisma.positionEvent.findMany({
      where: { governmentReferenceId: source.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.reason).toBe("Said on the record that vanished.");
  });

  test("an undo cannot be replayed", async () => {
    const source = await law();
    const target = await law();

    const report = await mergeReferences(source.id, target.id);
    await unmergeReferences(report.journalId, "test", "Wrong call.");

    // A journal replayed twice would move rows that legitimately belong to the
    // survivor by then.
    await expect(
      unmergeReferences(report.journalId, "test", "Again."),
    ).rejects.toThrow(/already been undone/);
  });

  test("the journal says who decided and why", async () => {
    const source = await law();
    const target = await law();

    const report = await mergeReferences(source.id, target.id, {
      decidedBy: "ai_adjudicated",
      reason: "Both texts describe the same FEMA outreach requirement.",
      confidence: 0.94,
      evidenceUrl: "https://www.congress.gov/bill/119th-congress/house-bill/4058",
    });

    const journal = await prisma.mergeJournal.findUniqueOrThrow({
      where: { id: report.journalId },
    });
    expect(journal.decidedBy).toBe("ai_adjudicated");
    expect(journal.confidence).toBe(0.94);
    expect(journal.reason).toContain("FEMA");
    expect(journal.evidenceUrl).toContain("congress.gov");
  });

  test("a merge decided by nobody in particular still records that", async () => {
    const source = await law();
    const target = await law();

    const report = await mergeReferences(source.id, target.id);
    expect(report.decidedBy).toBe("admin");
  });
});

/**
 * THE SWEEP DOES NOT PAY TWICE FOR THE SAME ANSWER.
 *
 * The Merge job runs every six hours and hands the oldest twenty-five pending
 * candidates to the adjudicator with a model allowed. A pair the model reads
 * and cannot decide stays pending — so before this, the next sweep asked the
 * same unanswerable question about the same two bills, and the one after that,
 * forever. Worse, oldest-first means those pairs sat at the head of the queue
 * and newer candidates were never reached at all.
 *
 * A model that could not be REACHED is a different thing and is left alone to
 * be retried, because an outage is not an answer.
 */
describe("a pair a model already read is not put to a model again", () => {
  async function pair(fields: Record<string, unknown> = {}) {
    const a = await law();
    const b = await law();
    const [leftId, rightId] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    return prisma.referenceMergeCandidate.create({
      data: {
        leftId,
        rightId,
        relationship: "Companion measure",
        identifiedBy: "CRS",
        ...fields,
      },
    });
  }

  test("the sweep skips a still-pending pair that has already been read", async () => {
    await pair();
    const alreadyRead = await pair({
      decidedAt: new Date(),
      note: "A model read both and could not decide (ai_adjudicated): too little text.",
    });

    const sweep = await adjudicatePending(25, { allowAI: false });

    // Two pending rows, one already read. Only the unread one is considered.
    expect(sweep.considered).toBe(1);

    const untouched = await prisma.referenceMergeCandidate.findUniqueOrThrow({
      where: { id: alreadyRead.id },
    });
    expect(untouched.status).toBe(CandidateStatus.PENDING);
    expect(untouched.note).toContain("could not decide");
  });

  test("a model that could not be reached leaves the pair open for another try", async () => {
    // No provider key in this process, so generateAI fails without a network
    // call and the basis is ai_unavailable rather than an answer.
    const keys = ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "OPENAI_API_KEY"];
    const saved = keys.map((name) => [name, process.env[name]] as const);
    for (const name of keys) delete process.env[name];

    try {
      const open = await pair();
      const sweep = await adjudicatePending(25, { allowAI: true });

      expect(sweep.considered).toBe(1);
      expect(sweep.leftPending).toBe(1);

      const row = await prisma.referenceMergeCandidate.findUniqueOrThrow({
        where: { id: open.id },
      });
      expect(row.status).toBe(CandidateStatus.PENDING);
      // Unstamped: an outage is not an answer, so the next sweep tries again.
      expect(row.decidedAt).toBeNull();
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
