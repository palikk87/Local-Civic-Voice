/**
 * FINDING AN ORDER BY WHAT IT IS ABOUT, ON THE DAY IT IS SIGNED.
 *
 * The failure this exists to prevent, in the words of the person who hit it:
 * he saw news about Mexican wolves, went looking for the order, found nothing
 * here, had to go to whitehouse.gov to learn its real name — "Supporting
 * America's Ranchers" — came back, searched that, and still found nothing.
 *
 * Two separate faults there. The record was missing, which the intake fixes.
 * And the search never asked our own database at all, which is this.
 *
 * The embedding model is replaced with a deterministic stand-in. What is under
 * test is the shelf: which records are searched, what is done with the scores,
 * and whether an order shows up twice once the Register has it too. Whether
 * OpenAI's vectors are any good is not this suite's question.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { prisma, resetData, startServer, stopServer } from "./helpers/server";
import { cosine, SHELF_MATCH_FLOOR } from "../src/services/order-embeddings";
import { pendingOrderAsDocument } from "../src/services/executive-search";
import { NumberStatus } from "../src/services/executive-order-numbering";

const realFetch = globalThis.fetch;

/**
 * A stand-in embedding: one dimension per word we care about, so "similar"
 * means "shares vocabulary" and the arithmetic is checkable by hand.
 */
const AXES = ["wolf", "rancher", "livestock", "vaccine", "tariff", "quantum"];
function toyVector(text: string): number[] {
  const words = text.toLowerCase();
  return AXES.map((axis) => (words.includes(axis) ? 1 : 0));
}

function serveEmbeddings() {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("api.openai.com/v1/embeddings")) {
      throw new Error(`unexpected host in test: ${url}`);
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string };
    return new Response(JSON.stringify({ data: [{ embedding: toyVector(body.input ?? "") }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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
  process.env.OPENAI_API_KEY = "test-key-not-a-real-one";
  serveEmbeddings();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function order(overrides: Record<string, unknown> = {}) {
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `eo-2026-09-04*`,
      referenceType: "executive_order",
      title: "Supporting America's Ranchers",
      status: "active",
      category: "agriculture",
      slug: "supporting-americas-ranchers",
      signedDate: new Date("2026-09-04T00:00:00.000Z"),
      numberStatus: NumberStatus.PENDING,
      fullText:
        "By the authority vested in me it is ordered. The Secretary shall review the " +
        "Mexican wolf recovery program as it affects livestock producers and rancher " +
        "operations across the affected States. ".repeat(6),
      ...overrides,
    },
  });
}

describe("the shelf answers what the Register cannot", () => {
  test("an order is found by a phrase in its body that is not in its title", async () => {
    // The exact failure: "Mexican wolves" appears seven times inside the real
    // order and nowhere in its name.
    await order();

    const { embedPendingOrders, searchPendingOrders } = await import("../src/services/order-embeddings");
    await embedPendingOrders();

    const hits = await searchPendingOrders("mexican wolf");
    expect(hits.length).toBe(1);
    expect(hits[0]!.title).toBe("Supporting America's Ranchers");
    expect(hits[0]!.similarity).toBeGreaterThanOrEqual(SHELF_MATCH_FLOOR);
  });

  test("an unrelated question does not drag the shelf into the results", async () => {
    await order();
    const { embedPendingOrders, searchPendingOrders } = await import("../src/services/order-embeddings");
    await embedPendingOrders();

    expect(await searchPendingOrders("quantum")).toEqual([]);
  });

  test("only orders still waiting on a number are on the shelf", async () => {
    // Once the Register publishes an order, its own full-text search covers it.
    // Keeping it here would be paying twice and showing it twice.
    await order({ numberStatus: NumberStatus.CONFIRMED, masterReferenceId: "eo-14424" });

    const { embedPendingOrders, searchPendingOrders } = await import("../src/services/order-embeddings");
    const written = await embedPendingOrders();

    expect(written.embedded).toBe(0);
    expect(await searchPendingOrders("mexican wolf")).toEqual([]);
  });

  test("a record merged away is not searched", async () => {
    const survivor = await order({ masterReferenceId: "eo-14424", slug: "kept" });
    await order({
      masterReferenceId: "eo-2026-09-04-2*",
      slug: "folded-away",
      mergedIntoId: survivor.id,
    });

    const { embedPendingOrders, searchPendingOrders } = await import("../src/services/order-embeddings");
    await embedPendingOrders();

    const hits = await searchPendingOrders("mexican wolf");
    expect(hits.every((h) => h.slug !== "folded-away")).toBe(true);
  });

  test("text that changed under us is re-embedded, not searched stale", async () => {
    // The White House re-publishes an order when the signed PDF is attached. A
    // vector of the old words is a search against a document that no longer
    // exists.
    const record = await order();
    const { embedPendingOrders } = await import("../src/services/order-embeddings");
    await embedPendingOrders();
    const first = await prisma.governmentReference.findUnique({ where: { id: record.id } });

    await prisma.governmentReference.update({
      where: { id: record.id },
      data: { fullText: "By the authority vested in me, tariff schedules are amended. ".repeat(8) },
    });
    const second = await embedPendingOrders();

    expect(second.embedded).toBe(1);
    const after = await prisma.governmentReference.findUnique({ where: { id: record.id } });
    expect(after!.textEmbedding).not.toBe(first!.textEmbedding);
    expect(after!.textEmbeddingHash).not.toBe(first!.textEmbeddingHash);
  });

  test("unchanged text is not paid for twice", async () => {
    await order();
    const { embedPendingOrders } = await import("../src/services/order-embeddings");
    await embedPendingOrders();
    const again = await embedPendingOrders();

    expect(again.embedded).toBe(0);
    expect(again.skipped).toBe(1);
  });

  test("with no key configured the shelf is silent and costs nothing", async () => {
    // env reads secrets live from process.env on every access, so this is the
    // real deployment condition and not a stub — see the liveSecrets note in
    // src/env.ts.
    await order();
    const { embedPendingOrders, searchPendingOrders } = await import("../src/services/order-embeddings");
    await embedPendingOrders();

    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = (async () => {
      throw new Error("no request should be made without a key");
    }) as unknown as typeof fetch;
    try {
      expect(await searchPendingOrders("mexican wolf")).toEqual([]);
      expect(await embedPendingOrders()).toEqual({ embedded: 0, skipped: 0, failed: 0 });
    } finally {
      process.env.OPENAI_API_KEY = previous;
    }
  });

  test("an embedding provider that refuses leaves the search silent, not broken", async () => {
    // This runs alongside the Federal Register search, and the Register's
    // results are the ones a reader must get either way. A shelf that threw
    // would take the whole search down with it.
    await order();
    const { embedPendingOrders, searchPendingOrders } = await import("../src/services/order-embeddings");
    await embedPendingOrders();

    globalThis.fetch = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    expect(await searchPendingOrders("mexican wolf")).toEqual([]);
  });

  test("a provider that refuses mid-backfill reports the failure rather than storing nothing quietly", async () => {
    await order();
    globalThis.fetch = (async () => new Response("nope", { status: 429 })) as unknown as typeof fetch;

    const { embedPendingOrders } = await import("../src/services/order-embeddings");
    const result = await embedPendingOrders();

    expect(result.embedded).toBe(0);
    expect(result.failed).toBe(1);
  });
});

describe("a pending order shown next to Register documents", () => {
  test("it carries no order number, because none has been assigned", () => {
    const doc = pendingOrderAsDocument({
      slug: "supporting-americas-ranchers",
      masterReferenceId: "eo-2026-09-04*",
      title: "Supporting America's Ranchers",
      signedDate: new Date("2026-09-04T00:00:00.000Z"),
    });

    expect(doc.executive_order_number).toBe("");
    expect(doc.publication_date).toBe("");
    expect(doc.signing_date).toBe("2026-09-04");
    expect(doc.just_signed).toBe(true);
  });

  test("it points at our record, not at a Register document that does not exist", () => {
    const doc = pendingOrderAsDocument({
      slug: "supporting-americas-ranchers",
      masterReferenceId: "eo-2026-09-04*",
      title: "Supporting America's Ranchers",
      signedDate: null,
    });
    expect(doc.reference_id).toBe("supporting-americas-ranchers");
    expect(doc.document_number).toBe("");
  });

  test("without a readable address it falls back to the record's name", () => {
    const doc = pendingOrderAsDocument({
      slug: null,
      masterReferenceId: "eo-2026-09-04*",
      title: "Supporting America's Ranchers",
      signedDate: null,
    });
    expect(doc.reference_id).toBe("eo-2026-09-04*");
  });
});

describe("comparing two vectors", () => {
  test("identical directions score 1", () => {
    expect(cosine([1, 0, 1], [1, 0, 1])).toBeCloseTo(1);
  });

  test("nothing in common scores 0", () => {
    expect(cosine([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  test("a length mismatch is refused rather than truncated", () => {
    // Two different models, or a half-written column. Answering 0 is safer than
    // answering from the dimensions that happen to line up.
    expect(cosine([1, 0, 1], [1, 0])).toBe(0);
  });

  test("an all-zero vector cannot divide by zero", () => {
    expect(cosine([0, 0, 0], [1, 1, 1])).toBe(0);
  });
});
