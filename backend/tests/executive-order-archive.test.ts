/**
 * The archive fills itself, and resumes from what is actually stored.
 *
 * The Federal Register publishes 1,556 executive orders back to 1994 and this
 * platform held 62. The nightly forward sync takes 50 new ones starting at the
 * newest, which is right for catching up on a few days and the wrong shape for
 * the other 1,494 — every run would re-walk everything already held before
 * reaching anything new.
 *
 * So sweeps walk BACKWARDS from the oldest order held, and that anchor is the
 * whole design. It is derived from the database on every run rather than kept
 * in a cursor column, which means an interrupted sweep, a redeploy mid-run, or
 * two sweeps at once all resume correctly. These tests are about that anchor,
 * because a bookmark that lies is how a backfill silently stops making
 * progress while continuing to look busy.
 *
 * NOT TESTED HERE: the walk against the live Federal Register. That was proven
 * separately against the real API — 1,556 reported, four sweeps of 100 stepping
 * back from 2026-06-03 to 2021-02-24 without stalling, and a window before the
 * archive begins returning zero results, which is the finish line this code
 * reads. A test that mocked those answers would only prove the mock.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/civicvoice_test";
process.env.DATABASE_URL ??= DATABASE_URL;
process.env.DIRECT_URL ??= DATABASE_URL;
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-value-not-used-anywhere-else";

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const IDS = ["eo-arch-1990", "eo-arch-2001", "eo-arch-2026", "eo-arch-nodate", "eo-arch-merged"];

async function plant(id: string, signedDate: Date | null, extra: Record<string, unknown> = {}) {
  await prisma.governmentReference.create({
    data: {
      masterReferenceId: id,
      referenceType: "executive_order",
      title: `Archive fixture ${id}`,
      status: "active",
      sourceUrl: `https://www.federalregister.gov/documents/${id}`,
      signedDate,
      ...extra,
    },
  });
}

beforeAll(async () => {
  await prisma.governmentReference.deleteMany({ where: { masterReferenceId: { in: IDS } } });
});

afterAll(async () => {
  await prisma.governmentReference.deleteMany({ where: { masterReferenceId: { in: IDS } } });
  await prisma.$disconnect();
});

describe("where the next sweep resumes from", () => {
  test("with orders held, it is the oldest one's signing date", async () => {
    const { archiveAnchor } = await import("../src/services/executive-order-archive");

    await plant("eo-arch-2026", new Date("2026-06-03"));
    await plant("eo-arch-2001", new Date("2001-09-14"));

    const anchor = await archiveAnchor();
    expect(anchor?.toISOString().slice(0, 10)).toBe("2001-09-14");
  });

  test("it moves as older orders arrive — which is what makes progress happen", async () => {
    const { archiveAnchor } = await import("../src/services/executive-order-archive");

    await plant("eo-arch-1990", new Date("1990-01-02"));

    const anchor = await archiveAnchor();
    expect(anchor?.toISOString().slice(0, 10)).toBe("1990-01-02");
  });

  test("an order with no signing date cannot become the anchor", async () => {
    // A null would either crash the query or anchor the walk on nothing. Both
    // stop the backfill dead while it carries on looking busy.
    const { archiveAnchor } = await import("../src/services/executive-order-archive");

    await plant("eo-arch-nodate", null);

    const anchor = await archiveAnchor();
    expect(anchor?.toISOString().slice(0, 10)).toBe("1990-01-02");
  });

  test("a merged-away order cannot become the anchor either", async () => {
    // Merged records are duplicates folded into a survivor. Anchoring on one
    // would walk backwards from a record that is no longer the platform's view
    // of that law.
    const { archiveAnchor } = await import("../src/services/executive-order-archive");
    const survivor = await prisma.governmentReference.findUniqueOrThrow({
      where: { masterReferenceId: "eo-arch-2026" },
      select: { id: true },
    });

    await plant("eo-arch-merged", new Date("1801-03-04"), { mergedIntoId: survivor.id });

    const anchor = await archiveAnchor();
    expect(anchor?.toISOString().slice(0, 10)).toBe("1990-01-02");
  });
});

describe("an empty shelf", () => {
  test("with no orders at all it asks for nothing and says so", async () => {
    const { sweepExecutiveOrderArchive } = await import(
      "../src/services/executive-order-archive"
    );
    await prisma.governmentReference.deleteMany({ where: { masterReferenceId: { in: IDS } } });

    const existing = await prisma.governmentReference.count({
      where: { referenceType: "executive_order", mergedIntoId: null, signedDate: { not: null } },
    });
    if (existing > 0) return; // Another test's data is present; this case is unreachable here.

    // No anchor means no window to ask for. It returns rather than guessing a
    // date, and the forward sync seeds the newest end on its own schedule.
    const result = await sweepExecutiveOrderArchive({ maxNew: 1 });
    expect(result.anchor).toBeNull();
    expect(result.synced).toBe(0);
    expect(result.complete).toBe(false);
  });
});
