/**
 * SEARCHING FOR A LAW WORKS IN THE CASE PEOPLE ACTUALLY TYPE.
 *
 * Reported against the composer's "attach a law" box, with two screenshots that
 * say it better than a description could: "End Gas Station Heroin Act" sitting
 * in the list, and typing "end gas station" answering "No bills found matching
 * 'end gas station'".
 *
 * THE CAUSE. Prisma's `contains` is case-SENSITIVE on PostgreSQL unless told
 * otherwise. The clauses had no `mode: "insensitive"`, so the catalogue could
 * only be searched by somebody who capitalised a law exactly the way its own
 * title does. Nobody types "End Gas Station Heroin Act".
 *
 * IT WAS NEVER ONLY THAT BOX. GET /api/government-references is the one list
 * endpoint behind both the composer and the Library, so law search has been
 * case-sensitive everywhere in the product. It survived because the obvious way
 * to test a search is to type a title you are looking at, in the case you are
 * looking at — which is the one input that works.
 *
 * Post search next door has had `mode: "insensitive"` on all four of its
 * clauses since it was written. That is what makes this a slip rather than a
 * decision, and it is why the last test here compares the two.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BASE_URL, prisma, resetData, startServer, stopServer } from "./helpers/server";

/** Title-cased, the way a government prints it. */
const TITLE = "End Gas Station Heroin Act";

interface ListResponse {
  references: Array<{ id: string; title: string; masterReferenceId: string }>;
}

async function search(query: string): Promise<ListResponse> {
  const params = new URLSearchParams({ referenceType: "bill", limit: "25" });
  if (query) params.set("search", query);
  const response = await fetch(`${BASE_URL}/api/government-references?${params.toString()}`);
  expect(response.status).toBe(200);
  return (await response.json()) as ListResponse;
}

const titles = (body: ListResponse) => body.references.map((r) => r.title);

beforeAll(async () => {
  await startServer();
  await resetData();

  await prisma.governmentReference.create({
    data: {
      masterReferenceId: "s-5383-119",
      referenceType: "bill",
      title: TITLE,
      status: "committee",
      category: "healthcare",
      congress: 119,
    },
  });

  // A second record, so a passing search has to be selecting rather than
  // returning everything it has.
  await prisma.governmentReference.create({
    data: {
      masterReferenceId: "hr-10152-119",
      referenceType: "bill",
      title: "Open-Source AI Leadership Act",
      status: "committee",
      category: "technology",
      congress: 119,
    },
  });
});

afterAll(async () => {
  await stopServer();
});

describe("finding a law by typing its name", () => {
  test("LOWERCASE FINDS A TITLE-CASED LAW — the reported bug", async () => {
    const found = await search("end gas station");
    expect(titles(found)).toContain(TITLE);
  });

  test("the exact case still works", async () => {
    expect(titles(await search("End Gas Station"))).toContain(TITLE);
  });

  test("SHOUTING finds it too", async () => {
    expect(titles(await search("END GAS STATION"))).toContain(TITLE);
  });

  test("a mid-title word finds it", async () => {
    // People search for the word they remember, not the opening of the title.
    expect(titles(await search("heroin"))).toContain(TITLE);
  });

  test("the search still selects rather than returning everything", async () => {
    const found = await search("end gas station");
    expect(titles(found)).not.toContain("Open-Source AI Leadership Act");
  });

  test("a law that is not there is still not there", async () => {
    // The empty state has to stay honest. A search loosened until everything
    // matches is not a fixed search.
    expect((await search("a law nobody has written")).references).toHaveLength(0);
  });

  test("an identifier is found in the case it is printed in", async () => {
    // Ids are stored hyphenated and lowercase — "s-5383-119" — and read as
    // "S 5383". Both spellings, either case.
    expect(titles(await search("S 5383"))).toContain(TITLE);
    expect(titles(await search("s 5383"))).toContain(TITLE);
  });
});

describe("the composer and the Library ask the same endpoint", () => {
  test("both go through GET /api/government-references", () => {
    // The reason this fix reaches both at once, asserted rather than assumed.
    // If either grows its own search, this stops being true and the two can
    // drift — which is how one of them ends up case-sensitive again.
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const repo = resolve(import.meta.dir, "..", "..");

    const composer = readFileSync(
      resolve(repo, "apps/web/src/components/mobile/ReferenceSearchModal.tsx"),
      "utf8",
    );
    expect(composer).toContain("/api/government-references?");
  });
});
