/**
 * A record gets a readable address, and earns its place in the sitemap.
 *
 * WHY BOTH ARE IN ONE FILE. They are two halves of one promise: every record
 * is addressable, and only some are advertised. Testing them apart makes it
 * easy to end up with a sitemap full of pages that have nothing on them, which
 * is the failure this is guarding against.
 *
 * THE CASE AGAINST LISTING EVERYTHING, since the test alone will not say it: a
 * bare record is a title, a date, an empty tally and a copy of a government
 * document Google already has from the .gov. Publishing 1,900 of those risks
 * the whole domain, not the page. See services/findable.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { BASE_URL, prisma, resetData, startServer, stopServer } from "./helpers/server";

/*
 * IMPORTED AFTER THE SERVER STARTS, NOT AT THE TOP OF THE FILE.
 *
 * src/prisma.ts does `new PrismaClient()` at import time, which reads
 * DATABASE_URL there and then. startServer() is what points that at the test
 * database, so a static import binds the client to the wrong one — or to
 * nothing — and every query afterwards hangs. Same reason
 * admin-permissions.test.ts reaches for its services with `await import`.
 */
type SlugModule = typeof import("../src/services/reference-slug");
type FindableModule = typeof import("../src/services/findable");
let ensureSlug: SlugModule["ensureSlug"];
let preferredSlug: SlugModule["preferredSlug"];
let backfillSlugs: SlugModule["backfillSlugs"];
let isFindable: FindableModule["isFindable"];

beforeAll(async () => {
  await startServer();
  ({ ensureSlug, preferredSlug, backfillSlugs } = await import("../src/services/reference-slug"));
  ({ isFindable } = await import("../src/services/findable"));
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

let seq = 0;
async function record(input: {
  referenceType: string;
  masterReferenceId?: string;
  title: string;
  description?: string;
  citizenBrief?: string;
  supportVotes?: number;
  opposeVotes?: number;
}) {
  seq += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: input.masterReferenceId ?? `test-${seq}`,
      referenceType: input.referenceType,
      title: input.title,
      status: "active",
      ...(input.description ? { description: input.description } : {}),
      ...(input.citizenBrief ? { citizenBrief: input.citizenBrief } : {}),
      ...(input.supportVotes ? { supportVotes: input.supportVotes } : {}),
      ...(input.opposeVotes ? { opposeVotes: input.opposeVotes } : {}),
    },
  });
}

describe("a readable address", () => {
  test("a bill keeps the id people already type", async () => {
    const bill = await record({
      referenceType: "bill",
      masterReferenceId: "hr-10184-119",
      title: "Consumer Financial Protection Accountability Act",
    });
    expect(await ensureSlug(bill.id)).toBe("hr-10184-119");
  });

  test("an executive order keeps its number", async () => {
    const order = await record({
      referenceType: "executive_order",
      masterReferenceId: "eo-14421",
      title: "Declaring a National Emergency",
    });
    expect(await ensureSlug(order.id)).toBe("eo-14421");
  });

  test("A SUPREME COURT CASE IS NAMED, NOT NUMBERED", async () => {
    // The whole reason slug is its own column. "24-20" is what the Court files
    // it under and matches nothing anybody searches for; the case name is the
    // query. Getting this wrong would give the branch with the most famous
    // records the least findable addresses.
    const ruling = await record({
      referenceType: "scotus_case",
      masterReferenceId: "24-20",
      title: "Fuld v. Palestine Liberation Organization",
    });
    expect(await ensureSlug(ruling.id)).toBe("fuld-v-palestine-liberation-organization");
  });

  test("two cases with the same name both get an address", async () => {
    const first = await record({
      referenceType: "scotus_case",
      masterReferenceId: "13-9972",
      title: "Rodriguez v. United States",
    });
    const second = await record({
      referenceType: "scotus_case",
      masterReferenceId: "24-999",
      title: "Rodriguez v. United States",
    });

    const a = await ensureSlug(first.id);
    const b = await ensureSlug(second.id);
    expect(a).toBe("rodriguez-v-united-states");
    expect(b).not.toBe(a);
    expect(b).toBeTruthy();
  });

  test("AN ADDRESS ONCE GIVEN NEVER CHANGES", async () => {
    // A slug is a promise to everybody holding the link. Re-deriving one
    // because a title was corrected would break every share and every result
    // already indexed.
    const ruling = await record({
      referenceType: "scotus_case",
      masterReferenceId: "24-20",
      title: "Fuld v. Palestine Liberation Organization",
    });
    const original = await ensureSlug(ruling.id);

    await prisma.governmentReference.update({
      where: { id: ruling.id },
      data: { title: "Fuld and others v. The PLO (corrected)" },
    });

    expect(await ensureSlug(ruling.id)).toBe(original);
  });

  test("the records held before this existed get one too, idempotently", async () => {
    await record({ referenceType: "bill", masterReferenceId: "hr-1-119", title: "A bill" });
    await record({ referenceType: "executive_order", masterReferenceId: "eo-9981", title: "An order" });

    expect(await backfillSlugs()).toBe(2);
    // Run again: nothing left to do, and nothing rewritten.
    expect(await backfillSlugs()).toBe(0);
  });

  test("a record answers to its readable address AND its old one", async () => {
    // Every link ever shared uses the cuid. Those must not die.
    const order = await record({
      referenceType: "executive_order",
      masterReferenceId: "eo-14421",
      title: "Declaring a National Emergency",
    });
    await ensureSlug(order.id);

    const byId = await fetch(`${BASE_URL}/api/government-references/${order.id}`);
    const bySlug = await fetch(`${BASE_URL}/api/government-references/eo-14421`);
    expect(byId.status).toBe(200);
    expect(bySlug.status).toBe(200);

    const one = (await byId.json()) as { reference: { id: string } };
    const two = (await bySlug.json()) as { reference: { id: string } };
    expect(two.reference.id).toBe(one.reference.id);
  });

  test("preferredSlug never returns something that is not a URL", async () => {
    expect(preferredSlug({
      referenceType: "scotus_case",
      masterReferenceId: "24-20",
      title: "Trump v. J. G. G. (per curiam) — No. 24A931!",
    })).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("what the sitemap advertises", () => {
  const bare = { slug: "eo-1", citizenBrief: null, description: null, supportVotes: 0, opposeVotes: 0 };

  test("A BARE RECORD IS NOT ADVERTISED", () => {
    // Its page exists and is shareable. It is not submitted to Google, because
    // what is on it is a government document Google already has.
    expect(isFindable(bare)).toBe(false);
  });

  test("a brief earns it a place", () => {
    expect(isFindable({ ...bare, citizenBrief: "What this order actually does…" })).toBe(true);
  });

  test("a real description earns it a place, a restated title does not", () => {
    expect(isFindable({ ...bare, description: "Short" })).toBe(false);
    expect(isFindable({
      ...bare,
      description:
        "Directs the Secretary to establish a programme within 180 days and report to Congress annually on its effect.",
    })).toBe(true);
  });

  test("A PUBLIC PULSE EARNS IT A PLACE — that is the thing nobody else has", () => {
    expect(isFindable({ ...bare, supportVotes: 1, opposeVotes: 1 })).toBe(false);
    expect(isFindable({ ...bare, supportVotes: 2, opposeVotes: 1 })).toBe(true);
  });

  test("no readable address means no listing, whatever else it has", () => {
    expect(isFindable({ ...bare, slug: null, citizenBrief: "A brief" })).toBe(false);
  });

  test("the sitemap is XML, and holds exactly the records that qualify", async () => {
    const listed = await record({
      referenceType: "executive_order",
      masterReferenceId: "eo-14421",
      title: "An order somebody wrote about",
      citizenBrief: "What it does, in plain English.",
    });
    const unlisted = await record({
      referenceType: "executive_order",
      masterReferenceId: "eo-12891",
      title: "An order nobody has touched",
    });
    await ensureSlug(listed.id);
    await ensureSlug(unlisted.id);

    const response = await fetch(`${BASE_URL}/api/sitemap`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("xml");

    const xml = await response.text();
    expect(xml).toContain("<urlset");
    expect(xml).toContain("/executive-order/eo-14421");
    expect(xml).not.toContain("/executive-order/eo-12891");
  });

  test("the merged-away half of a duplicate is never advertised", async () => {
    const target = await record({
      referenceType: "bill",
      masterReferenceId: "hr-1-119",
      title: "The surviving record",
      citizenBrief: "A brief.",
    });
    const merged = await record({
      referenceType: "bill",
      masterReferenceId: "hr-2-119",
      title: "The record that was merged away",
      citizenBrief: "A brief.",
    });
    await ensureSlug(target.id);
    await ensureSlug(merged.id);
    await prisma.governmentReference.update({
      where: { id: merged.id },
      data: { mergedIntoId: target.id },
    });

    const xml = await (await fetch(`${BASE_URL}/api/sitemap`)).text();
    expect(xml).toContain("/bill/hr-1-119");
    expect(xml).not.toContain("/bill/hr-2-119");
  });
});
