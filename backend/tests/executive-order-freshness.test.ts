/**
 * AN ORDER SIGNED TODAY IS ON THE PLATFORM TODAY, AND CARRIES THE REGISTER'S
 * NUMBER WHEN THE REGISTER GETS AROUND TO ASSIGNING ONE.
 *
 * The gap this closes: everything used to arrive through the Federal Register,
 * which publishes three to seven days after signing. Somebody who heard about
 * an order on the news found nothing here for most of a week.
 *
 * Both halves are exercised against real recorded responses — the White House
 * feed as served on 5 September 2026, and the Federal Register's own answers
 * for the days those orders were signed. `fetch` is replaced rather than the
 * modules being stubbed, so the code under test is the code that runs in
 * production, right down to the URL it builds.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { prisma, resetData, startServer, stopServer } from "./helpers/server";
import {
  alreadyHeld,
  intakeOrdersSignedOn,
  SAME_ORDER_CLOSENESS,
} from "../src/services/executive-order-intake";
import {
  NumberStatus,
  findInRegister,
  settleOneNumber,
} from "../src/services/executive-order-numbering";
import { parseOrderFeed } from "../src/services/white-house-orders";

const feed = readFileSync(new URL("./fixtures/wh-eo-feed.xml", import.meta.url).pathname, "utf8");
const orders = parseOrderFeed(feed);
const ranchers = orders.find((o) => o.title.includes("Ranchers"))!;

const realFetch = globalThis.fetch;

/**
 * Answer the two hosts this pipeline talks to, and nothing else.
 *
 * A request to any other host throws rather than falling through to the
 * network: a test that quietly reaches the internet passes on a laptop and
 * fails in CI for reasons nobody can see.
 */
function serve(handlers: {
  whiteHouse?: string | number;
  register?: unknown | number;
}) {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input instanceof Request ? input.url : input);

    if (url.includes("whitehouse.gov")) {
      const answer = handlers.whiteHouse;
      if (answer === undefined) throw new Error("the White House was not expected to be called");
      if (typeof answer === "number") return new Response("", { status: answer });
      return new Response(answer, { status: 200 });
    }

    if (url.includes("federalregister.gov")) {
      const answer = handlers.register;
      if (answer === undefined) throw new Error("the Register was not expected to be called");
      if (typeof answer === "number") return new Response("", { status: answer });
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`unexpected host in test: ${url}`);
  }) as typeof fetch;
}

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const eos = () =>
  prisma.governmentReference.findMany({
    where: { referenceType: "executive_order" },
    orderBy: { masterReferenceId: "asc" },
  });

// ---------------------------------------------------------------------------

describe("a day's orders arrive with their text and no invented number", () => {
  test("two orders signed the same day become two records, numbered by date", async () => {
    serve({ whiteHouse: feed });
    const report = await intakeOrdersSignedOn("2026-09-04");

    expect(report.reached).toBe(true);
    expect(report.found).toBe(2);
    expect(report.created).toBe(2);

    const held = await eos();
    expect(held.map((r) => r.masterReferenceId)).toEqual([
      "eo-2026-09-04*",
      "eo-2026-09-04-2*",
    ]);
    // Sequential, and no slash — an identifier with one in it breaks the first
    // time it reaches a path.
    for (const record of held) expect(record.masterReferenceId).not.toContain("/");
  });

  test("the full text is stored, not a summary", async () => {
    serve({ whiteHouse: feed });
    await intakeOrdersSignedOn("2026-09-04");

    const stored = (await eos()).find((r) => r.title.includes("Ranchers"))!;
    expect(stored.fullText!.length).toBeGreaterThan(5_000);
    // The phrase that started this work. It is in the order's body seven times
    // and in its title not at all.
    expect(stored.fullText!.toLowerCase()).toContain("mexican wolf");
    expect(stored.signedDate?.toISOString().slice(0, 10)).toBe("2026-09-04");
  });

  test("a record arrives saying its number is not real yet", async () => {
    serve({ whiteHouse: feed });
    await intakeOrdersSignedOn("2026-09-04");

    for (const record of await eos()) {
      expect(record.numberStatus).toBe(NumberStatus.PENDING);
      expect(record.numberConfirmedAt).toBeNull();
    }
  });

  test("running the same day twice does not create a second copy", async () => {
    serve({ whiteHouse: feed });
    await intakeOrdersSignedOn("2026-09-04");
    const second = await intakeOrdersSignedOn("2026-09-04");

    expect(second.created).toBe(0);
    expect(second.alreadyHeld).toBe(2);
    expect((await eos()).length).toBe(2);
  });

  test("an order the Register already gave us is recognised, not duplicated", async () => {
    // The cross-reference that matters most: a backfill of an old day, where
    // the nightly Register sync got there first. Same order, its own title,
    // already numbered.
    await prisma.governmentReference.create({
      data: {
        masterReferenceId: "eo-14424",
        referenceType: "executive_order",
        title: "Supporting America's Ranchers",
        status: "active",
        category: "agriculture",
        signedDate: new Date("2026-09-04T00:00:00.000Z"),
      },
    });

    serve({ whiteHouse: feed });
    const report = await intakeOrdersSignedOn("2026-09-04");

    expect(report.alreadyHeld).toBe(1);
    expect(report.created).toBe(1);
    const ids = (await eos()).map((r) => r.masterReferenceId);
    expect(ids).toContain("eo-14424");
    expect(ids.filter((id) => id.startsWith("eo-2026-09-04")).length).toBe(1);
  });

  test("a feed that will not answer writes nothing and says so", async () => {
    serve({ whiteHouse: 503 });
    const report = await intakeOrdersSignedOn("2026-09-04");

    // Not "a quiet day". A source that could not be asked must never look like
    // a source that answered "nothing".
    expect(report.reached).toBe(false);
    expect(report.created).toBe(0);
    expect((await eos()).length).toBe(0);
  });

  test("a day nobody signed anything is a real answer", async () => {
    serve({ whiteHouse: feed });
    const report = await intakeOrdersSignedOn("2026-09-01");

    expect(report.reached).toBe(true);
    expect(report.found).toBe(0);
    expect(report.created).toBe(0);
  });
});

describe("deciding we already hold an order", () => {
  const candidate = (title: string, extra: Record<string, unknown> = {}) => ({
    id: "x",
    masterReferenceId: "eo-1",
    title,
    sourceUrl: null,
    ...extra,
  });

  test("the same page at the same address is the same order", () => {
    expect(alreadyHeld(ranchers, [candidate("A different title", { sourceUrl: ranchers.url })])).not.toBeNull();
  });

  test("the Register's reworded title still matches", () => {
    expect(
      alreadyHeld(
        { ...ranchers, title: "Further Exclusions from the Federal Labor-Management Relations Program" },
        [candidate("Further Exclusions From the Federal Labor- Management Relations Program")],
      ),
    ).not.toBeNull();
  });

  test("two orders signed the same day are not each other", () => {
    // Both 4 September 2026, both about livestock. Getting this wrong would put
    // one order's votes on the other.
    const other = orders.find((o) => o.title.includes("Livestock"))!;
    expect(alreadyHeld(ranchers, [candidate(other.title)])).toBeNull();
  });

  test("the closeness bar is set above the worst real same-day pair", () => {
    expect(SAME_ORDER_CLOSENESS).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------

const registerSays = (docs: Array<Record<string, unknown>>) => ({ count: docs.length, results: docs });

const RANCHERS_IN_REGISTER = {
  title: "Supporting America's Ranchers",
  subtype: "Executive Order",
  executive_order_number: "14424",
  signing_date: "2026-09-04",
  publication_date: "2026-09-09",
  html_url: "https://www.federalregister.gov/documents/2026/09/09/supporting-americas-ranchers",
  document_number: "2026-17000",
};

async function onePendingOrder() {
  serve({ whiteHouse: feed });
  await intakeOrdersSignedOn("2026-09-04");
  const record = (await eos()).find((r) => r.title.includes("Ranchers"))!;
  return record;
}

describe("the Federal Register hands out the number", () => {
  test("a published order is renamed, and its old name still answers", async () => {
    const record = await onePendingOrder();

    serve({ register: registerSays([RANCHERS_IN_REGISTER]) });
    const result = await settleOneNumber(record.id, { allowAI: false });

    expect(result).toEqual({ outcome: "confirmed", masterReferenceId: "eo-14424" });

    const after = await prisma.governmentReference.findUnique({ where: { id: record.id } });
    expect(after!.masterReferenceId).toBe("eo-14424");
    expect(after!.numberStatus).toBe(NumberStatus.CONFIRMED);
    expect(after!.numberConfirmedAt).not.toBeNull();

    // The starred name is not discarded. Anything that reached the record under
    // it still does.
    const oldName = await prisma.referenceName.findUnique({ where: { name: "eo-2026-09-04*" } });
    expect(oldName?.referenceId).toBe(record.id);
  });

  test("the public address does not move when the number lands", async () => {
    const record = await onePendingOrder();
    const before = (await prisma.governmentReference.findUnique({ where: { id: record.id } }))!.slug;

    serve({ register: registerSays([RANCHERS_IN_REGISTER]) });
    await settleOneNumber(record.id, { allowAI: false });

    const after = (await prisma.governmentReference.findUnique({ where: { id: record.id } }))!.slug;
    expect(after).toBe(before);
  });

  test("an order the Register publishes without a number stops being asked about", async () => {
    // Real shape: the Antifa designation and the EMCORE divestment are both
    // filed this way. Not a failure — an answer.
    const record = await onePendingOrder();

    serve({
      register: registerSays([
        { ...RANCHERS_IN_REGISTER, subtype: "Presidential Order", executive_order_number: null },
      ]),
    });
    const result = await settleOneNumber(record.id, { allowAI: false });

    expect(result.outcome).toBe("never_numbered");
    const after = await prisma.governmentReference.findUnique({ where: { id: record.id } });
    expect(after!.numberStatus).toBe(NumberStatus.NEVER_NUMBERED);
    expect(after!.masterReferenceId).toBe("eo-2026-09-04*");
    expect(after!.numberConfirmedAt).not.toBeNull();
  });

  test("not published yet leaves the record alone and records the asking", async () => {
    const record = await onePendingOrder();

    serve({ register: registerSays([]) });
    const result = await settleOneNumber(record.id, { allowAI: false });

    expect(result.outcome).toBe("still_waiting");
    const after = await prisma.governmentReference.findUnique({ where: { id: record.id } });
    expect(after!.numberStatus).toBe(NumberStatus.PENDING);
    expect(after!.numberAskedAt).not.toBeNull();
    expect(after!.numberConfirmedAt).toBeNull();
  });

  test("a Register we cannot reach changes nothing at all", async () => {
    const record = await onePendingOrder();

    serve({ register: 500 });
    const result = await settleOneNumber(record.id, { allowAI: false });

    expect(result.outcome).toBe("unreachable");
    const after = await prisma.governmentReference.findUnique({ where: { id: record.id } });
    expect(after!.numberStatus).toBe(NumberStatus.PENDING);
    // Not even the asking is written: "we could not ask" and "we asked and it
    // said nothing" are different facts.
    expect(after!.numberAskedAt).toBeNull();
  });

  test("the Register's signing date corrects ours", async () => {
    // The White House posted this one four days after it was signed. Our date
    // came from when they posted; theirs is the day it was signed.
    const record = await onePendingOrder();

    serve({
      register: registerSays([{ ...RANCHERS_IN_REGISTER, signing_date: "2026-08-31" }]),
    });
    await settleOneNumber(record.id, { allowAI: false });

    const after = await prisma.governmentReference.findUnique({ where: { id: record.id } });
    expect(after!.signedDate?.toISOString().slice(0, 10)).toBe("2026-08-31");
  });
});

describe("when the real number is already taken", () => {
  test("the same order, held twice, is folded into one and keeps every vote", async () => {
    const record = await onePendingOrder();
    const text = (await prisma.governmentReference.findUnique({ where: { id: record.id } }))!.fullText!;

    // The Register's own sync got there first, with the same text.
    const rival = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "eo-14424",
        referenceType: "executive_order",
        title: "Supporting America's Ranchers",
        status: "active",
        category: "agriculture",
        fullText: text,
        signedDate: new Date("2026-09-04T00:00:00.000Z"),
      },
    });
    await prisma.referenceName.create({
      data: { name: "eo-14424", referenceId: rival.id, isCurrent: true, learnedFrom: "created" },
    });

    serve({ register: registerSays([RANCHERS_IN_REGISTER]) });
    const result = await settleOneNumber(record.id, { allowAI: false });

    // Identical text is proof, not inference — no model is consulted.
    expect(result.outcome).toBe("merged");

    const survivors = await prisma.governmentReference.findMany({
      where: { referenceType: "executive_order", mergedIntoId: null },
    });
    // The merged pair became one; the Livestock order signed the same day is
    // the other, and is untouched.
    expect(survivors.length).toBe(2);

    // The survivor is the record that was already correctly named. Nothing had
    // to be renamed, which is what makes this work at all: masterReferenceId is
    // unique, and a merged-away row keeps its own.
    const ranchersRow = survivors.find((r) => r.title.includes("Ranchers"))!;
    expect(ranchersRow.id).toBe(rival.id);
    expect(ranchersRow.masterReferenceId).toBe("eo-14424");
    expect(ranchersRow.numberStatus).toBe(NumberStatus.CONFIRMED);

    // And the starred name still reaches it, so a link shared in the days
    // before the number arrived does not die.
    const starred = await prisma.referenceName.findUnique({ where: { name: "eo-2026-09-04*" } });
    expect(starred?.referenceId).toBe(rival.id);
  });

  test("two records that are not the same order go to a person, not a machine", async () => {
    const record = await onePendingOrder();

    // Same number claimed, genuinely different text. With the model switched
    // off the adjudicator says "unsure", which is the escalation path.
    const rival = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "eo-14424",
        referenceType: "executive_order",
        title: "An entirely unrelated order about maritime shipping lanes",
        status: "active",
        category: "other",
        fullText: "By the authority vested in me, the Secretary shall chart lanes. ".repeat(20),
        signedDate: new Date("2026-09-04T00:00:00.000Z"),
      },
    });
    await prisma.referenceName.create({
      data: { name: "eo-14424", referenceId: rival.id, isCurrent: true, learnedFrom: "created" },
    });

    serve({ register: registerSays([RANCHERS_IN_REGISTER]) });
    const result = await settleOneNumber(record.id, { allowAI: false });

    expect(result.outcome).toBe("queued");

    // It is in front of a reviewer, in the queue the admin portal reads.
    const pair = [record.id, rival.id].sort();
    const filed = await prisma.referenceMergeCandidate.findUnique({
      where: { leftId_rightId: { leftId: pair[0]!, rightId: pair[1]! } },
    });
    expect(filed?.status).toBe("pending");

    // And neither record was renamed on a guess.
    const after = await prisma.governmentReference.findUnique({ where: { id: record.id } });
    expect(after!.masterReferenceId).toBe("eo-2026-09-04*");
  });

  test("a pair already waiting on a reviewer is not re-decided every night", async () => {
    const record = await onePendingOrder();
    const rival = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "eo-14424",
        referenceType: "executive_order",
        title: "An entirely unrelated order about maritime shipping lanes",
        status: "active",
        category: "other",
        fullText: "By the authority vested in me, the Secretary shall chart lanes. ".repeat(20),
        signedDate: new Date("2026-09-04T00:00:00.000Z"),
      },
    });
    await prisma.referenceName.create({
      data: { name: "eo-14424", referenceId: rival.id, isCurrent: true, learnedFrom: "created" },
    });

    serve({ register: registerSays([RANCHERS_IN_REGISTER]) });
    await settleOneNumber(record.id, { allowAI: false });

    // Second night: the pair is already filed, so nothing re-adjudicates it —
    // asking a model the same question nightly is how a bill becomes expensive.
    serve({ register: registerSays([RANCHERS_IN_REGISTER]) });
    const again = await settleOneNumber(record.id, { allowAI: false });
    expect(again).toEqual({ outcome: "queued", against: rival.id });
  });
});

describe("reading the Register's answer", () => {
  test("a proclamation signed the same day is never mistaken for the order", () => {
    const found = findInRegister("The Gold Card", [
      {
        title: "The Gold Card",
        subtype: "Proclamation",
        executive_order_number: null,
        signing_date: "2025-09-19",
        publication_date: null,
        html_url: null,
        document_number: null,
      },
    ]);
    expect(found).toBeNull();
  });

  test("an order whose title the Register reworded is still found", () => {
    const found = findInRegister("Providing for the Closure of Executive Departments and Agencies", [
      {
        title: "Providing for the Closing of Executive Departments and Agencies",
        subtype: "Executive Order",
        executive_order_number: "14370",
        signing_date: "2025-12-18",
        publication_date: null,
        html_url: null,
        document_number: null,
      },
    ]);
    expect(found?.executive_order_number).toBe("14370");
  });
});
