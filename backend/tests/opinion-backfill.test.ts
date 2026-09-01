/**
 * The seventeen rulings we already hold get the same treatment as the next one.
 *
 * `deriveOpinionDescription` is proved against real opinion text in
 * opinion-snippet.test.ts. This is the other half: that running it over the
 * database actually replaces the boilerplate, leaves a real description alone,
 * and finds nothing the second time — because it runs at every boot.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma, startServer, stopServer } from "./helpers/server";

const OPINIONS: Array<{ slug: string; title: string; fullTextHead: string }> = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "scotus-opinions.json"), "utf8"),
);
const MONSANTO = OPINIONS.find((o) => o.slug === "monsanto-v-durnell")!;

/** The Reporter's notice, exactly as production served it. */
const THE_NOTICE =
  "(Slip Opinion) OCTOBER TERM, 2025 1 Syllabus NOTE: Where it is feasible, a syllabus " +
  "(headnote) will be released, as is being done in connection with this case, at the time " +
  "the opinion is issued. The syllabus constitutes no part of the opinion of the Court but " +
  "has been prepared by the Reporter of Decisions for the convenience of the reader. See " +
  "United States v. Detroit";

let backfillOpinionDescriptions: () => Promise<number>;

const seed = (id: string, description: string | null) =>
  prisma.governmentReference.create({
    data: {
      masterReferenceId: id,
      referenceType: "scotus_case",
      title: MONSANTO.title,
      status: "decided",
      description,
      fullText: MONSANTO.fullTextHead,
      fullTextSource: "test",
    },
  });

beforeAll(async () => {
  await startServer();
  // Imported here rather than at the top: services/prisma.ts builds its client
  // at import time from DATABASE_URL, and startServer is what sets it.
  ({ backfillOpinionDescriptions } = await import("../src/services/opinion-snippet"));
  await prisma.governmentReference.deleteMany({
    where: { masterReferenceId: { startsWith: "backfill-test-" } },
  });
});

afterAll(async () => {
  await prisma.governmentReference.deleteMany({
    where: { masterReferenceId: { startsWith: "backfill-test-" } },
  });
  await stopServer();
});

describe("bringing the stored rulings up to the rule", () => {
  test("A RULING WEARING THE PRINTER'S NOTICE GETS THE COURT'S OWN SUMMARY", async () => {
    const record = await seed("backfill-test-notice", THE_NOTICE);

    expect(await backfillOpinionDescriptions()).toBeGreaterThan(0);

    const after = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: record.id },
      select: { description: true },
    });
    expect(after.description).toContain("Roundup");
    expect(after.description).not.toContain("Slip Opinion");
  });

  test("and so does one with a filing card, or with nothing at all", async () => {
    const card = await seed(
      "backfill-test-card",
      "Monsanto v. Durnell. Court: Supreme Court of the United States. Docket: 24-1068",
    );
    const empty = await seed("backfill-test-empty", null);

    await backfillOpinionDescriptions();

    for (const record of [card, empty]) {
      const after = await prisma.governmentReference.findUniqueOrThrow({
        where: { id: record.id },
        select: { description: true },
      });
      expect(after.description).toContain("Roundup");
    }
  });

  test("A DESCRIPTION THAT ACTUALLY SAYS SOMETHING IS NEVER OVERWRITTEN", async () => {
    const written =
      "Whether the Federal Insecticide, Fungicide, and Rodenticide Act pre-empts a state-law " +
      "failure-to-warn claim against the manufacturer of a glyphosate-based herbicide.";
    const record = await seed("backfill-test-real", written);

    await backfillOpinionDescriptions();

    const after = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: record.id },
      select: { description: true },
    });
    expect(after.description).toBe(written);
  });

  test("IT FINDS NOTHING THE SECOND TIME — it runs at every boot", async () => {
    await seed("backfill-test-idempotent", THE_NOTICE);

    expect(await backfillOpinionDescriptions()).toBeGreaterThan(0);
    expect(await backfillOpinionDescriptions()).toBe(0);
  });
});
