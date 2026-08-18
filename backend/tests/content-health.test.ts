/**
 * Can somebody see, in one request, whether all three branches are pulling
 * full text?
 *
 * THE FAILURE THIS EXISTS FOR. Briefs stopped working across bills, executive
 * orders and Supreme Court cases at the same time. Every source key was valid.
 * From outside, all three said the same sentence — "the official text isn't
 * published anywhere we can read yet" — and that sentence covers four unrelated
 * failures: no key, a rejected key, a throttled key, and a fetch that stored
 * markup instead of text. None of them is about the law, and none of them was
 * visible without reading server logs.
 *
 * This reports what the pipeline actually stored, per branch. It runs no
 * requests of its own, which is the point: a second implementation of three
 * branch-specific fetchers would drift from them and then report confidently on
 * code nobody runs.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BASE_URL, prisma, startServer, stopServer } from "./helpers/server";

let headers: Record<string, string>;
const created: string[] = [];

async function seed(input: {
  masterReferenceId: string;
  referenceType: string;
  title: string;
  fullText?: string;
  fullTextSource?: string;
  briefCurrent?: boolean;
}): Promise<void> {
  const row = await prisma.governmentReference.create({
    data: {
      masterReferenceId: input.masterReferenceId,
      referenceType: input.referenceType,
      title: input.title,
      status: "active",
      fullText: input.fullText,
      fullTextSource: input.fullTextSource,
      lawVersion: 1,
      ...(input.briefCurrent
        ? { citizenBriefJson: JSON.stringify({ format: 2 }), citizenBriefVersion: 1 }
        : {}),
    },
    select: { id: true },
  });
  created.push(row.id);
}

beforeAll(async () => {
  await startServer();

  const token = `admin_test_${Math.random().toString(36).slice(2)}`;
  await prisma.adminSession.create({
    data: {
      token,
      adminId: "test-content-health",
      username: "test-content-health",
      role: "superadmin",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  headers = { Authorization: `Bearer ${token}` };

  const law = "This Act may be cited as the Test Act. ".repeat(20);

  // A branch that is working.
  await seed({ masterReferenceId: "ch-hr-1-999", referenceType: "bill", title: "Working Bill", fullText: law, fullTextSource: "congress.gov/text", briefCurrent: true });
  await seed({ masterReferenceId: "ch-hr-2-999", referenceType: "bill", title: "Text But No Brief", fullText: law, fullTextSource: "congress.gov/text" });

  // A branch that is not: the record exists, the text does not.
  await seed({ masterReferenceId: "ch-eo-99991", referenceType: "executive_order", title: "Order With No Text" });

  // And one that only ever answers from a fallback, which is working in the
  // sense that something came back and in no other sense.
  await seed({ masterReferenceId: "ch-scotus-99-1", referenceType: "scotus_case", title: "Case From Fallback", fullText: law, fullTextSource: "courtlistener/docket-search" });
});

afterAll(async () => {
  await prisma.governmentReference.deleteMany({ where: { id: { in: created } } });
  await prisma.adminSession.deleteMany({ where: { adminId: "test-content-health" } });
  await stopServer();
});

interface Branch {
  referenceType: string;
  records: number;
  withText: number;
  withoutText: number;
  medianTextChars: number | null;
  briefsCurrent: number;
  sources: Array<{ source: string; count: number }>;
}

async function health(): Promise<{ branches: Branch[]; configured: Record<string, boolean> }> {
  const response = await fetch(`${BASE_URL}/api/admin/content-health`, { headers });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as {
    data: { branches: Branch[]; configured: Record<string, boolean> };
  };
  return payload.data;
}

describe("content health", () => {
  test("needs an admin token", async () => {
    const response = await fetch(`${BASE_URL}/api/admin/content-health`);
    expect(response.status).toBe(401);
  });

  test("separates a branch that has text from one that does not", async () => {
    const { branches } = await health();

    const bills = branches.find((b) => b.referenceType === "bill")!;
    expect(bills.withText).toBeGreaterThanOrEqual(2);
    expect(bills.medianTextChars).toBeGreaterThan(200);

    const orders = branches.find((b) => b.referenceType === "executive_order")!;
    // The record is counted, and counted as having nothing — which is the
    // distinction the old "no official text available" message could not make.
    expect(orders.records).toBeGreaterThanOrEqual(1);
    expect(orders.withoutText).toBeGreaterThanOrEqual(1);
  });

  test("names which source the text came from", async () => {
    const { branches } = await health();

    const scotus = branches.find((b) => b.referenceType === "scotus_case")!;
    const fallback = scotus.sources.find((s) => s.source === "courtlistener/docket-search");
    expect(fallback).toBeDefined();
    expect(fallback!.count).toBeGreaterThanOrEqual(1);

    const bills = branches.find((b) => b.referenceType === "bill")!;
    expect(bills.sources.some((s) => s.source === "congress.gov/text")).toBe(true);
  });

  test("counts a brief only when it describes the version of the law on the record", async () => {
    const { branches } = await health();
    const bills = branches.find((b) => b.referenceType === "bill")!;

    // Two bills hold text; one holds a brief written for lawVersion 1.
    expect(bills.briefsCurrent).toBeGreaterThanOrEqual(1);
    expect(bills.briefsCurrent).toBeLessThan(bills.withText + 1);
  });

  test("says whether a brief can be written at all", async () => {
    // Text is half of it. With no model key there is no brief for any branch,
    // and reading three healthy source counts told nobody that.
    const { configured } = await health();
    expect(configured).toHaveProperty("briefWriter");
    expect(configured).toHaveProperty("congress");
    expect(configured).toHaveProperty("courtListener");
    expect(configured).toHaveProperty("federalRegister");
  });

  test("says whether search can understand this week's news", async () => {
    // Without live web grounding, search interprets from the model's training
    // data alone. Settled law still resolves — a question about phone privacy
    // reaches Carpenter v. United States either way — but a ruling from the
    // last few days is a thing the model has never heard of and cannot
    // translate into the words the document actually uses.
    //
    // It fails quietly: search keeps working, slightly worse, on exactly the
    // queries people type after watching the news. So it is reported.
    const { configured } = await health();
    expect(configured).toHaveProperty("searchGrounding");
    expect(typeof configured.searchGrounding).toBe("boolean");
  });
});
