/**
 * The block page cleans itself up, and nobody has to be watching.
 *
 * WHY THESE EXIST. The clean-up was a button in the admin console, and a button
 * means the defect sits in front of readers until a person notices it, finds
 * the tab, and presses it. That person was Khalid, on his phone, reading the
 * app — which makes the reader the janitor. These pin the automatic version
 * shut: that it clears what the button clears, that it then asks for the real
 * text rather than leaving a hole, that it will not hammer a government API,
 * and that it touches nothing it was not asked to touch.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/civicvoice_test";
process.env.DATABASE_URL ??= DATABASE_URL;
process.env.DIRECT_URL ??= DATABASE_URL;
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-value-not-used-anywhere-else";

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const BLOCK_PAGE = readFileSync(
  join(import.meta.dir, "fixtures/federal-register-request-access.txt"),
  "utf8",
);

/** Long enough and plain enough to be unmistakably a law. */
const REAL_TEXT =
  "Executive Order 14418 of August 4, 2026. Establishing the National Bridge Inspection " +
  "Council. By the authority vested in me as President by the Constitution and the laws of " +
  "the United States of America, it is hereby ordered as follows: Section 1. Purpose. ".repeat(12);

const POISONED = "eo-selfheal-poisoned";
const HEALTHY = "eo-selfheal-healthy";
const EMPTY_STALE = "eo-selfheal-empty-stale";
const EMPTY_FRESH = "eo-selfheal-empty-fresh";
const ALL = [POISONED, HEALTHY, EMPTY_STALE, EMPTY_FRESH];

const DAY_MS = 24 * 60 * 60 * 1000;

async function plant(
  masterReferenceId: string,
  fields: { fullText?: string | null; sourceCheckedAt?: Date | null; brief?: boolean },
) {
  await prisma.governmentReference.create({
    data: {
      masterReferenceId,
      referenceType: "executive_order",
      title: `Self-heal fixture ${masterReferenceId}`,
      status: "active",
      sourceUrl: `https://www.federalregister.gov/documents/${masterReferenceId}`,
      fullText: fields.fullText ?? null,
      fullTextHash: fields.fullText ? "planted-hash" : null,
      sourceCheckedAt: fields.sourceCheckedAt ?? null,
      ...(fields.brief
        ? {
            citizenBrief: "A brief written from whatever was stored.",
            citizenBriefAt: new Date(),
            citizenBriefModel: "test-model",
          }
        : {}),
    },
  });
}

beforeAll(async () => {
  await prisma.governmentReference.deleteMany({ where: { masterReferenceId: { in: ALL } } });

  // The defect, exactly as it reached production: a captcha notice stored as a
  // law, with a Citizen's Brief written from it.
  await plant(POISONED, { fullText: BLOCK_PAGE, brief: true, sourceCheckedAt: new Date() });
  // A real law. Must come through untouched.
  await plant(HEALTHY, { fullText: REAL_TEXT, brief: true, sourceCheckedAt: new Date() });
  // No text, and nobody has asked the source in over a day.
  await plant(EMPTY_STALE, { fullText: null, sourceCheckedAt: new Date(Date.now() - 2 * DAY_MS) });
  // No text, but the source was asked minutes ago and had none to give.
  await plant(EMPTY_FRESH, { fullText: null, sourceCheckedAt: new Date() });
});

afterAll(async () => {
  await prisma.governmentReference.deleteMany({ where: { masterReferenceId: { in: ALL } } });
  await prisma.$disconnect();
});

describe("a record holding a block page fixes itself", () => {
  test("one sweep clears the lie, keeps the law, and asks for the missing text", async () => {
    const { healReferenceContent } = await import("../src/services/content-self-heal");
    const { jobQueue, JobType } = await import("../src/services/job-queue");

    // Watch what gets asked for rather than trusting a count.
    const asked: string[] = [];
    const realEnqueue = jobQueue.enqueue.bind(jobQueue);
    (jobQueue as unknown as { enqueue: typeof jobQueue.enqueue }).enqueue = ((
      type: unknown,
      data: unknown,
      priority: unknown,
    ) => {
      if (type === JobType.REEXTRACT_REFERENCE_TEXT) {
        asked.push((data as { referenceId: string }).referenceId);
      }
      return realEnqueue(type as never, data as never, priority as never);
    }) as typeof jobQueue.enqueue;

    try {
      const result = await healReferenceContent({ maxRequeue: 100 });
      expect(result.clearedBlockPages).toBeGreaterThanOrEqual(1);
      expect(result.cleared).toContain(POISONED);
    } finally {
      (jobQueue as unknown as { enqueue: typeof jobQueue.enqueue }).enqueue = realEnqueue;
    }

    const rows = await prisma.governmentReference.findMany({
      where: { masterReferenceId: { in: ALL } },
      select: {
        id: true,
        masterReferenceId: true,
        fullText: true,
        fullTextHash: true,
        citizenBrief: true,
      },
    });
    const by = (id: string) => rows.find((row) => row.masterReferenceId === id)!;

    // THE LIE IS GONE, and so is the brief written from it — that brief
    // described a captcha notice, under Support and Oppose buttons.
    expect(by(POISONED).fullText).toBeNull();
    expect(by(POISONED).fullTextHash).toBeNull();
    expect(by(POISONED).citizenBrief).toBeNull();

    // THE LAW IS UNTOUCHED. A cleaner that eats real text is worse than the
    // defect it was written for.
    expect(by(HEALTHY).fullText).toBe(REAL_TEXT);
    expect(by(HEALTHY).citizenBrief).not.toBeNull();

    // AND IT DOES NOT LEAVE A HOLE: the record it just emptied is asked to
    // fetch its official text again, in the same sweep.
    expect(asked).toContain(by(POISONED).id);

    // A record nobody has asked about in a day is asked now.
    expect(asked).toContain(by(EMPTY_STALE).id);

    // ONE THAT WAS ASKED MINUTES AGO IS LEFT ALONE. These APIs are a courtesy;
    // a sweep that re-asks every empty record every few hours is how a project
    // gets its access withdrawn.
    expect(asked).not.toContain(by(EMPTY_FRESH).id);
  });

  test("the batch is capped, so an empty database is a trickle and not a stampede", async () => {
    const { healReferenceContent } = await import("../src/services/content-self-heal");
    const result = await healReferenceContent({ maxRequeue: 1 });
    expect(result.requeued).toBeLessThanOrEqual(1);
  });

  test("a second sweep finds nothing left to clear", async () => {
    const { healReferenceContent } = await import("../src/services/content-self-heal");
    const result = await healReferenceContent({ maxRequeue: 0 });
    expect(result.clearedBlockPages).toBe(0);
  });
});
